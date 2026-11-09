//! Kitten 4 (version 25) JSON <-> the canonical Kitten N project model.
//!
//! Block names and sockets below are taken from the official 4.11.20 editor.
//! A native snapshot is retained, and export applies a three-way structural diff
//! against a fresh conversion of that snapshot. Thus editing a supported field
//! does not normalize away unknown data, shadow XML, or legacy serialization.
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

const METADATA: &str = "_nekocKitten4";
const OPAQUE: &str = "kitten4::";
const ANGLE: &str = "_nekocKitten4Angle";
// Inputs/statement bodies, not next links. Keeps recursive translators and VM
// compiler frames bounded on default-size worker/test stacks.
const MAX_DEPTH: usize = 64;

fn check_depth(block: &Value, depth: usize) -> Result<()> {
    ensure!(
        depth <= MAX_DEPTH,
        "block nesting exceeds {MAX_DEPTH} at block {} ({})",
        block["id"],
        block["type"]
    );
    Ok(())
}

fn without_next(block: &Value) -> Value {
    Value::Object(
        block
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(key, _)| key.as_str() != "next")
            .map(|(key, value)| (key.clone(), crate::json::clone_value(value)))
            .collect(),
    )
}

fn join_chain(nodes: Vec<Value>) -> Value {
    let mut tail = None;
    for mut node in nodes.into_iter().rev() {
        if let Some(next) = tail {
            node["next"] = next;
        }
        tail = Some(node);
    }
    tail.unwrap_or(Value::Null)
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum StartKind {
    Global,
    Activation,
}
// Stage/actor namespace, owner ID, then the canonical root ID assigned by the
// importer. Never correlate an edited canonical script list by array position.
pub(crate) type StartHats = BTreeMap<(bool, String, String), StartKind>;

pub(crate) fn start_hats(source: &Value) -> Result<StartHats> {
    let compiled = CompiledWork::new(source);
    let mut hats = StartHats::new();
    for (section, stage) in [("scenes", true), ("actors", false)] {
        for (owner, value) in source["theatre"][section]
            .as_object()
            .context("Kitten 4 start provenance owners must be objects")?
        {
            let (_, starts) = if let Some(workspace) = value.get("block_data_json") {
                import_workspace_with_starts(workspace)?
            } else {
                compiled.finish_with_starts(compiled.roots(owner))?
            };
            for (id, kind) in starts {
                ensure!(
                    hats.insert((stage, owner.clone(), id.clone()), kind)
                        .is_none(),
                    "ambiguous Kitten 4 start provenance for {section}/{owner}/{id}"
                );
            }
        }
    }
    Ok(hats)
}

pub fn is_kitten4(value: &Value) -> bool {
    value.get("work_type").and_then(Value::as_str) == Some("KITTEN")
        && value.get("theatre").is_some_and(Value::is_object)
}

pub fn to_neko(value: &Value) -> Result<crate::json::Json> {
    crate::json::expanded(|| {
        ensure!(is_kitten4(value), "not a native Kitten 4 project");
        let mut result = import_project(value)?;
        result[METADATA] = json!({"source": value});
        Ok(crate::json::Json::new(result))
    })
}

/// What stops a work from running: untranslated blocks by use count, then the first
/// compile or runtime error.
pub fn coverage(source: &Value, frames: u32) -> Value {
    use crate::engine::{Engine, Program};
    let project = match to_neko(source) {
        Ok(project) => project,
        Err(error) => return json!({"stage": "import", "error": format!("{error:#}")}),
    };
    let mut blocks = 0u64;
    let mut opaque = BTreeMap::new();
    for section in ["scenes", "actors", "procedures"] {
        count_blocks(&project[section], &mut blocks, &mut opaque);
    }
    let stubbed: BTreeMap<_, _> = opaque
        .iter()
        .filter(|(kind, _)| is_stub(kind))
        .map(|(kind, count)| (kind.clone(), *count))
        .collect();
    let mut report = json!({"blocks": blocks, "opaque": opaque, "stubbed": stubbed});
    if let Err(error) = from_neko(&project) {
        report["export_error"] = json!(format!("{error:#}"));
    }
    let result = Program::compile(&project)
        .map_err(|error| ("compile", error))
        .and_then(|program| {
            let mut engine = Engine::new(program);
            engine.start();
            for _ in 0..frames {
                engine
                    .advance(1.0 / 60.0, 2_000_000, std::time::Duration::from_millis(200))
                    .map_err(|error| ("run", error))?;
            }
            Ok(())
        });
    match result {
        Ok(()) => report["stage"] = json!("ran"),
        Err((stage, error)) => {
            report["stage"] = json!(stage);
            report["error"] = json!(format!("{error:#}"));
        }
    }
    report
}

fn count_blocks(value: &Value, blocks: &mut u64, opaque: &mut BTreeMap<String, u64>) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(items) => pending.extend(items),
            Value::Object(object) => {
                if let Some(kind) = object.get("type").and_then(Value::as_str)
                    && object.contains_key("id")
                {
                    *blocks += 1;
                    if let Some(kind) = kind.strip_prefix(OPAQUE) {
                        *opaque.entry(kind.to_owned()).or_default() += 1;
                    }
                }
                pending.extend(object.values());
            }
            _ => {}
        }
    }
}

/// VM form of a Kitten 4 project. Blocks without an editable Kitten N equivalent stay
/// opaque in the canonical project so they round-trip untouched, and are rewritten only
/// here, just before compiling.
pub fn lower_for_vm(project: &Value) -> crate::json::Json {
    crate::json::expanded(|| {
        let mut lowered = project.clone();
        if let Some(object) = lowered.as_object_mut() {
            object.remove(METADATA);
        }
        // Cloud data has no service to talk to here, so it behaves as local variables.
        if let Some(cloud) = project
            .pointer(&format!("/{METADATA}/source/cloud_variables"))
            .and_then(Value::as_object)
        {
            for (id, variable) in cloud {
                let list = variable["type"] == "public_list";
                lowered["variables"]["variablesDict"][id] = json!({
                    "id": id, "name": variable["name"],
                    "type": if list { "list" } else { "variable" },
                    "value": if list { json!([]) } else { json!(0) },
                });
            }
        }
        let targets = Targets {
            actors: project["actors"]["actorsDict"].clone(),
            scenes: project["scenes"]["scenesDict"].clone(),
            procedures: project["procedures"]["proceduresDict"].clone(),
            groups: project
                .pointer(&format!("/{METADATA}/source/theatre/groups"))
                .cloned()
                .unwrap_or(Value::Null),
        };
        for section in ["scenes", "actors", "procedures"] {
            lower_blocks(&mut lowered[section], &targets);
        }
        crate::json::Json::new(lowered)
    })
}

struct Targets {
    actors: Value,
    scenes: Value,
    procedures: Value,
    groups: Value,
}

impl Targets {
    /// Collision with an actor group is a collision with any member. A target that no
    /// longer exists can never collide.
    fn bump(&self, target: &str) -> Vec<String> {
        if target.starts_with("__") || target.starts_with("--") {
            return vec![target.replace("__edge", "--edge")];
        }
        if let Some(members) = self.groups[target]["actors"].as_array() {
            return members
                .iter()
                .filter_map(Value::as_str)
                .filter(|id| self.actors.get(id).is_some())
                .map(str::to_owned)
                .collect();
        }
        if self.actors.get(target).is_some() {
            vec![target.to_owned()]
        } else {
            vec![]
        }
    }
}

/// Replaces what the official runtime can no longer resolve: a call to a deleted
/// procedure or a block aimed at a deleted actor. A group target acts on its first member.
fn lower_missing_reference(block: &mut Value, targets: &Targets) {
    let kind = block["type"].as_str().unwrap_or_default().to_owned();
    let call = kind.starts_with("procedures_2_call");
    let mut missing = call && targets.procedures.get(field(block, "NAME")).is_none();
    if !matches!(kind.as_str(), "kitten4::bump" | "kitten4::bump_into_color") {
        for key in ["sprite", "target", "actor", "sprite1"] {
            let id = field(block, key).to_owned();
            if id.is_empty()
                || id.starts_with("__")
                || id.starts_with("--")
                || targets.actors.get(&id).is_some()
                || targets.scenes.get(&id).is_some()
            {
                continue;
            }
            match targets.bump(&id).first() {
                Some(member) => put_field(block, key, member),
                None => missing = true,
            }
        }
    }
    if !missing {
        return;
    }
    let reporter = kind == "procedures_2_callreturn" || block["is_output"] == true || {
        let kind = kind.trim_start_matches(OPAQUE);
        kind.starts_with("get_") || kind.ends_with("_of_sprite")
    };
    block["type"] = json!(if reporter {
        "math_number"
    } else {
        "kitten4_noop"
    });
    block["fields"] = json!({"NUM": "0"});
    remove(block, "inputs");
    remove(block, "mutation");
}

fn lower_bump(block: &mut Value, targets: &Targets) {
    let id = block["id"].as_str().unwrap_or_default().to_owned();
    let subjects = targets.bump(field(block, "sprite1"));
    let others = targets.bump(field(block, "sprite2"));
    let others = &others;
    let id = &id;
    let tests = subjects.iter().flat_map(|subject| {
        others.iter().map(move |target| {
            json!({"type": "bump_into", "id": id, "fields": {"sprite": subject, "sprite1": target}})
        })
    });
    *block = tests
        .reduce(|a, b| {
            json!({"type": "logic_operation", "id": id, "fields": {"type": "or"},
                "inputs": {"A": a, "B": b}})
        })
        .unwrap_or_else(|| json!({"type": "math_number", "id": id, "fields": {"NUM": "0"}}));
}

fn lower_blocks(value: &mut Value, targets: &Targets) {
    // Postorder traversal without recursive next links; each frame owns its
    // detached node so transformations may replace it safely.
    enum Work {
        Enter(Value),
        Array(usize),
        Object(Vec<String>),
    }
    let mut work = vec![Work::Enter(value.take())];
    let mut output = Vec::new();
    while let Some(item) = work.pop() {
        match item {
            Work::Enter(Value::Array(items)) => {
                work.push(Work::Array(items.len()));
                work.extend(items.into_iter().rev().map(Work::Enter));
            }
            Work::Enter(Value::Object(object)) => {
                let (keys, values): (Vec<_>, Vec<_>) = object.into_iter().unzip();
                work.push(Work::Object(keys));
                work.extend(values.into_iter().rev().map(Work::Enter));
            }
            Work::Enter(other) => output.push(other),
            Work::Array(len) => {
                let start = output.len() - len;
                let items = output.drain(start..).collect();
                output.push(Value::Array(items));
            }
            Work::Object(keys) => {
                let start = output.len() - keys.len();
                let mut node = Value::Object(keys.into_iter().zip(output.drain(start..)).collect());
                lower_node(&mut node, targets);
                output.push(node);
            }
        }
    }
    *value = output.pop().unwrap();
}

