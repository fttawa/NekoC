use crate::{project, ts_frontend};
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

struct CompiledProcedure {
    id: String,
    name: String,
    proc_type: String,
    params: Vec<Value>,
    blocks: Vec<Value>,
}

struct CompiledSprite {
    name: String,
    costume: Option<String>,
    x: f64,
    y: f64,
    scale: f64,
    visible: bool,
    center_x: f64,
    center_y: f64,
    blocks: Vec<Value>,
}

pub fn compile_ts_bcmkn(
    input: impl AsRef<Path>,
    template: impl AsRef<Path>,
    output: impl AsRef<Path>,
) -> Result<()> {
    let input = input.as_ref();
    let template = template.as_ref();
    let output = output.as_ref();
    let workspace_path = temp_workspace_path(output);

    ts_frontend::compile_ts(input, &workspace_path)?;
    let workspace_report = read_json_file(&workspace_path)?;
    let workspace_data = workspace_report
        .get("workspaceData")
        .context("compiled TypeScript report is missing workspaceData")?;
    let mut scripts = workspace_data_to_neko_blocks(workspace_data)?;
    let mut procedures = compiled_procedures_from_report(&workspace_report)?;
    let mut sprites = compiled_sprites_from_report(&workspace_report)?;
    let has_registered_sprites = !sprites.is_empty();

    if let Some(first) = scripts.first_mut().and_then(Value::as_object_mut) {
        first.insert("location".to_owned(), json!([80, 120]));
    }

    let mut project = project::load_project(template)?.value;
    clear_all_scripts(&mut project);
    if has_registered_sprites {
        reset_template_for_registered_resources(&mut project)?;
    }
    ensure_variables(&mut project, &mut scripts);
    ensure_lists(&mut project, &mut scripts);
    ensure_broadcasts(&mut project, &scripts);
    for procedure in &mut procedures {
        ensure_variables(&mut project, &mut procedure.blocks);
        ensure_lists(&mut project, &mut procedure.blocks);
        ensure_broadcasts(&mut project, &procedure.blocks);
    }
    for sprite in &mut sprites {
        ensure_variables(&mut project, &mut sprite.blocks);
        ensure_lists(&mut project, &mut sprite.blocks);
        ensure_broadcasts(&mut project, &sprite.blocks);
    }
    apply_stage_resource(&mut project, workspace_report.pointer("/resources/stage"))?;
    if !scripts.is_empty() {
        inject_scripts_into_first_actor(&mut project, scripts)?;
    }
    inject_sprite_resources(&mut project, sprites)?;
    inject_procedures(&mut project, procedures);
    project["projectName"] = Value::String(project_name(input));

    let bytes = serde_json::to_vec(&project)?;
    std::fs::write(output, bytes)
        .with_context(|| format!("failed to write output {}", output.display()))?;
    project::load_project(output)?;

    let _ = std::fs::remove_file(workspace_path);
    Ok(())
}

fn compiled_procedures_from_report(report: &Value) -> Result<Vec<CompiledProcedure>> {
    let Some(procedures) = report.get("procedures").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };

    procedures
        .iter()
        .map(|procedure| {
            let id = procedure
                .get("id")
                .and_then(Value::as_str)
                .context("compiled procedure is missing id")?
                .to_owned();
            let name = procedure
                .get("name")
                .and_then(Value::as_str)
                .context("compiled procedure is missing name")?
                .to_owned();
            let proc_type = procedure
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("NORMAL")
                .to_owned();
            let params = procedure
                .get("params")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let workspace_data = procedure
                .get("workspaceData")
                .context("compiled procedure is missing workspaceData")?;
            let blocks = workspace_data_to_neko_blocks(workspace_data)?;

            Ok(CompiledProcedure {
                id,
                name,
                proc_type,
                params,
                blocks,
            })
        })
        .collect()
}

