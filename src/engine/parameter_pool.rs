//! Bounded reuse of empty argument buffers, never of argument values.
use super::Cell;

#[derive(Default)]
pub(super) struct ParameterPool {
    buffers: Vec<Vec<Cell>>,
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
        #[cfg(feature = "interp-profile")]
        super::interp_profile::count(if self.buffers.is_empty() {
            "parameters/miss"
        } else {
            "parameters/hit"
        });
        let mut buffer = self.buffers.pop().unwrap_or_default();
        #[cfg(feature = "interp-profile")]
        if buffer.capacity() < count {
            super::interp_profile::count("parameters/grow");
        }
        buffer.reserve(count);
        buffer
    }

    pub(super) fn recycle(&mut self, mut buffer: Vec<Cell>) {
        // Drop every reference at the original return boundary, including when
        // the buffer is too large to retain. Returned lists retain their own Rc.
        buffer.clear();
        if (1..=64).contains(&buffer.capacity()) && self.buffers.len() < 16 {
            self.buffers.push(buffer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn buffers_are_empty_bounded_and_release_argument_references() {
        let mut pool = ParameterPool::default();
        let list = Rc::new(RefCell::new(vec![Cell::Bool(true)]));
        let mut buffer = pool.take(3);
        buffer.push(Cell::List(list.clone()));
        let pointer = buffer.as_ptr();
        pool.recycle(buffer);
        assert_eq!(Rc::strong_count(&list), 1);
        assert_eq!(pool.take(0).capacity(), 0);
        let buffer = pool.take(1);
        assert!(buffer.is_empty());
        assert_eq!(buffer.as_ptr(), pointer);
        pool.recycle(buffer);
        pool.recycle(Vec::with_capacity(65));
        for _ in 0..32 {
            pool.recycle(Vec::with_capacity(1));
        }
        assert_eq!(pool.buffers.len(), 16);
        assert!(
            pool.buffers
                .iter()
                .all(|b| b.is_empty() && b.capacity() <= 64)
        );
    }
}
