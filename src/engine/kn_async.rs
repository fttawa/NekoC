//! KN host timers use a separate queue: callbacks never re-enter an expression
//! evaluator or run synchronously while a timer is being registered.
use super::*;
use std::collections::BTreeMap;

struct Timer<T> {
    due: f64,
    period: Option<f64>,
    registered_tick: u64,
    callback: T,
}

pub(super) struct Timers<T> {
    next_id: u64,
    entries: BTreeMap<u64, Timer<T>>,
}

impl<T> Default for Timers<T> {
    fn default() -> Self {
        Self {
            next_id: 1,
            entries: BTreeMap::new(),
        }
    }
}

impl<T: Clone> Timers<T> {
    pub(super) fn insert(
        &mut self,
        now: f64,
        tick: u64,
        milliseconds: f64,
        repeat: bool,
        callback: T,
    ) -> Option<u64> {
        if self.entries.len() >= 4096 || self.next_id > (1_u64 << 53) {
            return None;
        }
        // The browser host converts the delay to a signed 32-bit integer. This
        // models the host conversion, not a guarantee about browser throttling
        // or a one-to-one correspondence between a VM tick and a JS macrotask.
        let delay = if milliseconds.is_finite() {
            let modulo = milliseconds.trunc().rem_euclid(4_294_967_296.0);
            if modulo < 2_147_483_648.0 {
                modulo / 1000.0
            } else {
                0.0
            }
        } else {
            0.0
        };
        let id = self.next_id;
        self.next_id += 1;
        self.entries.insert(
            id,
            Timer {
                due: now + delay,
                period: repeat.then_some(delay),
                registered_tick: tick,
                callback,
            },
        );
        Some(id)
    }

    pub(super) fn cancel(&mut self, id: f64) {
        if id.is_finite() && id >= 1.0 && id.fract() == 0.0 {
            self.entries.remove(&(id as u64));
        }
    }

    pub(super) fn clear(&mut self) {
        self.entries.clear();
    }

    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }

    /// At most one firing per timer per scheduler tick. Missed wall-clock
    /// firings are not replayed in an unbounded burst after suspension.
    pub(super) fn due(&mut self, now: f64, tick: u64) -> Vec<T> {
        let mut ready: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, timer)| timer.registered_tick < tick && timer.due <= now)
            .map(|(&id, timer)| (id, timer.due))
            .collect();
        ready.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        ready
            .into_iter()
            .map(|(id, _)| {
                let timer = self.entries.get_mut(&id).unwrap();
                let callback = timer.callback.clone();
                if let Some(period) = timer.period {
                    timer.due = now + period;
                    timer.registered_tick = tick;
                } else {
                    self.entries.remove(&id);
                }
                callback
            })
            .collect()
    }
}

impl Engine {
    pub(super) fn tick_kn_timers(&mut self) {
        if self.program.semantics != RuntimeSemantics::KnCurrent || self.stopped {
            return;
        }
        // Official KN 0.27.4 native compilation drops the callback statement;
        // the domain substitutes an empty host function (see evidence document).
        // Do not invent callback execution merely because the C-slot is visible.
        self.kn_timers.due(self.time, self.scheduler_tick);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_is_deferred_ordered_and_cancellable() {
        let mut timers = Timers::default();
        let later = timers.insert(0.0, 1, 100.0, false, "later").unwrap();
        timers.insert(0.0, 1, 0.0, false, "first");
        timers.insert(0.0, 1, -1.0, false, "second");
        assert!(timers.due(1.0, 1).is_empty());
        timers.cancel(later as f64);
        assert_eq!(timers.due(0.0, 2), ["first", "second"]);
        assert_eq!(timers.len(), 0);
    }

    #[test]
    fn intervals_do_not_spin_or_catch_up_and_clear_removes_pending_work() {
        let mut timers = Timers::default();
        let id = timers.insert(0.0, 0, 0.0, true, 7).unwrap();
        assert_eq!(timers.due(10.0, 1), [7]);
        assert!(timers.due(10.0, 1).is_empty());
        assert_eq!(timers.due(10.0, 2), [7]);
        timers.cancel(id as f64);
        assert!(timers.due(20.0, 3).is_empty());
        timers.insert(20.0, 3, 10.0, false, 8);
        timers.clear();
        assert!(timers.due(30.0, 4).is_empty());
    }

    #[test]
    fn deadlines_use_milliseconds_and_host_delay_coercion() {
        let mut timers = Timers::default();
        timers.insert(1.0, 0, 25.9, false, "25ms");
        timers.insert(1.0, 0, f64::NAN, false, "nan");
        timers.insert(1.0, 0, f64::INFINITY, false, "infinite");
        timers.insert(1.0, 0, 2_147_483_648.0, false, "overflow");
        assert_eq!(timers.due(1.0, 1), ["nan", "infinite", "overflow"]);
        assert!(timers.due(1.024, 2).is_empty());
        assert_eq!(timers.due(1.025, 3), ["25ms"]);
        timers.cancel(f64::NAN);
        timers.cancel(-1.0);
        timers.cancel(1.5);
        assert_eq!(timers.len(), 0);
    }

    #[test]
    fn handles_are_not_reused_and_pending_work_is_bounded() {
        let mut timers = Timers::default();
        let old = timers.insert(0.0, 0, 0.0, false, 0).unwrap();
        timers.clear();
        let new = timers.insert(0.0, 0, 0.0, false, 1).unwrap();
        assert_ne!(old, new);
        timers.cancel(old as f64);
        assert_eq!(timers.due(0.0, 1), [1]);
        for _ in 0..4096 {
            assert!(timers.insert(0.0, 0, 1000.0, true, 0).is_some());
        }
        assert!(timers.insert(0.0, 0, 1000.0, true, 0).is_none());
    }

    #[test]
    fn earlier_deadlines_precede_registration_order_and_duplicates_stay_stable() {
        let mut timers = Timers::default();
        timers.insert(0.0, 0, 200.0, false, "late");
        timers.insert(0.0, 0, 100.0, false, "early-a");
        timers.insert(0.0, 0, 100.0, false, "early-b");
        assert_eq!(timers.due(1.0, 1), ["early-a", "early-b", "late"]);
        assert!(timers.due(2.0, 2).is_empty());
    }
}
