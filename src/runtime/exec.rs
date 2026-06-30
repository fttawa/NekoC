use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use super::helpers::*;
use super::{
    DialogState, LoopFrame, PenStamp, ProcedureFrame, Runtime, RuntimeTraceEntry, RuntimeValue,
    record_pen_stroke,
};

impl<'a> super::Thread<'a> {
    pub(super) fn eval(&self, runtime: &Runtime<'a>, block: Option<&Value>) -> RuntimeValue {
        runtime.eval_for_context(
            block,
            Some(self.owner_id.as_str()),
            &self.range_values,
            &self.script_values,
            &self.procedure_values,
        )
    }

    pub(super) fn step(
        &mut self,
        runtime: &mut Runtime<'a>,
        active_thread_ids: &BTreeSet<usize>,
    ) -> Result<()> {
        if self.done {
            return Ok(());
        }
        if !self.waiting_for.is_empty() {
            self.waiting_for.retain(|id| active_thread_ids.contains(id));
            if !self.waiting_for.is_empty() {
                return Ok(());
            }
        }
        if self.wait_ticks > 0 {
            self.wait_ticks -= 1;
            return Ok(());
        }

        self.yielded = false;
        let mut budget = 10_000;
        while budget > 0 && !self.done && !self.yielded && self.wait_ticks == 0 {
            budget -= 1;
            let Some(block) = self.current else {
                self.done = true;
                break;
            };
            self.execute_block(block, runtime)?;
        }
        if budget == 0 {
            bail!("runtime step budget exhausted in owner {}", self.owner_id);
        }
        Ok(())
    }