fn lower_node(value: &mut Value, targets: &Targets) {
    match value {
        Value::Array(_) => {}
        Value::Object(object) => {
            if object.get("type").is_some_and(Value::is_string) && object.contains_key("id") {
                lower_missing_reference(value, targets);
            }
            let Value::Object(object) = value else {
                return;
            };
            if object.get("type").and_then(Value::as_str) == Some("kitten4::bump_into_color") {
                let id = object.get("id").cloned().unwrap_or(Value::Null);
                let subjects = targets.bump(field(value, "sprite"));
                let color = field(value, "color").to_owned();
                let next = value.get("next").cloned();
                *value = subjects.into_iter().map(|subject| {
                    json!({"id":id,"type":"bump_into_color","fields":{"sprite":subject,"color":color}})
                }).reduce(|a,b| json!({"id":id,"type":"logic_operation","fields":{"type":"or"},"inputs":{"A":a,"B":b}}))
                    .unwrap_or_else(|| json!({"id":id,"type":"logic_boolean","fields":{"BOOL":"FALSE"}}));
                if let Some(next) = next {
                    value["next"] = next;
                }
                return;
            }
            if object.get("type").and_then(Value::as_str) == Some("kitten4::bump") {
                lower_bump(value, targets);
                return;
            }
            if object.get("type").and_then(Value::as_str) == Some("when") {
                lower_when(value);
                return;
            }
            if object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|t| t.starts_with(OPAQUE))
            {
                lower_block(value);
            }
        }
        _ => {}
    }
}

/// Official 4.11.20: level-triggered, single-flight on originals. A mirror has
/// no condition responder. See tests/fixtures/kitten4/semantics-when.bcm.
fn lower_when(block: &mut Value) {
    let id = block["id"].as_str().unwrap_or_default().to_owned();
    let mut trigger = json!({"type": "wait_until", "id": format!("{id}-trigger"),
        "inputs": {"condition": block["inputs"]["condition"].clone()}});
    trigger["next"] = block["statements"]["DO"].take();
    *block = json!({
        "type": "on_running_group_activated", "id": id,
        "next": {"type": "repeat_forever", "id": format!("{id}-loop"), "statements": {"DO": trigger}},
    });
}

/// Accepted so a work runs, but without their effect. `coverage` lists them.
fn is_stub(kind: &str) -> bool {
    kind.starts_with("physics2_")
        || matches!(
            kind,
            "set_actor_as"
                | "play_words_audio"
                | "set_layer_with_pen"
                | "set_entity_show_hide"
                | "self_shake"
                | "show_ranking"
                | "hide_ranking"
                | "is_ranking_show_hide"
                | "play_video"
                | "play_video_until_end"
                | "continue_pause_video"
                | "show_hide_video"
        )
}

fn cloud_list(block: &mut Value, native: &str) {
    let list = field(block, "VAR").to_owned();
    remove(&mut block["fields"], "VAR");
    if !block["inputs"].is_object() {
        block["inputs"] = json!({});
    }
    block["inputs"]["VAR"] = json!({"type": "pure_list_get", "fields": {"list": list}});
    if field(block, "TYPE") == "nth" {
        put_field(block, "TYPE", "first");
    }
    block["type"] = json!(native);
    let _ = translate(block, false);
    if native == "lists_get_value" {
        block["type"] = json!("kitten4_cloud_list_item");
    }
}

fn lower_block(block: &mut Value) {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE)
        .to_owned();
    if is_stub(&kind) || (kind == "self_change_effect_3" && field(block, "scope") == "7") {
        if kind == "is_ranking_show_hide" {
            let hidden = field(block, "VAL") == "hide";
            block["type"] = json!("logic_boolean");
            put_field(block, "BOOL", if hidden { "TRUE" } else { "FALSE" });
        } else {
            block["type"] = json!("kitten4_noop");
        }
        return;
    }
    if let Some(list) = kind.strip_prefix("cloud_lists_") {
        cloud_list(block, &format!("lists_{list}"));
        return;
    }
    let renamed = match kind.as_str() {
        "set_pen_path" => {
            block["type"] = json!(match field(block, "point") {
                "start_point" => "pen_begin_path",
                "end_point" => "pen_close_path",
                _ => "kitten4_noop",
            });
            return;
        }
        "set_fill_style" | "pen_begin_path" | "pen_close_path" => kind.as_str(),
        "cloud_variables_get" => {
            fields(block, &[("VAR", "variable")], false);
            "variables_get"
        }
        "cloud_variables_set" => {
            fields(block, &[("VAR", "variable")], false);
            inputs(block, &[("VALUE", "value")], false);
            "variables_set"
        }
        "change_cloud_variable" => {
            fields(block, &[("valname", "variable")], false);
            inputs(block, &[("n", "value")], false);
            "change_variables"
        }
        "show_hide_cloud_variable" => {
            fields(block, &[("VAR", "variable"), ("FUNC", "show_hide")], false);
            "show_hide_variables"
        }
        "show_hide_list" | "show_hide_cloud_list" => {
            fields(block, &[("VAR", "list"), ("FUNC", "show_hide")], false);
            "show_hide_list"
        }
        "convert_type" => {
            inputs(block, &[("original_value", "text")], false);
            "convert_type"
        }
        "logic_empty" => {
            put_field(block, "BOOL", "FALSE");
            "logic_boolean"
        }
        "check_running_device" => {
            // The local player is a desktop runtime, not a mobile emulator.
            let computer = field(block, "device") == "computer";
            put_field(block, "BOOL", if computer { "TRUE" } else { "FALSE" });
            "logic_boolean"
        }
        "self_distance_to" => "distance_to",
        "self_change_layer" => {
            // Official set_theatre_layer's `n` adds a signed number of layers.
            put_field(block, "layer", "n");
            "self_change_layer"
        }
        "lists_get_value" => {
            // `nth` occurs in legacy/cloud serialization; `first` means indexed,
            // not the first element. Unknown TYPEs must not silently become indexed.
            if !matches!(field(block, "TYPE"), "" | "first" | "last" | "nth") {
                return;
            }
            if matches!(field(block, "TYPE"), "" | "nth") {
                put_field(block, "TYPE", "first");
            }
            block["type"] = json!("lists_get_value");
            let _ = translate(block, false);
            return;
        }
        // No signed-in player in a local run.
        "username_get" => {
            put_field(block, "TEXT", "");
            "text"
        }
        "user_id_get" | "connected_users_get" => {
            put_field(block, "NUM", if kind == "user_id_get" { "0" } else { "1" });
            "math_number"
        }
        "get_running_device" => {
            put_field(block, "TEXT", "web");
            "text"
        }
        "get_choice_or_index" => {
            let index = field(block, "type") == "select_index";
            put_field(block, "type", if index { "index" } else { "content" });
            "get_choice_and_index"
        }
        "get_audios" | "get_whole_audios" => {
            fields(block, &[("sound_id", "audio_id")], false);
            "get_play_audio"
        }
        "play_audio_2" | "stop_audio_2" | "play_audio_and_wait_2" => {
            inputs(block, &[("audio", "audio_id")], false);
            match kind.as_str() {
                "play_audio_2" => "play_audio",
                "stop_audio_2" => "stop_audio",
                _ => "play_audio_and_wait",
            }
        }
        "check_screen" => {
            // Official Tn6a/check_screen accepts scene IDs, names and 1-based
            // numbers; an unknown scene is outside, not an error.
            "kitten4_check_screen"
        }
        "shadow_number" | "shadow_text" => {
            if let Some(inner) = block.pointer("/inputs/VALUE").cloned() {
                *block = inner;
            }
            return;
        }
        "default_value" => "text",
        // The canonical form keeps forward trig only; the VM also has the inverses.
        "math_trig" => {
            let op = field(block, "OP").to_lowercase();
            put_field(block, "type", &op);
            remove(&mut block["fields"], "OP");
            inputs(block, &[("NUM", "num")], false);
            "math_trig"
        }
        "dispose" => "kitten4_dispose",
        "on_swipe" | "backdrop_on_change" | "self_flip" => kind.as_str(),
        "terminate" => {
            put_field(block, "scope", "0");
            "stop"
        }
        "set_volume_or_rate_2" | "change_volume_or_rate_2" => kind.as_str(),
        "self_prev_next_style" => {
            fields(block, &[("prev_or_next", "prev_next")], false);
            "self_prev_next_style"
        }
        "set_costume" => {
            inputs(block, &[("index", "style_id")], false);
            "set_sprite_style"
        }
        // Official Tn6a/get_current_costume returns {style_id}, not a number
        // (nor a plain ID string). Keep the canonical KN reporter unchanged.
        "get_current_costume" => "kitten4_costume_literal",
        "check_key" => {
            fields(block, &[("key_event_type", "type")], false);
            "check_key"
        }
        "get_mouse_info" => {
            fields(block, &[("position", "type")], false);
            "get_mouse_info"
        }
        "sprite_on_tap" => {
            let actor = match field(block, "actor") {
                "__self" => "--self".to_owned(),
                "__scene" => "--screen".to_owned(),
                other => other.to_owned(),
            };
            remove(&mut block["fields"], "actor");
            put_field(block, "sprite", &actor);
            "sprite_on_tap"
        }
        "self_change_scale_2" => "self_change_scale",
        "add_width_height_scale_2" => "add_width_height_scale",
        "self_set_effect_2" => "self_set_effect",
        "self_change_effect_3" => "self_change_effect",
        "get_current_scene" | "get_sensing_current_scene" => "get_screens",
        "text_select_changeable" => {
            // Without an end index it selects a single character.
            if block.pointer("/inputs/NUM1").is_none()
                && let Some(start) = block.pointer("/inputs/NUM0").cloned()
            {
                block["inputs"]["NUM1"] = start;
            }
            inputs(
                block,
                &[
                    ("STRING", "text"),
                    ("NUM0", "start_index"),
                    ("NUM1", "end_index"),
                ],
                false,
            );
            "text_select"
        }
        "get_3" => match field(block, "attribute") {
            "0" | "1" => {
                let axis = if field(block, "attribute") == "0" {
                    "x"
                } else {
                    "y"
                };
                put_field(block, "coordinate", axis);
                "coordinate_of_sprite"
            }
            // 2 and 4 were verified against the official editor (docs/kitten4-semantics.md).
            "2" => "style_of_sprite",
            "4" => "kitten4_costume_name",
            "5" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "16" | "17" => {
                // The existing clone-property reporter also addresses the original
                // with index 0, and preserves costume names as text (official
                // get_clone_index_property / get_scene_or_actor_property).
                block["inputs"]["index"] = if matches!(field(block, "sprite"), "__self" | "--self")
                {
                    json!({"type":"get_current_clone_index"})
                } else {
                    number(0.0)
                };
                "get_clone_index_property"
            }
            "3" => {
                put_field(block, "appearance", "direction");
                block["type"] = json!("appearance_of_sprite");
                *block = native_heading_reporter(block.clone());
                return;
            }
            _ => return,
        },
        "set_theatre_layer" => {
            let layer = match field(block, "layer") {
                "previous_level" => "prev_layer",
                "next_level" => "next_layer",
                other => other,
            }
            .to_owned();
            put_field(block, "layer", &layer);
            "self_change_layer"
        }
        "self_out_of_boundary" => {
            let boundary = match field(block, "boundary") {
                "1" => "left",
                "2" => "top",
                "3" => "bottom",
                "4" => "right",
                _ => "edge",
            };
            put_field(block, "boundary", boundary);
            "out_of_boundary"
        }
        "show_hide_variable" => {
            fields(block, &[("VAR", "variable"), ("FUNC", "show_hide")], false);
            "show_hide_variables"
        }
        "mouse_down"
        | "self_set_rotation_type"
        | "get_clone_index_property"
        | "get_clone_num"
        | "get_stage_info"
        | "mirror"
        | "start_as_a_mirror"
        | "dispose_clone"
        | "self_move_specify"
        | "self_face_to"
        | "stamp"
        | "image_stamp"
        | "tell"
        | "get_current_clone_index"
        | "get_answer"
        | "self_ask"
        | "ask_and_choose"
        | "restart"
        | "self_gradually_show_hide"
        | "self_glide_to"
        | "self_glide_coordinate"
        | "stop"
        | "get_time"
        | "set_width_height_scale"
        | "self_rotate_around"
        | "switch_to_screen"
        | "self_set_draggable"
        | "self_set_role_camp"
        | "create_stage_dialog"
        | "set_scene_transition" => kind.as_str(),
        _ => return,
    }
    .to_owned();
    if kind.starts_with("get_") && renamed == "get_screens" {
        fields(block, &[("scene", "screen")], false);
    }
    block["type"] = json!(renamed);
}

