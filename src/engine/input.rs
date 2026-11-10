//! State responders and coordinate-based picking shared by replay clients.
use super::*;

impl Engine {
    /// Move by a pointer delta, preserving the grabbed offset.
    pub fn drag_by(&mut self, id: &str, dx: f64, dy: f64) {
        if let Some(sprite) = self.sprites.iter().find(|a| a.id == id) {
            self.drag(id, sprite.x + dx, sprite.y + dy);
        }
    }
    /// Topmost visible, opaque costume under a stage coordinate. Costume masks
    /// must be supplied by the viewer; missing masks fall back to rectangles.
    pub fn hit_test(&self, x: f64, y: f64) -> Option<&str> {
        self.order
            .iter()
            .rev()
            .copied()
            .find(|&i| {
                let a = &self.sprites[i];
                a.alive && a.visible && !a.stage && self.contains(i, x, y)
            })
            .map(|i| self.sprites[i].id.as_str())
    }

    pub(super) fn dispatch_pointer_states(&mut self) {
        if self.stopped {
            return;
        }
        for script in 0..self.program.scripts.len() {
            let spec = &self.program.scripts[script];
            let ScriptEvent::Pointer(id, state) = &spec.event else {
                continue;
            };
            let actor = spec.actor;
            if !self.in_active_scene(actor) {
                continue;
            }
            let listeners = self.instances(actor);
            let mut targets = Vec::new();
            for target in listeners {
                let hit = if id == "--screen" {
                    ""
                } else if id == &self.program.sprites[actor].id {
                    self.sprites[target].id.as_str()
                } else {
                    id.as_str()
                };
                let matches =
                    if id == "--screen" && self.program.semantics == RuntimeSemantics::KnCurrent {
                        match state.as_str() {
                            "mouse_down" => self.pointer_down,
                            "mouse_up" => self.pointer_released,
                            "mouse_click" => self.pointer_clicked,
                            _ => false,
                        }
                    } else if state == "mouse_click" {
                        self.input_clicks.iter().any(|clicked| {
                            hit == clicked
                                || id != &self.program.sprites[actor].id
                                    && self.pointer_target_matches(hit, clicked)
                        })
                    } else {
                        self.input_targets.iter().any(|(clicked, value)| {
                            value == state
                                && (hit == clicked
                                    || id != &self.program.sprites[actor].id
                                        && self.pointer_target_matches(hit, clicked))
                        })
                    };
                if matches
                    && !self
                        .tasks
                        .iter()
                        .any(|t| !t.done && t.script == script && t.actor == target)
                {
                    targets.push(target);
                }
            }
            for target in targets {
                self.spawn(script, target);
            }
        }
    }

    fn pointer_target_matches(&self, listener: &str, hit: &str) -> bool {
        if listener == hit {
            return true;
        }
        self.sprites.iter().any(|a| {
            a.id == hit && a.alive && a.visible && self.program.sprites[a.origin].id == listener
        })
    }
}