fn compiled_sprites_from_report(report: &Value) -> Result<Vec<CompiledSprite>> {
    let Some(sprites) = report
        .pointer("/resources/sprites")
        .and_then(Value::as_array)
    else {
        return Ok(Vec::new());
    };

    sprites
        .iter()
        .map(|sprite| {
            let name = sprite
                .get("name")
                .and_then(Value::as_str)
                .context("compiled sprite resource is missing name")?
                .to_owned();
            let costume = sprite
                .get("costume")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let workspace_data = sprite
                .get("workspaceData")
                .context("compiled sprite resource is missing workspaceData")?;
            let blocks = workspace_data_to_neko_blocks(workspace_data)?;

            Ok(CompiledSprite {
                name,
                costume,
                x: sprite.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                y: sprite.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                scale: sprite.get("scale").and_then(Value::as_f64).unwrap_or(100.0),
                visible: sprite
                    .get("visible")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                center_x: sprite.get("centerX").and_then(Value::as_f64).unwrap_or(0.0),
                center_y: sprite.get("centerY").and_then(Value::as_f64).unwrap_or(0.0),
                blocks,
            })
        })
        .collect()
}

pub fn workspace_data_to_neko_blocks(workspace_data: &Value) -> Result<Vec<Value>> {
    let blocks = workspace_data
        .get("blocks")
        .and_then(Value::as_object)
        .context("workspaceData.blocks must be an object")?;
    let connections = workspace_data
        .get("connections")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let child_ids = collect_child_ids(&connections);
    let mut roots = blocks
        .iter()
        .filter(|(id, block)| {
            let parent_is_empty = block
                .get("parent_id")
                .map(|value| value.is_null() || value.as_str() == Some(""))
                .unwrap_or(true);
            parent_is_empty && !child_ids.contains(id.as_str())
        })
        .map(|(id, _)| id.to_owned())
        .collect::<Vec<_>>();
    roots.sort();

    roots
        .iter()
        .map(|id| build_nested_block(id, blocks, &connections, None))
        .collect()
}

fn build_nested_block(
    id: &str,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
    expected_parent: Option<&str>,
) -> Result<Value> {
    let block = blocks
        .get(id)
        .with_context(|| format!("connection references missing block {id}"))?;
    let mut nested = block.as_object().cloned().unwrap_or_default();
    nested.remove("next");
    nested.remove("inputs");
    nested.remove("statements");
    nested.insert(
        "parent_id".to_owned(),
        expected_parent.map_or(Value::String(String::new()), |parent_id| {
            Value::String(parent_id.to_owned())
        }),
    );
    if nested.get("shield").is_none() {
        nested.insert("shield".to_owned(), Value::Bool(false));
    }

    let mut input_items = BTreeMap::new();
    let mut statement_items = BTreeMap::new();
    let mut next_id = None;

    if let Some(children) = connections.get(id).and_then(Value::as_object) {
        for (child_id, connection) in children {
            let Some(connection_type) = connection.get("type").and_then(Value::as_str) else {
                continue;
            };
            if connection_type == "next" {
                next_id = Some(child_id.to_owned());
                continue;
            }

            if connection_type == "input" {
                let input_name = connection
                    .get("input_name")
                    .and_then(Value::as_str)
                    .context("input connection is missing input_name")?
                    .to_owned();
                let input_type = connection
                    .get("input_type")
                    .and_then(Value::as_str)
                    .unwrap_or("value");
                let child = build_nested_block(child_id, blocks, connections, Some(id))?;
                if input_type == "statement" {
                    statement_items.insert(input_name, child);
                } else {
                    input_items.insert(input_name, child);
                }
            }
        }
    }

    if !input_items.is_empty() {
        nested.insert(
            "inputs".to_owned(),
            Value::Object(input_items.into_iter().collect()),
        );
    }
    if !statement_items.is_empty() {
        nested.insert(
            "statements".to_owned(),
            Value::Object(statement_items.into_iter().collect()),
        );
    }
    if let Some(next_id) = next_id {
        nested.insert(
            "next".to_owned(),
            build_nested_block(&next_id, blocks, connections, Some(id))?,
        );
    }

    Ok(Value::Object(nested))
}

fn collect_child_ids(connections: &Map<String, Value>) -> BTreeSet<String> {
    connections
        .values()
        .filter_map(Value::as_object)
        .flat_map(|children| children.keys().cloned())
        .collect()
}

fn clear_all_scripts(project: &mut Value) {
    clear_owner_scripts(project, &["scenes", "scenesDict"]);
    clear_owner_scripts(project, &["actors", "actorsDict"]);
    if let Some(procedures) =
        get_path_mut(project, &["procedures", "proceduresDict"]).and_then(Value::as_object_mut)
    {
        procedures.clear();
    }
}