/// Equality that survives a trip through the browser, where 100.0 comes back as 100.
fn same_json(a: &Value, b: &Value) -> bool {
    let mut pending = vec![(a, b)];
    while let Some((a, b)) = pending.pop() {
        match (a, b) {
            (Value::Number(a), Value::Number(b)) => {
                if a == b {
                    continue;
                }
                // Do not round distinct large integers to the same f64. Browser
                // integer/float normalization is safe only in the exact JS range.
                let (Some(a_float), Some(b_float)) = (a.as_f64(), b.as_f64()) else {
                    return false;
                };
                if !((a.is_f64() || b.is_f64())
                    && a_float.abs() <= 9_007_199_254_740_991.0
                    && b_float.abs() <= 9_007_199_254_740_991.0
                    && a_float == b_float)
                {
                    return false;
                }
            }
            (Value::Array(a), Value::Array(b)) => {
                if a.len() != b.len() {
                    return false;
                }
                pending.extend(a.iter().zip(b));
            }
            (Value::Object(a), Value::Object(b)) => {
                if a.len() != b.len() {
                    return false;
                }
                for (key, a) in a {
                    let Some(b) = b.get(key) else { return false };
                    pending.push((a, b));
                }
            }
            _ if a != b => return false,
            _ => {}
        }
    }
    true
}

fn is_published(source: &Value) -> bool {
    let no_workspace = |section: &str| {
        source["theatre"][section]
            .as_object()
            .is_none_or(|owners| owners.values().all(|o| o.get("block_data_json").is_none()))
    };
    source.get("compile_result").is_some_and(Value::is_array)
        && no_workspace("actors")
        && no_workspace("scenes")
}

pub fn from_neko(value: &Value) -> Result<crate::json::Json> {
    crate::json::check_blocks(value, MAX_DEPTH)?;
    crate::json::expanded(|| from_neko_inner(value).map(crate::json::Json::new))
}

fn from_neko_inner(value: &Value) -> Result<Value> {
    ensure!(value.is_object(), "canonical project must be an object");
    let source = value.get(METADATA).and_then(|m| m.get("source"));
    if let Some(source) = source {
        ensure!(is_kitten4(source), "invalid _nekocKitten4.source");
        let baseline = import_project(source)?;
        if is_published(source) {
            // No workspace to write edits into: only an unchanged work can be exported.
            // Check the complete canonical snapshot, not just executable owners:
            // root edits (variables, resources, name, size, future fields) would
            // otherwise be silently lost by the source-clone return below.
            let content = value.as_object().unwrap();
            let baseline = baseline.as_object().unwrap();
            let unchanged = content
                .keys()
                .filter(|key| key.as_str() != METADATA)
                .count()
                == baseline.len()
                && baseline.iter().all(|(key, original)| {
                    content
                        .get(key)
                        .is_some_and(|edited| same_json(edited, original))
                });
            ensure!(
                unchanged,
                "published Kitten 4 work has no block workspace, so edits cannot be exported"
            );
            return Ok(source.clone());
        }
        let old = export_project(&baseline, Some(source))?;
        let new = export_project(value, Some(source))?;
        let mut result = source.clone();
        apply_changes(&mut result, &old, &new);
        Ok(result)
    } else {
        ensure!(
            value.get(METADATA).is_none(),
            "invalid _nekocKitten4 metadata"
        );
        export_project(value, None)
    }
}

fn import_project(source: &Value) -> Result<Value> {
    ensure!(
        matches!(source.get("version").and_then(Value::as_u64), Some(24 | 25)),
        "unsupported Kitten 4 project version {}; this adapter supports versions 24 and 25",
        source["version"]
    );
    let theatre = source
        .get("theatre")
        .context("Kitten 4 theatre is missing")?;
    let compiled = CompiledWork::new(source);
    let scenes = import_owners(&theatre["scenes"], "scene", &compiled)?;
    let actors = import_owners(&theatre["actors"], "actor", &compiled)?;
    let current_scene = theatre
        .get("current_scene")
        .and_then(Value::as_str)
        .filter(|id| scenes.contains_key(*id))
        .or_else(|| {
            theatre
                .get("scenes_order")
                .and_then(Value::as_array)
                .and_then(|order| {
                    order
                        .iter()
                        .filter_map(Value::as_str)
                        .find(|id| scenes.contains_key(*id))
                })
        })
        .or_else(|| scenes.keys().next().map(String::as_str));
    let mut styles = object_or_empty(theatre.get("styles"), "theatre.styles")?;
    for style in styles.values_mut() {
        // Both editors pass this unscaled, image-centred (x right, y down)
        // offset directly to the runtime pivot; see docs/costume-pivot.md.
        rename(style, "rotate_center", "centerPoint");
    }
    let mut variables = object_or_empty(source.get("variables"), "variables")?;
    for variable in variables.values_mut() {
        rename(variable, "is_global", "isGlobal");
        rename(variable, "create_time", "createTime");
    }
    Ok(json!({
        "projectName": source.get("project_name").cloned().unwrap_or(json!("Kitten 4")),
        "version": "0.27.4", "toolType": "KN",
        "stageSize": source.get("size").cloned().unwrap_or(json!({"width":640,"height":360})),
        "scenes": {"scenesDict": scenes,
            "sortList": theatre.get("scenes_order").cloned().unwrap_or(json!([])),
            "currentSceneId": current_scene},
        "actors": {"actorsDict": actors},
        "styles": {"stylesDict": styles},
        "variables": {"variablesDict": variables},
        "broadcasts": {"broadcastsDict": source.get("broadcasts").cloned().unwrap_or(json!({}))},
        "audios": {"audiosDict": source.get("audio").cloned().unwrap_or(json!({})),
            "sortList": source.get("audio_order").cloned().unwrap_or(json!([]))},
        "procedures": {"proceduresDict": compiled.procedures()?}
    }))
}

fn object_or_empty(value: Option<&Value>, label: &str) -> Result<Map<String, Value>> {
    match value {
        None => Ok(Map::new()),
        Some(value) => value
            .as_object()
            .cloned()
            .with_context(|| format!("{label} must be an object")),
    }
}

fn import_owners(value: &Value, kind: &str, compiled: &CompiledWork) -> Result<Map<String, Value>> {
    let owners = value
        .as_object()
        .with_context(|| format!("theatre.{kind}s must be an object"))?;
    owners
        .iter()
        .map(|(id, owner)| {
            ensure!(owner.is_object(), "{kind} {id} must be an object");
            let mut result = owner.clone();
            let workspace = owner
                .get("block_data_json")
                .cloned()
                .unwrap_or(json!({"blocks":{},"connections":{},"comments":{}}));
            let scripts = if owner.get("block_data_json").is_some() {
                import_workspace(&workspace)
            } else {
                compiled.scripts(id)
            }
            .with_context(|| format!("Kitten 4 {kind} {id}"))?;
            result["nekoBlockJsonList"] = Value::Array(scripts);
            result["comments"] = workspace.get("comments").cloned().unwrap_or(json!({}));
            remove(&mut result, "block_data_json");
            rename(&mut result, "current_style_id", "currentStyleId");
            rename(&mut result, "workspace_offset", "workspaceScrollXy");
            rename(&mut result, "screen_name", "screenName");
            rename(&mut result, "lock", "locked");
            if kind == "scene" {
                rename(&mut result, "actors", "actorIds");
            }
            result["position"] = json!({"x":owner.get("x").cloned().unwrap_or(json!(0)),
            "y":owner.get("y").cloned().unwrap_or(json!(0))});
            // Both project formats store radians. K4 is counterclockwise from
            // right; KN is clockwise from up. Block inputs/reporters use degrees.
            result["rotation"] = json!(
                std::f64::consts::FRAC_PI_2
                    - owner.get("rotation").and_then(Value::as_f64).unwrap_or(0.0)
            );
            remove(&mut result, "x");
            remove(&mut result, "y");
            Ok((id.clone(), result))
        })
        .collect()
}

