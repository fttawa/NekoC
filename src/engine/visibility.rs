use super::{Anim, Engine};

impl Engine {
    /// Kitten 4's blockers advance after scripts, not at each caller's AnimStep.
    /// The shared scheduler must call this once, before compacting finished tasks.
    /// Cancellation disposal is deferred until the next update: a caller stopped
    /// in the script phase still contributes this update's final alpha delta.
    pub(super) fn tick_entity_visibility(&mut self, dt: f64) {
        for task in 0..self.tasks.len() {
            let Some(Anim::EntityVisibility {
                start,
                duration,
                targets,
                show,
            }) = self.tasks[task].anim.clone()
            else {
                continue;
            };
            if self.time <= start {
                continue;
            }
            let finished = self.time - start + 1e-12 >= duration;
            for (target, from) in targets {
                if !self.sprites[target].alive {
                    continue;
                }
                if finished {
                    self.sprites[target].opacity = 1.0;
                    self.sprites[target].visible = show;
                    if !show {
                        self.clear_hidden_entity_pointer(target);
                    }
                } else {
                    // Each task contributes its own fixed slope to CURRENT alpha.
                    // Competing tasks can make the native alpha negative; do not
                    // clamp it or overwrite another task with absolute progress.
                    let to = if show { 1.0 } else { 0.0 };
                    self.sprites[target].opacity += (to - from) * dt / duration;
                }
                self.dirty[target] = true;
            }
            if finished {
                self.tasks[task].anim = None;
            }
        }
    }

    /// Return true only for a live K4 visibility blocker. The AnimStep caller
    /// rewinds its PC and yields; an ended blocker proceeds next update.
    pub(super) fn entity_visibility_blocked(&self, task: usize) -> bool {
        matches!(self.tasks[task].anim, Some(Anim::EntityVisibility { .. }))
    }

    // Hiding breaks the entity's held pointer responder. Keep the global mouse
    // button state: hiding a sprite is not a physical pointer release.
    fn clear_hidden_entity_pointer(&mut self, target: usize) {
        let id = &self.sprites[target].id;
        self.input_targets.remove(id);
    }

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
            if duration == 0.0 {
                self.sprites[target].visible = show;
                if !show {
                    self.clear_hidden_entity_pointer(target);
                }
                self.dirty[target] = true;
            } else if !duration.is_nan() && (!show || !self.sprites[target].visible) {
                let sprite = &mut self.sprites[target];
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
            if !self.sprites[target].alive {
                continue;
            }
            let sprite = &mut self.sprites[target];
            if t >= 1.0 {
                sprite.opacity = 1.0;
                sprite.visible = show;
            } else {
                sprite.opacity = from + (if show { 1.0 } else { 0.0 } - from) * t;
            }
            if t >= 1.0 && !show {
                self.clear_hidden_entity_pointer(target);
            }
            self.dirty[target] = true;
        }
    }
}