fn clear_owner_scripts(project: &mut Value, path: &[&str]) {
    let Some(owners) = get_path_mut(project, path).and_then(Value::as_object_mut) else {
        return;
    };
    for owner in owners.values_mut() {
        owner["nekoBlockJsonList"] = Value::Array(Vec::new());
        owner["comments"] = Value::Object(Map::new());
    }
}

fn reset_template_for_registered_resources(project: &mut Value) -> Result<()> {
    let scene_id = current_scene_id(project).context("template project must contain a scene")?;

    ensure_actors_dict(project);
    ensure_styles_dict(project);
    project["actors"]["actorsDict"] = Value::Object(Map::new());
    project["styles"]["stylesDict"] = Value::Object(Map::new());
    project["variables"] = json!({"variablesDict": {}});
    project["broadcasts"] = json!({"broadcastsDict": {}});

    let scene = get_path_mut(project, &["scenes", "scenesDict", &scene_id])
        .context("current scene is missing")?;
    scene["actorIds"] = Value::Array(Vec::new());
    if scene
        .get("currentStyleId")
        .and_then(Value::as_str)
        .is_none()
    {
        scene["currentStyleId"] = Value::String("nekoc-stage-style-main".to_owned());
    }
    if !scene.get("styles").is_some_and(Value::is_array)
        || scene
            .get("styles")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    {
        let style_id = scene
            .get("currentStyleId")
            .and_then(Value::as_str)
            .unwrap_or("nekoc-stage-style-main")
            .to_owned();
        scene["styles"] = json!([style_id]);
    }

    Ok(())
}

fn inject_scripts_into_first_actor(project: &mut Value, scripts: Vec<Value>) -> Result<()> {
    let actors = get_path_mut(project, &["actors", "actorsDict"])
        .and_then(Value::as_object_mut)
        .context("template project must contain actors.actorsDict")?;
    let Some((_, actor)) = actors.iter_mut().next() else {
        bail!("template project must contain at least one actor");
    };
    actor["nekoBlockJsonList"] = Value::Array(scripts);
    Ok(())
}

fn apply_stage_resource(project: &mut Value, stage: Option<&Value>) -> Result<()> {
    let Some(stage) = stage.and_then(Value::as_object) else {
        return Ok(());
    };
    let name = stage.get("name").and_then(Value::as_str);
    let backdrop = stage.get("backdrop").and_then(Value::as_str);
    if name.is_none() && backdrop.is_none() {
        return Ok(());
    }

    let scene_id = current_scene_id(project).context("template project must contain a scene")?;
    let style_id = {
        let scenes = get_path_mut(project, &["scenes", "scenesDict"])
            .and_then(Value::as_object_mut)
            .context("template project must contain scenes.scenesDict")?;
        let scene = scenes
            .get_mut(&scene_id)
            .with_context(|| format!("current scene {scene_id} is missing"))?;
        if let Some(name) = name {
            scene["name"] = Value::String(name.to_owned());
            scene["screenName"] = Value::String(name.to_owned());
        }
        let style_id = scene
            .get("currentStyleId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                scene
                    .get("styles")
                    .and_then(Value::as_array)
                    .and_then(|styles| styles.first())
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| "nekoc-stage-style-main".to_owned());
        scene["currentStyleId"] = Value::String(style_id.clone());
        if !scene.get("styles").is_some_and(Value::is_array) {
            scene["styles"] = Value::Array(Vec::new());
        }
        if let Some(styles) = scene["styles"].as_array_mut()
            && !styles.iter().any(|id| id.as_str() == Some(&style_id))
        {
            styles.push(Value::String(style_id.clone()));
        }
        style_id
    };

    if let Some(backdrop) = backdrop {
        ensure_styles_dict(project);
        project["styles"]["stylesDict"][&style_id] = json!({
            "id": style_id,
            "name": name.unwrap_or("main"),
            "url": backdrop,
        });
    }

    Ok(())
}

