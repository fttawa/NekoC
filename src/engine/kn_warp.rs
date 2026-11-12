//! KN's per-interpreter-step warp slice. This is deliberately separate from the
//! K4 counter: the two released runtimes have different limits.
use std::time::{Duration, Instant};

pub(super) const ITERATION_LIMIT: u32 = 30_000;
const TIME_LIMIT: Duration = Duration::from_millis(4);

pub(super) struct Slice {
    iterations: u32,
    deadline: Instant,
}

impl Default for Slice {
    fn default() -> Self {
        Self {
            iterations: 0,
            deadline: Instant::now() + TIME_LIMIT,
        }
    }
}

impl Slice {
    #[cfg(test)]
    pub(super) fn expire_for_test(&mut self) {
        self.deadline = Instant::now() - Duration::from_secs(1);
    }

    pub(super) fn reset(&mut self) {
        self.iterations = 0;
        self.deadline = Instant::now() + TIME_LIMIT;
    }

    pub(super) fn iteration_yields(&mut self, deterministic: bool) -> bool {
        // Compare absolute monotonic instants instead of constructing an elapsed
        // Duration at every loop tail. Keep the same strict 4 ms boundary and
        // read the clock at EVERY tail; sampling it less often changes KN.
        let expired = !deterministic && self.expired_at(Instant::now());
        // Official KN compares the old count, then increments even on yield;
        // the first count-only yield is tail 30002. See docs/kn-warp.md.
        let yielding = self.iterations > ITERATION_LIMIT || expired;
        self.iterations += 1;
        yielding
    }

    fn expired_at(&self, now: Instant) -> bool {
        now > self.deadline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_slice_uses_iterations_not_host_speed() {
        let mut slice = Slice::default();
        for _ in 0..=ITERATION_LIMIT {
            assert!(!slice.iteration_yields(true));
        }
        assert!(slice.iteration_yields(true));
        assert_eq!(slice.iterations, ITERATION_LIMIT + 2);
        slice.reset();
        assert!(!slice.iteration_yields(true));
    }

    #[test]
    fn wall_clock_is_checked_only_at_iteration_boundaries() {
        let slice = Slice::default();
        let started = slice.deadline - TIME_LIMIT;
        for elapsed in [
            Duration::ZERO,
            TIME_LIMIT,
            TIME_LIMIT + Duration::from_nanos(1),
        ] {
            assert_eq!(slice.expired_at(started + elapsed), elapsed > TIME_LIMIT);
        }
        assert!(!slice.expired_at(slice.deadline));
        assert!(slice.expired_at(slice.deadline + Duration::from_nanos(1)));
    }

    #[test]
    fn live_clock_gateway_and_reset_use_the_same_time_origin() {
        let mut slice = Slice::default();
        slice.expire_for_test();
        assert!(slice.iteration_yields(false));
        // Expired host time must be ignored in deterministic mode.
        assert!(!slice.iteration_yields(true));
        slice.reset();
        assert_eq!(slice.iterations, 0);
        assert!(!slice.iteration_yields(true));
    }
}
