use serde_json::{Map, Value, json};

pub fn build_report(workspace_report: &Value) -> Value {
    let resources = workspace_report
        .get("resources")
        .cloned()
        .unwrap_or_else(|| json!({"stage": null, "sprites": []}));

    let main_scripts = scripts_from_workspace(workspace_report.get("workspaceData"));
    let resource_sprites = resources
        .get("sprites")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut actors = Vec::new();
    if !main_scripts.is_empty() {
        actors.push(json!({
            "name": "main",
            "kind": "stage",
            "scripts": main_scripts,
        }));
    }

    for sprite in &resource_sprites {
        let name = sprite
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("sprite");
        actors.push(json!({
            "name": name,
            "kind": "sprite",
            "scripts": scripts_from_workspace(sprite.get("workspaceData")),
        }));
    }

    let script_count = actors
        .iter()
        .map(|actor| {
            actor
                .get("scripts")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        })
        .sum::<usize>();

    json!({
        "format": "nekoc-ir",
        "version": 1,
        "source": workspace_report.get("source").cloned().unwrap_or(Value::Null),
        "summary": {
            "scripts": script_count,
            "sprites": resource_sprites.len(),
            "procedures": workspace_report.pointer("/summary/procedures").cloned().unwrap_or(Value::Null),
        },
        "resources": resources,
        "actors": actors,
        "procedures": workspace_report.get("procedures").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
    })
}

fn scripts_from_workspace(workspace_data: Option<&Value>) -> Vec<Value> {
    let Some(workspace_data) = workspace_data else {
        return Vec::new();
    };
    let blocks = workspace_data
        .get("blocks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let connections = workspace_data
        .get("connections")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut roots = blocks
        .iter()
        .filter(|(_, block)| is_root_block(block))
        .map(|(id, block)| (id.clone(), block.clone()))
        .collect::<Vec<_>>();
    roots.sort_by(|left, right| left.0.cmp(&right.0));

    roots
        .into_iter()
        .map(|(id, block)| {
            let entry_type = block_type(&block).unwrap_or("unknown");
            let body = next_block_id(&id, &connections)
                .map(|next_id| statements_from_chain(next_id, &blocks, &connections))
                .unwrap_or_default();
            json!({
                "id": id,
                "event": event_name(entry_type),
                "entry_block_type": entry_type,
                "block_types": sequence_types(&block, &blocks, &connections),
                "body": body,
            })
        })
        .collect()
}

fn is_root_block(block: &Value) -> bool {
    block.get("parent_id").is_none_or(Value::is_null)
}

fn block_type(block: &Value) -> Option<&str> {
    block.get("type").and_then(Value::as_str)
}

fn event_name(block_type: &str) -> &str {
    match block_type {
        "on_running_group_activated" => "on_start",
        "self_listen" | "self_listen_with_param" => "on_broadcast",
        "sprite_on_tap" => "on_sprite_tap",
        _ => block_type,
    }
}

fn sequence_types(
    root: &Value,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
) -> Vec<String> {
    let mut types = Vec::new();
    let mut current = root;

    loop {
        if let Some(block_type) = block_type(current) {
            types.push(block_type.to_owned());
        }

        let Some(current_id) = current.get("id").and_then(Value::as_str) else {
            break;
        };
        let Some(next_id) = next_block_id(current_id, connections) else {
            break;
        };
        let Some(next_block) = blocks.get(next_id) else {
            break;
        };
        current = next_block;
    }

    types
}

fn next_block_id<'a>(id: &str, connections: &'a Map<String, Value>) -> Option<&'a str> {
    connections
        .get(id)?
        .as_object()?
        .iter()
        .find_map(|(child_id, connection)| {
            (connection.get("type").and_then(Value::as_str) == Some("next"))
                .then_some(child_id.as_str())
        })
}

fn statements_from_chain(
    start_id: &str,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
) -> Vec<Value> {
    let mut statements = Vec::new();
    let mut current_id = Some(start_id);

    while let Some(id) = current_id {
        let Some(block) = blocks.get(id) else {
            break;
        };
        statements.push(statement_from_block(id, block, blocks, connections));
        current_id = next_block_id(id, connections);
    }

    statements
}

fn statement_from_block(
    id: &str,
    block: &Value,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
) -> Value {
    match block_type(block).unwrap_or("unknown") {
        "variables_set" => json!({
            "kind": "set_var",
            "block_id": id,
            "variable": block.pointer("/fields/variable").cloned().unwrap_or(Value::Null),
            "value": input_expression(id, "value", blocks, connections),
        }),
        "change_variables" => json!({
            "kind": "change_var",
            "block_id": id,
            "variable": block.pointer("/fields/variable").cloned().unwrap_or(Value::Null),
            "method": block.pointer("/fields/method").cloned().unwrap_or(Value::Null),
            "value": input_expression(id, "value", blocks, connections),
        }),
        "wait" => json!({
            "kind": "wait",
            "block_id": id,
            "seconds": input_expression(id, "time", blocks, connections),
        }),
        "repeat_forever" => {
            let body = statement_input_id(id, "DO", connections)
                .map(|child_id| statements_from_chain(child_id, blocks, connections))
                .unwrap_or_default();
            json!({
                "kind": "forever",
                "block_id": id,
                "body": body,
            })
        }
        other => json!({
            "kind": "block",
            "block_id": id,
            "block_type": other,
        }),
    }
}

fn input_expression(
    id: &str,
    input_name: &str,
    blocks: &Map<String, Value>,
    connections: &Map<String, Value>,
) -> Value {
    let Some(child_id) = value_input_id(id, input_name, connections) else {
        return Value::Null;
    };
    let Some(block) = blocks.get(child_id) else {
        return Value::Null;
    };

    match block_type(block).unwrap_or("unknown") {
        "math_number" => {
            let value = block
                .pointer("/fields/NUM")
                .and_then(Value::as_str)
                .and_then(|number| number.parse::<f64>().ok())
                .unwrap_or(0.0);
            json!({
                "kind": "number",
                "value": value,
            })
        }
        "variables_get" => json!({
            "kind": "get_var",
            "variable": block.pointer("/fields/variable").cloned().unwrap_or(Value::Null),
        }),
        other => json!({
            "kind": "expression_block",
            "block_id": child_id,
            "block_type": other,
        }),
    }
}

fn value_input_id<'a>(
    id: &str,
    input_name: &str,
    connections: &'a Map<String, Value>,
) -> Option<&'a str> {
    input_id(id, input_name, "value", connections)
}

fn statement_input_id<'a>(
    id: &str,
    input_name: &str,
    connections: &'a Map<String, Value>,
) -> Option<&'a str> {
    input_id(id, input_name, "statement", connections)
}

fn input_id<'a>(
    id: &str,
    input_name: &str,
    input_type: &str,
    connections: &'a Map<String, Value>,
) -> Option<&'a str> {
    connections
        .get(id)?
        .as_object()?
        .iter()
        .find_map(|(child_id, connection)| {
            (connection.get("type").and_then(Value::as_str) == Some("input")
                && connection.get("input_name").and_then(Value::as_str) == Some(input_name)
                && connection.get("input_type").and_then(Value::as_str) == Some(input_type))
            .then_some(child_id.as_str())
        })
}
