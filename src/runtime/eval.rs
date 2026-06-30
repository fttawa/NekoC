use serde_json::Value;
use std::collections::BTreeMap;

use super::helpers::*;
use super::{Runtime, RuntimeValue};

impl<'a> Runtime<'a> {
    pub(super) fn eval(&self, block: Option<&Value>) -> RuntimeValue {
        self.eval_for_context(
            block,
            None,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
    }

    pub(super) fn eval_for_context(
        &self,
        block: Option<&Value>,
        owner_id: Option<&str>,
        range_values: &BTreeMap<String, RuntimeValue>,
        script_values: &BTreeMap<String, RuntimeValue>,
        procedure_values: &BTreeMap<String, RuntimeValue>,
    ) -> RuntimeValue {
        let Some(block) = block else {
            return RuntimeValue::Null;
        };
        let eval = |block| {
            self.eval_for_context(
                block,
                owner_id,
                range_values,
                script_values,
                procedure_values,
            )
        };
        match block_type(block).unwrap_or("") {
            "math_number" => number_field(block, "NUM")
                .map(RuntimeValue::Number)
                .unwrap_or(RuntimeValue::Number(0.0)),
            "text" => RuntimeValue::String(
                block
                    .get("fields")
                    .and_then(|fields| fields.get("TEXT"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            ),
            "variables_get" => block
                .get("fields")
                .and_then(|fields| fields.get("variable"))
                .and_then(Value::as_str)
                .and_then(|id| self.variables.get(id))
                .cloned()
                .unwrap_or(RuntimeValue::Null),
            "broadcast_input" => RuntimeValue::String(
                block
                    .get("fields")
                    .and_then(|fields| fields.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            ),
            "get_screens" => RuntimeValue::String(
                block
                    .get("fields")
                    .and_then(|fields| fields.get("screen_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            ),
            "pure_list_get" => RuntimeValue::String(
                block
                    .get("fields")
                    .and_then(|fields| fields.get("list"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            ),
            "list_get" => block
                .get("fields")
                .and_then(|fields| fields.get("list"))
                .and_then(Value::as_str)
                .and_then(|id| self.variables.get(id))
                .cloned()
                .unwrap_or(RuntimeValue::List(Vec::new())),
            "list_item" => {
                let list_id = eval(input(block, "list")).as_string();
                let index = eval(input(block, "list_index")).as_number();
                let item = block
                    .get("fields")
                    .and_then(|fields| fields.get("item"))
                    .and_then(Value::as_str)
                    .unwrap_or("any");
                let Some(RuntimeValue::List(items)) = self.variables.get(&list_id) else {
                    return RuntimeValue::Null;
                };
                list_index(item, index, items.len())
                    .and_then(|index| items.get(index).cloned())
                    .unwrap_or(RuntimeValue::Null)
            }
            "list_length" => {
                let list_id = eval(input(block, "list")).as_string();
                let length = self
                    .variables
                    .get(&list_id)
                    .and_then(runtime_list)
                    .map(Vec::len)
                    .unwrap_or(0);
                RuntimeValue::Number(length as f64)
            }
            "list_index_of" => {
                let list_id = eval(input(block, "list")).as_string();
                let needle = eval(input(block, "list_item_value"));
                let index = self
                    .variables
                    .get(&list_id)
                    .and_then(runtime_list)
                    .and_then(|items| {
                        items
                            .iter()
                            .position(|item| same_runtime_value(item, &needle))
                    })
                    .map(|index| index + 1)
                    .unwrap_or(0);
                RuntimeValue::Number(index as f64)
            }
            "list_is_exist" => {
                let list_id = eval(input(block, "list")).as_string();
                let needle = eval(input(block, "list_item_value"));
                let exists = self
                    .variables
                    .get(&list_id)
                    .and_then(runtime_list)
                    .is_some_and(|items| {
                        items.iter().any(|item| same_runtime_value(item, &needle))
                    });
                RuntimeValue::Bool(exists)
            }
            "temporary_list" => {
                let mut parts = block
                    .get("inputs")
                    .and_then(Value::as_object)
                    .map(|inputs| {
                        inputs
                            .iter()
                            .filter_map(|(name, value)| {
                                list_item_input_index(name).map(|index| (index, value))
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                parts.sort_by_key(|(index, _)| *index);
                RuntimeValue::List(
                    parts
                        .into_iter()
                        .map(|(_, value)| eval(Some(value)))
                        .collect(),
                )
            }
            "self_listen_value" => block
                .get("fields")
                .and_then(|fields| fields.get("TEXT"))
                .and_then(Value::as_str)
                .and_then(|name| self.message_values.get(name))
                .cloned()
                .unwrap_or(RuntimeValue::Null),
            "traverse_number_value" => block
                .get("fields")
                .and_then(|fields| fields.get("TEXT"))
                .and_then(Value::as_str)
                .and_then(|name| range_values.get(name))
                .cloned()
                .unwrap_or(RuntimeValue::Null),
            "script_variables_value" => block
                .get("fields")
                .and_then(|fields| fields.get("TEXT"))
                .and_then(Value::as_str)
                .and_then(|name| script_values.get(name))
                .cloned()
                .unwrap_or(RuntimeValue::Null),
            "procedures_2_parameter" => block
                .get("fields")
                .and_then(|fields| fields.get("param_name"))
                .and_then(Value::as_str)
                .and_then(|name| procedure_values.get(name))
                .cloned()
                .unwrap_or(RuntimeValue::Null),
            "procedures_2_callreturn" => {
                let Some(def_id) = procedure_def_id(block) else {
                    return RuntimeValue::Null;
                };
                let Some(procedure) = self.procedures.get(def_id) else {
                    return RuntimeValue::Null;
                };
                let mut values = BTreeMap::new();
                for param in &procedure.params {
                    if let Some(input) = input(block, &param.id) {
                        values.insert(param.name.clone(), eval(Some(input)));
                    }
                }
                self.eval_procedure_return(
                    procedure,
                    owner_id,
                    range_values,
                    script_values,
                    &values,
                )
            }
            "received_broadcast" => {
                let message = broadcast_message(input(block, "message")).unwrap_or_default();
                RuntimeValue::Bool(self.received_broadcasts.contains(&message))
            }
            "check_key" => {
                let key = field_string(block, "key").unwrap_or_default();
                let state = field_string(block, "type").unwrap_or("down");
                let is_down = self.pressed_keys.contains(key);
                RuntimeValue::Bool(if state == "up" { !is_down } else { is_down })
            }
            "mouse_down" => {
                let state = field_string(block, "type").unwrap_or("down");
                RuntimeValue::Bool(if state == "up" {
                    !self.mouse_down
                } else {
                    self.mouse_down
                })
            }
            "get_mouse_info" => match field_string(block, "type").unwrap_or("x") {
                "y" => RuntimeValue::Number(self.mouse_y),
                _ => RuntimeValue::Number(self.mouse_x),
            },
            "get_answer" => self.last_answer.clone(),
            "get_choice_and_index" => {
                let field_type = field_string(block, "type").unwrap_or("content");
                if field_type == "index" {
                    RuntimeValue::Number(self.last_choice_index as f64)
                } else {
                    self.last_choice_content.clone()
                }
            }
            "timer" => RuntimeValue::Number(self.timer_elapsed_ticks as f64 / super::DEFAULT_FPS),
            "get_time" => RuntimeValue::Number(0.0),
            "get_stage_info" => match field_string(block, "type").unwrap_or("width") {
                "height" => RuntimeValue::Number(self.stage_height),
                _ => RuntimeValue::Number(self.stage_width),
            },
            "coordinate_of_sprite" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                let coordinate = field_string(block, "coordinate").unwrap_or("x");
                let value = self
                    .actor_for_sprite(sprite, owner_id)
                    .map(|actor| if coordinate == "y" { actor.y } else { actor.x })
                    .unwrap_or(0.0);
                RuntimeValue::Number(value)
            }
            "distance_to" => {
                let target = field_string(block, "sprite").unwrap_or("--mouse");
                let Some(source) = owner_id.and_then(|id| self.actors.get(id)) else {
                    return RuntimeValue::Number(0.0);
                };
                let (target_x, target_y) = self
                    .actor_for_sprite(target, owner_id)
                    .map(|actor| (actor.x, actor.y))
                    .unwrap_or((0.0, 0.0));
                RuntimeValue::Number(
                    ((source.x - target_x).powi(2) + (source.y - target_y).powi(2)).sqrt(),
                )
            }
            "get_orientation" => RuntimeValue::Number(0.0),
            "style_of_sprite" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                RuntimeValue::String(
                    self.actor_for_sprite(sprite, owner_id)
                        .and_then(|actor| actor.current_style_id.clone())
                        .unwrap_or_default(),
                )
            }
            "appearance_of_sprite" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                let appearance = field_string(block, "appearance").unwrap_or("scale");
                let value = self
                    .actor_for_sprite(sprite, owner_id)
                    .map(|actor| match appearance {
                        "x" => actor.x,
                        "y" => actor.y,
                        "rotation" | "direction" => actor.rotation,
                        "visible" => {
                            if actor.visible {
                                1.0
                            } else {
                                0.0
                            }
                        }
                        _ => actor.scale,
                    })
                    .unwrap_or(0.0);
                RuntimeValue::Number(value)
            }
            "effect_of_sprite" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                let scope = field_string(block, "effect").unwrap_or("color");
                let value = self
                    .actor_for_sprite(sprite, owner_id)
                    .and_then(|a| a.effects.get(scope).copied())
                    .unwrap_or(0.0);
                RuntimeValue::Number(value)
            }
            "bump_into" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                let target = field_string(block, "target")
                    .or_else(|| field_string(block, "body"))
                    .unwrap_or("--edge");
                RuntimeValue::Bool(if target == "--edge" {
                    self.touching_edge(sprite, owner_id)
                } else {
                    self.touching_actor(sprite, target, owner_id)
                })
            }
            "out_of_boundary" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                RuntimeValue::Bool(self.touching_edge(sprite, owner_id))
            }
            "bump_into_color" | "bump_into_body_part" => RuntimeValue::Bool(false),
            "get_clone_num" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                RuntimeValue::Number(self.clone_count_for_sprite(sprite, owner_id) as f64)
            }
            "get_current_clone_index" => RuntimeValue::Number(
                owner_id
                    .and_then(|id| self.clone_indices.get(id).copied())
                    .unwrap_or(0) as f64,
            ),
            "get_clone_index_property" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                let attribute = field_string(block, "attribute").unwrap_or("x");
                let index = eval(input(block, "index")).as_number().floor().max(0.0) as usize;
                RuntimeValue::Number(self.clone_property(sprite, owner_id, index, attribute))
            }
            "get_appearance_of_part" | "get_tilt_angle_of_face" => RuntimeValue::Number(0.0),
            "logic_boolean" => RuntimeValue::Bool(
                block
                    .get("fields")
                    .and_then(|fields| fields.get("BOOL"))
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case("true"))
                    .unwrap_or(false),
            ),
            "logic_compare" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("OP"))
                    .and_then(Value::as_str)
                    .unwrap_or("EQ");
                let a = eval(input(block, "A"));
                let b = eval(input(block, "B"));
                RuntimeValue::Bool(compare_values(&a, &b, op))
            }
            "logic_operation" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("and");
                let a = eval(input(block, "A")).is_truthy();
                let b = eval(input(block, "B")).is_truthy();
                RuntimeValue::Bool(if op == "or" { a || b } else { a && b })
            }
            "logic_negate" => RuntimeValue::Bool(!eval(input(block, "logic")).is_truthy()),
            "convert_type" => {
                let target = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("string");
                let value = eval(input(block, "text"));
                match target {
                    "number" => RuntimeValue::Number(value.as_number()),
                    "boolean" => RuntimeValue::Bool(value.is_truthy()),
                    _ => RuntimeValue::String(value.as_string()),
                }
            }
            "text_join" => {
                let mut parts = block
                    .get("inputs")
                    .and_then(Value::as_object)
                    .map(|inputs| {
                        inputs
                            .iter()
                            .filter_map(|(name, value)| {
                                text_join_index(name).map(|index| (index, value))
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                parts.sort_by_key(|(index, _)| *index);
                RuntimeValue::String(
                    parts
                        .into_iter()
                        .map(|(_, value)| eval(Some(value)).as_string())
                        .collect::<String>(),
                )
            }
            "text_length" => {
                let value = eval(input(block, "text"));
                let length = match value {
                    RuntimeValue::List(items) => items.len(),
                    _ => value.as_string().chars().count(),
                };
                RuntimeValue::Number(length as f64)
            }
            "text_contain" => {
                let text = eval(input(block, "A")).as_string();
                let needle = eval(input(block, "B")).as_string();
                RuntimeValue::Bool(text.contains(&needle))
            }
            "text_split" => {
                let text = eval(input(block, "TEXT_TO_SPLIT")).as_string();
                let delimiter = eval(input(block, "SPLIT_TEXT")).as_string();
                let items = if delimiter.is_empty() {
                    text.chars()
                        .map(|value| RuntimeValue::String(value.to_string()))
                        .collect()
                } else {
                    text.split(&delimiter)
                        .map(|value| RuntimeValue::String(value.to_owned()))
                        .collect()
                };
                RuntimeValue::List(items)
            }
            "text_select" => {
                let source = eval(input(block, "text"));
                let start = eval(input(block, "start_index")).as_number() as isize;
                let end = input(block, "end_index")
                    .map(|value| eval(Some(value)).as_number() as isize)
                    .unwrap_or(start);
                select_text_value(source, start, end)
            }
            "math_arithmetic" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("add");
                let a = eval(input(block, "A")).as_number();
                let b = eval(input(block, "B")).as_number();
                let value = match op {
                    "minus" | "subtract" => a - b,
                    "multiply" => a * b,
                    "divide" => {
                        if b == 0.0 {
                            0.0
                        } else {
                            a / b
                        }
                    }
                    "mod" => a % b,
                    "power" => a.powf(b),
                    _ => a + b,
                };
                RuntimeValue::Number(value)
            }
            "math_modulo" => {
                let a = eval(input(block, "A")).as_number();
                let b = eval(input(block, "B")).as_number();
                RuntimeValue::Number(if b == 0.0 { 0.0 } else { a % b })
            }
            "random_num" => {
                let a = eval(input(block, "A")).as_number();
                let b = eval(input(block, "B")).as_number();
                let lo = a.min(b);
                let hi = a.max(b);
                if lo >= hi {
                    RuntimeValue::Number(lo)
                } else {
                    let seed = self.ticks as f64 * 9301.0 + 49297.0;
                    let frac = (seed % 233280.0) / 233280.0;
                    RuntimeValue::Number(lo + frac * (hi - lo))
                }
            }
            "divisible_by" => {
                let a = eval(input(block, "A")).as_number();
                let b = eval(input(block, "B")).as_number();
                RuntimeValue::Bool(b != 0.0 && (a % b).abs() < f64::EPSILON)
            }
            "math_round" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("round");
                let value = eval(input(block, "num")).as_number();
                RuntimeValue::Number(match op {
                    "round_down" => value.floor(),
                    "round_up" => value.ceil(),
                    _ => value.round(),
                })
            }
            "math_function" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("0");
                let value = eval(input(block, "num")).as_number();
                RuntimeValue::Number(match op {
                    "0" | "abs" => value.abs(),
                    "1" | "floor" => value.floor(),
                    "2" | "ceil" => value.ceil(),
                    "3" | "sqrt" => value.sqrt(),
                    "4" | "ln" => value.ln(),
                    "5" | "log" => value.log10(),
                    "6" | "pow2" => 2_f64.powf(value),
                    "7" | "exp" => value.exp(),
                    _ => value,
                })
            }
            "math_number_property" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("integer");
                let value = eval(input(block, "num")).as_number();
                RuntimeValue::Bool(match op {
                    "odd" => value.fract() == 0.0 && (value as i64).rem_euclid(2) == 1,
                    "even" => value.fract() == 0.0 && (value as i64).rem_euclid(2) == 0,
                    "positive" => value > 0.0,
                    "negative" => value < 0.0,
                    "prime" => is_prime(value),
                    _ => value.fract() == 0.0,
                })
            }
            "math_trig" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("sin");
                let value = eval(input(block, "num")).as_number().to_radians();
                let result = match op {
                    "cos" => value.cos(),
                    "tan" => value.tan(),
                    _ => value.sin(),
                };
                RuntimeValue::Number(result)
            }
            _ => RuntimeValue::Null,
        }
    }

    fn eval_procedure_return(
        &self,
        procedure: &super::Procedure<'a>,
        owner_id: Option<&str>,
        range_values: &BTreeMap<String, RuntimeValue>,
        script_values: &BTreeMap<String, RuntimeValue>,
        procedure_values: &BTreeMap<String, RuntimeValue>,
    ) -> RuntimeValue {
        let mut current = procedure.body;
        while let Some(block) = current {
            if block_type(block) == Some("procedures_2_return_value") {
                return self.eval_for_context(
                    input(block, "VALUE"),
                    owner_id,
                    range_values,
                    script_values,
                    procedure_values,
                );
            }
            current = block.get("next");
        }
        RuntimeValue::Null
    }
}
