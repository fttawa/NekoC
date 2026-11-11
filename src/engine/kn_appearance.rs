//! Official main.8ccf2442.js:1897852 properties, 1667073 actor parameters,
//! 1569626 bubbles. See docs/kn-appearance-dialog.md for identity and boundaries.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum Property {
    X,
    Y,
    Style,
    Width,
    Height,
    Direction,
    Effect(u8),
    Camp,
    Distance,
}
impl Property {
    pub(super) fn appearance(name: &str) -> Result<Self> {
        Ok(match name {
            "scale" | "width" => Self::Width,
            "height" => Self::Height,
            "direction" => Self::Direction,
            other => bail!("unsupported appearance reporter {other}"),
        })
    }
    fn actor(name: &str) -> Result<Self> {
        Ok(match name {
            "x" => Self::X,
            "y" => Self::Y,
            "style_index" => Self::Style,
            "camp" => Self::Camp,
            "distance" => Self::Distance,
            "0" | "1" | "2" | "3" | "4" | "5" | "6" => Self::Effect(name.parse().unwrap()),
            // clone_index is in the menu, but absent from getSceneOrActorProperty.
            other => Self::appearance(other)?,
        })
    }
}

impl Compiler {
    pub(super) fn kn_actor_parameter(&self, block: &Value) -> Result<ExprOp> {
        ensure!(
            self.program.semantics == RuntimeSemantics::KnCurrent,
            "actor parameter requires KN semantics"
        );
        let mutation = block["mutation"].as_str().unwrap_or("");
        // Match the exact published domain's mutation.match(/id="([^"]+)"/).
        let id = mutation
            .split_once("id=\"")
            .and_then(|(_, s)| s.split_once('"'))
            .map(|(id, _)| id)
            .filter(|id| !id.is_empty())
            .context("actor parameter missing mutation id")?;
        let index = *self
            .parameters
            .get(&format!("\0{id}"))
            .with_context(|| format!("unknown actor parameter id {id}"))?;
        Ok(ExprOp::KnActorParameter(
            index,
            Property::actor(field(block, "attribute"))?,
        ))
    }
}

// lodash.round(value, 2) uses exponent shifting, not Math.round(value*100)/100.
fn round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    let text = crate::js_number::text(value);
    let (mantissa, exponent) = text.split_once('e').map_or((text.as_str(), 0), |(m, e)| {
        (m, e.parse::<i32>().unwrap_or(0))
    });
    let shifted = format!("{mantissa}e{}", exponent + 2)
        .parse::<f64>()
        .unwrap_or(value);
    let rounded = (shifted + 0.5).floor();
    let text = crate::js_number::text(rounded);
    let (mantissa, exponent) = text.split_once('e').map_or((text.as_str(), 0), |(m, e)| {
        (m, e.parse::<i32>().unwrap_or(0))
    });
    format!("{mantissa}e{}", exponent - 2)
        .parse()
        .unwrap_or(rounded)
}

pub(super) fn set_axis(sprite: &mut Sprite, height: bool, value: f64, add: bool) {
    sprite.size_x *= sprite.scale / 100.0;
    sprite.size_y *= sprite.scale / 100.0;
    sprite.scale = 100.0;
    let axis = if height {
        &mut sprite.size_y
    } else {
        &mut sprite.size_x
    };
    *axis = if add { *axis + round(value) } else { value }.clamp(1.0, 9999.0);
}

impl Engine {
    pub(super) fn kn_property(&self, target: usize, actor: usize, property: Property) -> f64 {
        let s = &self.sprites[target];
        match property {
            Property::X => round(s.x),
            Property::Y => round(s.y),
            Property::Width => {
                if s.stage {
                    100.0
                } else {
                    round((s.scale * s.size_x / 100.0).abs())
                }
            }
            Property::Height => {
                if s.stage {
                    100.0
                } else {
                    round((s.scale * s.size_y / 100.0).abs())
                }
            }
            Property::Direction => round(s.direction),
            Property::Style => s
                .styles
                .iter()
                .position(|id| Some(id) == s.style.as_ref())
                .map_or(0.0, |i| (i + 1) as f64),
            Property::Camp => {
                if s.stage {
                    f64::NAN
                } else {
                    s.camp as f64
                }
            }
            Property::Distance => {
                k4_round((s.x - self.sprites[actor].x).hypot(s.y - self.sprites[actor].y))
            }
            Property::Effect(1) => {
                if s.visible {
                    round(100.0 * (1.0 - s.opacity))
                } else {
                    100.0
                }
            }
            Property::Effect(0) => round(if s.effects[0] < 0.0 {
                360.0 + s.effects[0]
            } else {
                s.effects[0]
            }),
            Property::Effect(index) => round(s.effects[index as usize]),
        }
    }
    pub(super) fn kn_actor_parameter_property(
        &self,
        parameter: usize,
        actor: usize,
        property: Property,
    ) -> f64 {
        let Some(Cell::Text(id)) = self.tasks[self.current_task].parameters.get(parameter) else {
            return f64::NAN;
        };
        let Some(target) = self
            .sprites
            .iter()
            .position(|s| s.alive && s.id == id.as_ref())
        else {
            return f64::NAN;
        };
        self.kn_property(target, actor, property)
    }
    pub(super) fn kn_dialog(&mut self, actor: usize, value: Cell, think: bool) {
        let sprite = &mut self.sprites[actor];
        if sprite.stage || !sprite.visible || matches!(value, Cell::Null | Cell::Undefined) {
            return;
        }
        let units: Vec<_> = value.text().replace(' ', "\u{a0}").encode_utf16().collect();
        let mut text = String::from_utf16_lossy(&units[..units.len().min(90)]);
        if units.len() > 90 {
            text.push_str("...");
        }
        sprite.dialog = Some(Dialog { text, think });
        self.dirty[actor] = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kn_round_matches_official_decimal_shifting() {
        assert_eq!(round(1.005), 1.01);
        assert_eq!(round(-2.34567), -2.35);
        assert_eq!(round(123.456), 123.46);
    }
}
