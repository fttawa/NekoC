use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq)]
struct OptStats {
    constant_folded: usize,
    dead_removed: usize,
    simplified: usize,
}

fn optimize_workspace(data: &Value) -> (Value, OptStats) {
    let Some(blocks) = data.get("blocks").and_then(Value::as_object) else {
        return (
            data.clone(),
            OptStats {
                constant_folded: 0,
                dead_removed: 0,
                simplified: 0,
            },
        );
    };
    let Some(connections) = data.get("connections").and_then(Value::as_object) else {
        return (
            data.clone(),
            OptStats {
                constant_folded: 0,
                dead_removed: 0,
                simplified: 0,
            },
        );
    };

    let mut blocks: Map<String, Value> = blocks.clone();
    let mut connections: Map<String, Value> = connections.clone();
    let mut stats = OptStats {
        constant_folded: 0,
        dead_removed: 0,
        simplified: 0,
    };

    // Phase 1: Constant folding
    loop {
        let mut changed = false;
        let folded_ids: Vec<(String, String, String, f64)> = blocks
            .iter()
            .filter(|(_, b)| b.get("type").and_then(Value::as_str) == Some("math_arithmetic"))
            .filter_map(|(id, _)| {
                let conns = connections.get(id).and_then(Value::as_object)?;
                let a_conn = conns.values().find(|c| {
                    c.get("input_name").and_then(Value::as_str) == Some("A")
                        && c.get("type").and_then(Value::as_str) == Some("input")
                })?;
                let b_conn = conns.values().find(|c| {
                    c.get("input_name").and_then(Value::as_str) == Some("B")
                        && c.get("type").and_then(Value::as_str) == Some("input")
                })?;
                let a_id = a_conn.get("child_id").and_then(Value::as_str)?;
                let b_id = b_conn.get("child_id").and_then(Value::as_str)?;
                let a_block = blocks.get(a_id)?;
                let b_block = blocks.get(b_id)?;
                if a_block.get("type").and_then(Value::as_str) != Some("math_number") {
                    return None;
                }
                if b_block.get("type").and_then(Value::as_str) != Some("math_number") {
                    return None;
                }
                let a_val = a_block
                    .get("fields")
                    .and_then(|f| f.get("NUM"))
                    .and_then(Value::as_str)?
                    .parse::<f64>()
                    .ok()?;
                let b_val = b_block
                    .get("fields")
                    .and_then(|f| f.get("NUM"))
                    .and_then(Value::as_str)?
                    .parse::<f64>()
                    .ok()?;
                let op = blocks
                    .get(id)?
                    .get("fields")
                    .and_then(|f| f.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("add");
                let result = match op {
                    "minus" | "subtract" => a_val - b_val,
                    "multiply" => a_val * b_val,
                    "divide" => {
                        if b_val == 0.0 {
                            0.0
                        } else {
                            a_val / b_val
                        }
                    }
                    "mod" => a_val % b_val,
                    "power" => a_val.powf(b_val),
                    _ => a_val + b_val,
                };
                Some((id.clone(), a_id.to_owned(), b_id.to_owned(), result))
            })
            .collect();

        for (id, a_id, b_id, result) in folded_ids {
            let result_str = if result.fract() == 0.0 && result.abs() < 1e15 {
                format!("{}", result as i64)
            } else {
                result.to_string()
            };
            if let Some(block) = blocks.get_mut(&id) {
                block
                    .as_object_mut()
                    .unwrap()
                    .insert("type".to_owned(), Value::String("math_number".to_owned()));
                block
                    .as_object_mut()
                    .unwrap()
                    .insert("fields".to_owned(), json!({ "NUM": result_str }));
                block.as_object_mut().unwrap().remove("inputs");
                block.as_object_mut().unwrap().remove("statements");
                block
                    .as_object_mut()
                    .unwrap()
                    .insert("is_output".to_owned(), Value::Bool(true));
            }
            // Remove connections to folded children
            connections.remove(&a_id);
            connections.remove(&b_id);
            if let Some(conns) = connections.get_mut(&id)
                && let Some(obj) = conns.as_object_mut()
            {
                obj.retain(|_, c| {
                    let child = c.get("child_id").and_then(Value::as_str).unwrap_or("");
                    child != a_id && child != b_id
                });
            }
            blocks.remove(&a_id);
            blocks.remove(&b_id);
            stats.constant_folded += 1;
            changed = true;
        }

        if !changed {
            break;
        }
    }

    // Phase 2: Dead code elimination
    let mut referenced = std::collections::HashSet::new();
    for conns in connections.values() {
        if let Some(obj) = conns.as_object() {
            for c in obj.values() {
                if let Some(child_id) = c.get("child_id").and_then(Value::as_str) {
                    referenced.insert(child_id.to_owned());
                }
            }
        }
    }

    // Also mark script entry points as referenced
    let script_types = [
        "on_running_group_activated",
        "start_on_click",
        "on_keydown",
        "self_listen",
        "self_listen_with_param",
        "start_as_clone",
        "on_custom_procedure",
    ];
    let script_ids: Vec<String> = blocks
        .iter()
        .filter(|(_, b)| {
            script_types.contains(&b.get("type").and_then(Value::as_str).unwrap_or(""))
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in &script_ids {
        referenced.insert(id.clone());
    }

    // Also mark variables_get, traverse_number_value, etc. as referenced
    // since they may be used by the parent through the connection
    let keep_types = [
        "variables_get",
        "traverse_number_value",
        "script_variables_value",
        "self_listen_value",
        "procedures_2_parameter",
        "procedures_2_actor_param",
        "math_number",
        "text",
        "logic_boolean",
        "get_answer",
        "get_choice_and_index",
        "broadcast_input",
        "timer",
        "get_time",
        "get_stage_info",
        "check_key",
        "mouse_down",
        "get_mouse_info",
        "distance_to",
        "coordinate_of_sprite",
        "style_of_sprite",
        "appearance_of_sprite",
        "effect_of_sprite",
        "bump_into",
        "out_of_boundary",
        "get_clone_num",
        "get_current_clone_index",
        "get_clone_index_property",
        "list_length",
        "list_index_of",
        "list_is_exist",
        "data_itemoflist",
        "data_itemnumoflist",
        "temporary_list",
        "text_join",
        "text_length",
        "text_contain",
        "text_split",
        "text_select",
        "logic_compare",
        "logic_operation",
        "logic_negate",
        "convert_type",
        "math_arithmetic",
        "math_modulo",
        "random_num",
        "divisible_by",
        "math_round",
        "math_function",
        "math_number_property",
        "math_trig",
    ];
    for (id, b) in &blocks {
        if keep_types.contains(&b.get("type").and_then(Value::as_str).unwrap_or("")) {
            referenced.insert(id.clone());
        }
    }

    let dead_ids: Vec<String> = blocks
        .keys()
        .filter(|id| !referenced.contains(*id))
        .cloned()
        .collect();

    for id in &dead_ids {
        blocks.remove(id);
        connections.remove(id);
        // Remove connections pointing to dead blocks
        for conns in connections.values_mut() {
            if let Some(obj) = conns.as_object_mut() {
                obj.retain(|_, c| c.get("child_id").and_then(Value::as_str).unwrap_or("") != *id);
            }
        }
        stats.dead_removed += 1;
    }

    // Phase 3: Expression simplification
    let simplify_ids: Vec<(String, String)> = blocks
        .iter()
        .filter_map(|(id, b)| {
            if b.get("type").and_then(Value::as_str) != Some("math_arithmetic") {
                return None;
            }
            let conns = connections.get(id).and_then(Value::as_object)?;
            let a_conn = conns.values().find(|c| {
                c.get("input_name").and_then(Value::as_str) == Some("A")
                    && c.get("type").and_then(Value::as_str) == Some("input")
            })?;
            let b_conn = conns.values().find(|c| {
                c.get("input_name").and_then(Value::as_str) == Some("B")
                    && c.get("type").and_then(Value::as_str) == Some("input")
            })?;
            let a_id = a_conn.get("child_id").and_then(Value::as_str)?;
            let b_id = b_conn.get("child_id").and_then(Value::as_str)?;
            let a_block = blocks.get(a_id)?;
            let b_block = blocks.get(b_id)?;
            let op = b
                .get("fields")
                .and_then(|f| f.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("add");

            // x + 0 → x, 0 + x → x
            if op == "add" {
                if is_zero(a_block) {
                    return Some((id.clone(), b_id.to_owned()));
                }
                if is_zero(b_block) {
                    return Some((id.clone(), a_id.to_owned()));
                }
            }
            // x * 1 → x, 1 * x → x
            if op == "multiply" {
                if is_one(a_block) {
                    return Some((id.clone(), b_id.to_owned()));
                }
                if is_one(b_block) {
                    return Some((id.clone(), a_id.to_owned()));
                }
                // x * 0 → 0, 0 * x → 0
                if is_zero(a_block) || is_zero(b_block) {
                    return Some((id.clone(), a_id.to_owned()));
                }
            }
            // x - 0 → x
            if (op == "minus" || op == "subtract") && is_zero(b_block) {
                return Some((id.clone(), a_id.to_owned()));
            }
            // x / 1 → x
            if op == "divide" && is_one(b_block) {
                return Some((id.clone(), a_id.to_owned()));
            }
            // x ** 1 → x
            if op == "power" && is_one(b_block) {
                return Some((id.clone(), a_id.to_owned()));
            }
            // x ** 0 → 1
            if op == "power" && is_zero(b_block) {
                return Some((id.clone(), a_id.to_owned()));
            }
            None
        })
        .collect();

    for (simplify_id, keep_id) in simplify_ids {
        // Redirect all connections pointing to simplify_id to keep_id
        for conns in connections.values_mut() {
            if let Some(obj) = conns.as_object_mut() {
                for c in obj.values_mut() {
                    if c.get("child_id").and_then(Value::as_str) == Some(&simplify_id) {
                        c.as_object_mut()
                            .unwrap()
                            .insert("child_id".to_owned(), Value::String(keep_id.clone()));
                    }
                }
            }
        }
        blocks.remove(&simplify_id);
        connections.remove(&simplify_id);
        stats.simplified += 1;
    }

    let result = json!({
        "blocks": blocks,
        "connections": connections,
        "comments": {},
    });

    (result, stats)
}

fn is_zero(block: &Value) -> bool {
    if block.get("type").and_then(Value::as_str) != Some("math_number") {
        return false;
    }
    block
        .get("fields")
        .and_then(|f| f.get("NUM"))
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<f64>().ok())
        .map(|v| v == 0.0)
        .unwrap_or(false)
}

fn is_one(block: &Value) -> bool {
    if block.get("type").and_then(Value::as_str) != Some("math_number") {
        return false;
    }
    block
        .get("fields")
        .and_then(|f| f.get("NUM"))
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<f64>().ok())
        .map(|v| v == 1.0)
        .unwrap_or(false)
}

pub fn optimize_report(report: &Value) -> Value {
    let mut report = report.clone();
    if let Some(workspace_data) = report.get("workspaceData").cloned() {
        let (optimized, stats) = optimize_workspace(&workspace_data);
        if let Some(obj) = report.as_object_mut() {
            obj.insert("workspaceData".to_owned(), optimized);
            obj.insert(
                "optimization".to_owned(),
                json!({
                    "constantFolded": stats.constant_folded,
                    "deadRemoved": stats.dead_removed,
                    "simplified": stats.simplified,
                }),
            );
        }
    }
    report
}