    pub(super) fn execute_block(
        &mut self,
        block: &'a Value,
        runtime: &mut Runtime<'a>,
    ) -> Result<()> {
        match block_type(block).unwrap_or("") {
            "on_running_group_activated" | "start_on_click" | "on_keydown" | "start_as_clone" => {
                self.advance(runtime, block.get("next"));
            }
            "when" => {
                if self.eval(runtime, input(block, "condition")).is_truthy() {
                    self.enter_branch(runtime, statement(block, "DO"), block.get("next"));
                } else {
                    self.wait_ticks = 1;
                    self.current = Some(block);
                }
            }
            "variables_set" => {
                let variable = variable_field(block).context("variables_set missing variable")?;
                let value = self.eval(runtime, input(block, "value"));
                runtime.variables.insert(variable.to_owned(), value);
                self.advance(runtime, block.get("next"));
            }
            "change_variables" => {
                let variable =
                    variable_field(block).context("change_variables missing variable")?;
                let delta = self.eval(runtime, input(block, "value")).as_number();
                let current = runtime
                    .variables
                    .get(variable)
                    .cloned()
                    .unwrap_or(RuntimeValue::Number(0.0))
                    .as_number();
                let method = block
                    .get("fields")
                    .and_then(|fields| fields.get("method"))
                    .and_then(Value::as_str)
                    .unwrap_or("increase");
                let value = if method == "decrease" {
                    current - delta
                } else {
                    current + delta
                };
                runtime
                    .variables
                    .insert(variable.to_owned(), RuntimeValue::Number(value));
                self.advance(runtime, block.get("next"));
            }
            "list_append" => {
                let list_id = self.eval(runtime, input(block, "list")).as_string();
                let value = self.eval(runtime, input(block, "list_item_value"));
                ensure_runtime_list(
                    runtime
                        .variables
                        .entry(list_id)
                        .or_insert(RuntimeValue::Null),
                )
                .push(value);
                self.advance(runtime, block.get("next"));
            }
            "list_insert_value" => {
                let list_id = self.eval(runtime, input(block, "list")).as_string();
                let index = self.eval(runtime, input(block, "list_index")).as_number();
                let value = self.eval(runtime, input(block, "list_item_value"));
                let items = ensure_runtime_list(
                    runtime
                        .variables
                        .entry(list_id)
                        .or_insert(RuntimeValue::Null),
                );
                let index = insertion_index(index, items.len());
                items.insert(index, value);
                self.advance(runtime, block.get("next"));
            }
            "replace_list_item" => {
                let list_id = self.eval(runtime, input(block, "list")).as_string();
                let index = self.eval(runtime, input(block, "list_index")).as_number();
                let value = self.eval(runtime, input(block, "list_item_value"));
                let item = block
                    .get("fields")
                    .and_then(|fields| fields.get("item"))
                    .and_then(Value::as_str)
                    .unwrap_or("any");
                let items = ensure_runtime_list(
                    runtime
                        .variables
                        .entry(list_id)
                        .or_insert(RuntimeValue::Null),
                );
                if let Some(index) = list_index(item, index, items.len())
                    && let Some(slot) = items.get_mut(index)
                {
                    *slot = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "delete_list_item" => {
                let list_id = self.eval(runtime, input(block, "list")).as_string();
                let index = self.eval(runtime, input(block, "list_index")).as_number();
                let item = block
                    .get("fields")
                    .and_then(|fields| fields.get("item"))
                    .and_then(Value::as_str)
                    .unwrap_or("any");
                let items = ensure_runtime_list(
                    runtime
                        .variables
                        .entry(list_id)
                        .or_insert(RuntimeValue::Null),
                );
                if let Some(index) = list_index(item, index, items.len()) {
                    items.remove(index);
                }
                self.advance(runtime, block.get("next"));
            }
            "list_copy" => {
                let source_id = self.eval(runtime, input(block, "list")).as_string();
                let target_id = self.eval(runtime, input(block, "target_list")).as_string();
                let value = runtime
                    .variables
                    .get(&source_id)
                    .cloned()
                    .unwrap_or(RuntimeValue::List(Vec::new()));
                runtime.variables.insert(target_id, value);
                self.advance(runtime, block.get("next"));
            }
            "show_hide_list" => {
                self.advance(runtime, block.get("next"));
            }
            "script_variables" => {
                for name in script_variable_names(block) {
                    self.script_values
                        .entry(name.to_owned())
                        .or_insert(RuntimeValue::Null);
                }
                self.advance(runtime, block.get("next"));
            }
            "repeat_forever" => {
                let body = statement(block, "DO");
                if let Some(body) = body {
                    self.loops.push(LoopFrame::Forever { body });
                    self.current = Some(body);
                } else {
                    self.advance(runtime, block.get("next"));
                }
            }
            "repeat_n_times" => {
                let times = runtime
                    .eval(input(block, "times"))
                    .as_number()
                    .floor()
                    .max(0.0);
                if let Some(body) = statement(block, "DO") {
                    if times <= 0.0 {
                        self.advance(runtime, block.get("next"));
                    } else {
                        self.loops.push(LoopFrame::Repeat {
                            body,
                            remaining: times as usize - 1,
                            after: block.get("next"),
                        });
                        self.current = Some(body);
                    }
                } else {
                    self.advance(runtime, block.get("next"));
                }
            }
            "repeat_forever_until" => {
                if let Some(body) = statement(block, "DO") {
                    if self.eval(runtime, input(block, "condition")).is_truthy() {
                        self.advance(runtime, block.get("next"));
                    } else {
                        self.loops.push(LoopFrame::Until {
                            body,
                            condition: input(block, "condition"),
                            after: block.get("next"),
                        });
                        self.current = Some(body);
                    }
                } else {
                    self.advance(runtime, block.get("next"));
                }
            }
            "traverse_number" => {
                let variable = input(block, "value")
                    .and_then(traverse_param_name)
                    .context("traverse_number missing loop variable")?
                    .to_owned();
                let start = self.eval(runtime, input(block, "from")).as_number();
                let end = self.eval(runtime, input(block, "to")).as_number();
                let step = self.eval(runtime, input(block, "by")).as_number();
                let body = statement(block, "DO");
                let Some(body) = body else {
                    self.advance(runtime, block.get("next"));
                    return Ok(());
                };
                if step == 0.0 || !range_contains(start, end, step) {
                    self.advance(runtime, block.get("next"));
                } else {
                    self.range_values
                        .insert(variable.clone(), RuntimeValue::Number(start));
                    self.loops.push(LoopFrame::Range {
                        variable,
                        body,
                        current: start,
                        end,
                        step,
                        after: block.get("next"),
                    });
                    self.current = Some(body);
                }
            }
            "controls_if" => {
                let branch = if self.eval(runtime, input(block, "IF0")).is_truthy() {
                    statement(block, "DO0")
                } else {
                    statement(block, "ELSE")
                };
                self.enter_branch(runtime, branch, block.get("next"));
            }
            "wait" => {
                let seconds = self
                    .eval(runtime, input(block, "time"))
                    .as_number()
                    .max(0.0);
                self.wait_ticks = seconds_to_wait_ticks(seconds);
                self.yielded = true;
                self.advance(runtime, block.get("next"));
            }
            "wait_until" => {
                if self.eval(runtime, input(block, "condition")).is_truthy() {
                    self.advance(runtime, block.get("next"));
                } else {
                    self.wait_ticks = 1;
                    self.current = Some(block);
                }
            }
            "break" => {
                self.break_loop(runtime);
            }
            "procedures_2_callnoreturn" => {
                let def_id = procedure_def_id(block).context("procedure call missing def_id")?;
                let procedure = runtime
                    .procedures
                    .get(def_id)
                    .with_context(|| format!("unknown procedure {def_id}"))?;
                let mut values = BTreeMap::new();
                for param in &procedure.params {
                    if let Some(input) = input(block, &param.id) {
                        values.insert(param.name.clone(), self.eval(runtime, Some(input)));
                    }
                }
                if let Some(body) = procedure.body {
                    let previous_values = std::mem::replace(&mut self.procedure_values, values);
                    self.procedure_frames.push(ProcedureFrame {
                        after: block.get("next"),
                        procedure_values: previous_values,
                    });
                    self.current = Some(body);
                } else {
                    self.advance(runtime, block.get("next"));
                }
            }
            "self_broadcast" => {
                let message = broadcast_message(input(block, "message"))
                    .context("broadcast block missing message")?;
                runtime.dispatch_broadcast(&message, None);
                self.advance(runtime, block.get("next"));
            }
            "self_broadcast_and_wait" => {
                let message = broadcast_message(input(block, "message"))
                    .context("broadcast block missing message")?;
                let listener_thread_ids = runtime.dispatch_broadcast(&message, None);
                if listener_thread_ids.is_empty() {
                    self.advance(runtime, block.get("next"));
                } else {
                    runtime.trace.push(RuntimeTraceEntry::message(
                        runtime.ticks,
                        "broadcast_wait",
                        &message,
                    ));
                    self.waiting_for = listener_thread_ids.into_iter().collect();
                    self.yielded = true;
                    self.advance(runtime, block.get("next"));
                }
            }
            "self_broadcast_with_param" => {
                let message = broadcast_message(input(block, "message"))
                    .context("broadcast block missing message")?;
                let payload = self.eval(runtime, input(block, "param"));
                runtime.dispatch_broadcast(&message, Some(payload));
                self.advance(runtime, block.get("next"));
            }
            "ask_and_choose" => {
                runtime.last_answer = RuntimeValue::String(String::new());
                runtime.last_choice_content =
                    RuntimeValue::String(self.eval(runtime, choice_input(block, 0)).as_string());
                runtime.last_choice_index = 1;
                self.advance(runtime, block.get("next"));
            }
            "self_ask" => {
                runtime.last_answer = RuntimeValue::String(String::new());
                self.advance(runtime, block.get("next"));
            }
            "set_timer_state" => {
                match field_string(block, "type").unwrap_or("reset") {
                    "start" => runtime.timer_running = true,
                    "stop" => runtime.timer_running = false,
                    _ => {
                        runtime.timer_elapsed_ticks = 0;
                        runtime.timer_running = true;
                    }
                }
                self.advance(runtime, block.get("next"));
            }
            "show_hide_timer" | "face_to_body_part" => {
                self.advance(runtime, block.get("next"));
            }
            "mirror" => {
                let sprite = field_string(block, "sprite").unwrap_or("--self");
                if let Some(actor_id) = runtime.actor_id_for_sprite(sprite, Some(&self.owner_id)) {
                    runtime.create_clone(&actor_id);
                }
                self.advance(runtime, block.get("next"));
            }
            "dispose_clone" => {
                if runtime.delete_clone(&self.owner_id) {
                    self.done = true;
                } else {
                    self.advance(runtime, block.get("next"));
                }
            }
            "warp" | "tell" | "sync_tell" => {
                self.enter_branch(runtime, statement(block, "DO"), block.get("next"));
            }
            "stop" => {
                self.done = true;
            }
            "restart" => {
                self.advance(runtime, block.get("next"));
            }
            "switch_to_screen" => {
                let screen_id = self.eval(runtime, input(block, "screen_id")).as_string();
                if screen_id.is_empty() {
                    bail!("switch_to_screen missing target screen");
                }
                runtime.current_scene_id = Some(screen_id);
                runtime.trace.push(RuntimeTraceEntry::event(
                    runtime.ticks,
                    "switch_screen",
                    None,
                    None,
                    runtime.current_scene_id.clone(),
                    None,
                    None,
                ));
                self.advance(runtime, block.get("next"));
            }
            "self_go_forward" => {
                let steps = self.eval(runtime, input(block, "steps")).as_number();
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    let radians = actor.rotation.to_radians();
                    actor.x += steps * radians.sin();
                    actor.y += steps * radians.cos();
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_move_to" | "self_glide_to" => {
                let x = self.eval(runtime, input(block, "x")).as_number();
                let y = self.eval(runtime, input(block, "y")).as_number();
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x = x;
                    actor.y = y;
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_x" => {
                let value = self.eval(runtime, input(block, "value")).as_number();
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x = value;
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_y" => {
                let value = self.eval(runtime, input(block, "value")).as_number();
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.y = value;
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_x" | "self_glide_coordinate_x" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "value")).as_number());
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x += delta;
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_y" | "self_glide_coordinate_y" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "value")).as_number());
                let old = runtime
                    .actors
                    .get(&self.owner_id)
                    .map(|a| (a.x, a.y))
                    .unwrap_or((0.0, 0.0));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.y += delta;
                }
                record_pen_stroke(&mut runtime.actors, &self.owner_id, old.0, old.1);
                self.advance(runtime, block.get("next"));
            }
            "self_rotate" => {
                let degrees = self.eval(runtime, input(block, "degrees")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.rotation += degrees;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_point_towards" => {
                let degrees = self.eval(runtime, input(block, "degrees")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.rotation = degrees;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_appear" => {
                let visible = block
                    .get("fields")
                    .and_then(|fields| fields.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or("appear")
                    == "appear";
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.visible = visible;
                }
                self.advance(runtime, block.get("next"));
            }
            "set_scale" => {
                let value = self.eval(runtime, input(block, "scale")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.scale = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_scale" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "scale")).as_number());
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.scale += delta;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_appear_animation"
            | "self_gradually_show_hide"
            | "create_stage_dialog"
            | "set_width_height_scale"
            | "add_width_height_scale"
            | "self_text_effect_text"
            | "self_text_effect_size"
            | "self_text_effect_color"
            | "set_top_bottom_layer"
            | "self_set_role_camp"
            | "self_stress_animation"
            | "global_animation"
            | "show_hide_variables" => {
                self.advance(runtime, block.get("next"));
            }
            "self_set_effect" => {
                let scope = field_string(block, "scope").unwrap_or("color").to_owned();
                let value = self.eval(runtime, input(block, "value")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.effects.insert(scope, value);
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_effect" => {
                let scope = field_string(block, "scope").unwrap_or("color").to_owned();
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "value")).as_number());
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    let current = actor.effects.get(&scope).copied().unwrap_or(0.0);
                    actor.effects.insert(scope, current + delta);
                }
                self.advance(runtime, block.get("next"));
            }
            "clear_all_effects" => {
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.effects.clear();
                }
                self.advance(runtime, block.get("next"));
            }
            "clear_drawing" => {
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.strokes.clear();
                    actor.pen.stamps.clear();
                }
                self.advance(runtime, block.get("next"));
            }
            "self_pen_down" => {
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.down = true;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_pen_up" => {
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.down = false;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_pen_color" => {
                let color = field_string(block, "color").unwrap_or("#000000").to_owned();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.color = color;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_pen_size" => {
                let size = self.eval(runtime, input(block, "size")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.size = size.max(0.0);
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_pen_size" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "steps")).as_number());
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.pen.size = (actor.pen.size + delta).max(0.0);
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_pen_color_property" => {
                self.advance(runtime, block.get("next"));
            }
            "self_change_pen_color_property" => {
                self.advance(runtime, block.get("next"));
            }
            "stamp" => {
                if let Some(actor) = runtime.actors.get(&self.owner_id) {
                    let stamp = PenStamp {
                        x: actor.x,
                        y: actor.y,
                        kind: "costume".to_owned(),
                    };
                    runtime
                        .actors
                        .get_mut(&self.owner_id)
                        .unwrap()
                        .pen
                        .stamps
                        .push(stamp);
                }
                self.advance(runtime, block.get("next"));
            }
            "image_stamp" => {
                if let Some(actor) = runtime.actors.get(&self.owner_id) {
                    let stamp = PenStamp {
                        x: actor.x,
                        y: actor.y,
                        kind: "image".to_owned(),
                    };
                    runtime
                        .actors
                        .get_mut(&self.owner_id)
                        .unwrap()
                        .pen
                        .stamps
                        .push(stamp);
                }
                self.advance(runtime, block.get("next"));
            }
            "set_pen_layer" => {
                self.advance(runtime, block.get("next"));
            }
            "play_audio" | "play_audio_and_wait" => {
                runtime.trace.push(RuntimeTraceEntry {
                    tick: runtime.ticks,
                    kind: "play_audio".to_owned(),
                    owner_id: Some(self.owner_id.clone()),
                    block_id: block
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    message: None,
                    key: None,
                    state: None,
                    x: None,
                    y: None,
                    screen_id: None,
                    clone_id: None,
                });
                self.advance(runtime, block.get("next"));
            }
            "stop_audio" => {
                runtime.trace.push(RuntimeTraceEntry {
                    tick: runtime.ticks,
                    kind: "stop_audio".to_owned(),
                    owner_id: Some(self.owner_id.clone()),
                    block_id: block
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    message: None,
                    key: None,
                    state: None,
                    x: None,
                    y: None,
                    screen_id: None,
                    clone_id: None,
                });
                self.advance(runtime, block.get("next"));
            }
            "self_prev_next_style" => {
                let direction = field_string(block, "prev_next").unwrap_or("next");
                let Some(actor) = runtime.actors.get_mut(&self.owner_id) else {
                    self.advance(runtime, block.get("next"));
                    return Ok(());
                };
                let Some(project_actor) =
                    get_path(runtime.project, &["actors", "actorsDict", &self.owner_id])
                else {
                    self.advance(runtime, block.get("next"));
                    return Ok(());
                };
                let Some(styles) = project_actor.get("styles").and_then(Value::as_array) else {
                    self.advance(runtime, block.get("next"));
                    return Ok(());
                };
                if styles.is_empty() {
                    self.advance(runtime, block.get("next"));
                    return Ok(());
                }
                let current_id = actor.current_style_id.as_deref().unwrap_or("");
                let idx = styles
                    .iter()
                    .position(|s| s.as_str() == Some(current_id))
                    .unwrap_or(0);
                let new_idx = if direction == "prev" {
                    if idx == 0 { styles.len() - 1 } else { idx - 1 }
                } else {
                    (idx + 1) % styles.len()
                };
                actor.current_style_id = styles[new_idx].as_str().map(ToOwned::to_owned);
                self.advance(runtime, block.get("next"));
            }
            "set_sprite_style" => {
                let style_input = self.eval(runtime, input(block, "style_id"));
                if let (RuntimeValue::String(id), Some(actor)) =
                    (style_input, runtime.actors.get_mut(&self.owner_id))
                {
                    actor.current_style_id = Some(id);
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_draggable" => {
                let value = field_string(block, "draggable").unwrap_or("false");
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.draggable = value == "true";
                }
                self.advance(runtime, block.get("next"));
            }
            "self_dialog" => {
                let kind = field_string(block, "type").unwrap_or("say").to_owned();
                let text = self.eval(runtime, input(block, "text"));
                let time = input(block, "time").and_then(|b| {
                    let v = self.eval(runtime, Some(b));
                    if let RuntimeValue::Number(n) = v {
                        Some(n as usize)
                    } else {
                        None
                    }
                });
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.dialog = Some(DialogState {
                        kind,
                        text: format_value(&text),
                        timeout_ticks: time,
                    });
                }
                self.advance(runtime, block.get("next"));
            }
            "self_dialog_wait" => {
                let kind = field_string(block, "type").unwrap_or("say").to_owned();
                let text = self.eval(runtime, input(block, "text"));
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.dialog = Some(DialogState {
                        kind,
                        text: format_value(&text),
                        timeout_ticks: None,
                    });
                }
                self.advance(runtime, block.get("next"));
            }
            "close_self_dialog" => {
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.dialog = None;
                }
                self.advance(runtime, block.get("next"));
            }
            "console_log" => {
                let value = self.eval(runtime, input(block, "console_log"));
                runtime.logs.push(format_value(&value));
                self.advance(runtime, block.get("next"));
            }
            unsupported => {
                bail!("unsupported runtime block type: {unsupported}");
            }
        }
        Ok(())
    }

    pub(super) fn advance(&mut self, runtime: &Runtime<'a>, next: Option<&'a Value>) {
        if let Some(next) = next {
            self.current = Some(next);
        } else if let Some(Some(continuation)) = self.continuations.pop() {
            self.current = Some(continuation);
        } else if let Some(next_loop) = self.next_loop_iteration(runtime) {
            self.current = next_loop;
        } else if let Some(frame) = self.procedure_frames.pop() {
            self.procedure_values = frame.procedure_values;
            if let Some(after) = frame.after {
                self.current = Some(after);
            } else {
                self.advance(runtime, None);
            }
        } else {
            self.done = true;
        }
    }

    pub(super) fn enter_branch(
        &mut self,
        runtime: &Runtime<'a>,
        branch: Option<&'a Value>,
        after: Option<&'a Value>,
    ) {
        if let Some(branch) = branch {
            self.continuations.push(after);
            self.current = Some(branch);
        } else {
            self.advance(runtime, after);
        }
    }

    pub(super) fn next_loop_iteration(
        &mut self,
        runtime: &Runtime<'a>,
    ) -> Option<Option<&'a Value>> {
        let owner_id = self.owner_id.as_str();
        let frame = self.loops.last_mut()?;
        match frame {
            LoopFrame::Forever { body } => Some(Some(*body)),
            LoopFrame::Repeat {
                body,
                remaining,
                after,
            } => {
                if *remaining > 0 {
                    *remaining -= 1;
                    Some(Some(*body))
                } else {
                    let after = *after;
                    self.loops.pop();
                    if after.is_some() {
                        Some(after)
                    } else {
                        self.next_loop_iteration(runtime)
                    }
                }
            }
            LoopFrame::Until {
                body,
                condition,
                after,
            } => {
                let after = *after;
                let body = *body;
                if runtime
                    .eval_for_context(
                        *condition,
                        Some(owner_id),
                        &self.range_values,
                        &self.script_values,
                        &self.procedure_values,
                    )
                    .is_truthy()
                {
                    self.loops.pop();
                    if after.is_some() {
                        Some(after)
                    } else {
                        self.next_loop_iteration(runtime)
                    }
                } else {
                    Some(Some(body))
                }
            }
            LoopFrame::Range {
                variable,
                body,
                current,
                end,
                step,
                after,
            } => {
                let next = *current + *step;
                if range_contains(next, *end, *step) {
                    *current = next;
                    self.range_values
                        .insert(variable.clone(), RuntimeValue::Number(next));
                    Some(Some(*body))
                } else {
                    let variable = variable.clone();
                    let after = *after;
                    self.loops.pop();
                    self.range_values.remove(&variable);
                    if after.is_some() {
                        Some(after)
                    } else {
                        self.next_loop_iteration(runtime)
                    }
                }
            }
        }
    }

    pub(super) fn break_loop(&mut self, runtime: &Runtime<'a>) {
        self.continuations.clear();
        let Some(frame) = self.loops.pop() else {
            self.done = true;
            return;
        };
        let after = match frame {
            LoopFrame::Forever { body: _ } => None,
            LoopFrame::Repeat {
                body: _,
                remaining: _,
                after,
            }
            | LoopFrame::Until {
                body: _,
                condition: _,
                after,
            } => after,
            LoopFrame::Range {
                variable,
                body: _,
                current: _,
                end: _,
                step: _,
                after,
            } => {
                self.range_values.remove(&variable);
                after
            }
        };
        if let Some(after) = after {
            self.current = Some(after);
        } else if let Some(next_loop) = self.next_loop_iteration(runtime) {
            self.current = next_loop;
        } else {
            self.done = true;
        }
    }
}