/// Validate the entire graph (including disconnected cycles) before recursion.
/// Published works carry no block workspace, only the tree the official compiler
/// produced (`compile_result`). Its `params` use the same names as native fields and
/// inputs, so it can be rebuilt into the nested form the importer already understands.
struct CompiledWork<'a> {
    entities: Vec<&'a Value>,
    parameters: BTreeMap<&'a str, Vec<&'a str>>,
}

impl<'a> CompiledWork<'a> {
    fn new(source: &'a Value) -> Self {
        let entities: Vec<&Value> = source
            .get("compile_result")
            .and_then(Value::as_array)
            .map(|entities| entities.iter().collect())
            .unwrap_or_default();
        let mut parameters = BTreeMap::new();
        for (name, definition) in entities
            .iter()
            .filter_map(|entity| entity["procedures"].as_object())
            .flatten()
        {
            let names = definition["params"]
                .as_object()
                .map(|params| params.keys().map(String::as_str).collect())
                .unwrap_or_default();
            parameters.insert(name.as_str(), names);
        }
        Self {
            entities,
            parameters,
        }
    }

    fn scripts(&self, owner: &str) -> Result<Vec<Value>> {
        self.finish(self.roots(owner))
    }

    fn roots<'b>(&'b self, owner: &'b str) -> impl Iterator<Item = &'a Value> + 'b {
        self.entities
            .iter()
            .filter(|entity| entity["id"].as_str() == Some(owner))
            .filter_map(|entity| entity["compiled_block_map"].as_object())
            .flat_map(Map::values)
    }

    fn procedures(&self) -> Result<Map<String, Value>> {
        let mut result = Map::new();
        for (name, definition) in self
            .entities
            .iter()
            .filter_map(|entity| entity["procedures"].as_object())
            .flatten()
        {
            let params: Vec<Value> = self.parameters[name.as_str()]
                .iter()
                .map(|param| json!({"id": param, "name": param, "type": "String"}))
                .collect();
            let scripts = self
                .finish(std::iter::once(definition))
                .with_context(|| format!("Kitten 4 procedure {name}"))?;
            result.insert(
                name.clone(),
                json!({"id": name, "name": name, "params": params, "nekoBlockJsonList": scripts}),
            );
        }
        Ok(result)
    }

    fn finish<'b>(&self, roots: impl Iterator<Item = &'b Value>) -> Result<Vec<Value>> {
        Ok(self.finish_with_starts(roots)?.0)
    }

    fn finish_with_starts<'b>(
        &self,
        roots: impl Iterator<Item = &'b Value>,
    ) -> Result<ImportedRoots> {
        finish_roots(roots.map(|root| self.native(root, 0)), None)
    }

    fn native(&self, node: &Value, depth: usize) -> Result<Value> {
        let mut nodes = Vec::new();
        let mut current = Some(node);
        while let Some(node) = current {
            nodes.push(self.native_one(node, depth)?);
            current = node.get("next_block").filter(|v| !v.is_null());
        }
        Ok(join_chain(nodes))
    }

    fn native_one(&self, node: &Value, depth: usize) -> Result<Value> {
        check_depth(node, depth)?;
        let kind = node["type"]
            .as_str()
            .context("compiled block has no type")?;
        // Number sockets holding typed text compile to math_number with only TEXT.
        let kind = if kind == "math_number" && node["params"].get("NUM").is_none() {
            "text"
        } else {
            kind
        };
        let definition = kind.starts_with("procedures_2_def");
        let (mut fields, mut inputs, mut statements) = (Map::new(), Map::new(), Map::new());
        if !definition {
            for (name, value) in node["params"].as_object().into_iter().flatten() {
                if value.is_object() {
                    inputs.insert(name.clone(), self.native(value, depth + 1)?);
                } else if !value.is_null() {
                    fields.insert(name.clone(), value.clone());
                }
            }
        }
        if matches!(
            kind,
            "procedures_2_callnoreturn" | "procedures_2_callreturn"
        ) {
            let name = node["procedure_name"].as_str().unwrap_or_default();
            fields.insert("NAME".into(), json!(name));
            let parameters = self.parameters.get(name);
            inputs.retain(|key, _| parameters.is_none_or(|p| p.contains(&key.as_str())));
            for parameter in parameters.into_iter().flatten() {
                inputs
                    .entry(parameter.to_string())
                    .or_insert_with(|| json!({"type": "math_number", "fields": {"NUM": "0"}}));
            }
        }
        if kind == "procedures_2_return_value" && !inputs.contains_key("VALUE") {
            inputs.insert(
                "VALUE".into(),
                json!({"type": "text", "fields": {"TEXT": ""}}),
            );
        }
        let conditions = node["conditions"].as_array().map_or(0, Vec::len);
        for (index, condition) in node["conditions"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            if !condition.is_null() {
                inputs.insert(format!("IF{index}"), self.native(condition, depth + 1)?);
            }
        }
        for (index, child) in node["child_block"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            if child.is_null() {
                continue;
            }
            let socket = match kind {
                "controls_if" if index < conditions => format!("DO{index}"),
                "controls_if" => "ELSE".to_owned(),
                _ if definition => "STACK".to_owned(),
                _ => "DO".to_owned(),
            };
            statements.insert(socket, self.native(child, depth + 1)?);
        }
        let mut block = json!({"type": kind});
        if matches!(
            kind,
            "procedures_2_callnoreturn" | "procedures_2_callreturn"
        ) {
            let name = node["procedure_name"].as_str().unwrap_or_default();
            let name = name
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('"', "&quot;");
            block["mutation"] = json!(format!(
                "<mutation def_id=\"{name}\" name=\"{name}\" type=\"NORMAL\"></mutation>"
            ));
        }
        if let Some(id) = node.get("id") {
            block["id"] = id.clone();
        }
        if !fields.is_empty() {
            block["fields"] = Value::Object(fields);
        }
        if !inputs.is_empty() {
            block["inputs"] = Value::Object(inputs);
        }
        if !statements.is_empty() {
            block["statements"] = Value::Object(statements);
        }
        Ok(block)
    }
}

fn import_workspace(workspace: &Value) -> Result<Vec<Value>> {
    Ok(import_workspace_with_starts(workspace)?.0)
}

type ImportedRoots = (Vec<Value>, Vec<(String, StartKind)>);

fn import_workspace_with_starts(workspace: &Value) -> Result<ImportedRoots> {
    let blocks = workspace
        .get("blocks")
        .and_then(Value::as_object)
        .context("block_data_json.blocks must be an object")?;
    let connections = object_or_empty(workspace.get("connections"), "block_data_json.connections")?;
    let mut parents = BTreeMap::new();
    for (parent, children) in &connections {
        ensure!(
            blocks.contains_key(parent),
            "connections reference missing parent block {parent}"
        );
        let children = children
            .as_object()
            .with_context(|| format!("connections for {parent} must be an object"))?;
        let mut sockets = BTreeSet::new();
        for (child, connection) in children {
            ensure!(
                blocks.contains_key(child),
                "connection {parent} references missing block {child}"
            );
            ensure!(
                parents.insert(child.as_str(), parent.as_str()).is_none(),
                "block {child} has multiple parents"
            );
            let socket = match connection["type"].as_str() {
                Some("next") => "next".to_owned(),
                Some("input") => {
                    let name = connection["input_name"]
                        .as_str()
                        .context("input connection missing input_name")?;
                    let kind = connection["input_type"].as_str().unwrap_or("value");
                    ensure!(
                        matches!(kind, "value" | "statement"),
                        "invalid input_type {kind} at {parent}"
                    );
                    format!("input:{name}")
                }
                other => bail!("unsupported connection type {other:?} at {parent}"),
            };
            ensure!(
                sockets.insert(socket),
                "duplicate connection socket at block {parent}"
            );
        }
    }
    let mut state = BTreeMap::new();
    // Visit complete root paths before cached descendants, so the path-length
    // bound cannot be bypassed by dictionary ordering. Then check detached cycles.
    for id in blocks
        .keys()
        .filter(|id| !parents.contains_key(id.as_str()))
        .chain(blocks.keys())
    {
        visit(id, &connections, &mut state, 0)?;
    }
    let roots = blocks
        .keys()
        .filter(|id| !parents.contains_key(id.as_str()))
        .map(|id| nest(id, blocks, &connections, 0));
    finish_roots(roots, Some(workspace))
}

fn finish_roots(
    roots: impl Iterator<Item = Result<Value>>,
    workspace: Option<&Value>,
) -> Result<ImportedRoots> {
    let mut kinds = Vec::new();
    let mut scripts = roots
        .map(|native| {
            let native = native?;
            kinds.push(match native["type"].as_str() {
                Some("start_on_click") => Some(StartKind::Global),
                Some("on_running_group_activated") => Some(StartKind::Activation),
                _ => None,
            });
            import_block(&native, 0)
        })
        .collect::<Result<Vec<_>>>()?;
    // Conversion expressions are real editable KN blocks and need stable,
    // noncolliding IDs for workspace editors and subsequent graph export.
    let mut ids = Graph::new(workspace);
    for block in &scripts {
        ids.reserve_ids(block, 0)?;
    }
    for block in &mut scripts {
        ids.assign_ids(block, 0)?;
        repair_parents(block, None);
    }
    let starts = scripts
        .iter()
        .zip(kinds)
        .filter_map(|(block, kind)| {
            kind.map(|kind| (block["id"].as_str().unwrap().to_owned(), kind))
        })
        .collect();
    Ok((scripts, starts))
}

