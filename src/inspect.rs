use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn build_report(value: &Value, byte_len: usize) -> Result<Value> {
    let Some(root) = value.as_object() else {
        bail!("project root must be a JSON object");
    };

    let top_level_keys = root.keys().cloned().collect::<Vec<_>>();
    let block_summary = summarize_blocks(value);

    Ok(json!({
        "project_name": root.get("projectName").and_then(Value::as_str),
        "version": root.get("version").and_then(Value::as_str),
        "tool_type": root.get("toolType").and_then(Value::as_str),
        "byte_len": byte_len,
        "stage_size": root.get("stageSize").cloned().unwrap_or(Value::Null),
        "counts": {
            "scenes": dict_count(value, &["scenes", "scenesDict"]),
            "actors": dict_count(value, &["actors", "actorsDict"]),
            "styles": dict_count(value, &["styles", "stylesDict"]),
            "variables": dict_count(value, &["variables", "variablesDict"]),
            "broadcasts": dict_count(value, &["broadcasts", "broadcastsDict"]),
            "audios": dict_count(value, &["audios", "audiosDict"]),
            "procedures": dict_count(value, &["procedures", "proceduresDict"]),
        },
        "blocks": {
            "owners": block_summary.owners,
            "total_top_level_items": block_summary.total_top_level_items,
            "top_type_frequencies": block_summary.top_type_frequencies,
        },
        "top_level_keys": top_level_keys,
    }))
}

fn dict_count(value: &Value, path: &[&str]) -> usize {
    get_path(value, path)
        .and_then(Value::as_object)
        .map_or(0, serde_json::Map::len)
}

fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}

struct BlockSummary {
    owners: usize,
    total_top_level_items: usize,
    top_type_frequencies: Vec<Value>,
}

fn summarize_blocks(value: &Value) -> BlockSummary {
    let mut owners = 0;
    let mut total_top_level_items = 0;
    let mut frequencies = BTreeMap::<String, usize>::new();

    walk_block_lists(value, &mut |blocks| {
        owners += 1;
        total_top_level_items += blocks.len();
        for block in blocks {
            if let Some(block_type) = block.get("type").and_then(Value::as_str) {
                *frequencies.entry(block_type.to_owned()).or_default() += 1;
            }
        }
    });

    let mut top_type_frequencies = frequencies.into_iter().collect::<Vec<_>>();
    top_type_frequencies.sort_by(|(left_type, left_count), (right_type, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_type.cmp(right_type))
    });

    BlockSummary {
        owners,
        total_top_level_items,
        top_type_frequencies: top_type_frequencies
            .into_iter()
            .take(30)
            .map(|(block_type, count)| json!({ "type": block_type, "count": count }))
            .collect(),
    }
}

fn walk_block_lists<F>(value: &Value, on_blocks: &mut F)
where
    F: FnMut(&Vec<Value>),
{
    match value {
        Value::Object(map) => {
            if let Some(Value::Array(blocks)) = map.get("nekoBlockJsonList") {
                on_blocks(blocks);
            }
            for child in map.values() {
                walk_block_lists(child, on_blocks);
            }
        }
        Value::Array(items) => {
            for child in items {
                walk_block_lists(child, on_blocks);
            }
        }
        _ => {}
    }
}