fn inject_sprite_resources(project: &mut Value, sprites: Vec<CompiledSprite>) -> Result<()> {
    if sprites.is_empty() {
        return Ok(());
    }
    let scene_id = current_scene_id(project).context("template project must contain a scene")?;
    ensure_actors_dict(project);
    ensure_styles_dict(project);

    for sprite in sprites {
        let id_part = sanitize_id_part(&sprite.name);
        let actor_id = format!("nekoc-actor-{id_part}");
        let style_id = format!("nekoc-style-{id_part}");

        project["styles"]["stylesDict"][&style_id] = json!({
            "id": style_id,
            "url": sprite.costume.unwrap_or_default(),
            "name": sprite.name,
            "centerPoint": {"x": sprite.center_x, "y": sprite.center_y},
        });
        project["actors"]["actorsDict"][&actor_id] = json!({
            "id": actor_id,
            "position": {"x": sprite.x, "y": sprite.y},
            "scale": sprite.scale,
            "locked": false,
            "rotation": 0,
            "nekoBlockJsonList": sprite.blocks,
            "visible": sprite.visible,
            "workspaceScrollXy": {"x": 0, "y": 30},
            "deletable": true,
            "editable": true,
            "name": sprite.name,
            "styles": [style_id],
            "currentStyleId": style_id,
            "comments": {},
        });

        let scene = get_path_mut(project, &["scenes", "scenesDict", &scene_id])
            .context("current scene is missing")?;
        if !scene.get("actorIds").is_some_and(Value::is_array) {
            scene["actorIds"] = Value::Array(Vec::new());
        }
        if let Some(actor_ids) = scene["actorIds"].as_array_mut()
            && !actor_ids.iter().any(|id| id.as_str() == Some(&actor_id))
        {
            actor_ids.push(Value::String(actor_id));
        }
    }

    Ok(())
}

fn inject_procedures(project: &mut Value, procedures: Vec<CompiledProcedure>) {
    if project.get("procedures").is_none() {
        project["procedures"] = json!({"proceduresDict": {}});
    }
    if project["procedures"].get("proceduresDict").is_none() {
        project["procedures"]["proceduresDict"] = Value::Object(Map::new());
    }

    let Some(dict) = project["procedures"]["proceduresDict"].as_object_mut() else {
        return;
    };

    for procedure in procedures {
        dict.insert(
            procedure.id.clone(),
            json!({
                "id": procedure.id,
                "name": procedure.name,
                "type": procedure.proc_type,
                "params": procedure.params,
                "nekoBlockJsonList": procedure.blocks,
                "workspaceScrollXy": {"x": 100, "y": 50},
                "comments": {},
            }),
        );
    }
}

fn ensure_variables(project: &mut Value, scripts: &mut [Value]) {
    let existing = collect_existing_variables(project);
    let referenced = collect_referenced_variable_names(scripts);
    let mut mapping = existing;

    for name in referenced {
        mapping.entry(name.clone()).or_insert_with(|| {
            let id = format!("kn-var-{}", sanitize_id_part(&name));
            insert_variable(project, &id, &name);
            id
        });
    }

    rewrite_variable_fields(scripts, &mapping);
}

fn ensure_lists(project: &mut Value, scripts: &mut [Value]) {
    let existing = collect_existing_lists(project);
    let referenced = collect_referenced_list_names(scripts);
    let mut mapping = existing;

    for name in referenced {
        mapping.entry(name.clone()).or_insert_with(|| {
            let id = format!("kn-list-{}", sanitize_id_part(&name));
            insert_list(project, &id, &name);
            id
        });
    }

    rewrite_list_fields(scripts, &mapping);
}

fn ensure_broadcasts(project: &mut Value, scripts: &[Value]) {
    let messages = collect_broadcast_messages(scripts);
    if messages.is_empty() {
        return;
    }

    if project.get("broadcasts").is_none() {
        project["broadcasts"] = json!({"broadcastsDict": {}});
    }
    if project["broadcasts"].get("broadcastsDict").is_none() {
        project["broadcasts"]["broadcastsDict"] = Value::Object(Map::new());
    }

    let Some(dict) = project["broadcasts"]["broadcastsDict"].as_object_mut() else {
        return;
    };

    if dict.is_empty() {
        dict.insert("toJSON".to_owned(), Value::Array(Vec::new()));
    }

    for values in dict.values_mut() {
        if !values.is_array() {
            *values = Value::Array(Vec::new());
        }
        let Some(values) = values.as_array_mut() else {
            continue;
        };
        for message in &messages {
            if !values.iter().any(|value| value.as_str() == Some(message)) {
                values.push(Value::String(message.to_owned()));
            }
        }
    }
}

