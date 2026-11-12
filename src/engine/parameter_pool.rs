//! Bounded reuse of empty argument buffers, never of argument values.
use super::Cell;

const MAX_BUFFER_CAPACITY: usize = 64;
const BUCKET_COUNT: usize = MAX_BUFFER_CAPACITY.ilog2() as usize + 1;
// Enough for hundreds of small, simultaneously live argument buffers without
// retaining an unbounded high-water mark after a deeply nested call returns.
// The cell budget bounds backing storage; the count also bounds Vec metadata.
const MAX_RETAINED_CELLS: usize = 8192;
const MAX_RETAINED_BUFFERS: usize = 512;

#[derive(Default)]
pub(super) struct ParameterPool {
    // Bucket i contains capacities [2^i, 2^(i+1)), capped at 64. Empty
    // buckets allocate no metadata, and each nonempty bucket is a LIFO stack.
    buffers: [Vec<Vec<Cell>>; BUCKET_COUNT],
    retained_cells: usize,
    retained_buffers: usize,
}

impl ParameterPool {
    pub(super) fn take(&mut self, count: usize) -> Vec<Cell> {
        #[cfg(feature = "interp-profile")]
        let _profile = super::interp_profile::span("parameters", &count);
        // Zero-argument calls do not allocate, nor should they consume a buffer
        // that a nested, nonempty call could reuse.
        if count == 0 {
            #[cfg(feature = "interp-profile")]
            super::interp_profile::count("parameters/zero");
            return Vec::new();
        }
        // Round small requests up to a tier boundary so every buffer in that
        // tier is large enough. Prefer the smallest fitting tier, not whichever
        // arity happened to return last. Oversized calls never drain the pool.
        let requested_capacity = if count <= MAX_BUFFER_CAPACITY {
            count.next_power_of_two()
        } else {
            count
        };
        let reused = if count <= MAX_BUFFER_CAPACITY {
            let first = requested_capacity.ilog2() as usize;
            self.buffers[first..].iter_mut().find_map(Vec::pop)
        } else {
            None
        };
        #[cfg(feature = "interp-profile")]
        super::interp_profile::count(if reused.is_some() {
            "parameters/hit"
        } else {
            "parameters/miss"
        });
        let mut buffer = match reused {
            Some(buffer) => {
                self.retained_cells -= buffer.capacity();
                self.retained_buffers -= 1;
                buffer
            }
            None => Vec::new(),
        };
        debug_assert!(buffer.is_empty());
        #[cfg(feature = "interp-profile")]
        if buffer.capacity() < count {
            super::interp_profile::count("parameters/grow");
        }
        buffer.reserve(requested_capacity);
        buffer
    }

