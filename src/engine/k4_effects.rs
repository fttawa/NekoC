//! Effect state transitions measured against the offline K4 player (Tn6a/lt).
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct K4Effect {
    scope: u8,
    value: usize,
    method: u8,
}

impl K4Effect {
    pub(super) fn compile(c: &mut Compiler, b: &Value, change: bool) -> Result<Self> {
        let scope = match field(b, "scope") {
            "0" => 0,
            "1" => 1,
            "2" => 2,
            "3" => 3,
            "4" => 4,
            "5" => 5,
            "6" => 6,
            "7" => 7,
            _ => u8::MAX,
        };
        let method = if !change {
            0
        } else {
            match field(b, "increase") {
                "increase" => 1,
                "decrease" => 2,
                _ => 3,
            }
        };
        Ok(Self {
            scope,
            method,
            value: c.value(input(b, if change { "steps" } else { "val" })?)?,
        })
    }
}

impl Engine {
    pub(super) fn exec_k4_effect(&mut self, effect: K4Effect, actor: usize) {
        // lodash.isFinite: unlike an arithmetic expression, numeric strings and
        // booleans are not accepted, even on legacy aliases.
        let Cell::Number(value) = self.eval_value(effect.value, actor) else {
            return;
        };
        if !value.is_finite() || effect.method == 3 || effect.scope > 7 {
            return;
        }
        // ASCII tests the original input, before decrease applies its sign.
        if effect.scope == 7 && value < 1.0 {
            return;
        }
        // The filter limits pixel/ASCII size to the shortest source-texture
        // edge, not a global 20. Host-loaded costume geometry is authoritative.
        let upper = self.sprites[actor]
            .style
            .as_ref()
            .and_then(|id| self.program.costumes.get(id))
            .map(|c| c.width.min(c.height).max(1.0))
            .unwrap_or_else(|| {
                if self.sprites[actor].stage {
                    self.program.width.min(self.program.height).max(1.0)
                } else {
                    1.0
                }
            });
        let a = &mut self.sprites[actor];
        let delta = if effect.method == 2 { -value } else { value };
        if effect.scope == 1 {
            a.opacity = if effect.method == 0 {
                (100.0 - value) / 100.0
            } else {
                a.opacity - delta / 100.0
            }
            .clamp(0.0, 1.0);
            return;
        }
        let slot = &mut a.effects[effect.scope as usize];
        let next = if effect.method == 0 {
            if effect.scope == 2 {
                value - 100.0
            } else {
                value
            }
        } else {
            *slot + delta
        };
        *slot = match effect.scope {
            3 | 7 => next.clamp(1.0, upper),
            4..=6 => next.clamp(0.0, 100.0),
            _ => next,
        };
    }
}
