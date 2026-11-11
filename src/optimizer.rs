use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

#[derive(Debug, Default, Clone, PartialEq)]
struct OptStats {
    constant_folded: usize,
    dead_removed: usize,
    simplified: usize,
}

// Workspace edges are keyed by child ID; there is no child_id field.
fn operand<'a>(connections: &'a Map<String, Value>, id: &str, input: &str) -> Option<&'a str> {
    connections
        .get(id)?
        .as_object()?
        .iter()
        .find_map(|(child, edge)| {
            (edge["type"] == "input" && edge["input_name"] == input).then_some(child.as_str())
        })
}

fn number(block: &Value) -> Option<f64> {
    if block["type"] != "math_number" {
        return None;
    }
    let value = &block["fields"]["NUM"];
    let number = value.as_f64().or_else(|| value.as_str()?.parse().ok())?;
    number.is_finite().then_some(number)
}

fn folded_value(op: &str, a: f64, b: f64) -> Option<f64> {
    let result = match op {
        "add" => a + b,
        "minus" | "subtract" => a - b,
        "multiply" => a * b,
        // Leave exceptional arithmetic to the target runtime. In particular,
        // neither NaN nor infinity can be serialized as a JSON number.
        "divide" if b != 0.0 => a / b,
        "mod" if b != 0.0 => a % b,
        "power" => a.powf(b),
        _ => return None,
    };
    result.is_finite().then_some(result)
}

fn numeric_reporter(block: &Value) -> bool {
    // Do not remove arithmetic coercion around mixed-value variables or
    // procedure calls: x * 1 is a number, but x may be text or a list.
    matches!(
        block["type"].as_str(),
        Some(
            "math_number"
                | "math_arithmetic"
                | "math_modulo"
                | "math_round"
                | "math_function"
                | "math_trig"
                | "math_arc_trig"
                | "math_trig_rad"
        )
    )
}

fn identity_operand<'a>(
    op: &str,
    a_id: &'a str,
    b_id: &'a str,
    blocks: &Map<String, Value>,
) -> Option<&'a str> {
    let a = blocks.get(a_id)?;
    let b = blocks.get(b_id)?;
    match op {
        "multiply" if number(a) == Some(1.0) && numeric_reporter(b) => Some(b_id),
        "multiply" | "divide" | "power" if number(b) == Some(1.0) && numeric_reporter(a) => {
            Some(a_id)
        }
        // x * 0 and x ** 0 must still evaluate x (side effects, errors, NaN).
        // x + 0 is not an identity for signed zero either.
        _ => None,
    }
}