fn collect_broadcast_messages(blocks: &[Value]) -> BTreeSet<String> {
    let mut messages = BTreeSet::new();
    for block in blocks {
        collect_broadcast_messages_in_value(block, &mut messages);
    }
    messages
}

fn collect_broadcast_messages_in_value(value: &Value, messages: &mut BTreeSet<String>) {
    if value.get("type").and_then(Value::as_str) == Some("broadcast_input")
        && let Some(message) = value
            .get("fields")
            .and_then(|fields| fields.get("message"))
            .and_then(Value::as_str)
    {
        messages.insert(message.to_owned());
    }

    if let Some(next) = value.get("next") {
        collect_broadcast_messages_in_value(next, messages);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get(container).and_then(Value::as_object) {
            for child in items.values() {
                collect_broadcast_messages_in_value(child, messages);
            }
        }
    }
}

fn collect_existing_variables(project: &Value) -> BTreeMap<String, String> {
    let Some(variables) = project
        .get("variables")
        .and_then(|value| value.get("variablesDict"))
        .and_then(Value::as_object)
    else {
        return BTreeMap::new();
    };

    variables
        .iter()
        .filter_map(|(id, variable)| {
            variable
                .get("name")
                .and_then(Value::as_str)
                .map(|name| (name.to_owned(), id.to_owned()))
        })
        .collect()
}

fn collect_referenced_variable_names(blocks: &[Value]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for block in blocks {
        collect_referenced_variable_names_in_value(block, &mut names);
    }
    names
}

fn collect_referenced_variable_names_in_value(value: &Value, names: &mut BTreeSet<String>) {
    if let Some(variable) = value
        .get("fields")
        .and_then(|fields| fields.get("variable"))
        .and_then(Value::as_str)
        && !looks_like_generated_id(variable)
    {
        names.insert(variable.to_owned());
    }

    if let Some(next) = value.get("next") {
        collect_referenced_variable_names_in_value(next, names);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get(container).and_then(Value::as_object) {
            for child in items.values() {
                collect_referenced_variable_names_in_value(child, names);
            }
        }
    }
}

fn insert_variable(project: &mut Value, id: &str, name: &str) {
    if project.get("variables").is_none() {
        project["variables"] = json!({"variablesDict": {}});
    }
    if project["variables"].get("variablesDict").is_none() {
        project["variables"]["variablesDict"] = Value::Object(Map::new());
    }

    project["variables"]["variablesDict"][id] = json!({
        "id": id,
        "type": "any",
        "name": name,
        "value": 0,
        "style": "default",
        "scale": 1,
        "visible": false,
        "position": {"x": 20, "y": 20},
        "isGlobal": true,
        "createTime": 0,
    });
}

fn collect_existing_lists(project: &Value) -> BTreeMap<String, String> {
    let Some(variables) = project
        .get("variables")
        .and_then(|value| value.get("variablesDict"))
        .and_then(Value::as_object)
    else {
        return BTreeMap::new();
    };

    variables
        .iter()
        .filter_map(|(id, variable)| {
            let is_list = variable.get("type").and_then(Value::as_str) == Some("list");
            let name = variable.get("name").and_then(Value::as_str)?;
            is_list.then(|| (name.to_owned(), id.to_owned()))
        })
        .collect()
}

fn collect_referenced_list_names(blocks: &[Value]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for block in blocks {
        collect_referenced_list_names_in_value(block, &mut names);
    }
    names
}

fn collect_referenced_list_names_in_value(value: &Value, names: &mut BTreeSet<String>) {
    if let Some(list) = value
        .get("fields")
        .and_then(|fields| fields.get("list"))
        .and_then(Value::as_str)
        && !looks_like_list_id(list)
    {
        names.insert(list.to_owned());
    }

    if let Some(next) = value.get("next") {
        collect_referenced_list_names_in_value(next, names);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get(container).and_then(Value::as_object) {
            for child in items.values() {
                collect_referenced_list_names_in_value(child, names);
            }
        }
    }
}

