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
const MAX_DEPTH: usize = 256;

pub fn is_kitten4(value: &Value) -> bool {
    value.get("work_type").and_then(Value::as_str) == Some("KITTEN")
        && value.get("theatre").is_some_and(Value::is_object)
}

pub fn to_neko(value: &Value) -> Result<Value> {
    ensure!(is_kitten4(value), "not a native Kitten 4 project");
    let mut result = import_project(value)?;
    result[METADATA] = json!({"source": value});
    Ok(result)
}

pub fn from_neko(value: &Value) -> Result<Value> {
    ensure!(value.is_object(), "canonical project must be an object");
    let source = value.get(METADATA).and_then(|m| m.get("source"));
    if let Some(source) = source {
        ensure!(is_kitten4(source), "invalid _nekocKitten4.source");
        let baseline = import_project(source)?;
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
        source.get("version").and_then(Value::as_u64) == Some(25),
        "unsupported Kitten 4 project version {}; this adapter supports version 25",
        source["version"]
    );
    let theatre = source
        .get("theatre")
        .context("Kitten 4 theatre is missing")?;
    let scenes = import_owners(&theatre["scenes"], "scene")?;
    let actors = import_owners(&theatre["actors"], "actor")?;
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
        "procedures": {"proceduresDict": {}}
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

fn import_owners(value: &Value, kind: &str) -> Result<Map<String, Value>> {
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
            let scripts =
                import_workspace(&workspace).with_context(|| format!("Kitten 4 {kind} {id}"))?;
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
fn import_workspace(workspace: &Value) -> Result<Vec<Value>> {
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
    for id in blocks.keys() {
        visit(id, &connections, &mut state, 0)?;
    }
    let mut scripts: Vec<Value> = blocks
        .keys()
        .filter(|id| !parents.contains_key(id.as_str()))
        .map(|id| {
            let native = nest(id, blocks, &connections, 0)?;
            import_block(&native, 0)
        })
        .collect::<Result<_>>()?;
    // Conversion expressions are real editable KN blocks and need stable,
    // noncolliding IDs for workspace editors and subsequent graph export.
    let mut ids = Graph::new(Some(workspace));
    for block in &scripts {
        ids.reserve_ids(block, 0)?;
    }
    for block in &mut scripts {
        ids.assign_ids(block, 0)?;
        repair_parents(block, None);
    }
    Ok(scripts)
}

fn visit<'a>(
    id: &'a str,
    connections: &'a Map<String, Value>,
    state: &mut BTreeMap<&'a str, u8>,
    depth: usize,
) -> Result<()> {
    ensure!(
        depth <= MAX_DEPTH,
        "Kitten 4 block graph nesting exceeds {MAX_DEPTH}"
    );
    match state.get(id) {
        Some(1) => bail!("cycle in Kitten 4 block graph at {id}"),
        Some(2) => return Ok(()),
        _ => {}
    }
    state.insert(id, 1);
    if let Some(children) = connections.get(id).and_then(Value::as_object) {
        for child in children.keys() {
            visit(child, connections, state, depth + 1)?;
        }
    }
    state.insert(id, 2);
    Ok(())
}

fn nest(
    id: &str,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
    depth: usize,
) -> Result<Value> {
    ensure!(
        depth <= MAX_DEPTH,
        "Kitten 4 block nesting exceeds {MAX_DEPTH}"
    );
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
            let nested = nest(child, blocks, connections, depth + 1)?;
            if connection["type"] == "next" {
                result.insert("next".into(), nested);
            } else {
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
    Ok(Value::Object(result))
}

fn import_block(block: &Value, depth: usize) -> Result<Value> {
    ensure!(
        depth <= MAX_DEPTH,
        "Kitten 4 block nesting exceeds {MAX_DEPTH}"
    );
    let mut result = block.clone();
    for key in ["inputs", "statements"] {
        if let Some(children) = result.get_mut(key).and_then(Value::as_object_mut) {
            for child in children.values_mut() {
                *child = import_block(child, depth + 1)?;
            }
        }
    }
    if let Some(next) = result.get_mut("next") {
        *next = import_block(next, depth + 1)?;
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
    block["parent_id"] = json!(parent);
    let id = block["id"].as_str().unwrap_or("").to_owned();
    if let Some(next) = block.get_mut("next") {
        repair_parents(next, Some(&id));
    }
    for key in ["inputs", "statements"] {
        if let Some(children) = block.get_mut(key).and_then(Value::as_object_mut) {
            for child in children.values_mut() {
                repair_parents(child, Some(&id));
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
        | "clear_drawing" => {}
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
    export_block_mode(block, originals, depth, true)
}

fn export_block_mode(
    block: &Value,
    originals: Option<&Value>,
    depth: usize,
    convert_reporter: bool,
) -> Result<Value> {
    ensure!(
        depth <= MAX_DEPTH,
        "canonical block nesting exceeds {MAX_DEPTH}"
    );
    ensure!(block.is_object(), "canonical block must be an object");
    if let Some(reporter) = original_heading_reporter(block) {
        return export_block_mode(reporter, originals, depth + 1, false);
    }
    let mut result = block.clone();
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
    if let Some(next) = result.get_mut("next") {
        *next = export_block(next, originals, depth + 1)?;
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
        ensure!(
            depth <= MAX_DEPTH,
            "canonical block nesting exceeds {MAX_DEPTH}"
        );
        if let Some(id) = block["id"].as_str() {
            self.reserved.insert(id.to_owned());
        }
        if let Some(next) = block.get("next") {
            self.reserve_ids(next, depth + 1)?;
        }
        for key in ["inputs", "statements"] {
            if let Some(children) = block.get(key).and_then(Value::as_object) {
                for child in children.values() {
                    self.reserve_ids(child, depth + 1)?;
                }
            }
        }
        Ok(())
    }
    fn assign_ids(&mut self, block: &mut Value, depth: usize) -> Result<()> {
        ensure!(
            depth <= MAX_DEPTH,
            "canonical block nesting exceeds {MAX_DEPTH}"
        );
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
        if let Some(next) = block.get_mut("next") {
            self.assign_ids(next, depth + 1)?;
        }
        for key in ["inputs", "statements"] {
            if let Some(children) = block.get_mut(key).and_then(Value::as_object_mut) {
                for child in children.values_mut() {
                    self.assign_ids(child, depth + 1)?;
                }
            }
        }
        Ok(())
    }
    fn flatten(&mut self, block: &Value, parent: Option<&str>, depth: usize) -> Result<String> {
        ensure!(
            depth <= MAX_DEPTH,
            "canonical block nesting exceeds {MAX_DEPTH}"
        );
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
        let mut flat = block.clone();
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
        if let Some(next) = block.get("next") {
            let child = self.flatten(next, Some(&id), depth + 1)?;
            edges.insert(child, json!({"type":"next"}));
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
        self.connections.insert(id.clone(), Value::Object(edges));
        Ok(id)
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
