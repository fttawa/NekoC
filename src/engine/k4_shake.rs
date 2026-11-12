//! Independently implemented K4 shake task (Tn6a/self_shake, K9+f/task_update).
//! Millisecond arithmetic matters at strict normalized-progress thresholds.
use super::{Anim, Engine};

#[derive(Default)]
pub(super) struct Clock {
    origin_ms: f64,
    current_ms: Option<f64>,
}

impl Clock {
    pub fn tick(&mut self, dt: f64) {
        // Like ClockImpl after clear: the first update establishes an origin.
        // Default zero is deterministic; callers may explicitly match the
        // independent official wall-clock origin for same-input diagnostics.
        self.current_ms = Some(
            self.current_ms
                .map_or(self.origin_ms, |now| now + dt * 1000.0),
        );
    }

    pub fn now(&self) -> f64 {
        self.current_ms.unwrap_or(self.origin_ms)
    }

    pub fn reset(&mut self) {
        self.current_ms = None;
    }

    pub fn configure(&mut self, origin_ms: f64) -> bool {
        if !origin_ms.is_finite() || self.current_ms.is_some() {
            return false;
        }
        self.origin_ms = origin_ms;
        true
    }
}

#[derive(Clone, Debug)]
pub(super) struct Shake {
    start_ms: f64,
    duration_ms: f64,
    count: usize,
    next: f64,
    interval: f64,
}

impl Shake {
    pub fn new(start_ms: f64, duration: f64) -> Self {
        Self {
            start_ms,
            duration_ms: duration * 1000.0,
            count: 0,
            next: 0.05 / duration,
            interval: 0.04 / duration,
        }
    }

    pub fn finished(&self, now_ms: f64) -> bool {
        now_ms - self.start_ms >= self.duration_ms
    }

    pub fn step(&mut self, now_ms: f64) -> (f64, f64) {
        // Official normalized task progress stays zero for lifetime=Infinity.
        if self.duration_ms.is_infinite() {
            return (0.0, 0.0);
        }
        let elapsed = now_ms - self.start_ms;
        if self.finished(now_ms) {
            return match self.count % 4 {
                1 => (-5.0, 0.0),
                2 => (-5.0, -5.0),
                3 => (0.0, -5.0),
                _ => (0.0, 0.0),
            };
        }
        if elapsed / self.duration_ms <= self.next {
            return (0.0, 0.0);
        }
        let delta = match self.count % 4 {
            0 => (5.0, 0.0),
            1 => (0.0, 5.0),
            2 => (-5.0, 0.0),
            _ => (0.0, -5.0),
        };
        self.count = (self.count + 1) % 4;
        self.next += self.interval;
        delta
    }
}

impl Engine {
    /// Set the independent K4 shake clock's diagnostic input before its first
    /// update. `start()` resets elapsed time but preserves this explicit origin.
    /// Does not change global timers or claim wall-clock synchronization.
    pub fn set_k4_shake_clock_origin_ms(&mut self, origin_ms: f64) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.k4_shake_clock.configure(origin_ms),
            "shake clock origin must be finite and configured before the first update"
        );
        Ok(())
    }

    /// Shake owns a blocking task, not a script-phase animation. Removing it at
    /// frame end makes AnimStep resume on the next update, never the end frame.
    /// No physics/body behavior is implemented here.
    pub(super) fn tick_k4_shake(&mut self) {
        #[cfg(feature = "interp-profile")]
        let _profile = super::interp_profile::span("tick_k4_shake", &());
        let now = self.k4_shake_clock.now();
        for index in 0..self.tasks.len() {
            if !matches!(self.tasks[index].anim, Some(Anim::Shake(_))) {
                continue;
            }
            let Some(Anim::Shake(mut shake)) = self.tasks[index].anim.take() else {
                unreachable!();
            };
            let actor = self.tasks[index].actor;
            if self.sprites[actor].alive {
                let delta = shake.step(now);
                if delta != (0.0, 0.0) {
                    let old = (self.sprites[actor].x, self.sprites[actor].y);
                    self.sprites[actor].x += delta.0;
                    self.sprites[actor].y += delta.1;
                    self.dirty[actor] = true;
                    self.line(actor, old);
                }
            }
            if !shake.finished(now) {
                self.tasks[index].anim = Some(Anim::Shake(shake));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Shake;

    #[test]
    fn strict_threshold_one_leg_per_update_and_each_end_correction() {
        for legs in 0..8 {
            let mut shake = Shake::new(0.0, 1.0);
            assert_eq!(shake.step(50.0), (0.0, 0.0));
            let mut sum = (0.0, 0.0);
            for _ in 0..legs {
                // Deliberately late: the official task callback does not catch up.
                let step = shake.step(900.0);
                assert_eq!(step.0.abs() + step.1.abs(), 5.0);
                sum.0 += step.0;
                sum.1 += step.1;
            }
            let restore = shake.step(1000.0);
            assert_eq!((sum.0 + restore.0, sum.1 + restore.1), (0.0, 0.0));
        }
    }

    #[test]
    fn infinite_lifetime_never_moves() {
        let mut shake = Shake::new(0.0, f64::INFINITY);
        assert_eq!(shake.step(1000.0), (0.0, 0.0));
    }

    #[test]
    fn zero_origin_millisecond_clock_preserves_official_strict_threshold() {
        let mut clock = super::Clock::default();
        clock.tick(1.0 / 60.0);
        let mut shake = Shake::new(clock.now(), 0.14);
        for frame in 1..=5 {
            if frame > 1 {
                clock.tick(1.0 / 60.0);
            }
            assert_eq!(
                shake.step(clock.now()),
                if frame == 5 { (5.0, 0.0) } else { (0.0, 0.0) }
            );
        }
    }
}