fn visit<'a>(
    id: &'a str,
    connections: &'a Map<String, Value>,
    state: &mut BTreeMap<&'a str, u8>,
    depth: usize,
) -> Result<()> {
    let mut pending = vec![(id, depth, 0, false)];
    while let Some((id, depth, path_depth, exit)) = pending.pop() {
        if exit {
            state.insert(id, 2);
            continue;
        }
        ensure!(
            depth <= MAX_DEPTH,
            "Kitten 4 block graph nesting exceeds {MAX_DEPTH} at block {id}"
        );
        ensure!(
            path_depth <= crate::json::MAX_BLOCK_PATH,
            "Kitten 4 block path exceeds {} at block {id}",
            crate::json::MAX_BLOCK_PATH
        );
        match state.get(id) {
            Some(1) => bail!("cycle in Kitten 4 block graph at {id}"),
            Some(2) => continue,
            _ => {}
        }
        state.insert(id, 1);
        pending.push((id, depth, path_depth, true));
        if let Some(children) = connections.get(id).and_then(Value::as_object) {
            for (child, connection) in children {
                pending.push((
                    child,
                    depth + usize::from(connection["type"] != "next"),
                    path_depth + 1,
                    false,
                ));
            }
        }
    }
    Ok(())
}

fn nest(
    id: &str,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
    depth: usize,
) -> Result<Value> {
    let mut nodes = Vec::new();
    let mut current = Some(id);
    while let Some(id) = current {
        ensure!(
            depth <= MAX_DEPTH,
            "Kitten 4 block nesting exceeds {MAX_DEPTH} at block {id}"
        );
        current = None;
        let mut result = blocks[id]
            .as_object()
            .cloned()
            .with_context(|| format!("block {id} must be an object"))?;
        ensure!(
            result.get("id").is_none_or(|v| v.as_str() == Some(id)),
            "block ID disagrees with dictionary key {id}"
        );
        result.insert("id".into(), json!(id));
        for key in ["next", "inputs", "statements"] {
            result.remove(key);
        }
        if let Some(children) = connections.get(id).and_then(Value::as_object) {
            for (child, connection) in children {
                if connection["type"] == "next" {
                    current = Some(child);
                } else {
                    let nested = nest(child, blocks, connections, depth + 1)?;
                    let container = if connection["input_type"] == "statement" {
                        "statements"
                    } else {
                        "inputs"
                    };
                    let name = connection["input_name"]
                        .as_str()
                        .context("missing input name")?;
                    result
                        .entry(container)
                        .or_insert(json!({}))
                        .as_object_mut()
                        .unwrap()
                        .insert(name.into(), nested);
                }
            }
        }
        nodes.push(Value::Object(result));
    }
    Ok(join_chain(nodes))
}

fn import_block(block: &Value, depth: usize) -> Result<Value> {
    let mut nodes = Vec::new();
    let mut current = Some(block);
    while let Some(block) = current {
        nodes.push(import_one(block, depth)?);
        current = block.get("next");
    }
    Ok(join_chain(nodes))
}

fn import_one(block: &Value, depth: usize) -> Result<Value> {
    check_depth(block, depth)?;
    ensure!(
        block["type"] != "on_keydown"
            || block.get("next").is_none()
            || block.pointer("/statements/DO").is_none(),
        "native event has both next and DO bodies at block {}",
        block["id"]
    );
    let mut result = without_next(block);
    for key in ["inputs", "statements"] {
        if let Some(children) = result.get_mut(key).and_then(Value::as_object_mut) {
            for child in children.values_mut() {
                *child = import_block(child, depth + 1)?;
            }
        }
    }
    let kind = block["type"]
        .as_str()
        .context("Kitten 4 block is missing type")?;
    let untranslated = result.clone();
    if !translate(&mut result, false).unwrap_or(false) {
        result = untranslated;
        result["type"] = json!(format!("{OPAQUE}{kind}"));
    }
    match kind {
        "self_point_towards" | "self_rotate" => {
            let offset = if kind == "self_point_towards" {
                90.0
            } else {
                0.0
            };
            if let Some(input) = result.get_mut("inputs").and_then(|v| v.get_mut("degrees")) {
                *input = angle_expression(input.clone(), offset, false, Some("input"));
            }
        }
        "get_2" if field(block, "attribute") == "3" && result["type"] == "appearance_of_sprite" => {
            result = native_heading_reporter(result);
        }
        _ => {}
    }
    // Native list reporters produce arrays; KN uses reference reporters in list sockets.
    for name in ["list", "target_list"] {
        if let Some(child) = result.get_mut("inputs").and_then(|v| v.get_mut(name))
            && child["type"] == "list_get"
        {
            child["type"] = json!("pure_list_get");
        }
    }
    Ok(result)
}

fn angle_expression(expression: Value, offset: f64, native: bool, marker: Option<&str>) -> Value {
    let mut block = json!({"type":"math_arithmetic", "is_output":true,
        "fields": if native {json!({"OP":"MINUS"})} else {json!({"type":"minus"})},
        "inputs":{"A":{"type":"math_number","is_output":true,"fields":{"NUM":offset}},"B":expression}});
    if let Some(marker) = marker {
        block[ANGLE] = json!({"kind":marker,"offset":offset});
    }
    block
}

fn arithmetic(op: &str, a: Value, b: Value) -> Value {
    json!({"type":"math_arithmetic","is_output":true,"fields":{"type":op},"inputs":{"A":a,"B":b}})
}
fn number(n: f64) -> Value {
    json!({"type":"math_number","is_output":true,"fields":{"NUM":n}})
}

fn native_heading_reporter(mut reporter: Value) -> Value {
    reporter[ANGLE] = json!({"kind":"raw-reporter"});
    // Official JfQ3.N normalizes radians to (-PI,PI], then Tn6a.O
    // rounds the reported degrees to two decimal places.
    let raw = angle_expression(reporter, 90.0, false, None);
    let modulo = arithmetic(
        "mod",
        arithmetic(
            "add",
            arithmetic(
                "mod",
                arithmetic("minus", number(180.0), raw),
                number(360.0),
            ),
            number(360.0),
        ),
        number(360.0),
    );
    let normalized = arithmetic("minus", number(180.0), modulo);
    // JS Math.round is floor(x + 0.5), including negative halfway values.
    let rounded = json!({"type":"math_round","is_output":true,"fields":{"type":"round_down"},"inputs":{"num":arithmetic("add",arithmetic("multiply",normalized,number(100.0)),number(0.5))}});
    let mut result = arithmetic("divide", rounded, number(100.0));
    result[ANGLE] = json!({"kind":"reporter"});
    result
}

fn reporter_leaf(block: &Value) -> Option<&Value> {
    if block[ANGLE]["kind"] == "raw-reporter" {
        return Some(block);
    }
    block
        .get("inputs")
        .and_then(Value::as_object)?
        .values()
        .find_map(reporter_leaf)
}
fn expression_shape(block: &Value) -> Value {
    json!({"type":block["type"],"fields":block["fields"],
        "next":block.get("next"),"statements":block.get("statements"),
        "inputs":block.get("inputs").and_then(Value::as_object).map(|inputs|inputs.iter().map(|(k,v)|(k.clone(),expression_shape(v))).collect::<Map<_,_>>())})
}
fn original_heading_reporter(block: &Value) -> Option<&Value> {
    if block[ANGLE]["kind"] != "reporter" {
        return None;
    }
    let reporter = reporter_leaf(block)?;
    (expression_shape(block) == expression_shape(&native_heading_reporter(reporter.clone())))
        .then_some(reporter)
}
fn repair_parents(block: &mut Value, parent: Option<&str>) {
    let mut pending = vec![(block, parent.map(str::to_owned))];
    while let Some((block, parent)) = pending.pop() {
        block["parent_id"] = json!(parent);
        let id = block["id"].as_str().unwrap_or("").to_owned();
        for (key, child) in block.as_object_mut().unwrap() {
            if key == "next" {
                pending.push((child, Some(id.clone())));
            } else if matches!(key.as_str(), "inputs" | "statements")
                && let Some(children) = child.as_object_mut()
            {
                for child in children.values_mut() {
                    pending.push((child, Some(id.clone())));
                }
            }
        }
    }
}

fn original_angle_input<'a>(block: &'a Value, kind: &str, offset: f64) -> Option<&'a Value> {
    // Only cancel our own intact wrapper. Edits to its arithmetic are preserved
    // as normal arithmetic, rather than discarded using stale provenance.
    (block[ANGLE]["kind"] == kind
        && block[ANGLE]["offset"].as_f64() == Some(offset)
        && block["type"] == "math_arithmetic"
        && field(block, "type") == "minus"
        && block.pointer("/inputs/A/type").and_then(Value::as_str) == Some("math_number")
        && block
            .pointer("/inputs/A/fields/NUM")
            .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
            == Some(offset))
    .then(|| block.pointer("/inputs/B"))
    .flatten()
}

fn rename(value: &mut Value, from: &str, to: &str) {
    if from == to {
        return;
    }
    if let Some(object) = value.as_object_mut()
        && let Some(item) = object.remove(from)
    {
        object.insert(to.into(), item);
    }
}
fn remove(value: &mut Value, key: &str) {
    if let Some(map) = value.as_object_mut() {
        map.remove(key);
    }
}
fn field<'a>(block: &'a Value, key: &str) -> &'a str {
    block["fields"][key].as_str().unwrap_or("")
}
fn put_field(block: &mut Value, key: &str, value: &str) {
    if !block.get("fields").is_some_and(Value::is_object) {
        block["fields"] = json!({});
    }
    block["fields"][key] = json!(value);
}
fn names(block: &mut Value, container: &str, pairs: &[(&str, &str)], export: bool) {
    if let Some(value) = block.get_mut(container) {
        for &(native, neko) in pairs {
            let (a, b) = if export {
                (neko, native)
            } else {
                (native, neko)
            };
            rename(value, a, b);
        }
    }
}
fn fields(block: &mut Value, pairs: &[(&str, &str)], export: bool) {
    for key in ["fields", "field_constraints", "field_extra_attr"] {
        names(block, key, pairs, export);
    }
}
fn inputs(block: &mut Value, pairs: &[(&str, &str)], export: bool) {
    for key in ["inputs", "shadows"] {
        names(block, key, pairs, export);
    }
}
fn enum_field(
    block: &mut Value,
    native: &str,
    neko: &str,
    pairs: &[(&str, &str)],
    export: bool,
) -> Result<()> {
    let key = if export { neko } else { native };
    let value = field(block, key);
    let pair = pairs
        .iter()
        .find(|&&(a, b)| value == if export { b } else { a });
    let Some(&(a, b)) = pair else {
        bail!("unsupported {} field {key}={value:?}", block["type"]);
    };
    fields(block, &[(native, neko)], export);
    put_field(
        block,
        if export { native } else { neko },
        if export { a } else { b },
    );
    Ok(())
}

