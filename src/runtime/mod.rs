mod eval;
mod exec;
pub mod helpers;

use anyhow::{Result, bail};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};

use helpers::*;

pub(crate) const DEFAULT_FPS: f64 = 30.0;
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
    #[serde(skip_serializing_if = "is_default_pen")]
    pub pen: PenState,
}

fn is_default_pen(pen: &PenState) -> bool {
    !pen.down && pen.strokes.is_empty() && pen.stamps.is_empty()
}

pub fn record_pen_stroke(
    actors: &mut BTreeMap<String, ActorState>,
    owner_id: &str,
    old_x: f64,
    old_y: f64,
) {
    if let Some(actor) = actors.get(owner_id)
        && actor.pen.down
    {
        let stroke = PenStroke {
            x1: old_x,
            y1: old_y,
            x2: actor.x,
            y2: actor.y,
            color: actor.pen.color.clone(),
            size: actor.pen.size,
        };
        actors.get_mut(owner_id).unwrap().pen.strokes.push(stroke);
    }
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
pub struct PenState {
    pub down: bool,
    pub color: String,
    pub size: f64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub strokes: Vec<PenStroke>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stamps: Vec<PenStamp>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PenStroke {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub color: String,
    pub size: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PenStamp {
    pub x: f64,
    pub y: f64,
    pub kind: String,
}

fn default_pen() -> PenState {
    PenState {
        down: false,
        color: "#000000".to_owned(),
        size: 1.0,
        strokes: Vec::new(),
        stamps: Vec::new(),
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_column: Option<usize>,
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
            source_line: None,
            source_column: None,
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
            source_line: None,
            source_column: None,
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
            source_line: None,
            source_column: None,
        }
    }

    fn with_source(
        mut self,
        source_map: &BTreeMap<String, (usize, usize)>,
        block_id: Option<&str>,
    ) -> Self {
        if let Some(bid) = block_id
            && let Some(&(line, col)) = source_map.get(bid)
        {
            self.source_line = Some(line);
            self.source_column = Some(col);
        }
        self
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

// ---------------------------------------------------------------------------
// Internal structs
// ---------------------------------------------------------------------------

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
    source_map: BTreeMap<String, (usize, usize)>,
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

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

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
        let source_map = collect_source_map(project);

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
            source_map,
        })
    }

    fn start(&mut self) {
        self.spawn_start_scripts_at(&["scenes", "scenesDict"]);
        self.spawn_start_scripts_at(&["actors", "actorsDict"]);
    }

    fn trace_entry_with_source(&self, entry: RuntimeTraceEntry) -> RuntimeTraceEntry {
        let block_id = entry.block_id.clone();
        entry.with_source(&self.source_map, block_id.as_deref())
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
                    source_line: None,
                    source_column: None,
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
                        let entry = RuntimeTraceEntry::script(self.ticks, kind, owner_id, block);
                        self.trace.push(self.trace_entry_with_source(entry));
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
                let entry = RuntimeTraceEntry::script(
                    self.ticks,
                    "broadcast_listener",
                    listener.owner_id,
                    body,
                );
                self.trace.push(self.trace_entry_with_source(entry));
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
            source_line: None,
            source_column: None,
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
                let entry =
                    RuntimeTraceEntry::script(self.ticks, "start_as_clone", clone_actor_id, block);
                self.trace.push(self.trace_entry_with_source(entry));
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
            source_line: None,
            source_column: None,
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
}

// ---------------------------------------------------------------------------
// Collection functions
// ---------------------------------------------------------------------------

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
                    pen: default_pen(),
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

fn collect_listeners(project: &Value) -> BTreeMap<String, Vec<Listener<'_>>> {
    let mut listeners = BTreeMap::new();
    collect_listeners_at(project, &["scenes", "scenesDict"], &mut listeners);
    collect_listeners_at(project, &["actors", "actorsDict"], &mut listeners);
    listeners
}

pub use helpers::snapshot_to_json;

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

fn collect_source_map(project: &Value) -> BTreeMap<String, (usize, usize)> {
    let mut map = BTreeMap::new();
    if let Some(sm) = project.get("sourceMap").and_then(Value::as_object) {
        for (block_id, entry) in sm {
            if let Some(obj) = entry.as_object() {
                let line = obj.get("line").and_then(Value::as_u64).unwrap_or(0) as usize;
                let col = obj.get("column").and_then(Value::as_u64).unwrap_or(0) as usize;
                map.insert(block_id.clone(), (line, col));
            }
        }
    }
    map
}