fn optimize_workspace(data: &Value) -> (Value, OptStats) {
    let (Some(blocks), Some(connections)) = (
        data.get("blocks").and_then(Value::as_object),
        data.get("connections").and_then(Value::as_object),
    ) else {
        return (data.clone(), OptStats::default());
    };
    let mut blocks = blocks.clone();
    let mut connections = connections.clone();
    let mut stats = OptStats::default();

    // Preserve all statement roots, including new/unknown event hats and native
    // procedure definitions. Never maintain a lossy event-type allowlist.
    let roots: Vec<String> = blocks
        .iter()
        .filter(|(_, block)| {
            block["is_output"] != true
                && block
                    .get("parent_id")
                    .is_none_or(|parent| parent.is_null() || parent == "")
        })
        .map(|(id, _)| id.clone())
        .collect();

    loop {
        let mut changed = false;
        let ids: Vec<String> = blocks.keys().cloned().collect();
        for id in ids {
            if !blocks
                .get(&id)
                .is_some_and(|block| block["type"] == "math_arithmetic")
            {
                continue;
            }
            let (Some(a), Some(b)) = (
                operand(&connections, &id, "A"),
                operand(&connections, &id, "B"),
            ) else {
                continue;
            };
            let op = blocks[&id]["fields"]["type"].as_str().unwrap_or("");
            if let Some(result) = blocks
                .get(a)
                .and_then(number)
                .zip(blocks.get(b).and_then(number))
                .and_then(|(a, b)| folded_value(op, a, b))
            {
                let block = blocks.get_mut(&id).unwrap().as_object_mut().unwrap();
                block.insert("type".into(), json!("math_number"));
                block.insert("fields".into(), json!({"NUM":result.to_string()}));
                block.insert("is_output".into(), json!(true));
                for key in ["inputs", "statements", "shadows", "mutation"] {
                    block.remove(key);
                }
                connections.remove(&id);
                stats.constant_folded += 1;
                changed = true;
            } else if let Some(keep) = identity_operand(op, a, b, &blocks).map(str::to_owned) {
                // Keep the expression ID so incoming edges, source locations and
                // parent links remain stable. Adopt the retained operand's edges.
                let mut replacement = blocks[&keep].clone();
                replacement["id"] = json!(id);
                replacement["parent_id"] = blocks[&id]["parent_id"].clone();
                if let Some(location) = blocks[&id].get("location") {
                    replacement["location"] = location.clone();
                }
                let children = connections.remove(&keep);
                blocks.remove(&keep);
                stats.dead_removed += 1;
                connections.remove(&id);
                if let Some(children) = children {
                    for child in children
                        .as_object()
                        .into_iter()
                        .flat_map(|edges| edges.keys())
                    {
                        if let Some(block) = blocks.get_mut(child) {
                            block["parent_id"] = json!(id);
                        }
                    }
                    connections.insert(id.clone(), children);
                }
                blocks.insert(id, replacement);
                stats.simplified += 1;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    // Traverse from roots, rather than retaining every block with an incoming
    // edge (which also keeps disconnected chains and cycles alive).
    let mut reachable = BTreeSet::new();
    let mut pending = roots;
    while let Some(id) = pending.pop() {
        if !blocks.contains_key(&id) || !reachable.insert(id.clone()) {
            continue;
        }
        if let Some(edges) = connections.get(&id).and_then(Value::as_object) {
            pending.extend(edges.keys().cloned());
        }
    }
    stats.dead_removed += blocks.len() - reachable.len();
    blocks.retain(|id, _| reachable.contains(id));
    connections.retain(|id, _| reachable.contains(id));

    // Keep comments and adapter/extension metadata, not just the graph.
    let mut result = data.clone();
    result["blocks"] = json!(blocks);
    result["connections"] = json!(connections);
    (result, stats)
}

fn optimize_workspaces(value: &mut Value, total: &mut OptStats) {
    match value {
        Value::Object(object) => {
            if let Some(data) = object.get_mut("workspaceData") {
                let (optimized, stats) = optimize_workspace(data);
                *data = optimized;
                total.constant_folded += stats.constant_folded;
                total.dead_removed += stats.dead_removed;
                total.simplified += stats.simplified;
                let block_count = data["blocks"].as_object().map(Map::len);
                let connection_count = data["connections"].as_object().map(|edges| {
                    edges
                        .values()
                        .filter_map(Value::as_object)
                        .map(Map::len)
                        .sum::<usize>()
                });
                if let Some(summary) = object.get_mut("summary").and_then(Value::as_object_mut) {
                    if let Some(count) = block_count {
                        summary.insert("blocks".into(), json!(count));
                    }
                    if let Some(count) = connection_count {
                        summary.insert("connections".into(), json!(count));
                    }
                }
            }
            for (key, child) in object {
                if key != "workspaceData" {
                    optimize_workspaces(child, total);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                optimize_workspaces(item, total);
            }
        }
        _ => {}
    }
}

pub fn optimize_report(report: &Value) -> Value {
    let mut report = report.clone();
    let mut stats = OptStats::default();
    optimize_workspaces(&mut report, &mut stats);
    if let Some(object) = report.as_object_mut() {
        object.insert(
            "optimization".into(),
            json!({
                "constantFolded": stats.constant_folded,
                "deadRemoved": stats.dead_removed,
                "simplified": stats.simplified,
            }),
        );
    }
    report
}
