//! Wall-clock-only sampling policy. See docs/kn-warp-sampling.md for the
//! conditional time bound and the unconditional (31 extra tails) bound.
use std::time::Instant;

const MAX_INTERVAL: u32 = 32;
const TARGET_NS: u64 = 25_000;
const FINAL_WINDOW_NS: u64 = 50_000;

pub(super) struct ClockChecks {
    remaining: u32,
    interval: u32,
    last: Instant,
    last_tail: u32,
    slowest_ns: u64,
}

impl ClockChecks {
    pub(super) fn new(started: Instant) -> Self {
        Self {
            remaining: 1,
            interval: 1,
            last: started,
            last_tail: 0,
            slowest_ns: 1,
        }
    }

    #[inline]
    pub(super) fn due(&mut self) -> bool {
        if self.slowest_ns >= TARGET_NS {
            return true;
        }
        self.remaining -= 1;
        self.remaining == 0
    }

    pub(super) fn observe(&mut self, now: Instant, tail: u32, deadline: Instant) {
        // Once even one average tail costs >= the target, this step must stay
        // at interval 1. Do not add adaptive divisions to the old clock-only
        // slow path (e.g. a cold JIT compile in the first batch).
        if self.slowest_ns >= TARGET_NS {
            return;
        }
        let tails = u64::from(tail - self.last_tail);
        let elapsed = now
            .saturating_duration_since(self.last)
            .as_nanos()
            .min(u128::from(u64::MAX)) as u64;
        // Round UP: a coarse clock or sub-nanosecond average must not estimate
        // a free iteration. Retain the slowest batch average within this step.
        let per_tail = elapsed.div_ceil(tails);
        self.slowest_ns = self.slowest_ns.max(per_tail);
        let left = deadline.saturating_duration_since(now).as_nanos() as u64;
        let interval = if left <= FINAL_WINDOW_NS {
            1
        } else {
            let affordable = left / 2 / self.slowest_ns;
            u64::from(MAX_INTERVAL)
                .min(u64::from(self.interval) * 2)
                .min(TARGET_NS / self.slowest_ns)
                .min(affordable)
                .max(1) as u32
        };
        self.last = now;
        self.last_tail = tail;
        self.interval = interval;
        self.remaining = interval;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn first_tail_is_checked_and_growth_is_bounded_even_with_a_coarse_clock() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(4);
        let mut checks = ClockChecks::new(start);
        let mut previous_tail = 0;
        let mut expected_interval = 1;
        for tail in 1..=1000 {
            if checks.due() {
                assert_eq!(tail - previous_tail, expected_interval);
                checks.observe(start, tail, deadline);
                expected_interval = (expected_interval * 2).min(MAX_INTERVAL);
                previous_tail = tail;
            }
        }
        assert_eq!(expected_interval, MAX_INTERVAL);
    }

    #[test]
    fn slow_batches_reduce_the_interval_and_the_final_window_checks_every_tail() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(4);
        let mut checks = ClockChecks::new(start);
        assert!(checks.due());
        checks.observe(start + Duration::from_micros(100), 1, deadline);
        assert_eq!(checks.interval, 1);
        assert!(checks.due());
        checks.observe(deadline - Duration::from_micros(50), 2, deadline);
        assert_eq!(checks.interval, 1);
        assert!(checks.due());
        // Locked slow path remains clock-only, without decrementing a stale
        // countdown or recomputing a batch average on every subsequent tail.
        for tail in 3..100 {
            assert!(checks.due());
            checks.observe(deadline, tail, deadline);
        }
    }

    #[test]
    fn fast_batches_reach_the_cap_then_a_slow_batch_shrinks_it() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(4);
        let mut checks = ClockChecks::new(start);
        for tail in 1..=63 {
            if checks.due() {
                checks.observe(
                    start + Duration::from_nanos(u64::from(tail) * 10),
                    tail,
                    deadline,
                );
            }
        }
        assert_eq!(checks.interval, MAX_INTERVAL);
        for tail in 64..=95 {
            if checks.due() {
                checks.observe(start + Duration::from_micros(3200), tail, deadline);
            }
        }
        assert_eq!(checks.interval, 1);
    }

    #[test]
    fn final_window_checks_every_tail_even_when_the_cost_estimate_is_fast() {
        let start = Instant::now();
        for left in [0, 1, FINAL_WINDOW_NS - 1, FINAL_WINDOW_NS] {
            let mut checks = ClockChecks::new(start);
            for tail in 1..=63 {
                if checks.due() {
                    checks.observe(
                        start + Duration::from_nanos(u64::from(tail) * 10),
                        tail,
                        start + Duration::from_millis(4),
                    );
                }
            }
            assert_eq!(checks.interval, MAX_INTERVAL);
            for _ in 0..MAX_INTERVAL - 1 {
                assert!(!checks.due());
            }
            assert!(checks.due());
            let now = start + Duration::from_nanos(950);
            // The policy accepts an explicit deadline: moving it in this
            // isolated test keeps the measured batch fast, so interval=1 must
            // come from the final-window branch, not the slow-path lock.
            checks.observe(now, 95, now + Duration::from_nanos(left));
            assert_eq!(checks.slowest_ns, 10);
            assert_eq!(checks.interval, 1);
            assert!(checks.due());
        }
    }
}
