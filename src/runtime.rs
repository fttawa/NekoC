use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};

const DEFAULT_FPS: f64 = 30.0;
const DEFAULT_BUMP_RADIUS: f64 = 24.0;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_style_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale: f64,
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialog: Option<DialogState>,
    #[serde(skip_serializing_if = "is_false")]
    pub draggable: bool,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub effects: BTreeMap<String, f64>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DialogState {
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ticks: Option<usize>,
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
    pub trace: Vec<RuntimeTraceEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RuntimeTraceEntry {
    pub tick: usize,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clone_id: Option<String>,
}

impl RuntimeTraceEntry {
    fn event(
        tick: usize,
        kind: &str,
        key: Option<String>,
        state: Option<String>,
        screen_id: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
    ) -> Self {
        Self {
            tick,
            kind: kind.to_owned(),
            owner_id: None,
            block_id: None,
            message: None,
            key,
            state,
            x,
            y,
            screen_id,
            clone_id: None,
        }
    }

    fn script(tick: usize, kind: &str, owner_id: &str, block: &Value) -> Self {
        Self {
            tick,
            kind: kind.to_owned(),
            owner_id: Some(owner_id.to_owned()),
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
        }
    }

    fn message(tick: usize, kind: &str, message: &str) -> Self {
        Self {
            tick,
            kind: kind.to_owned(),
            owner_id: None,
            block_id: None,
            message: Some(message.to_owned()),
            key: None,
            state: None,
            x: None,
            y: None,
            screen_id: None,
            clone_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeEvent {
    Click {
        x: Option<f64>,
        y: Option<f64>,
    },
    Key {
        key: String,
        state: String,
    },
    Mouse {
        state: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
    },
    Drag {
        actor: String,
        x: f64,
        y: f64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeStep {
    Run(usize),
    Event(RuntimeEvent),
}

pub fn run_project(value: &Value, ticks: usize) -> Result<RuntimeSnapshot> {
    let mut runtime = Runtime::from_project(value)?;
    runtime.start();
    runtime.run_ticks(ticks)?;
    Ok(runtime.snapshot())
}

pub fn run_project_with_events(
    value: &Value,
    events: &[RuntimeEvent],
    ticks: usize,
) -> Result<RuntimeSnapshot> {
    let mut runtime = Runtime::from_project(value)?;
    runtime.start();
    for event in events {
        runtime.dispatch_event(event);
    }
    runtime.run_ticks(ticks)?;
    Ok(runtime.snapshot())
}

pub fn run_project_steps(value: &Value, steps: &[RuntimeStep]) -> Result<RuntimeSnapshot> {
    let mut runtime = Runtime::from_project(value)?;
    runtime.start();
    for step in steps {
        match step {
            RuntimeStep::Run(ticks) => runtime.run_ticks(*ticks)?,
            RuntimeStep::Event(event) => runtime.dispatch_event(event),
        }
    }
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
    clone_sources: BTreeMap<String, String>,
    clone_indices: BTreeMap<String, usize>,
    next_clone_index: BTreeMap<String, usize>,
    listeners: BTreeMap<String, Vec<Listener<'a>>>,
    procedures: BTreeMap<String, Procedure<'a>>,
    received_broadcasts: BTreeSet<String>,
    message_values: BTreeMap<String, RuntimeValue>,
    pressed_keys: HashSet<String>,
    mouse_down: bool,
    mouse_x: f64,
    mouse_y: f64,
    logs: Vec<String>,
    trace: Vec<RuntimeTraceEntry>,
    next_thread_id: usize,
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
        let procedures = collect_procedures(project);

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
            clone_sources: BTreeMap::new(),
            clone_indices: BTreeMap::new(),
            next_clone_index: BTreeMap::new(),
            listeners,
            procedures,
            received_broadcasts: BTreeSet::new(),
            message_values: BTreeMap::new(),
            pressed_keys: HashSet::new(),
            mouse_down: false,
            mouse_x: 0.0,
            mouse_y: 0.0,
            logs: Vec::new(),
            trace: Vec::new(),
            next_thread_id: 1,
            threads: Vec::new(),
        })
    }

    fn start(&mut self) {
        self.spawn_start_scripts_at(&["scenes", "scenesDict"]);
        self.spawn_start_scripts_at(&["actors", "actorsDict"]);
    }

    fn dispatch_event(&mut self, event: &RuntimeEvent) {
        match event {
            RuntimeEvent::Click { x, y } => {
                if let Some(x) = x {
                    self.mouse_x = *x;
                }
                if let Some(y) = y {
                    self.mouse_y = *y;
                }
                self.trace.push(RuntimeTraceEntry::event(
                    self.ticks, "click", None, None, None, *x, *y,
                ));
                self.spawn_hat_scripts_at(&["scenes", "scenesDict"], "start_on_click");
                self.spawn_hat_scripts_at(&["actors", "actorsDict"], "start_on_click");
            }
            RuntimeEvent::Key { key, state } => {
                match state.as_str() {
                    "down" => {
                        self.pressed_keys.insert(key.clone());
                    }
                    "up" => {
                        self.pressed_keys.remove(key);
                    }
                    _ => {}
                }
                self.trace.push(RuntimeTraceEntry::event(
                    self.ticks,
                    "key",
                    Some(key.clone()),
                    Some(state.clone()),
                    None,
                    None,
                    None,
                ));
                self.spawn_key_scripts_at(&["scenes", "scenesDict"], key, state);
                self.spawn_key_scripts_at(&["actors", "actorsDict"], key, state);
            }
            RuntimeEvent::Mouse { state, x, y } => {
                if let Some(state) = state {
                    self.mouse_down = state == "down";
                }
                if let Some(x) = x {
                    self.mouse_x = *x;
                }
                if let Some(y) = y {
                    self.mouse_y = *y;
                }
                self.trace.push(RuntimeTraceEntry::event(
                    self.ticks,
                    "mouse",
                    None,
                    state.clone(),
                    None,
                    *x,
                    *y,
                ));
            }
            RuntimeEvent::Drag { actor, x, y } => {
                self.mouse_x = *x;
                self.mouse_y = *y;
                self.mouse_down = true;
                let is_draggable = self.actors.get(actor).map(|a| a.draggable).unwrap_or(false);
                if is_draggable && let Some(actor_state) = self.actors.get_mut(actor) {
                    actor_state.x = *x;
                    actor_state.y = *y;
                }
                self.trace.push(RuntimeTraceEntry {
                    tick: self.ticks,
                    kind: "drag".to_owned(),
                    owner_id: Some(actor.clone()),
                    block_id: None,
                    message: None,
                    key: None,
                    state: None,
                    x: Some(*x),
                    y: Some(*y),
                    screen_id: None,
                    clone_id: None,
                });
            }
        }
    }

    fn spawn_start_scripts_at(&mut self, path: &[&str]) {
        self.spawn_matching_scripts_at(path, Some("start"), |block| {
            matches!(
                block_type(block),
                Some("on_running_group_activated" | "when")
            )
        });
    }

    fn spawn_hat_scripts_at(&mut self, path: &[&str], hat_type: &str) {
        self.spawn_matching_scripts_at(path, Some(hat_type), |block| {
            block_type(block) == Some(hat_type)
        });
    }

    fn spawn_key_scripts_at(&mut self, path: &[&str], key: &str, state: &str) {
        self.spawn_matching_scripts_at(path, Some("on_keydown"), |block| {
            block_type(block) == Some("on_keydown")
                && field_string(block, "key") == Some(key)
                && field_string(block, "type") == Some(state)
        });
    }

    fn spawn_matching_scripts_at(
        &mut self,
        path: &[&str],
        trace_kind: Option<&str>,
        mut is_match: impl FnMut(&Value) -> bool,
    ) {
        let Some(owners) = get_path(self.project, path).and_then(Value::as_object) else {
            return;
        };

        for (owner_id, owner) in owners {
            let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) else {
                continue;
            };
            for block in blocks {
                if is_match(block) {
                    if let Some(kind) = trace_kind {
                        self.trace
                            .push(RuntimeTraceEntry::script(self.ticks, kind, owner_id, block));
                    }
                    self.spawn_thread(owner_id, Some(block));
                }
            }
        }
    }

    fn run_ticks(&mut self, ticks: usize) -> Result<()> {
        for _ in 0..ticks {
            self.ticks += 1;
            let mut threads = std::mem::take(&mut self.threads);
            let active_thread_ids = threads
                .iter()
                .chain(self.threads.iter())
                .filter(|thread| !thread.done)
                .map(|thread| thread.id)
                .collect::<BTreeSet<_>>();
            for thread in &mut threads {
                thread.step(self, &active_thread_ids)?;
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
            trace: self.trace.clone(),
            answer: match &self.last_answer {
                RuntimeValue::String(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            },
        }
    }

    fn dispatch_broadcast(&mut self, message: &str, payload: Option<RuntimeValue>) -> Vec<usize> {
        self.received_broadcasts.insert(message.to_owned());
        self.trace
            .push(RuntimeTraceEntry::message(self.ticks, "broadcast", message));
        let listeners = self.listeners.get(message).cloned().unwrap_or_default();
        let mut listener_thread_ids = Vec::new();
        for listener in listeners {
            if let (Some(param_name), Some(payload)) = (&listener.param_name, &payload) {
                self.message_values
                    .insert(param_name.clone(), payload.clone());
            }
            if let Some(body) = listener.body {
                self.trace.push(RuntimeTraceEntry::script(
                    self.ticks,
                    "broadcast_listener",
                    listener.owner_id,
                    body,
                ));
                listener_thread_ids.push(self.spawn_thread(listener.owner_id, Some(body)));
            }
        }
        listener_thread_ids
    }

    fn spawn_thread(&mut self, owner_id: &str, current: Option<&'a Value>) -> usize {
        let id = self.next_thread_id;
        self.next_thread_id += 1;
        self.threads.push(Thread {
            id,
            owner_id: owner_id.to_owned(),
            current,
            loops: Vec::new(),
            continuations: Vec::new(),
            range_values: BTreeMap::new(),
            script_values: BTreeMap::new(),
            procedure_values: BTreeMap::new(),
            procedure_frames: Vec::new(),
            wait_ticks: 0,
            waiting_for: BTreeSet::new(),
            yielded: false,
            done: false,
        });
        id
    }

    fn actor_for_sprite(&self, sprite: &str, owner_id: Option<&str>) -> Option<&ActorState> {
        let actor_id = self.actor_id_for_sprite(sprite, owner_id)?;
        self.actors.get(actor_id.as_str())
    }

    fn actor_id_for_sprite(&self, sprite: &str, owner_id: Option<&str>) -> Option<String> {
        if sprite == "--self" {
            owner_id.map(ToOwned::to_owned)
        } else {
            Some(sprite.to_owned())
        }
    }

    fn clone_source_id(&self, actor_id: &str) -> String {
        self.clone_sources
            .get(actor_id)
            .cloned()
            .unwrap_or_else(|| actor_id.to_owned())
    }

    fn clone_count_for_sprite(&self, sprite: &str, owner_id: Option<&str>) -> usize {
        let Some(actor_id) = self.actor_id_for_sprite(sprite, owner_id) else {
            return 0;
        };
        let source_id = self.clone_source_id(&actor_id);
        self.clone_sources
            .values()
            .filter(|source| *source == &source_id)
            .count()
    }

    fn clone_actor_by_index(
        &self,
        sprite: &str,
        owner_id: Option<&str>,
        index: usize,
    ) -> Option<&ActorState> {
        let actor_id = self.actor_id_for_sprite(sprite, owner_id)?;
        let source_id = self.clone_source_id(&actor_id);
        let clone_id = self
            .clone_sources
            .iter()
            .filter(|(_, source)| *source == &source_id)
            .find_map(|(clone_id, _)| {
                (self.clone_indices.get(clone_id).copied() == Some(index))
                    .then_some(clone_id.as_str())
            })?;
        self.actors.get(clone_id)
    }

    fn clone_property(
        &self,
        sprite: &str,
        owner_id: Option<&str>,
        index: usize,
        attribute: &str,
    ) -> f64 {
        self.clone_actor_by_index(sprite, owner_id, index)
            .map(|actor| match attribute {
                "y" => actor.y,
                "rotation" | "direction" => actor.rotation,
                "scale" => actor.scale,
                "visible" => {
                    if actor.visible {
                        1.0
                    } else {
                        0.0
                    }
                }
                _ => actor.x,
            })
            .unwrap_or(0.0)
    }

    fn create_clone(&mut self, source_actor_id: &str) -> Option<String> {
        let source = self.actors.get(source_actor_id)?.clone();
        let source_id = self.clone_source_id(source_actor_id);
        let index = self.next_clone_index.entry(source_id.clone()).or_insert(1);
        let clone_index = *index;
        *index += 1;
        let clone_id = format!("{source_id}#clone-{clone_index}");
        let mut clone_actor = source;
        clone_actor.id = clone_id.clone();
        clone_actor.name = format!("{} clone {clone_index}", clone_actor.name);
        self.actors.insert(clone_id.clone(), clone_actor);
        self.clone_sources
            .insert(clone_id.clone(), source_id.clone());
        self.clone_indices.insert(clone_id.clone(), clone_index);
        self.trace.push(RuntimeTraceEntry {
            tick: self.ticks,
            kind: "clone_create".to_owned(),
            owner_id: Some(source_id.clone()),
            block_id: None,
            message: None,
            key: None,
            state: None,
            x: None,
            y: None,
            screen_id: None,
            clone_id: Some(clone_id.clone()),
        });
        self.spawn_clone_scripts(source_actor_id, &clone_id);
        Some(clone_id)
    }

    fn spawn_clone_scripts(&mut self, source_actor_id: &str, clone_actor_id: &str) {
        let Some(owner) = get_path(self.project, &["actors", "actorsDict", source_actor_id]) else {
            return;
        };
        let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) else {
            return;
        };
        for block in blocks {
            if block_type(block) == Some("start_as_clone") {
                self.trace.push(RuntimeTraceEntry::script(
                    self.ticks,
                    "start_as_clone",
                    clone_actor_id,
                    block,
                ));
                self.spawn_thread(clone_actor_id, Some(block));
            }
        }
    }

    fn delete_clone(&mut self, clone_actor_id: &str) -> bool {
        if !self.clone_sources.contains_key(clone_actor_id) {
            return false;
        }
        self.actors.remove(clone_actor_id);
        self.clone_sources.remove(clone_actor_id);
        self.clone_indices.remove(clone_actor_id);
        self.trace.push(RuntimeTraceEntry {
            tick: self.ticks,
            kind: "clone_delete".to_owned(),
            owner_id: Some(clone_actor_id.to_owned()),
            block_id: None,
            message: None,
            key: None,
            state: None,
            x: None,
            y: None,
            screen_id: None,
            clone_id: Some(clone_actor_id.to_owned()),
        });
        true
    }

    fn touching_edge(&self, sprite: &str, owner_id: Option<&str>) -> bool {
        self.actor_for_sprite(sprite, owner_id)
            .is_some_and(|actor| self.actor_out_of_boundary(actor))
    }

    fn actor_out_of_boundary(&self, actor: &ActorState) -> bool {
        let half_width = self.stage_width / 2.0;
        let half_height = self.stage_height / 2.0;
        half_width > 0.0
            && half_height > 0.0
            && (actor.x.abs() > half_width || actor.y.abs() > half_height)
    }

    fn touching_actor(&self, sprite: &str, target: &str, owner_id: Option<&str>) -> bool {
        let Some(source) = self.actor_for_sprite(sprite, owner_id) else {
            return false;
        };
        let Some(target) = self.actor_for_sprite(target, owner_id) else {
            return false;
        };
        if source.id == target.id {
            return false;
        }
        let distance = ((source.x - target.x).powi(2) + (source.y - target.y).powi(2)).sqrt();
        distance <= DEFAULT_BUMP_RADIUS
    }

    fn eval(&self, block: Option<&Value>) -> RuntimeValue {
        self.eval_for_context(
            block,
            None,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
    }

    fn eval_for_context(
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
            "timer" => RuntimeValue::Number(self.timer_elapsed_ticks as f64 / DEFAULT_FPS),
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
            "effect_of_sprite" => RuntimeValue::Number(0.0),
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
                RuntimeValue::Number(a.min(b))
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
        procedure: &Procedure<'a>,
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

struct Thread<'a> {
    id: usize,
    owner_id: String,
    current: Option<&'a Value>,
    loops: Vec<LoopFrame<'a>>,
    continuations: Vec<Option<&'a Value>>,
    range_values: BTreeMap<String, RuntimeValue>,
    script_values: BTreeMap<String, RuntimeValue>,
    procedure_values: BTreeMap<String, RuntimeValue>,
    procedure_frames: Vec<ProcedureFrame<'a>>,
    wait_ticks: usize,
    waiting_for: BTreeSet<usize>,
    yielded: bool,
    done: bool,
}

impl<'a> Thread<'a> {
    fn eval(&self, runtime: &Runtime<'a>, block: Option<&Value>) -> RuntimeValue {
        runtime.eval_for_context(
            block,
            Some(self.owner_id.as_str()),
            &self.range_values,
            &self.script_values,
            &self.procedure_values,
        )
    }

    fn step(
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

    fn execute_block(&mut self, block: &'a Value, runtime: &mut Runtime<'a>) -> Result<()> {
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
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    let radians = actor.rotation.to_radians();
                    actor.x += steps * radians.sin();
                    actor.y += steps * radians.cos();
                }
                self.advance(runtime, block.get("next"));
            }
            "self_move_to" | "self_glide_to" => {
                let x = self.eval(runtime, input(block, "x")).as_number();
                let y = self.eval(runtime, input(block, "y")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x = x;
                    actor.y = y;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_x" => {
                let value = self.eval(runtime, input(block, "value")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_set_position_y" => {
                let value = self.eval(runtime, input(block, "value")).as_number();
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.y = value;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_x" | "self_glide_coordinate_x" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "value")).as_number());
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.x += delta;
                }
                self.advance(runtime, block.get("next"));
            }
            "self_change_coordinate_y" | "self_glide_coordinate_y" => {
                let delta =
                    signed_delta(block, self.eval(runtime, input(block, "value")).as_number());
                if let Some(actor) = runtime.actors.get_mut(&self.owner_id) {
                    actor.y += delta;
                }
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
            | "show_hide_variables"
            | "clear_drawing"
            | "self_pen_down"
            | "self_pen_up"
            | "self_set_pen_color"
            | "self_set_pen_size"
            | "self_change_pen_size"
            | "self_set_pen_color_property"
            | "self_change_pen_color_property"
            | "stamp"
            | "image_stamp"
            | "set_pen_layer" => {
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

    fn advance(&mut self, runtime: &Runtime<'a>, next: Option<&'a Value>) {
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

#[derive(Debug, Clone)]
struct Listener<'a> {
    owner_id: &'a str,
    body: Option<&'a Value>,
    param_name: Option<String>,
}

#[derive(Debug, Clone)]
struct Procedure<'a> {
    body: Option<&'a Value>,
    params: Vec<ProcedureParam>,
}

#[derive(Debug, Clone)]
struct ProcedureParam {
    id: String,
    name: String,
}

#[derive(Debug, Clone)]
struct ProcedureFrame<'a> {
    after: Option<&'a Value>,
    procedure_values: BTreeMap<String, RuntimeValue>,
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
    Range {
        variable: String,
        body: &'a Value,
        current: f64,
        end: f64,
        step: f64,
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
                    current_style_id: actor
                        .get("currentStyleId")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
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
                    dialog: None,
                    draggable: actor
                        .get("draggable")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    effects: BTreeMap::new(),
                },
            )
        })
        .collect()
}

fn collect_procedures(project: &Value) -> BTreeMap<String, Procedure<'_>> {
    let Some(procedures) = project
        .get("procedures")
        .and_then(|value| value.get("proceduresDict"))
        .and_then(Value::as_object)
    else {
        return BTreeMap::new();
    };

    procedures
        .iter()
        .filter_map(|(id, procedure)| {
            let definition = procedure
                .get("nekoBlockJsonList")
                .and_then(Value::as_array)?
                .first()?;
            let params = procedure
                .get("params")
                .and_then(Value::as_array)
                .map(|params| {
                    params
                        .iter()
                        .filter_map(|param| {
                            if param.get("type").and_then(Value::as_str) != Some("String") {
                                return None;
                            }
                            Some(ProcedureParam {
                                id: param.get("id").and_then(Value::as_str)?.to_owned(),
                                name: param.get("name").and_then(Value::as_str)?.to_owned(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some((
                id.clone(),
                Procedure {
                    body: statement(definition, "STACK"),
                    params,
                },
            ))
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

fn traverse_param_name(block: &Value) -> Option<&str> {
    if block_type(block) != Some("traverse_number_param") {
        return None;
    }
    field_string(block, "TEXT")
}

fn script_variable_names(block: &Value) -> Vec<&str> {
    let Some(inputs) = block.get("inputs").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut names = inputs
        .iter()
        .filter_map(|(key, value)| {
            let index = key.strip_prefix("PARAMS")?.parse::<usize>().ok()?;
            if block_type(value) != Some("script_variables_param") {
                return None;
            }
            Some((index, field_string(value, "TEXT")?))
        })
        .collect::<Vec<_>>();
    names.sort_by_key(|(index, _)| *index);
    names.into_iter().map(|(_, name)| name).collect()
}

fn procedure_def_id(block: &Value) -> Option<&str> {
    attr_value(block.get("mutation")?.as_str()?, "def_id")
}

fn attr_value<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = text.find(&needle)? + needle.len();
    let rest = &text[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
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

fn range_contains(value: f64, end: f64, step: f64) -> bool {
    if step > 0.0 {
        value <= end
    } else {
        value >= end
    }
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