/// Return false for genuinely unsupported native blocks. Never guess by name.
fn translate(block: &mut Value, export: bool) -> Result<bool> {
    let kind = block["type"]
        .as_str()
        .context("block missing type")?
        .to_owned();
    let native = if export {
        match kind.as_str() {
            "on_running_group_activated" => "start_on_click",
            "change_variables" => "change_variable",
            "pure_list_get" | "list_get" => "lists_get",
            "list_append" => "lists_append",
            "list_insert_value" => "lists_insert_value",
            "replace_list_item" => "lists_replace",
            "delete_list_item" => "lists_delete",
            "list_item" => "lists_get_value",
            "list_length" => "lists_length",
            "list_index_of" => "lists_index_of",
            "list_is_exist" => "lists_is_exist",
            "list_copy" => "lists_copy",
            "math_function" => "math_single",
            "random_num" => "random",
            "self_set_position_x" | "self_set_position_y" => "self_set_position",
            "self_add_position_x"
            | "self_add_position_y"
            | "self_change_coordinate_x"
            | "self_change_coordinate_y" => "self_change_coordinate",
            "self_change_pen_size" => "self_change_pen_size_2",
            "self_change_pen_color_property" => "self_change_pen_color_property_2",
            "timer" => "get_timer",
            "coordinate_of_sprite"
            | "self_get_position_x"
            | "self_get_position_y"
            | "self_get_rotation"
            | "get_orientation" => "get_2",
            // Sprite heading; KN get_orientation is device tilt, not rotation.
            "appearance_of_sprite" if field(block, "appearance") == "direction" => "get_2",
            other => other,
        }
        .to_owned()
    } else {
        kind.clone()
    };
    let mut neko = native.clone();
    match native.as_str() {
        "start_on_click" => {
            neko = "on_running_group_activated".into();
        }
        "controller_shadow" if !export => {
            neko = "math_number".into();
        }
        "on_running_group_activated" if !export => {}
        "variables_get" | "variables_set" => {
            fields(block, &[("VAR", "variable")], export);
            inputs(block, &[("VALUE", "value")], export);
        }
        "change_variable" => {
            neko = "change_variables".into();
            fields(block, &[("valname", "variable")], export);
            inputs(block, &[("n", "value")], export);
        }
        "lists_get" => {
            neko = "list_get".into();
            fields(block, &[("VAR", "list")], export);
        }
        "lists_append" | "lists_insert_value" | "lists_replace" | "lists_delete"
        | "lists_get_value" | "lists_length" | "lists_is_exist" | "lists_index_of" => {
            neko = match native.as_str() {
                "lists_append" => "list_append",
                "lists_insert_value" => "list_insert_value",
                "lists_replace" => "replace_list_item",
                "lists_delete" => "delete_list_item",
                "lists_get_value" => "list_item",
                "lists_length" => "list_length",
                "lists_is_exist" => "list_is_exist",
                _ => "list_index_of",
            }
            .into();
            inputs(
                block,
                &[
                    ("VAR", "list"),
                    ("VALUE", "list_item_value"),
                    ("INDEX", "list_index"),
                ],
                export,
            );
            if matches!(
                native.as_str(),
                "lists_replace" | "lists_delete" | "lists_get_value"
            ) {
                enum_field(
                    block,
                    "TYPE",
                    "item",
                    &[("first", "any"), ("last", "last"), ("all", "all")],
                    export,
                )?;
            }
        }
        "lists_copy" => {
            neko = "list_copy".into();
            inputs(
                block,
                &[("VALUE", "list"), ("TARGET", "target_list")],
                export,
            );
        }
        "broadcast_input" => fields(block, &[("MESSAGE", "message")], export),
        "on_keydown" => {
            fields(block, &[("key_event_type", "type")], export);
            event_body(block, export)?;
        }
        "math_arithmetic" => {
            if export && field(block, "type") == "mod" {
                block["type"] = json!("math_modulo");
                remove(&mut block["fields"], "type");
                inputs(block, &[("DIVIDEND", "A"), ("DIVISOR", "B")], true);
                return Ok(true);
            }
            if export && field(block, "type") == "subtract" {
                put_field(block, "type", "minus");
            }
            enum_field(
                block,
                "OP",
                "type",
                &[
                    ("ADD", "add"),
                    ("MINUS", "minus"),
                    ("MULTIPLY", "multiply"),
                    ("DIVIDE", "divide"),
                    ("POWER", "power"),
                ],
                export,
            )?;
        }
        "math_single" => {
            neko = "math_function".into();
            if export {
                let alias = match field(block, "type") {
                    "sqrt" => Some("0"),
                    "abs" => Some("1"),
                    "neg" => Some("2"),
                    "ln" => Some("3"),
                    "log" => Some("4"),
                    "exp" => Some("5"),
                    "pow10" => Some("6"),
                    _ => None,
                };
                if let Some(alias) = alias {
                    put_field(block, "type", alias);
                }
            }
            enum_field(
                block,
                "OP",
                "type",
                &[
                    ("ROOT", "0"),
                    ("ABS", "1"),
                    ("NEG", "2"),
                    ("LN", "3"),
                    ("LOG10", "4"),
                    ("EXP", "5"),
                    ("POW10", "6"),
                ],
                export,
            )?;
            inputs(block, &[("NUM", "num")], export);
        }
        "math_round" => {
            if export {
                match field(block, "type") {
                    "floor" => put_field(block, "type", "round_down"),
                    "ceil" => put_field(block, "type", "round_up"),
                    _ => {}
                }
            }
            enum_field(
                block,
                "OP",
                "type",
                &[
                    ("ROUND", "round"),
                    ("ROUNDDOWN", "round_down"),
                    ("ROUNDUP", "round_up"),
                ],
                export,
            )?;
            inputs(block, &[("NUM", "num")], export);
        }
        "math_trig" => {
            // The canonical evaluator currently implements only forward trig.
            enum_field(
                block,
                "OP",
                "type",
                &[("SIN", "sin"), ("COS", "cos"), ("TAN", "tan")],
                export,
            )?;
            inputs(block, &[("NUM", "num")], export);
        }
        "math_modulo" => inputs(block, &[("DIVIDEND", "A"), ("DIVISOR", "B")], export),
        "random" => {
            neko = "random_num".into();
            inputs(block, &[("a", "A"), ("b", "B")], export);
        }
        "divisible_by" => inputs(block, &[("NUMBER_TO_CHECK", "A"), ("DIVISOR", "B")], export),
        "math_number_property" => {
            enum_field(
                block,
                "PROPERTY",
                "type",
                &[
                    ("EVEN", "even"),
                    ("ODD", "odd"),
                    ("PRIME", "prime"),
                    ("WHOLE", "integer"),
                    ("POSITIVE", "positive"),
                    ("NEGATIVE", "negative"),
                ],
                export,
            )?;
            inputs(block, &[("NUMBER_TO_CHECK", "num")], export);
        }
        "logic_operation" => {
            enum_field(block, "OP", "type", &[("AND", "and"), ("OR", "or")], export)?
        }
        "logic_negate" => inputs(block, &[("BOOL", "logic")], export),
        "text_length" => inputs(block, &[("VALUE", "text")], export),
        "text_contain" => inputs(block, &[("TEXT1", "A"), ("TEXT2", "B")], export),
        "text_select" => inputs(
            block,
            &[
                ("string", "text"),
                ("char_start_index", "start_index"),
                ("char_end_index", "end_index"),
            ],
            export,
        ),
        "self_set_position" | "self_change_coordinate" => {
            let axis = if export {
                if kind.ends_with('y') { "y" } else { "x" }
            } else {
                field(block, "coordinary")
            };
            ensure!(
                matches!(axis, "x" | "y"),
                "invalid Kitten 4 coordinate {axis}"
            );
            let axis = axis.to_owned();
            if native == "self_set_position" {
                neko = format!("self_set_position_{axis}");
            } else {
                neko = format!("self_change_coordinate_{axis}");
                // KN's reference runtime/TS frontend use `increase`; the fast
                // VM uses `method`. Supply both on import without changing the
                // native socket or operator when exporting again.
                let sign = if field(block, "increase").is_empty() {
                    field(block, "method")
                } else {
                    field(block, "increase")
                }
                .to_owned();
                if !sign.is_empty() {
                    put_field(block, "increase", &sign);
                    if !export {
                        put_field(block, "method", &sign);
                    }
                }
                if export {
                    remove(&mut block["fields"], "method");
                }
            }
            if export {
                put_field(block, "coordinary", &axis);
                if kind.starts_with("self_add_position_") {
                    put_field(block, "increase", "increase");
                }
            } else {
                remove(&mut block["fields"], "coordinary");
            }
        }
        "self_appear" | "self_disappear" => {
            if export {
                block["type"] = json!(match field(block, "value") {
                    "appear" => "self_appear",
                    "disappear" => "self_disappear",
                    other => bail!("unsupported visibility {other}"),
                });
                remove(&mut block["fields"], "value");
                return Ok(true);
            }
            neko = "self_appear".into();
            put_field(
                block,
                "value",
                if native == "self_appear" {
                    "appear"
                } else {
                    "disappear"
                },
            );
        }
        "self_change_pen_size_2" => neko = "self_change_pen_size".into(),
        "self_change_pen_color_property_2" => neko = "self_change_pen_color_property".into(),
        "get_timer" => neko = "timer".into(),
        "set_timer_state" => fields(block, &[("actions", "type")], export),
        "show_hide_timer" => fields(block, &[("state", "showHide")], export),
        "get_2" => {
            if export {
                let (attribute, target) = match kind.as_str() {
                    "self_get_position_x" => ("0", "--self"),
                    "self_get_position_y" => ("1", "--self"),
                    "self_get_rotation" => ("3", "--self"),
                    "get_orientation" => ("3", field(block, "target")),
                    "appearance_of_sprite" => ("3", field(block, "sprite")),
                    "coordinate_of_sprite" => (
                        if field(block, "coordinate") == "y" {
                            "1"
                        } else {
                            "0"
                        },
                        field(block, "sprite"),
                    ),
                    _ => return Ok(false),
                };
                let target = target.to_owned();
                put_field(block, "attribute", attribute);
                put_field(
                    block,
                    "sprite",
                    if target == "--self" {
                        "__self"
                    } else {
                        &target
                    },
                );
                remove(&mut block["fields"], "coordinate");
                remove(&mut block["fields"], "target");
            } else {
                let target = field(block, "sprite").replace("__self", "--self");
                match field(block, "attribute") {
                    "0" | "1" => {
                        let axis = if field(block, "attribute") == "0" {
                            "x"
                        } else {
                            "y"
                        };
                        neko = "coordinate_of_sprite".into();
                        put_field(block, "coordinate", axis);
                        put_field(block, "sprite", &target);
                    }
                    "3" => {
                        neko = "appearance_of_sprite".into();
                        put_field(block, "sprite", &target);
                        put_field(block, "appearance", "direction");
                    }
                    _ => return Ok(false),
                }
                remove(&mut block["fields"], "attribute");
            }
        }
        // These sockets and field values are shared by both official editors.
        // In particular self_listen/when use DO (unlike on_keydown), text_split
        // uses TEXT_TO_SPLIT/SPLIT_TEXT, and pen changes use `increase`.
        // Stamp is deliberately excluded: its text orientation follows K4's
        // actor rotation, which cannot share KN's stamp direction unchanged.
        "math_number"
        | "text"
        | "logic_boolean"
        | "logic_compare"
        | "text_join"
        | "text_split"
        | "repeat_n_times"
        | "repeat_forever"
        | "repeat_forever_until"
        | "controls_if"
        | "warp"
        | "break"
        | "wait"
        | "wait_until"
        | "when"
        | "self_listen"
        | "self_broadcast"
        | "self_broadcast_and_wait"
        | "self_go_forward"
        | "self_move_to"
        | "self_rotate"
        | "self_point_towards"
        | "self_bounce_off_edge"
        | "set_scale"
        | "self_dialog"
        | "self_dialog_wait"
        | "self_pen_down"
        | "self_pen_up"
        | "self_set_pen_size"
        | "self_set_pen_color"
        | "self_set_pen_color_property"
        | "clear_drawing"
        | "procedures_2_defnoreturn"
        | "procedures_2_callnoreturn"
        | "procedures_2_callreturn"
        | "procedures_2_parameter"
        | "procedures_2_return_value" => {}
        _ => return Ok(false),
    }
    block["type"] = json!(if export { native } else { neko });
    Ok(true)
}

