use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn build_report(value: &Value) -> Result<Value> {
    let Some(root) = value.as_object() else {
        bail!("project root must be a JSON object");
    };

    let mut owners = Vec::new();
    collect_owners(value, &["scenes", "scenesDict"], "scene", &mut owners);
    collect_owners(value, &["actors", "actorsDict"], "actor", &mut owners);

    let scripts = owners
        .iter()
        .map(|owner: &OwnerReport| owner.scripts.len())
        .sum::<usize>();
    let blocks = owners
        .iter()
        .flat_map(|owner| &owner.scripts)
        .map(|script| script.blocks.len())
        .sum::<usize>();

    Ok(json!({
        "project_name": root.get("projectName").and_then(Value::as_str),
        "version": root.get("version").and_then(Value::as_str),
        "tool_type": root.get("toolType").and_then(Value::as_str),
        "summary": {
            "owners": owners.len(),
            "scripts": scripts,
            "blocks": blocks,
        },
        "owners": owners.into_iter().map(OwnerReport::into_json).collect::<Vec<_>>(),
    }))
}

fn collect_owners(value: &Value, path: &[&str], kind: &str, owners: &mut Vec<OwnerReport>) {
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
        let scripts = blocks
            .iter()
            .enumerate()
            .map(|(index, block)| ScriptReport::from_block(index, block))
            .collect::<Vec<_>>();

        owners.push(OwnerReport {
            kind: kind.to_owned(),
            id: id.to_owned(),
            name,
            scripts,
        });
    }
}

fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}

struct OwnerReport {
    kind: String,
    id: String,
    name: String,
    scripts: Vec<ScriptReport>,
}

impl OwnerReport {
    fn into_json(self) -> Value {
        json!({
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "scripts": self.scripts.into_iter().map(ScriptReport::into_json).collect::<Vec<_>>(),
        })
    }
}

struct ScriptReport {
    index: usize,
    entry_id: Option<String>,
    entry_type: Option<String>,
    location: Value,
    sequence_types: Vec<String>,
    blocks: Vec<BlockReport>,
}

impl ScriptReport {
    fn from_block(index: usize, block: &Value) -> Self {
        let mut blocks = Vec::new();
        collect_blocks(block, "$", 0, &mut blocks);

        Self {
            index,
            entry_id: block
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            entry_type: block
                .get("type")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            location: block.get("location").cloned().unwrap_or(Value::Null),
            sequence_types: collect_sequence_types(block),
            blocks,
        }
    }

    fn into_json(self) -> Value {
        json!({
            "index": self.index,
            "entry_id": self.entry_id,
            "entry_type": self.entry_type,
            "location": self.location,
            "sequence_types": self.sequence_types,
            "blocks": self.blocks.into_iter().map(BlockReport::into_json).collect::<Vec<_>>(),
        })
    }
}

struct BlockReport {
    path: String,
    depth: usize,
    id: Option<String>,
    block_type: Option<String>,
    is_output: bool,
    shield: Option<bool>,
    fields: BTreeMap<String, Value>,
    input_names: Vec<String>,
    statement_names: Vec<String>,
    has_next: bool,
}

impl BlockReport {
    fn from_value(path: String, depth: usize, value: &Value) -> Self {
        Self {
            path,
            depth,
            id: value
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            block_type: value
                .get("type")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            is_output: value
                .get("is_output")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            shield: value.get("shield").and_then(Value::as_bool),
            fields: value
                .get("fields")
                .and_then(Value::as_object)
                .map(|fields| {
                    fields
                        .iter()
                        .map(|(key, value)| (key.to_owned(), value.clone()))
                        .collect()
                })
                .unwrap_or_default(),
            input_names: object_keys(value.get("inputs")),
            statement_names: object_keys(value.get("statements")),
            has_next: value.get("next").is_some(),
        }
    }

    fn into_json(self) -> Value {
        json!({
            "path": self.path,
            "depth": self.depth,
            "id": self.id,
            "type": self.block_type,
            "is_output": self.is_output,
            "shield": self.shield,
            "fields": self.fields,
            "input_names": self.input_names,
            "statement_names": self.statement_names,
            "has_next": self.has_next,
        })
    }
}

fn collect_blocks(value: &Value, path: &str, depth: usize, blocks: &mut Vec<BlockReport>) {
    if !is_block(value) {
        return;
    }

    blocks.push(BlockReport::from_value(path.to_owned(), depth, value));

    if let Some(next) = value.get("next") {
        collect_blocks(next, &format!("{path}.next"), depth, blocks);
    }
    if let Some(inputs) = value.get("inputs").and_then(Value::as_object) {
        for (name, input) in inputs {
            collect_blocks(input, &format!("{path}.inputs.{name}"), depth + 1, blocks);
        }
    }
    if let Some(statements) = value.get("statements").and_then(Value::as_object) {
        for (name, statement) in statements {
            collect_blocks(
                statement,
                &format!("{path}.statements.{name}"),
                depth + 1,
                blocks,
            );
        }
    }
}

fn collect_sequence_types(mut value: &Value) -> Vec<String> {
    let mut types = Vec::new();
    loop {
        if let Some(block_type) = value.get("type").and_then(Value::as_str) {
            types.push(block_type.to_owned());
        }
        let Some(next) = value.get("next") else {
            break;
        };
        value = next;
    }
    types
}

fn is_block(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str).is_some()
}

fn object_keys(value: Option<&Value>) -> Vec<String> {
    let Some(map) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    map.keys().cloned().collect()
}
