//! Original soft-mode lifecycle bookkeeping, NOT a LiquidFun implementation.
//! Observed source anchors and remaining deformation gap:
//! docs/kitten4-partial-physics-9.md. Never synthesize a particle trajectory from
//! an oracle recording, or call a rigid collider a compatible soft body.

#[derive(Default)]
pub(super) struct Lifecycle {
    elastic: bool,
    generation: u64,
    live: bool,
    pending_geometry: bool,
}

impl Lifecycle {
    pub fn elastic(&self) -> bool {
        self.elastic
    }

    /// Same-mode commands are idempotent. A mode switch preserves the caller's
    /// velocity; only a geometry/enable reconstruction discards soft velocity.
    pub fn set_elastic(&mut self, elastic: bool, enabled: bool) -> bool {
        if elastic == self.elastic {
            return false;
        }
        self.elastic = elastic;
        self.live = elastic && enabled;
        if self.live {
            self.generation += 1;
        }
        self.pending_geometry = false;
        true
    }

    /// Returns true exactly when the fallback's velocity must be cleared.
    /// Hidden/disabled geometry is deferred until the first enabled actor tick.
    pub fn synchronize(&mut self, enabled: bool, geometry_changed: bool) -> bool {
        if !self.elastic {
            return false;
        }
        self.pending_geometry |= geometry_changed;
        if !enabled {
            self.live = false;
            return false;
        }
        let rebuild = !self.live || self.pending_geometry;
        if rebuild {
            self.generation += 1;
        }
        self.live = true;
        self.pending_geometry = false;
        rebuild
    }

    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "elastic": self.elastic, "generation": self.generation,
            "live": self.live, "pendingGeometry": self.pending_geometry,
            "model": "rigid-fallback", "deformationImplemented": false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_is_idempotent_and_geometry_rebuild_is_deferred_while_disabled() {
        let mut state = Lifecycle::default();
        assert!(!state.set_elastic(false, true));
        assert!(state.set_elastic(true, true));
        assert_eq!(state.generation, 1);
        assert!(!state.set_elastic(true, true));
        assert!(!state.synchronize(true, false));
        assert!(state.synchronize(true, true));
        assert_eq!(state.generation, 2);
        assert!(!state.synchronize(false, true));
        assert!(state.pending_geometry);
        assert!(state.synchronize(true, false));
        assert_eq!(state.generation, 3);
        assert!(state.set_elastic(false, true));
        assert!(!state.synchronize(true, true));
    }
}
