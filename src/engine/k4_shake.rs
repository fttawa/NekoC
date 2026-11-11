//! Source-derived K4 shake path: Tn6a@12136, task timing K9+f/task_update.
//! One 5-unit leg per update (never catch up multiple legs on a long frame).
#[derive(Clone, Debug)]
pub(super) struct Shake {
    pub start: f64,
    pub duration: f64,
    count: usize,
    next: f64,
}

impl Shake {
    pub fn new(start: f64, duration: f64) -> Self {
        Self {
            start,
            duration,
            count: 0,
            next: 0.05,
        }
    }

    pub fn step(&mut self, now: f64) -> (f64, f64) {
        // Official normalized task progress stays zero for lifetime=Infinity.
        if self.duration.is_infinite() {
            return (0.0, 0.0);
        }
        let elapsed = now - self.start;
        if elapsed >= self.duration {
            return match self.count % 4 {
                1 => (-5.0, 0.0),
                2 => (-5.0, -5.0),
                3 => (0.0, -5.0),
                _ => (0.0, 0.0),
            };
        }
        if elapsed <= self.next {
            return (0.0, 0.0);
        }
        let delta = match self.count % 4 {
            0 => (5.0, 0.0),
            1 => (0.0, 5.0),
            2 => (-5.0, 0.0),
            _ => (0.0, -5.0),
        };
        self.count = (self.count + 1) % 4;
        self.next += 0.04;
        delta
    }
}

#[cfg(test)]
mod tests {
    use super::Shake;

    #[test]
    fn strict_threshold_one_leg_per_update_and_each_end_correction() {
        for legs in 0..8 {
            let mut shake = Shake::new(0.0, 1.0);
            assert_eq!(shake.step(0.05), (0.0, 0.0));
            let mut sum = (0.0, 0.0);
            for _ in 0..legs {
                // Deliberately late: the official task callback does not catch up.
                let step = shake.step(0.9);
                assert_eq!(step.0.abs() + step.1.abs(), 5.0);
                sum.0 += step.0;
                sum.1 += step.1;
            }
            let restore = shake.step(1.0);
            assert_eq!((sum.0 + restore.0, sum.1 + restore.1), (0.0, 0.0));
        }
    }

    #[test]
    fn infinite_lifetime_never_moves() {
        let mut shake = Shake::new(0.0, f64::INFINITY);
        assert_eq!(shake.step(1000.0), (0.0, 0.0));
    }
}
