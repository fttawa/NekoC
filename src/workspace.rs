use anyhow::{Result, bail};
use serde_json::{Map, Value, json};

pub fn build_report(value: &Value) -> Result<Value> {
    let Some(root) = value.as_object() else {
        bail!("project root must be a JSON object");
    };

    let mut owners = Vec::new();
    collect_owners(value, &["scenes", "scenesDict"], "scene", &mut owners);
    collect_owners(value, &["actors", "actorsDict"], "actor", &mut owners);

    let scripts = owners
        .iter()
        .map(|owner: &OwnerWorkspace| owner.script_count)
        .sum::<usize>();
    let blocks = owners
        .iter()
        .map(|owner: &OwnerWorkspace| owner.block_count)
        .sum::<usize>();
    let connections = owners
        .iter()
        .map(|owner: &OwnerWorkspace| owner.connection_count)
        .sum::<usize>();

    Ok(json!({
        "project_name": root.get("projectName").and_then(Value::as_str),
        "version": root.get("version").and_then(Value::as_str),
        "tool_type": root.get("toolType").and_then(Value::as_str),
        "summary": {
            "owners": owners.len(),
            "scripts": scripts,
            "blocks": blocks,
            "connections": connections,
        },
        "owners": owners.into_iter().map(OwnerWorkspace::into_json).collect::<Vec<_>>(),
    }))
}

fn collect_owners(value: &Value, path: &[&str], kind: &str, owners: &mut Vec<OwnerWorkspace>) {
    let Some(dict) = get_path(value, path).and_then(Value::as_object) else {
        return;
    };

    for (id, owner) in dict {
        let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) else {
            continue;
        };
        if blocks.is_empty() {
            continue;
        }

        let name = owner
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let workspace_data = flatten_blocks(blocks);
        let block_count = workspace_data
            .get("blocks")
            .and_then(Value::as_object)
            .map(Map::len)
            .unwrap_or_default();
        let connection_count = workspace_data
            .get("connections")
            .and_then(Value::as_object)
            .map(|connections| {
                connections
                    .values()
                    .filter_map(Value::as_object)
                    .map(Map::len)
                    .sum()
            })
            .unwrap_or_default();

        owners.push(OwnerWorkspace {
            kind: kind.to_owned(),
            id: id.to_owned(),
            name,
            script_count: blocks.len(),
            block_count,
            connection_count,
            workspace_data,
        });
    }
}

fn flatten_blocks(blocks: &[Value]) -> Value {
    let mut data = WorkspaceData::default();
    for block in blocks {
        flatten_block(block, None, &mut data);
    }
    json!({
        "blocks": data.blocks,
        "connections": data.connections,
        "comments": Map::<String, Value>::new(),
    })
}

fn flatten_block(
    block: &Value,
    parent_id: Option<&str>,
    data: &mut WorkspaceData,
) -> Option<String> {
    let mut pending = vec![(block, parent_id.map(str::to_owned), None)];
    let mut first = None;
    while let Some((block, parent_id, edge)) = pending.pop() {
        let Some(block_type) = block.get("type").and_then(Value::as_str) else {
            continue;
        };
        let id = block
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| generated_id(block_type, data.blocks.len()));
        let mut flat_block: Map<String, Value> = block
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(key, _)| !matches!(key.as_str(), "next" | "inputs" | "statements"))
            .map(|(key, value)| (key.clone(), crate::json::clone_value(value)))
            .collect();
        flat_block.insert("id".into(), json!(id));
        flat_block.insert("parent_id".into(), json!(parent_id));
        data.blocks.insert(id.clone(), Value::Object(flat_block));
        if first.is_none() {
            first = Some(id.clone());
        }
        if let (Some(parent), Some(edge)) = (parent_id, edge) {
            add_connection(data, &parent, &id, edge);
        }
        // Reverse pushes preserve the original next/inputs/statements DFS order
        // and therefore generated IDs for blocks that have no source ID.
        for (key, input_type) in [("statements", "statement"), ("inputs", "value")] {
            for (name, child) in block
                .get(key)
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.iter().rev())
            {
                pending.push((
                    child,
                    Some(id.clone()),
                    Some(json!({"type":"input","input_name":name,"input_type":input_type})),
                ));
            }
        }
        if let Some(next) = block.get("next") {
            pending.push((next, Some(id), Some(json!({"type":"next"}))));
        }
    }
    first
}

fn add_connection(data: &mut WorkspaceData, parent_id: &str, child_id: &str, connection: Value) {
    let parent = data
        .connections
        .entry(parent_id.to_owned())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(parent) = parent.as_object_mut() {
        parent.insert(child_id.to_owned(), connection);
    }
}

fn generated_id(block_type: &str, index: usize) -> String {
    format!("generated-{block_type}-{index}")
}

fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}

#[derive(Default)]
struct WorkspaceData {
    blocks: Map<String, Value>,
    connections: Map<String, Value>,
}

struct OwnerWorkspace {
    kind: String,
    id: String,
    name: String,
    script_count: usize,
    block_count: usize,
    connection_count: usize,
    workspace_data: Value,
}

impl OwnerWorkspace {
    fn into_json(self) -> Value {
        json!({
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "script_count": self.script_count,
            "block_count": self.block_count,
            "connection_count": self.connection_count,
            "workspaceData": self.workspace_data,
        })
    }
}
