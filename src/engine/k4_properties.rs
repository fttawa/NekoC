//! K4 Tn6a/get_3, get_clone_index_property and Vt.get_scene_or_actor_property.
//! Factory-relative evidence and native probes: docs/kitten4-partial-properties.md.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct Property {
    target: usize,
    pub(super) index: Option<usize>,
    attribute: usize,
    variable: Option<usize>,
    global: Option<usize>,
    list: Option<usize>,
    uuid_attribute: bool,
}

// Tn6a/E uses an unanchored alphanumeric UUID regex, not a hex-only UUID parser.
fn uuid_like(text: &str) -> bool {
    text.as_bytes().windows(36).any(|part| {
        part.iter().enumerate().all(|(i, byte)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_alphanumeric()
            }
        })
    })
}

impl Compiler {
    pub(super) fn k4_property(&mut self, block: &Value, clone: bool) -> Result<usize> {
        let id = field(block, "sprite");
        let target = self.actor_target(id).unwrap_or(usize::MAX - 1);
        // Keep repository-owned synthetic entity IDs usable; unknown invalid
        // selectors follow the player's early return rather than compile error.
        if target == usize::MAX - 1 && !uuid_like(id) {
            let value = self.constant(Cell::Number(0.0));
            return self.push_k4_value(value);
        }
        let index = if clone {
            Some(self.value(input(block, "index")?)?)
        } else {
            None
        };
        let attribute = field(block, "attribute");
        let variable = self.actor_variables.get(attribute).copied();
        let uuid_attribute = uuid_like(attribute);
        let global = uuid_attribute
            .then(|| self.slots.get(attribute).copied())
            .flatten();
        let list = uuid_attribute
            .then(|| self.lists.get(attribute).copied())
            .flatten();
        let attribute = self.program.strings.len();
        self.program.strings.push(field(block, "attribute").into());
        self.program.k4_properties.push(Property {
            target,
            index,
            attribute,
            variable,
            global,
            list,
            uuid_attribute,
        });
        let value = ValueExpr::K4Property(self.program.k4_properties.len() as u32 - 1);
        self.push_k4_value(value)
    }

    fn push_k4_value(&mut self, value: ValueExpr) -> Result<usize> {
        let index = self.program.values.len();
        self.program.values.push(value);
        Ok(index)
    }
}

impl Engine {
    pub(super) fn lazy_k4_property_globals(&self) -> &BTreeMap<String, Cell> {
        &self.k4_property_globals
    }

    pub(super) fn eval_k4_property(&mut self, property: Property, actor: usize) -> Cell {
        let mut target = if property.target == usize::MAX {
            actor
        } else {
            property.target
        };
        if let Some(index) = property.index {
            // Target/scene validation precedes index type validation in Tn6a.
            if self.sprites.get(target).is_none_or(|s| !s.alive) {
                return self.k4_property_error("clone_entity_not_exist");
            }
            if self.sprites[target].stage {
                return self.k4_property_error("use_actor_blocks_in_scene");
            }
            let index = self.eval_value(index, actor);
            let Cell::Number(index) = index else {
                return self.k4_property_error("clone_entity_index_only_support_number");
            };
            let origin = self.sprites[target].origin;
            let Some(found) = self
                .sprites
                .iter()
                .position(|s| s.alive && s.origin == origin && f64::from(s.clone_index) == index)
            else {
                return self.k4_property_error("clone_entity_not_exist");
            };
            target = found;
        }
        if let Some(slot) = property.variable {
            if self.sprites.get(target).is_none_or(|s| !s.alive) {
                return self.k4_property_error("entity_variable_operation_out_of_scope");
            }
            return self.read_actor_variable(target, slot);
        }
        if let Some(slot) = property.global {
            return self.global_value(slot);
        }
        if let Some(slot) = property.list {
            // UUID properties return the actual list, not its string or a copy.
            // Both native list blocks and property-based mutations share it.
            return Cell::List(self.lists[slot].clone());
        }
        if property.uuid_attribute {
            let id = self.program.strings[property.attribute].as_str();
            // A later-compiled ordinary variable block can allocate a slot
            // after this reporter was compiled. Resolve that shared slot too.
            if let Some(slot) = self
                .program
                .variable_names
                .iter()
                .position(|name| name == id)
            {
                return self.global_value(slot);
            }
            // O8fc/get_var_or_list creates the slot only when this expression
            // executes; unreachable reporters must not create runtime state.
            let id = id.to_owned();
            return self
                .k4_property_globals
                .entry(id)
                .or_insert(Cell::Number(0.0))
                .clone();
        }
        let Some(sprite) = self.sprites.get(target).filter(|s| s.alive) else {
            return Cell::Number(f64::NAN);
        };
        let attribute = self.program.strings[property.attribute].as_str();
        let number = match attribute {
            "0" => sprite.x,
            "1" => sprite.y,
            "2" => {
                if sprite.style.as_deref().is_none_or(str::is_empty) {
                    if sprite.stage { 0.0 } else { f64::NAN }
                } else {
                    sprite
                        .styles
                        .iter()
                        .position(|id| Some(id) == sprite.style.as_ref())
                        .map_or(0.0, |i| (i + 1) as f64)
                }
            }
            // a1xw/set_rotation normalizes radians through JfQ3/t before
            // Tn6a converts back to degrees. Preserve its floating-point order.
            "3" => {
                let radians = (90.0 - sprite.direction) * std::f64::consts::PI / 180.0;
                let turn = 2.0 * std::f64::consts::PI;
                let absolute = radians.abs();
                let normalized = if absolute > turn {
                    absolute % turn
                } else {
                    absolute
                };
                let normalized = if radians < 0.0 {
                    turn - normalized
                } else {
                    normalized
                };
                let normalized = if normalized > std::f64::consts::PI {
                    normalized - turn
                } else {
                    normalized
                };
                180.0 * normalized / std::f64::consts::PI
            }
            "4" => {
                if sprite.style.as_deref().is_none_or(str::is_empty) {
                    return Cell::Number(f64::NAN);
                }
                let id = sprite.style.as_deref().unwrap_or("");
                return Cell::Text(
                    self.program
                        .style_names
                        .get(id)
                        .map_or(id, String::as_str)
                        .into(),
                );
            }
            "5" | "16" => sprite.scale * sprite.size_x / 100.0,
            "17" => sprite.scale * sprite.size_y / 100.0,
            "8" => {
                if sprite.visible {
                    (1.0 - sprite.opacity) * 100.0
                } else {
                    100.0
                }
            }
            "9" => sprite.effects[2] + 100.0,
            "7" => sprite.effects[0],
            "10" => sprite.effects[3],
            "11" => sprite.effects[4],
            "12" => sprite.effects[5],
            "13" => sprite.effects[6],
            "14" => sprite.effects.get(7).copied().unwrap_or(0.0),
            _ => f64::NAN,
        };
        Cell::Number(k4_round(number))
    }

    fn k4_property_error(&mut self, error: &str) -> Cell {
        self.value_error = Some(error.into());
        Cell::Number(f64::NAN)
    }
}