fn insert_list(project: &mut Value, id: &str, name: &str) {
    if project.get("variables").is_none() {
        project["variables"] = json!({"variablesDict": {}});
    }
    if project["variables"].get("variablesDict").is_none() {
        project["variables"]["variablesDict"] = Value::Object(Map::new());
    }

    project["variables"]["variablesDict"][id] = json!({
        "id": id,
        "type": "list",
        "name": name,
        "value": [],
        "style": "default",
        "scale": 1,
        "visible": false,
        "position": {"x": 180, "y": 70},
        "isGlobal": true,
        "createTime": 0,
    });
}

fn ensure_actors_dict(project: &mut Value) {
    if project.get("actors").is_none() {
        project["actors"] = json!({"actorsDict": {}});
    }
    if project["actors"].get("actorsDict").is_none() {
        project["actors"]["actorsDict"] = Value::Object(Map::new());
    }
}

fn ensure_styles_dict(project: &mut Value) {
    if project.get("styles").is_none() {
        project["styles"] = json!({"stylesDict": {}});
    }
    if project["styles"].get("stylesDict").is_none() {
        project["styles"]["stylesDict"] = Value::Object(Map::new());
    }
}

fn current_scene_id(project: &Value) -> Option<String> {
    project
        .get("scenes")
        .and_then(|scenes| scenes.get("currentSceneId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            project
                .get("scenes")
                .and_then(|scenes| scenes.get("scenesDict"))
                .and_then(Value::as_object)
                .and_then(|scenes| scenes.keys().next())
                .map(ToOwned::to_owned)
        })
}

fn rewrite_variable_fields(blocks: &mut [Value], mapping: &BTreeMap<String, String>) {
    for block in blocks {
        rewrite_variable_fields_in_value(block, mapping);
    }
}

fn rewrite_list_fields(blocks: &mut [Value], mapping: &BTreeMap<String, String>) {
    for block in blocks {
        rewrite_list_fields_in_value(block, mapping);
    }
}

fn rewrite_list_fields_in_value(value: &mut Value, mapping: &BTreeMap<String, String>) {
    if let Some(list) = value
        .get_mut("fields")
        .and_then(|fields| fields.get_mut("list"))
        && let Some(name) = list.as_str()
        && let Some(id) = mapping.get(name)
    {
        *list = Value::String(id.to_owned());
    }

    if let Some(next) = value.get_mut("next") {
        rewrite_list_fields_in_value(next, mapping);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get_mut(container).and_then(Value::as_object_mut) {
            for child in items.values_mut() {
                rewrite_list_fields_in_value(child, mapping);
            }
        }
    }
}

fn rewrite_variable_fields_in_value(value: &mut Value, mapping: &BTreeMap<String, String>) {
    if let Some(variable) = value
        .get_mut("fields")
        .and_then(|fields| fields.get_mut("variable"))
        && let Some(name) = variable.as_str()
        && let Some(id) = mapping.get(name)
    {
        *variable = Value::String(id.to_owned());
    }

    if let Some(next) = value.get_mut("next") {
        rewrite_variable_fields_in_value(next, mapping);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get_mut(container).and_then(Value::as_object_mut) {
            for child in items.values_mut() {
                rewrite_variable_fields_in_value(child, mapping);
            }
        }
    }
}

fn looks_like_generated_id(value: &str) -> bool {
    value.starts_with("kn-var-") || value.matches('-').count() >= 4
}

fn looks_like_list_id(value: &str) -> bool {
    value.starts_with("kn-list-") || value.matches('-').count() >= 4
}

fn sanitize_id_part(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "variable".to_owned()
    } else {
        sanitized
    }
}

fn get_path_mut<'a>(mut value: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    for segment in path {
        value = value.get_mut(*segment)?;
    }
    Some(value)
}

fn read_json_file(path: &Path) -> Result<Value> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read JSON file {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("invalid JSON in {}", path.display()))
}

fn temp_workspace_path(output: &Path) -> PathBuf {
    let mut path = output.to_owned();
    path.set_extension("workspace.tmp.json");
    path
}

fn project_name(input: &Path) -> String {
    input
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("compiled")
        .to_owned()
}
