//! KN's per-interpreter-step warp slice. This is deliberately separate from the
//! K4 counter: the two released runtimes have different limits.
use std::time::{Duration, Instant};

#[path = "kn_warp_sampling.rs"]
mod sampling;
use sampling::ClockChecks;

pub(super) const ITERATION_LIMIT: u32 = 30_000;
const TIME_LIMIT: Duration = Duration::from_millis(4);

pub(super) struct Slice {
    iterations: u32,
    deadline: Instant,
    checks: ClockChecks,
}

impl Default for Slice {
    fn default() -> Self {
        let started = Instant::now();
        Self {
            iterations: 0,
            deadline: started + TIME_LIMIT,
            checks: ClockChecks::new(started),
        }
    }
}

impl Slice {
    #[cfg(test)]
    pub(super) fn expire_for_test(&mut self) {
        self.deadline = Instant::now() - Duration::from_secs(1);
    }

    #[cfg(test)]
    pub(super) fn warm_sampling_for_test(&mut self) {
        let start = self.deadline - TIME_LIMIT;
        for tail in 1..=63 {
            assert!(
                !self.iteration_yields_with(false, || { start + Duration::from_nanos(tail * 10) })
            );
        }
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn iteration_yields(&mut self, deterministic: bool) -> bool {
        self.iteration_yields_with(deterministic, Instant::now)
    }

    #[inline]
    fn iteration_yields_with(
        &mut self,
        deterministic: bool,
        now: impl FnOnce() -> Instant,
    ) -> bool {
        // Official KN compares the old count, then increments even on yield;
        // the first count-only yield is tail 30002. See docs/kn-warp.md.
        let mut yielding = self.iterations > ITERATION_LIMIT;
        self.iterations += 1;
        // Keep the fixed-clock path completely independent of sampling state.
        // Both native and interpreted boundaries enter this gateway. Wall-clock
        // sampling intentionally permits <=31 extra tails, NOT official exact
        // timing; see docs/kn-warp-sampling.md for the conditional time bound.
        if !deterministic && !yielding && self.checks.due() {
            let now = now();
            yielding = self.expired_at(now);
            self.checks.observe(now, self.iterations, self.deadline);
        }
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

    #[test]
    fn deterministic_tails_never_consult_the_clock_or_sampling_state() {
        let mut slice = Slice::default();
        slice.expire_for_test();
        for tail in 1..=ITERATION_LIMIT + 2 {
            assert_eq!(
                slice.iteration_yields_with(true, || panic!("deterministic clock read")),
                tail == ITERATION_LIMIT + 2
            );
        }
        slice.reset();
        slice.expire_for_test();
        assert!(slice.iteration_yields(false));
    }

    #[test]
    fn fixed_clock_matches_the_old_counter_bit_for_bit_across_resets() {
        let mut slice = Slice::default();
        for _ in 0..3 {
            let mut old_count = 0;
            for _ in 0..=ITERATION_LIMIT + 2 {
                let old_yield = old_count > ITERATION_LIMIT;
                old_count += 1;
                assert_eq!(slice.iteration_yields(true), old_yield);
                assert_eq!(slice.iterations, old_count);
            }
            slice.reset();
        }
    }

    #[test]
    fn sampled_time_boundary_is_strict_and_reset_checks_the_first_tail() {
        let mut slice = Slice::default();
        let deadline = slice.deadline;
        assert!(!slice.iteration_yields_with(false, || deadline));
        assert!(slice.iteration_yields_with(false, || deadline + Duration::from_nanos(1)));
        slice.reset();
        let deadline = slice.deadline;
        assert!(slice.iteration_yields_with(false, || deadline + Duration::from_nanos(1)));
    }

    #[test]
    fn sampling_has_a_31_tail_hard_bound_even_after_an_arbitrary_time_jump() {
        // Warm up to the cap, then inject expiry at EVERY phase of that batch.
        // Shared synthetic timestamps compare policies on one execution trace;
        // they do not pretend two independent native runs have the same timing.
        for phase in 1..=32 {
            let mut slice = Slice::default();
            let start = slice.deadline - TIME_LIMIT;
            let mut reads = 0;
            for tail in 1..=63 {
                assert!(!slice.iteration_yields_with(false, || {
                    reads += 1;
                    start + Duration::from_nanos(tail * 10)
                }));
            }
            assert_eq!(reads, 6);
            let first_expired = 63 + phase;
            let mut yielded = None;
            for tail in 64..=95 {
                let time = if tail < first_expired {
                    start + Duration::from_nanos(tail * 10)
                } else {
                    // A sudden expensive body / OS pause defeats the *target*
                    // time bound but cannot defeat the hard tail-count bound.
                    slice.deadline + Duration::from_secs(1)
                };
                if slice.iteration_yields_with(false, || time) {
                    yielded = Some(tail);
                    break;
                }
            }
            assert_eq!(yielded, Some(95));
            assert!(yielded.unwrap() - first_expired <= 31);
        }
    }

    #[test]
    fn bounded_tail_cost_proves_the_conditional_time_bound() {
        // Given tail-to-tail WCET <= 3us (INCLUDING any preemption), the 31-tail
        // bound gives <=93us extra detection latency. Enumerate changing speeds
        // and deadline crossings without sleeping or relying on host speed.
        for ns in [10, 100, 500, 1_000, 3_000] {
            for phase in 0..32 {
                let mut slice = Slice::default();
                let start = slice.deadline - TIME_LIMIT;
                let mut elapsed = Duration::ZERO;
                let mut first_expired = None;
                for tail in 0..=ITERATION_LIMIT + 1 {
                    let cost = if tail < 63 + phase { 10 } else { ns };
                    elapsed += Duration::from_nanos(cost);
                    let time = start + elapsed;
                    if time > slice.deadline && first_expired.is_none() {
                        first_expired = Some((tail, time));
                    }
                    if slice.iteration_yields_with(false, || time) {
                        if let Some((first_tail, first_time)) = first_expired {
                            assert!(tail - first_tail <= 31);
                            assert!(time - first_time <= Duration::from_micros(93));
                        } else {
                            assert_eq!(tail, ITERATION_LIMIT + 1);
                        }
                        break;
                    }
                }
            }
        }
    }
}
