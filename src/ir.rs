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
            json!({
                "id": id,
                "event": event_name(entry_type),
                "entry_block_type": entry_type,
                "block_types": sequence_types(&block, &blocks, &connections),
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