fn event_body(block: &mut Value, export: bool) -> Result<()> {
    if export {
        if let Some(next) = block.as_object_mut().unwrap().remove("next") {
            ensure!(
                block.pointer("/statements/DO").is_none(),
                "event has both next and DO bodies"
            );
            if !block.get("statements").is_some_and(Value::is_object) {
                block["statements"] = json!({});
            }
            block["statements"]["DO"] = next;
        }
    } else if let Some(body) = block
        .get_mut("statements")
        .and_then(Value::as_object_mut)
        .and_then(|m| m.remove("DO"))
    {
        ensure!(
            block.get("next").is_none(),
            "native event has both next and DO bodies"
        );
        block["next"] = body;
    }
    Ok(())
}

fn export_project(value: &Value, source: Option<&Value>) -> Result<Value> {
    let size = value
        .get("stageSize")
        .cloned()
        .unwrap_or(json!({"width":1280,"height":720}));
    let unchanged_size = source.is_some_and(|s| s.get("size") == Some(&size));
    match (size["width"].as_f64(), size["height"].as_f64()) {
        (Some(620.0), Some(900.0)) | (Some(960.0), Some(720.0)) | (Some(1280.0), Some(720.0)) => {}
        _ if unchanged_size => {}
        _ => bail!("unsupported Kitten 4 stage size {size}; use 620x900, 960x720, or 1280x720"),
    }
    ensure!(
        value
            .pointer("/procedures/proceduresDict")
            .and_then(Value::as_object)
            .is_none_or(Map::is_empty),
        "Kitten 4 export does not yet support new canonical procedures"
    );
    let scenes = export_owners(value.pointer("/scenes/scenesDict"), "scene", source)?;
    let mut actors = export_owners(value.pointer("/actors/actorsDict"), "actor", source)?;
    let mut groups = object_or_empty(
        source.and_then(|s| s.pointer("/theatre/groups")),
        "theatre.groups",
    )?;
    // Keep user-created folders and their metadata, updating membership only.
    for group in groups.values_mut() {
        let members = scenes
            .get(group["scene"].as_str().unwrap_or(""))
            .and_then(|s| s["actors"].as_array());
        if let Some(ids) = group.get_mut("actors").and_then(Value::as_array_mut) {
            ids.retain(|id| members.is_some_and(|m| m.contains(id)));
        }
    }
    let mut scenes = scenes;
    for (scene_id, scene) in &mut scenes {
        let ids = scene["actors"].as_array().cloned().unwrap_or_default();
        let mut order = scene["group_order"].as_array().cloned().unwrap_or_default();
        for actor_id in ids.iter().filter_map(Value::as_str) {
            if let Some(actor) = actors.get_mut(actor_id) {
                actor["scene"] = json!(scene_id);
            }
            let existing = groups
                .iter()
                .find(|(_, g)| {
                    g["scene"] == *scene_id
                        && g["actors"]
                            .as_array()
                            .is_some_and(|ids| ids.iter().any(|id| id == actor_id))
                })
                .map(|(id, _)| id.clone());
            let group_id = existing.unwrap_or_else(|| {
                let base = format!("nekoc-k4-group-{actor_id}");
                let mut id = base.clone();
                let mut suffix = 0;
                while groups.contains_key(&id) {suffix += 1; id = format!("{base}-{suffix}");}
                groups.insert(id.clone(),json!({"id":id,"name":"","is_fold":false,"is_group":false,"actors":[actor_id],"scene":scene_id,"visible":true}));
                id
            });
            if !order.iter().any(|id| id == &group_id) {
                order.push(json!(group_id));
            }
        }
        scene["group_order"] = json!(order);
    }
    let mut styles = object_or_empty(value.pointer("/styles/stylesDict"), "styles.stylesDict")?;
    for style in styles.values_mut() {
        rename(style, "centerPoint", "rotate_center");
    }
    let mut variables = object_or_empty(
        value.pointer("/variables/variablesDict"),
        "variables.variablesDict",
    )?;
    for variable in variables.values_mut() {
        rename(variable, "isGlobal", "is_global");
        rename(variable, "createTime", "create_time");
        for (key, default) in [
            ("theme", json!("common")),
            ("offset", json!({"x":0,"y":0})),
            ("position", json!({"x":0,"y":0})),
            ("is_global", json!(true)),
            ("scale", json!(1)),
            ("visible", json!(false)),
        ] {
            variable
                .as_object_mut()
                .context("variable must be an object")?
                .entry(key)
                .or_insert(default);
        }
    }
    let scene_order = value
        .pointer("/scenes/sortList")
        .cloned()
        .unwrap_or_else(|| json!(scenes.keys().collect::<Vec<_>>()));
    let current = value
        .pointer("/scenes/currentSceneId")
        .and_then(Value::as_str)
        .filter(|id| scenes.contains_key(*id))
        .or_else(|| {
            scene_order.as_array().and_then(|order| {
                order
                    .iter()
                    .filter_map(Value::as_str)
                    .find(|id| scenes.contains_key(*id))
            })
        })
        .or_else(|| scenes.keys().next().map(String::as_str));
    // Include the retained selection in both sides of the three-way diff. If
    // its owner is deleted, this produces a real edit rather than preserving
    // the source's now-dangling current_entity as unrecognized metadata.
    let current_entity = source
        .and_then(|s| s.pointer("/theatre/current_entity"))
        .and_then(Value::as_str)
        .filter(|id| scenes.contains_key(*id) || actors.contains_key(*id))
        .or(current);
    let variable_order = variables.keys().cloned().collect::<Vec<_>>();
    Ok(json!({
        "version":25,"application_version":"4.11.20","work_type":"KITTEN","type":1,
        "project_name":value.get("projectName").cloned().unwrap_or(json!("NekoC")),
        "size":size,
        "theatre":{"scenes":scenes,"actors":actors,"styles":styles,"scenes_order":scene_order,
            "current_scene":current,"current_entity":current_entity,"groups":groups,"timer":{},"videos":{}},
        "variables":variables,"variable_order":variable_order,"cloud_variables":{},
        "broadcasts":value.pointer("/broadcasts/broadcastsDict").cloned().unwrap_or(json!({})),
        "audio":value.pointer("/audios/audiosDict").cloned().unwrap_or(json!({})),
        "audio_order":value.pointer("/audios/sortList").cloned().unwrap_or(json!([])),
        "midimusic":[],"midi_order":[],"matrix":{},"models":{},"ai_lab":{},"painter":{"color":[]},
        "hidden_toolbox":{"toolbox":[],"blocks":[]},"work_source_label":1,"hardware_type":"","is_partial":false,
        "toolbox":{"current_type":"","pen":true},
        "toolbox_order":["event","control","action","appearance","audio","pen","sensing","operator","data","procedure"]
    }))
}

