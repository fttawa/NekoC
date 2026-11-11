//! KN's per-interpreter-step warp slice. This is deliberately separate from the
//! K4 counter: the two released runtimes have different limits.
use std::time::{Duration, Instant};

pub(super) const ITERATION_LIMIT: u32 = 30_000;
const TIME_LIMIT: Duration = Duration::from_millis(4);

pub(super) struct Slice {
    iterations: u32,
    started: Instant,
}

impl Default for Slice {
    fn default() -> Self {
        Self {
            iterations: 0,
            started: Instant::now(),
        }
    }
}

impl Slice {
    #[cfg(test)]
    pub(super) fn expire_for_test(&mut self) {
        self.started = Instant::now() - TIME_LIMIT - Duration::from_secs(1);
    }

    pub(super) fn reset(&mut self) {
        self.iterations = 0;
        self.started = Instant::now();
    }

    pub(super) fn iteration_yields(&mut self, deterministic: bool) -> bool {
        self.check(if deterministic {
            None
        } else {
            Some(self.started.elapsed())
        })
    }

    fn check(&mut self, elapsed: Option<Duration>) -> bool {
        // Official KN 0.27.4 OptiRunner.step_iteration_yield: check the
        // previous count, then increment. See docs/kn-warp.md for evidence.
        let yielding = self.iterations > ITERATION_LIMIT
            || elapsed.is_some_and(|elapsed| elapsed > TIME_LIMIT);
        self.iterations += 1;
        yielding
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_slice_uses_iterations_not_host_speed() {
        let mut slice = Slice::default();
        for _ in 0..=ITERATION_LIMIT {
            assert!(!slice.check(None));
        }
        assert!(slice.check(None));
        slice.reset();
        assert!(!slice.check(None));
    }

    #[test]
    fn wall_clock_is_checked_only_at_iteration_boundaries() {
        let mut slice = Slice::default();
        assert!(!slice.check(Some(TIME_LIMIT)));
        assert!(slice.check(Some(TIME_LIMIT + Duration::from_nanos(1))));
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
