use super::{Anim, Engine};

impl Engine {
    // Official player_v2 Tn6a/lt::f and set_entity_show_hide. Group fades are
    // concurrent blockers owned by the calling interpreter, not tell scripts.
    pub(super) fn start_entity_visibility(
        &mut self,
        task: usize,
        actor: usize,
        target_ids: Vec<usize>,
        duration: f64,
        show: bool,
    ) {
        let mut targets = Vec::new();
        for target in target_ids {
            let target = if target == usize::MAX { actor } else { target };
            let sprite = &mut self.sprites[target];
            if duration == 0.0 {
                sprite.visible = show;
                self.dirty[target] = true;
            } else if duration.is_finite() && duration > 0.0 && (!show || !sprite.visible) {
                if show {
                    sprite.visible = true;
                    if sprite.opacity == 1.0 {
                        sprite.opacity = 0.0;
                    }
                }
                targets.push((target, sprite.opacity));
                self.dirty[target] = true;
            }
        }
        if !targets.is_empty() {
            self.tasks[task].anim = Some(Anim::EntityVisibility {
                start: self.time,
                duration,
                targets,
                show,
            });
        }
    }

    pub(super) fn update_entity_visibility(
        &mut self,
        targets: &[(usize, f64)],
        show: bool,
        t: f64,
    ) {
        for &(target, from) in targets {
            let sprite = &mut self.sprites[target];
            if t >= 1.0 {
                sprite.opacity = 1.0;
                sprite.visible = show;
            } else {
                sprite.opacity = from + (if show { 1.0 } else { 0.0 } - from) * t;
            }
            self.dirty[target] = true;
        }
    }
}