fn export_owners(
    value: Option<&Value>,
    kind: &str,
    source: Option<&Value>,
) -> Result<Map<String, Value>> {
    let owners = object_or_empty(value, &format!("{kind}s dictionary"))?;
    owners.iter().map(|(id,owner)| {
        ensure!(owner.is_object(),"{kind} {id} must be an object");
        let mut result=owner.clone();
        let originals=source.and_then(|s|s.get("theatre")).and_then(|t|t.get(format!("{kind}s"))).and_then(|o|o.get(id)).and_then(|o|o.get("block_data_json"));
        let mut graph=Graph::new(originals);
        if let Some(scripts)=owner.get("nekoBlockJsonList") {
            for block in scripts.as_array().context("nekoBlockJsonList must be an array")? {
                graph.reserve_ids(block, 0)?;
            }
            for block in scripts.as_array().context("nekoBlockJsonList must be an array")? {
                let block=export_block(block, originals, 0).with_context(||format!("Kitten 4 export {kind} {id}"))?;
                graph.flatten(&block,None,0)?;
            }
        }
        result["block_data_json"]=json!({"blocks":graph.blocks,"connections":graph.connections,
            "comments":owner.get("comments").cloned().unwrap_or(json!({}))});
        remove(&mut result,"nekoBlockJsonList"); remove(&mut result,"comments");
        rename(&mut result,"currentStyleId","current_style_id"); rename(&mut result,"workspaceScrollXy","workspace_offset");
        rename(&mut result,"screenName","screen_name"); rename(&mut result,"locked","lock");
        if kind=="scene" {rename(&mut result,"actorIds","actors");}
        if let Some(position)=result.get("position").cloned() {
            result["x"]=position["x"].clone();result["y"]=position["y"].clone();remove(&mut result,"position");
        }
        result["rotation"] = json!(std::f64::consts::FRAC_PI_2
            - owner.get("rotation").and_then(Value::as_f64).unwrap_or(0.0));
        for (key,default) in [("id",json!(id)),("x",json!(0)),("y",json!(0)),("scale",json!(100)),("rotation",json!(0)),("rotation_type",json!(0)),("draggable",json!(false)),("visible",json!(true)),("styles",json!([])),("workspace_offset",json!({"x":100,"y":50}))] {
            result.as_object_mut().unwrap().entry(key).or_insert(default);
        }
        Ok((id.clone(),result))
    }).collect()
}

fn export_block(block: &Value, originals: Option<&Value>, depth: usize) -> Result<Value> {
    let mut nodes = Vec::new();
    let mut current = Some(block);
    while let Some(block) = current {
        nodes.push(export_block_mode(block, originals, depth, true)?);
        current = block.get("next");
    }
    let mut tail = None;
    for mut node in nodes.into_iter().rev() {
        if let Some(next) = tail {
            node["next"] = next;
            if node["type"] == "on_keydown" {
                event_body(&mut node, true)?;
            }
        }
        tail = Some(node);
    }
    Ok(tail.unwrap_or(Value::Null))
}

fn export_block_mode(
    block: &Value,
    originals: Option<&Value>,
    depth: usize,
    convert_reporter: bool,
) -> Result<Value> {
    check_depth(block, depth)?;
    ensure!(block.is_object(), "canonical block must be an object");
    if let Some(reporter) = original_heading_reporter(block) {
        return export_block_mode(reporter, originals, depth + 1, false);
    }
    let mut result = without_next(block);
    // Event translation moves next into a statement socket. Attach it only
    // after converting the individual chain node, in export_block.
    let kind = block["type"]
        .as_str()
        .context("canonical block missing type")?;
    let angle_offset = match kind {
        "self_point_towards" => Some(90.0),
        "self_rotate" => Some(0.0),
        _ => None,
    };
    let mut restore_input = false;
    if let Some(offset) = angle_offset
        && let Some(input) = block.pointer("/inputs/degrees")
        && let Some(original) = original_angle_input(input, "input", offset)
    {
        result["inputs"]["degrees"] = original.clone();
        restore_input = true;
    }
    if let Some(native) = kind.strip_prefix(OPAQUE) {
        let original = block["id"].as_str().and_then(|id| {
            originals
                .and_then(|g| g.get("blocks"))
                .and_then(|b| b.get(id))
        });
        ensure!(
            original.is_some_and(|b| b["type"].as_str() == Some(native)),
            "cannot export unsupported new KN block {kind} ({})",
            block["id"]
        );
        result["type"] = json!(native);
    } else {
        ensure!(
            translate(&mut result, true)
                .with_context(|| format!("block {kind} ({})", block["id"]))?,
            "unsupported new KN block {kind} ({}) for Kitten 4 export",
            block["id"]
        );
    }
    for key in ["inputs", "statements"] {
        if let Some(children) = result.get_mut(key) {
            for child in children
                .as_object_mut()
                .with_context(|| format!("block {kind} {key} must be an object"))?
                .values_mut()
            {
                *child = export_block(child, originals, depth + 1)?;
            }
        }
    }
    remove(&mut result, ANGLE);
    if let Some(offset) = angle_offset
        && !restore_input
    {
        let input = result
            .pointer("/inputs/degrees")
            .cloned()
            .unwrap_or(json!({"type":"math_number","fields":{"NUM":0}}));
        if !result.get("inputs").is_some_and(Value::is_object) {
            result["inputs"] = json!({});
        }
        result["inputs"]["degrees"] = angle_expression(input, offset, true, None);
    }
    if convert_reporter && matches!(kind, "get_orientation" | "self_get_rotation") {
        result = angle_expression(result, 90.0, true, None);
    }
    Ok(result)
}

struct Graph {
    blocks: Map<String, Value>,
    connections: Map<String, Value>,
    reserved: BTreeSet<String>,
    sequence: usize,
}
impl Graph {
    fn new(originals: Option<&Value>) -> Self {
        Self {
            blocks: Map::new(),
            connections: Map::new(),
            reserved: originals
                .and_then(|g| g["blocks"].as_object())
                .map(|b| b.keys().cloned().collect())
                .unwrap_or_default(),
            sequence: 0,
        }
    }
    fn reserve_ids(&mut self, block: &Value, depth: usize) -> Result<()> {
        let mut pending = vec![(block, depth)];
        while let Some((block, depth)) = pending.pop() {
            check_depth(block, depth)?;
            if let Some(id) = block["id"].as_str() {
                self.reserved.insert(id.to_owned());
            }
            if let Some(next) = block.get("next") {
                pending.push((next, depth));
            }
            for key in ["inputs", "statements"] {
                if let Some(children) = block.get(key).and_then(Value::as_object) {
                    for child in children.values() {
                        pending.push((child, depth + 1));
                    }
                }
            }
        }
        Ok(())
    }
    fn assign_ids(&mut self, block: &mut Value, depth: usize) -> Result<()> {
        let mut pending = vec![(block, depth)];
        while let Some((block, depth)) = pending.pop() {
            check_depth(block, depth)?;
            if block["id"].as_str().is_none() {
                loop {
                    self.sequence += 1;
                    let id = format!("nekoc-k4-angle-{}", self.sequence);
                    if self.reserved.insert(id.clone()) {
                        block["id"] = json!(id);
                        break;
                    }
                }
            }
            for (key, child) in block.as_object_mut().unwrap() {
                if key == "next" {
                    pending.push((child, depth));
                } else if matches!(key.as_str(), "inputs" | "statements")
                    && let Some(children) = child.as_object_mut()
                {
                    for child in children.values_mut() {
                        pending.push((child, depth + 1));
                    }
                }
            }
        }
        Ok(())
    }
    fn flatten(&mut self, block: &Value, parent: Option<&str>, depth: usize) -> Result<String> {
        // Keep statement recursion bounded, but walk next links without frames.
        let mut current = Some(block);
        let mut parent = parent.map(str::to_owned);
        let mut first = None;
        while let Some(block) = current {
            check_depth(block, depth)?;
            let id = if let Some(id) = block["id"].as_str() {
                id.to_owned()
            } else {
                loop {
                    self.sequence += 1;
                    let id = format!("nekoc-k4-{}", self.sequence);
                    if !self.reserved.contains(&id) && !self.blocks.contains_key(&id) {
                        break id;
                    }
                }
            };
            ensure!(
                !self.blocks.contains_key(&id),
                "duplicate canonical block id {id}"
            );
            let mut flat = without_next(block);
            for key in ["next", "inputs", "statements", "shield"] {
                remove(&mut flat, key);
            }
            flat["id"] = json!(id);
            flat["parent_id"] = json!(parent);
            for (key, default) in [
                ("is_shadow", json!(false)),
                ("collapsed", Value::Null),
                ("disabled", Value::Null),
                ("deletable", json!(true)),
                ("movable", json!(true)),
                ("editable", json!(true)),
                ("visible", json!("visible")),
                ("location", json!([0, 0])),
                ("shadows", json!({})),
                ("fields", json!({})),
                ("field_constraints", json!({})),
                ("field_extra_attr", json!({})),
                ("comment", Value::Null),
                ("mutation", json!("")),
                ("is_output", Value::Null),
            ] {
                flat.as_object_mut().unwrap().entry(key).or_insert(default);
            }
            self.blocks.insert(id.clone(), flat);
            let mut edges = Map::new();
            if first.is_some()
                && let Some(parent) = &parent
            {
                self.connections
                    .entry(parent.clone())
                    .or_insert(json!({}))
                    .as_object_mut()
                    .unwrap()
                    .insert(id.clone(), json!({"type":"next"}));
            }
            if first.is_none() {
                first = Some(id.clone());
            }
            for (key, input_type) in [("inputs", "value"), ("statements", "statement")] {
                if let Some(children) = block.get(key).and_then(Value::as_object) {
                    for (name, child) in children {
                        let child = self.flatten(child, Some(&id), depth + 1)?;
                        edges.insert(
                            child,
                            json!({"type":"input","input_name":name,"input_type":input_type}),
                        );
                    }
                }
            }
            self.connections
                .entry(id.clone())
                .or_insert(json!({}))
                .as_object_mut()
                .unwrap()
                .extend(edges);
            parent = Some(id);
            current = block.get("next");
        }
        Ok(first.unwrap())
    }
}

/// Apply only edits relative to the canonical baseline. Unrecognized native
/// properties and the distinction between absent/null/default remain intact.
fn apply_changes(target: &mut Value, before: &Value, after: &Value) {
    if before == after {
        return;
    }
    if let (Some(old), Some(new), Some(out)) = (
        before.as_object(),
        after.as_object(),
        target.as_object_mut(),
    ) {
        for key in old.keys() {
            if !new.contains_key(key) {
                out.remove(key);
            }
        }
        for (key, value) in new {
            if old.get(key) == Some(value) {
                continue;
            }
            match (old.get(key), out.get_mut(key)) {
                (Some(previous), Some(current)) => apply_changes(current, previous, value),
                _ => {
                    out.insert(key.clone(), value.clone());
                }
            }
        }
    } else {
        *target = after.clone();
    }
}
