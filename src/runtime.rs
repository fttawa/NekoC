use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

const DEFAULT_FPS: f64 = 30.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum RuntimeValue {
    Number(f64),
    Bool(bool),
    String(String),
    List(Vec<RuntimeValue>),
    Null,
}

impl RuntimeValue {
    fn as_number(&self) -> f64 {
        match self {
            RuntimeValue::Number(value) => *value,
            RuntimeValue::Bool(value) => {
                if *value {
                    1.0
                } else {
                    0.0
                }
            }
            RuntimeValue::String(value) => value.parse().unwrap_or(0.0),
            RuntimeValue::List(value) => value.len() as f64,
            RuntimeValue::Null => 0.0,
        }
    }

    fn is_truthy(&self) -> bool {
        match self {
            RuntimeValue::Number(value) => *value != 0.0,
            RuntimeValue::Bool(value) => *value,
            RuntimeValue::String(value) => !value.is_empty() && value != "false" && value != "0",
            RuntimeValue::List(value) => !value.is_empty(),
            RuntimeValue::Null => false,
        }
    }

    fn as_string(&self) -> String {
        format_value(self)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActorState {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RuntimeSnapshot {
    pub ticks: usize,
    pub current_scene_id: Option<String>,
    pub current_scene_name: Option<String>,
    pub variables: BTreeMap<String, RuntimeValue>,
    pub variable_names: BTreeMap<String, String>,
    pub actors: BTreeMap<String, ActorState>,
    pub logs: Vec<String>,
    pub received_broadcasts: Vec<String>,
    pub message_values: BTreeMap<String, RuntimeValue>,
    pub active_threads: usize,
}

pub fn run_project(value: &Value, ticks: usize) -> Result<RuntimeSnapshot> {
    let mut runtime = Runtime::from_project(value)?;
    runtime.start();
    runtime.run_ticks(ticks)?;
    Ok(runtime.snapshot())
}

struct Runtime<'a> {
    project: &'a Value,
    ticks: usize,
    current_scene_id: Option<String>,
    scene_names: BTreeMap<String, String>,
    stage_width: f64,
    stage_height: f64,
    timer_elapsed_ticks: usize,
    timer_running: bool,
    last_answer: RuntimeValue,
    last_choice_content: RuntimeValue,
    last_choice_index: usize,
    variables: BTreeMap<String, RuntimeValue>,
    variable_names: BTreeMap<String, String>,
    actors: BTreeMap<String, ActorState>,
    listeners: BTreeMap<String, Vec<Listener<'a>>>,
    received_broadcasts: BTreeSet<String>,
    message_values: BTreeMap<String, RuntimeValue>,
    logs: Vec<String>,
    threads: Vec<Thread<'a>>,
}

impl<'a> Runtime<'a> {
    fn from_project(project: &'a Value) -> Result<Self> {
        let Some(root) = project.as_object() else {
            bail!("project root must be a JSON object");
        };

        let variables = root
            .get("variables")
            .and_then(|value| value.get("variablesDict"))
            .and_then(Value::as_object)
            .map(collect_variables)
            .unwrap_or_default();
        let variable_names = root
            .get("variables")
            .and_then(|value| value.get("variablesDict"))
            .and_then(Value::as_object)
            .map(collect_variable_names)
            .unwrap_or_default();
        let actors = root
            .get("actors")
            .and_then(|value| value.get("actorsDict"))
            .and_then(Value::as_object)
            .map(collect_actors)
            .unwrap_or_default();
        let current_scene_id = root
            .get("scenes")
            .and_then(|value| value.get("currentSceneId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let scene_names = root
            .get("scenes")
            .and_then(|value| value.get("scenesDict"))
            .and_then(Value::as_object)
            .map(collect_scene_names)
            .unwrap_or_default();
        let stage_width = root
            .get("stageSize")
            .and_then(|stage_size| stage_size.get("width"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let stage_height = root
            .get("stageSize")
            .and_then(|stage_size| stage_size.get("height"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let listeners = collect_listeners(project);

        Ok(Self {
            project,
            ticks: 0,
            current_scene_id,
            scene_names,
            stage_width,
            stage_height,
            timer_elapsed_ticks: 0,
            timer_running: true,
            last_answer: RuntimeValue::String(String::new()),
            last_choice_content: RuntimeValue::String(String::new()),
            last_choice_index: 0,
            variables,
            variable_names,
            actors,
            listeners,
            received_broadcasts: BTreeSet::new(),
            message_values: BTreeMap::new(),
            logs: Vec::new(),
            threads: Vec::new(),
        })
    }

    fn start(&mut self) {
        self.spawn_start_scripts_at(&["scenes", "scenesDict"]);
        self.spawn_start_scripts_at(&["actors", "actorsDict"]);
    }

    fn spawn_start_scripts_at(&mut self, path: &[&str]) {
        let Some(owners) = get_path(self.project, path).and_then(Value::as_object) else {
            return;
        };

        for (owner_id, owner) in owners {
            let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) else {
                continue;
            };
            for block in blocks {
                let is_start_hat = matches!(
                    block_type(block),
                    Some("on_running_group_activated" | "when")
                );
                if is_start_hat {
                    self.threads.push(Thread {
                        owner_id,
                        current: Some(block),
                        loops: Vec::new(),
                        continuations: Vec::new(),
                        wait_ticks: 0,
                        yielded: false,
                        done: false,
                    });
                }
            }
        }
    }

    fn run_ticks(&mut self, ticks: usize) -> Result<()> {
        for _ in 0..ticks {
            self.ticks += 1;
            let mut threads = std::mem::take(&mut self.threads);
            for thread in &mut threads {
                thread.step(self)?;
            }
            threads.retain(|thread| !thread.done);
            threads.append(&mut self.threads);
            self.threads = threads;
            if self.timer_running {
                self.timer_elapsed_ticks += 1;
            }
        }
        Ok(())
    }

    fn snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot {
            ticks: self.ticks,
            current_scene_id: self.current_scene_id.clone(),
            current_scene_name: self
                .current_scene_id
                .as_ref()
                .and_then(|id| self.scene_names.get(id))
                .cloned(),
            variables: self.variables.clone(),
            variable_names: self.variable_names.clone(),
            actors: self.actors.clone(),
            logs: self.logs.clone(),
            received_broadcasts: self.received_broadcasts.iter().cloned().collect(),
            message_values: self.message_values.clone(),
            active_threads: self.threads.len(),
        }
    }

    fn dispatch_broadcast(&mut self, message: &str, payload: Option<RuntimeValue>) {
        self.received_broadcasts.insert(message.to_owned());
        let listeners = self.listeners.get(message).cloned().unwrap_or_default();
        for listener in listeners {
            if let (Some(param_name), Some(payload)) = (&listener.param_name, &payload) {
                self.message_values
                    .insert(param_name.clone(), payload.clone());
            }
            if let Some(body) = listener.body {
                self.threads.push(Thread {
                    owner_id: listener.owner_id,
                    current: Some(body),
                    loops: Vec::new(),
                    continuations: Vec::new(),
                    wait_ticks: 0,
                    yielded: false,
                    done: false,
                });
            }
        }
    }

    fn eval(&self, block: Option<&Value>) -> RuntimeValue {
        let Some(block) = block else {
            return RuntimeValue::Null;
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
                let list_id = self.eval(input(block, "list")).as_string();
                let index = self.eval(input(block, "list_index")).as_number();
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
                let list_id = self.eval(input(block, "list")).as_string();
                let length = self
                    .variables
                    .get(&list_id)
                    .and_then(runtime_list)
                    .map(Vec::len)
                    .unwrap_or(0);
                RuntimeValue::Number(length as f64)
            }
            "list_index_of" => {
                let list_id = self.eval(input(block, "list")).as_string();
                let needle = self.eval(input(block, "list_item_value"));
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
                let list_id = self.eval(input(block, "list")).as_string();
                let needle = self.eval(input(block, "list_item_value"));
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
                        .map(|(_, value)| self.eval(Some(value)))
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
            "received_broadcast" => {
                let message = broadcast_message(input(block, "message")).unwrap_or_default();
                RuntimeValue::Bool(self.received_broadcasts.contains(&message))
            }
            "check_key" | "mouse_down" => RuntimeValue::Bool(false),
            "get_mouse_info" => RuntimeValue::Number(0.0),
            "get_answer" => self.last_answer.clone(),
            "get_choice_and_index" => {
                let field_type = field_string(block, "type").unwrap_or("content");
                if field_type == "index" {
                    RuntimeValue::Number(self.last_choice_index as f64)
                } else {
                    self.last_choice_content.clone()
                }
            }
            "timer" => RuntimeValue::Number(self.timer_elapsed_ticks as f64 / DEFAULT_FPS),
            "get_time" => RuntimeValue::Number(0.0),
            "get_stage_info" => match field_string(block, "type").unwrap_or("width") {
                "height" => RuntimeValue::Number(self.stage_height),
                _ => RuntimeValue::Number(self.stage_width),
            },
            "bump_into" | "bump_into_color" | "out_of_boundary" | "bump_into_body_part" => {
                RuntimeValue::Bool(false)
            }
            "get_clone_num" | "get_current_clone_index" | "get_clone_index_property" => {
                RuntimeValue::Number(0.0)
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
                let a = self.eval(input(block, "A"));
                let b = self.eval(input(block, "B"));
                RuntimeValue::Bool(compare_values(&a, &b, op))
            }
            "logic_operation" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("and");
                let a = self.eval(input(block, "A")).is_truthy();
                let b = self.eval(input(block, "B")).is_truthy();
                RuntimeValue::Bool(if op == "or" { a || b } else { a && b })
            }
            "logic_negate" => RuntimeValue::Bool(!self.eval(input(block, "logic")).is_truthy()),
            "convert_type" => {
                let target = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("string");
                let value = self.eval(input(block, "text"));
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
                        .map(|(_, value)| self.eval(Some(value)).as_string())
                        .collect::<String>(),
                )
            }
            "text_length" => {
                let value = self.eval(input(block, "text"));
                let length = match value {
                    RuntimeValue::List(items) => items.len(),
                    _ => value.as_string().chars().count(),
                };
                RuntimeValue::Number(length as f64)
            }
            "text_contain" => {
                let text = self.eval(input(block, "A")).as_string();
                let needle = self.eval(input(block, "B")).as_string();
                RuntimeValue::Bool(text.contains(&needle))
            }
            "text_split" => {
                let text = self.eval(input(block, "TEXT_TO_SPLIT")).as_string();
                let delimiter = self.eval(input(block, "SPLIT_TEXT")).as_string();
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
                let source = self.eval(input(block, "text"));
                let start = self.eval(input(block, "start_index")).as_number() as isize;
                let end = input(block, "end_index")
                    .map(|value| self.eval(Some(value)).as_number() as isize)
                    .unwrap_or(start);
                select_text_value(source, start, end)
            }
            "math_arithmetic" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("add");
                let a = self.eval(input(block, "A")).as_number();
                let b = self.eval(input(block, "B")).as_number();
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
                let a = self.eval(input(block, "A")).as_number();
                let b = self.eval(input(block, "B")).as_number();
                RuntimeValue::Number(if b == 0.0 { 0.0 } else { a % b })
            }
            "math_round" => {
                let op = block
                    .get("fields")
                    .and_then(|fields| fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("round");
                let value = self.eval(input(block, "num")).as_number();
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
                let value = self.eval(input(block, "num")).as_number();
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
                let value = self.eval(input(block, "num")).as_number();
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
                let value = self.eval(input(block, "num")).as_number().to_radians();
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
}

struct Thread<'a> {
    owner_id: &'a str,
    current: Option<&'a Value>,
    loops: Vec<LoopFrame<'a>>,
    continuations: Vec<Option<&'a Value>>,
    wait_ticks: usize,
    yielded: bool,
    done: bool,
}

impl<'a> Thread<'a> {
    fn step(&mut self, runtime: &mut Runtime<'a>) -> Result<()> {
        if self.done {
            return Ok(());
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

    fn execute_block(&mut self, block: &'a Value, runtime: &mut Runtime<'a>) -> Result<()> {
        match block_type(block).unwrap_or("") {
            "on_running_group_activated" => {
                self.advance(runtime, block.get("next"));
            }
            "when" => {
                if runtime.eval(input(block, "condition")).is_truthy() {
                    self.enter_branch(runtime, statement(block, "DO"), block.get("next"));
                } else {
                    self.wait_ticks = 1;
                    self.current = Some(block);
                }
            }
            "variables_set" => {
                let variable = variable_field(block).context("variables_set missing variable")?;
                let value = runtime.eval(input(block, "value"));
                runtime.variables.insert(variable.to_owned(), value);
                self.advance(runtime, block.get("next"));
            }
            "change_variables" => {
                let variable =
                    variable_field(block).context("change_variables missing variable")?;
                let delta = runtime.eval(input(block, "value")).as_number();
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
                let list_id = runtime.eval(input(block, "list")).as_string();
                let value = runtime.eval(input(block, "list_item_value"));
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
                let list_id = runtime.eval(input(block, "list")).as_string();
                let index = runtime.eval(input(block, "list_index")).as_number();
                let value = runtime.eval(input(block, "list_item_value"));
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
                let list_id = runtime.eval(input(block, "list")).as_string();
                let index = runtime.eval(input(block, "list_index")).as_number();
                let value = runtime.eval(input(block, "list_item_value"));
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
                let list_id = runtime.eval(input(block, "list")).as_string();
                let index = runtime.eval(input(block, "list_index")).as_number();
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
                let source_id = runtime.eval(input(block, "list")).as_string();
                let target_id = runtime.eval(input(block, "target_list")).as_string();
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
                    if runtime.eval(input(block, "condition")).is_truthy() {
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
            "controls_if" => {
                let branch = if runtime.eval(input(block, "IF0")).is_truthy() {
                    statement(block, "DO0")
                } else {
                    statement(block, "ELSE")
                };
                self.enter_branch(runtime, branch, block.get("next"));
            }
            "wait" => {
                let seconds = runtime.eval(input(block, "time")).as_number().max(0.0);
                self.wait_ticks = seconds_to_wait_ticks(seconds);
                self.yielded = true;
                self.advance(runtime, block.get("next"));
            }
            "wait_until" => {
                if runtime.eval(input(block, "condition")).is_truthy() {
                    self.advance(runtime, block.get("next"));
                } else {
                    self.wait_ticks = 1;
                    self.current = Some(block);
                }
            }
            "break" => {
                self.break_loop(runtime);
            }
            "self_broadcast" | "self_broadcast_and_wait" => {
                let message = broadcast_message(input(block, "message"))
                    .context("broadcast block missing message")?;
                runtime.dispatch_broadcast(&message, None);
                self.advance(runtime, block.get("next"));
            }
            "self_broadcast_with_param" => {
                let message = broadcast_message(input(block, "message"))
                    .context("broadcast block missing message")?;
                let payload = runtime.eval(input(block, "param"));
                runtime.dispatch_broadcast(&message, Some(payload));
                self.advance(runtime, block.get("next"));
            }
            "ask_and_choose" => {
                runtime.last_answer = RuntimeValue::String(String::new());
                runtime.last_choice_content =
                    RuntimeValue::String(runtime.eval(choice_input(block, 0)).as_string());
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
            "show_hide_timer" | "face_to_body_part" | "mirror" | "dispose_clone" => {
                self.advance(runtime, block.get("next"));
            }
            "switch_to_screen" => {
                let screen_id = runtime.eval(input(block, "screen_id")).as_string();
                if screen_id.is_empty() {
                    bail!("switch_to_screen missing target screen");
                }
                runtime.current_scene_id = Some(screen_id);
                self.advance(runtime, block.get("next"));
            }
            "self_go_forward" => {
                let steps = runtime.eval(input(block, "steps")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    let radians = actor.rotation.to_radians();
                    actor.x += steps * radians.sin();
                    actor.y += steps * radians.cos();
                }
                self.advance(runtime, block.get("next"));
            }
            "self_move_to" | "self_glide_to" => {
                let x = runtime.eval(input(block, "x")).as_number();
                let y = runtime.eval(input(block, "y")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.x = x;
                    actor.y = y;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_x" => {
                let value = runtime.eval(input(block, "value")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.x = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_y" => {
                let value = runtime.eval(input(block, "value")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.y = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_x" | "self_glide_coordinate_x" => {
                let delta = signed_delta(block, runtime.eval(input(block, "value")).as_number());
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.x += delta;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_y" | "self_glide_coordinate_y" => {
                let delta = signed_delta(block, runtime.eval(input(block, "value")).as_number());
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.y += delta;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_rotate" => {
                let degrees = runtime.eval(input(block, "degrees")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.rotation += degrees;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_point_towards" => {
                let degrees = runtime.eval(input(block, "degrees")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
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
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.visible = visible;
                }
                self.advance(runtime, block.get("next"));
            }
            "set_scale" => {
                let value = runtime.eval(input(block, "scale")).as_number();
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.scale = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_scale" => {
                let delta = signed_delta(block, runtime.eval(input(block, "scale")).as_number());
                if let Some(actor) = runtime.actors.get_mut(self.owner_id) {
                    actor.scale += delta;
                }
                self.advance(runtime, block.get("next"));
            }
            "console_log" => {
                let value = runtime.eval(input(block, "console_log"));
                runtime.logs.push(format_value(&value));
                self.advance(runtime, block.get("next"));
            }
            unsupported => {
                bail!("unsupported runtime block type: {unsupported}");
            }
        }
        Ok(())
    }

    fn advance(&mut self, runtime: &Runtime<'a>, next: Option<&'a Value>) {
        if let Some(next) = next {
            self.current = Some(next);
        } else if let Some(Some(continuation)) = self.continuations.pop() {
            self.current = Some(continuation);
        } else if let Some(next_loop) = self.next_loop_iteration(runtime) {
            self.current = next_loop;
        } else {
            self.done = true;
        }
    }

    fn enter_branch(
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

    fn next_loop_iteration(&mut self, runtime: &Runtime<'a>) -> Option<Option<&'a Value>> {
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
                if runtime.eval(*condition).is_truthy() {
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
        }
    }

    fn break_loop(&mut self, runtime: &Runtime<'a>) {
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

#[derive(Debug, Clone)]
struct Listener<'a> {
    owner_id: &'a str,
    body: Option<&'a Value>,
    param_name: Option<String>,
}

#[derive(Debug, Clone)]
enum LoopFrame<'a> {
    Forever {
        body: &'a Value,
    },
    Repeat {
        body: &'a Value,
        remaining: usize,
        after: Option<&'a Value>,
    },
    Until {
        body: &'a Value,
        condition: Option<&'a Value>,
        after: Option<&'a Value>,
    },
}

fn collect_variables(dict: &Map<String, Value>) -> BTreeMap<String, RuntimeValue> {
    dict.iter()
        .map(|(id, variable)| {
            (
                id.clone(),
                json_to_runtime_value(variable.get("value").unwrap_or(&Value::Null)),
            )
        })
        .collect()
}

fn collect_variable_names(dict: &Map<String, Value>) -> BTreeMap<String, String> {
    dict.iter()
        .filter_map(|(id, variable)| {
            variable
                .get("name")
                .and_then(Value::as_str)
                .map(|name| (id.clone(), name.to_owned()))
        })
        .collect()
}

fn collect_scene_names(dict: &Map<String, Value>) -> BTreeMap<String, String> {
    dict.iter()
        .filter_map(|(id, scene)| {
            scene
                .get("screenName")
                .or_else(|| scene.get("name"))
                .and_then(Value::as_str)
                .map(|name| (id.clone(), name.to_owned()))
        })
        .collect()
}

fn collect_actors(dict: &Map<String, Value>) -> BTreeMap<String, ActorState> {
    dict.iter()
        .map(|(id, actor)| {
            (
                id.clone(),
                ActorState {
                    id: id.clone(),
                    name: actor
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned(),
                    x: actor
                        .get("position")
                        .and_then(|position| position.get("x"))
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    y: actor
                        .get("position")
                        .and_then(|position| position.get("y"))
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    rotation: actor.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                    scale: actor.get("scale").and_then(Value::as_f64).unwrap_or(100.0),
                    visible: actor
                        .get("visible")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                },
            )
        })
        .collect()
}

fn signed_delta(block: &Value, value: f64) -> f64 {
    let method = block
        .get("fields")
        .and_then(|fields| fields.get("increase"))
        .and_then(Value::as_str)
        .unwrap_or("increase");
    if method == "decrease" { -value } else { value }
}

fn runtime_list(value: &RuntimeValue) -> Option<&Vec<RuntimeValue>> {
    match value {
        RuntimeValue::List(items) => Some(items),
        _ => None,
    }
}

fn ensure_runtime_list(value: &mut RuntimeValue) -> &mut Vec<RuntimeValue> {
    if !matches!(value, RuntimeValue::List(_)) {
        *value = RuntimeValue::List(Vec::new());
    }
    let RuntimeValue::List(items) = value else {
        unreachable!();
    };
    items
}

fn insertion_index(index: f64, len: usize) -> usize {
    let index = index.floor().max(1.0) as usize;
    index.saturating_sub(1).min(len)
}

fn list_index(mode: &str, index: f64, len: usize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    match mode {
        "first" => Some(0),
        "last" => Some(len - 1),
        _ => {
            let index = index.floor() as isize;
            if index < 1 || index as usize > len {
                None
            } else {
                Some(index as usize - 1)
            }
        }
    }
}

fn same_runtime_value(left: &RuntimeValue, right: &RuntimeValue) -> bool {
    left == right || left.as_string() == right.as_string()
}

fn collect_listeners(project: &Value) -> BTreeMap<String, Vec<Listener<'_>>> {
    let mut listeners = BTreeMap::new();
    collect_listeners_at(project, &["scenes", "scenesDict"], &mut listeners);
    collect_listeners_at(project, &["actors", "actorsDict"], &mut listeners);
    listeners
}

fn collect_listeners_at<'a>(
    project: &'a Value,
    path: &[&str],
    listeners: &mut BTreeMap<String, Vec<Listener<'a>>>,
) {
    let Some(owners) = get_path(project, path).and_then(Value::as_object) else {
        return;
    };

    for (owner_id, owner) in owners {
        let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) else {
            continue;
        };
        for block in blocks {
            let Some(kind) = block_type(block) else {
                continue;
            };
            if kind != "self_listen" && kind != "self_listen_with_param" {
                continue;
            }
            let Some(message) = broadcast_message(input(block, "message")) else {
                continue;
            };
            listeners.entry(message).or_default().push(Listener {
                owner_id,
                body: statement(block, "DO"),
                param_name: listen_param_name(input(block, "param")),
            });
        }
    }
}

fn json_to_runtime_value(value: &Value) -> RuntimeValue {
    match value {
        Value::Number(value) => RuntimeValue::Number(value.as_f64().unwrap_or(0.0)),
        Value::Bool(value) => RuntimeValue::Bool(*value),
        Value::String(value) => RuntimeValue::String(value.clone()),
        Value::Array(value) => {
            RuntimeValue::List(value.iter().map(json_to_runtime_value).collect())
        }
        _ => RuntimeValue::Null,
    }
}

fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}

fn block_type(block: &Value) -> Option<&str> {
    block.get("type").and_then(Value::as_str)
}

fn input<'a>(block: &'a Value, name: &str) -> Option<&'a Value> {
    block
        .get("inputs")
        .and_then(Value::as_object)
        .and_then(|inputs| inputs.get(name))
}

fn choice_input(block: &Value, index: usize) -> Option<&Value> {
    input(block, &format!("CHOICE{index}"))
}

fn statement<'a>(block: &'a Value, name: &str) -> Option<&'a Value> {
    block
        .get("statements")
        .and_then(Value::as_object)
        .and_then(|statements| statements.get(name))
}

fn variable_field(block: &Value) -> Option<&str> {
    block
        .get("fields")
        .and_then(|fields| fields.get("variable"))
        .and_then(Value::as_str)
}

fn field_string<'a>(block: &'a Value, name: &str) -> Option<&'a str> {
    block
        .get("fields")
        .and_then(|fields| fields.get(name))
        .and_then(Value::as_str)
}

fn number_field(block: &Value, name: &str) -> Option<f64> {
    let value = block.get("fields")?.get(name)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

fn seconds_to_wait_ticks(seconds: f64) -> usize {
    ((seconds * DEFAULT_FPS).ceil().max(0.0) as usize).saturating_sub(1)
}

fn text_join_index(name: &str) -> Option<usize> {
    name.strip_prefix("ADD")?.parse().ok()
}

fn list_item_input_index(name: &str) -> Option<usize> {
    name.strip_prefix("ITEM")?.parse().ok()
}

fn select_text_value(value: RuntimeValue, start: isize, end: isize) -> RuntimeValue {
    let start = start.max(1) as usize;
    let end = end.max(start as isize) as usize;
    match value {
        RuntimeValue::List(items) => {
            if start == end {
                return items.get(start - 1).cloned().unwrap_or(RuntimeValue::Null);
            }
            RuntimeValue::List(
                items
                    .into_iter()
                    .skip(start - 1)
                    .take(end - start + 1)
                    .collect(),
            )
        }
        value => {
            let text = value.as_string();
            RuntimeValue::String(text.chars().skip(start - 1).take(end - start + 1).collect())
        }
    }
}

fn broadcast_message(block: Option<&Value>) -> Option<String> {
    let block = block?;
    match block_type(block)? {
        "broadcast_input" => block
            .get("fields")
            .and_then(|fields| fields.get("message"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "text" => block
            .get("fields")
            .and_then(|fields| fields.get("TEXT"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        _ => None,
    }
}

fn listen_param_name(block: Option<&Value>) -> Option<String> {
    let block = block?;
    if block_type(block) != Some("self_listen_param") {
        return None;
    }
    block
        .get("fields")
        .and_then(|fields| fields.get("TEXT"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn compare_values(left: &RuntimeValue, right: &RuntimeValue, op: &str) -> bool {
    let left_number = comparable_number(left);
    let right_number = comparable_number(right);
    if let (Some(left), Some(right)) = (left_number, right_number) {
        return match op {
            "NEQ" => left != right,
            "GT" => left > right,
            "GTE" => left >= right,
            "LT" => left < right,
            "LTE" => left <= right,
            _ => left == right,
        };
    }

    let left = format_value(left);
    let right = format_value(right);
    match op {
        "NEQ" => left != right,
        "GT" => left > right,
        "GTE" => left >= right,
        "LT" => left < right,
        "LTE" => left <= right,
        _ => left == right,
    }
}

fn comparable_number(value: &RuntimeValue) -> Option<f64> {
    match value {
        RuntimeValue::Number(value) => Some(*value),
        RuntimeValue::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        RuntimeValue::String(value) => value.parse().ok(),
        RuntimeValue::List(value) => Some(value.len() as f64),
        RuntimeValue::Null => None,
    }
}

fn is_prime(value: f64) -> bool {
    if value.fract() != 0.0 || value < 2.0 {
        return false;
    }
    let value = value as u64;
    if value == 2 {
        return true;
    }
    if value.is_multiple_of(2) {
        return false;
    }
    let limit = (value as f64).sqrt() as u64;
    (3..=limit)
        .step_by(2)
        .all(|factor| !value.is_multiple_of(factor))
}

fn format_value(value: &RuntimeValue) -> String {
    match value {
        RuntimeValue::Number(value) => {
            if value.fract() == 0.0 {
                format!("{}", *value as i64)
            } else {
                value.to_string()
            }
        }
        RuntimeValue::Bool(value) => value.to_string(),
        RuntimeValue::String(value) => value.clone(),
        RuntimeValue::List(value) => value.iter().map(format_value).collect::<Vec<_>>().join(","),
        RuntimeValue::Null => "null".to_owned(),
    }
}

pub fn snapshot_to_json(snapshot: &RuntimeSnapshot) -> Value {
    json!(snapshot)
}