    pub(super) fn recycle(&mut self, mut buffer: Vec<Cell>) {
        // Drop every reference at the original return boundary, including when
        // the buffer is too large to retain. Returned lists retain their own Rc.
        buffer.clear();
        let capacity = buffer.capacity();
        if (1..=MAX_BUFFER_CAPACITY).contains(&capacity)
            && self.retained_buffers < MAX_RETAINED_BUFFERS
            && self.retained_cells + capacity <= MAX_RETAINED_CELLS
        {
            self.retained_cells += capacity;
            self.retained_buffers += 1;
            self.buffers[capacity.ilog2() as usize].push(buffer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    fn assert_invariants(pool: &ParameterPool) {
        let buffers: Vec<_> = pool.buffers.iter().flatten().collect();
        assert_eq!(pool.retained_buffers, buffers.len());
        assert_eq!(
            pool.retained_cells,
            buffers.iter().map(|b| b.capacity()).sum::<usize>()
        );
        assert!(pool.retained_buffers <= MAX_RETAINED_BUFFERS);
        assert!(pool.retained_cells <= MAX_RETAINED_CELLS);
        for (index, bucket) in pool.buffers.iter().enumerate() {
            for buffer in bucket {
                assert!(buffer.is_empty());
                assert!((1..=MAX_BUFFER_CAPACITY).contains(&buffer.capacity()));
                assert_eq!(buffer.capacity().ilog2() as usize, index);
            }
        }
    }

    #[test]
    fn buffers_are_empty_and_zero_arguments_leave_the_pool_untouched() {
        let mut pool = ParameterPool::default();
        let list = Rc::new(RefCell::new(vec![Cell::Bool(true)]));
        let mut buffer = pool.take(3);
        buffer.push(Cell::List(list.clone()));
        let pointer = buffer.as_ptr();
        pool.recycle(buffer);
        assert_eq!(Rc::strong_count(&list), 1);
        let retained = (pool.retained_cells, pool.retained_buffers);
        assert_eq!(pool.take(0).capacity(), 0);
        let empty = pool.take(0);
        pool.recycle(empty);
        assert_eq!((pool.retained_cells, pool.retained_buffers), retained);
        let buffer = pool.take(1);
        assert!(buffer.is_empty());
        assert_eq!(buffer.as_ptr(), pointer);
        pool.recycle(buffer);
        assert_invariants(&pool);
    }

    #[test]
    fn deep_calls_reuse_every_buffer_after_warmup() {
        let mut pool = ParameterPool::default();
        let mut pointers = Vec::new();
        // Match the reporter depth limit, well above the previous 16 buffers.
        for round in 0..4 {
            let mut active = Vec::new();
            for depth in 0..200 {
                let mut buffer = pool.take(3);
                assert!(buffer.is_empty());
                assert!(buffer.capacity() >= 3);
                if round == 0 {
                    pointers.push(buffer.as_ptr());
                } else {
                    assert_eq!(buffer.as_ptr(), pointers[depth]);
                }
                buffer.push(Cell::Number(depth as f64));
                active.push(buffer);
            }
            assert_eq!(pool.retained_buffers, 0);
            while let Some(buffer) = active.pop() {
                pool.recycle(buffer);
            }
            assert_eq!(pool.retained_buffers, 200);
            assert_invariants(&pool);
        }
    }

    #[test]
    fn mixed_arities_prefer_the_smallest_fitting_tier() {
        let mut pool = ParameterPool::default();
        let small = pool.take(3);
        let large = pool.take(33);
        let small_pointer = small.as_ptr();
        let large_pointer = large.as_ptr();
        pool.recycle(small);
        pool.recycle(large);
        let small = pool.take(3);
        assert_eq!(small.as_ptr(), small_pointer);
        let large = pool.take(48);
        assert_eq!(large.as_ptr(), large_pointer);
        pool.recycle(small);
        pool.recycle(large);
        assert_invariants(&pool);
    }

    #[test]
    fn larger_tiers_can_supply_smaller_calls_without_growing() {
        let mut pool = ParameterPool::default();
        let buffer = pool.take(33);
        let pointer = buffer.as_ptr();
        pool.recycle(buffer);
        let buffer = pool.take(1);
        assert_eq!(buffer.as_ptr(), pointer);
        assert_eq!(pool.retained_cells, 0);
        assert_eq!(pool.retained_buffers, 0);
        pool.recycle(buffer);
        assert_invariants(&pool);
    }

    #[test]
    fn arbitrary_returned_capacities_never_supply_an_undersized_buffer() {
        let mut pool = ParameterPool::default();
        for capacity in 1..=MAX_BUFFER_CAPACITY {
            pool.recycle(Vec::with_capacity(capacity));
        }
        for count in 1..=MAX_BUFFER_CAPACITY {
            let buffer = pool.take(count);
            assert!(buffer.is_empty());
            assert!(buffer.capacity() >= count);
            assert_invariants(&pool);
        }
    }

    #[test]
    fn oversized_calls_do_not_consume_retained_buffers() {
        let mut pool = ParameterPool::default();
        let small = pool.take(1);
        let pointer = small.as_ptr();
        pool.recycle(small);
        let retained = (pool.retained_cells, pool.retained_buffers);
        let oversized = pool.take(MAX_BUFFER_CAPACITY + 1);
        assert!(oversized.capacity() > MAX_BUFFER_CAPACITY);
        pool.recycle(oversized);
        assert_eq!((pool.retained_cells, pool.retained_buffers), retained);
        let small = pool.take(1);
        assert_eq!(small.as_ptr(), pointer);
        assert_invariants(&pool);
    }

    #[test]
    fn count_and_capacity_limits_release_even_rejected_argument_references() {
        let list = Rc::new(RefCell::new(vec![Cell::Bool(true)]));
        for capacity in [1, MAX_BUFFER_CAPACITY] {
            let mut pool = ParameterPool::default();
            for _ in 0..MAX_RETAINED_BUFFERS + 1 {
                let mut buffer = Vec::with_capacity(capacity);
                buffer.push(Cell::List(list.clone()));
                pool.recycle(buffer);
                assert_eq!(Rc::strong_count(&list), 1);
                assert_invariants(&pool);
            }
            if capacity == 1 {
                assert_eq!(pool.retained_buffers, MAX_RETAINED_BUFFERS);
            } else {
                assert_eq!(pool.retained_cells, MAX_RETAINED_CELLS);
            }
        }
        let mut pool = ParameterPool::default();
        let mut oversized = Vec::with_capacity(MAX_BUFFER_CAPACITY + 1);
        oversized.push(Cell::List(list.clone()));
        pool.recycle(oversized);
        assert_eq!(Rc::strong_count(&list), 1);
        assert_eq!(pool.retained_buffers, 0);
        assert_invariants(&pool);
    }
}
