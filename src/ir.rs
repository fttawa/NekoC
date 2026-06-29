use std::collections::BTreeSet;

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
    let resource_screens = resources
        .get("screens")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let screens = if resource_screens.is_empty() {
        fallback_screens(&resources, &main_scripts, &resource_sprites)
    } else {
        screens_from_resources(&resource_screens)
    };

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

    let script_count = count_screen_scripts(&screens);
    let sprite_count = if resource_screens.is_empty() {
        resource_sprites.len()
    } else {
        screens
            .iter()
            .map(|screen| {
                screen
                    .get("actors")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0)
            })
            .sum::<usize>()
    };

    json!({
        "format": "nekoc-ir",
        "version": 1,
        "source": workspace_report.get("source").cloned().unwrap_or(Value::Null),
        "summary": {
            "scripts": script_count,
            "screens": screens.len(),
            "sprites": sprite_count,
            "procedures": workspace_report.pointer("/summary/procedures").cloned().unwrap_or(Value::Null),
        },
        "resources": resources,
        "screens": screens,
        "actors": actors,
        "procedures": workspace_report.get("procedures").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
    })
}

fn fallback_screens(resources: &Value, main_scripts: &[Value], sprites: &[Value]) -> Vec<Value> {
    let stage = resources.get("stage").unwrap_or(&Value::Null);
    let name = stage.get("name").and_then(Value::as_str).unwrap_or("main");
    let backdrop = stage.get("backdrop").cloned().unwrap_or(Value::Null);
    let mut actors = Vec::new();
    if !main_scripts.is_empty() {
        actors.push(json!({
            "name": "main",
            "kind": "stage",
            "scripts": main_scripts,
        }));
    }
    actors.extend(sprites.iter().map(actor_from_sprite));

    vec![json!({
        "id": "nekoc-screen-main",
        "name": name,
        "backdrop": backdrop,
        "actors": actors,
    })]
}

fn screens_from_resources(screens: &[Value]) -> Vec<Value> {
    screens
        .iter()
        .map(|screen| {
            let sprites = screen
                .get("sprites")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(actor_from_sprite).collect::<Vec<_>>())
                .unwrap_or_default();
            json!({
                "id": screen.get("id").cloned().unwrap_or(Value::Null),
                "name": screen.get("name").cloned().unwrap_or(Value::Null),
                "backdrop": screen.get("backdrop").cloned().unwrap_or(Value::Null),
                "actors": sprites,
            })
        })
        .collect()
}

fn actor_from_sprite(sprite: &Value) -> Value {
    json!({
        "name": sprite.get("name").cloned().unwrap_or(Value::Null),
        "kind": "sprite",
        "costume": sprite.get("costume").cloned().unwrap_or(Value::Null),
        "x": sprite.get("x").cloned().unwrap_or(Value::Null),
        "y": sprite.get("y").cloned().unwrap_or(Value::Null),
        "scale": sprite.get("scale").cloned().unwrap_or(Value::Null),
        "visible": sprite.get("visible").cloned().unwrap_or(Value::Null),
        "scripts": scripts_from_workspace(sprite.get("workspaceData")),
    })
}

fn count_scripts(actors: &[Value]) -> usize {
    actors
        .iter()
        .map(|actor| {
            actor
                .get("scripts")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        })
        .sum::<usize>()
}

fn count_screen_scripts(screens: &[Value]) -> usize {
    screens
        .iter()
        .filter_map(|screen| screen.get("actors").and_then(Value::as_array))
        .map(|actors| count_scripts(actors))
        .sum()
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
            let data_flow = data_flow_for_statements(&body);
            json!({
                "id": id,
                "event": event_name(entry_type),
                "entry_block_type": entry_type,
                "block_types": sequence_types(&block, &blocks, &connections),
                "data_flow": data_flow,
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

fn data_flow_for_statements(statements: &[Value]) -> Value {
    let mut reads = BTreeSet::new();
    let mut writes = BTreeSet::new();

    collect_statements_data_flow(statements, &mut reads, &mut writes);

    json!({
        "reads": reads.into_iter().collect::<Vec<_>>(),
        "writes": writes.into_iter().collect::<Vec<_>>(),
    })
}

fn collect_statements_data_flow(
    statements: &[Value],
    reads: &mut BTreeSet<String>,
    writes: &mut BTreeSet<String>,
) {
    for statement in statements {
        collect_statement_data_flow(statement, reads, writes);
    }
}

fn collect_statement_data_flow(
    statement: &Value,
    reads: &mut BTreeSet<String>,
    writes: &mut BTreeSet<String>,
) {
    match statement.get("kind").and_then(Value::as_str) {
        Some("set_var") => {
            insert_string_field(statement, "variable", writes);
            collect_expression_reads(&statement["value"], reads);
        }
        Some("change_var") => {
            insert_string_field(statement, "variable", reads);
            insert_string_field(statement, "variable", writes);
            collect_expression_reads(&statement["value"], reads);
        }
        Some("wait") => collect_expression_reads(&statement["seconds"], reads),
        Some("move_steps") => collect_expression_reads(&statement["steps"], reads),
        Some("set_x") | Some("set_y") => collect_expression_reads(&statement["value"], reads),
        Some("switch_screen") | Some("break") => {}
        Some("if") => {
            collect_expression_reads(&statement["condition"], reads);
            collect_json_statement_array(&statement["then"], reads, writes);
            collect_json_statement_array(&statement["else"], reads, writes);
        }
        Some("repeat_times") => {
            collect_expression_reads(&statement["times"], reads);
            collect_json_statement_array(&statement["body"], reads, writes);
        }
        Some("repeat_until") => {
            collect_expression_reads(&statement["condition"], reads);
            collect_json_statement_array(&statement["body"], reads, writes);
        }
        Some("forever") => collect_json_statement_array(&statement["body"], reads, writes),
        _ => {}
    }
}

fn collect_json_statement_array(
    value: &Value,
    reads: &mut BTreeSet<String>,
    writes: &mut BTreeSet<String>,
) {
    if let Some(statements) = value.as_array() {
        collect_statements_data_flow(statements, reads, writes);
    }
}

fn collect_expression_reads(expression: &Value, reads: &mut BTreeSet<String>) {
    match expression.get("kind").and_then(Value::as_str) {
        Some("get_var") => {
            insert_string_field(expression, "variable", reads);
        }
        Some("binary") | Some("compare") | Some("logic") => {
            collect_expression_reads(&expression["left"], reads);
            collect_expression_reads(&expression["right"], reads);
        }
        Some("trig") | Some("not") => collect_expression_reads(&expression["value"], reads),
        _ => {}
    }
}

fn insert_string_field(value: &Value, field: &str, target: &mut BTreeSet<String>) {
    if let Some(text) = value.get(field).and_then(Value::as_str) {
        target.insert(text.to_owned());
    }
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
        "self_go_forward" => json!({
            "kind": "move_steps",
            "block_id": id,
            "steps": input_expression(id, "steps", blocks, connections),
        }),
        "self_set_position_x" => json!({
            "kind": "set_x",
            "block_id": id,
            "value": input_expression(id, "value", blocks, connections),
        }),
        "self_set_position_y" => json!({
            "kind": "set_y",
            "block_id": id,
            "value": input_expression(id, "value", blocks, connections),
        }),
        "switch_to_screen" => json!({
            "kind": "switch_screen",
            "block_id": id,
            "target": input_expression(id, "screen_id", blocks, connections).get("target").cloned().unwrap_or(Value::Null),
        }),
        "controls_if" => {
            let then_body = statement_input_id(id, "DO0", connections)
                .map(|child_id| statements_from_chain(child_id, blocks, connections))
                .unwrap_or_default();
            let else_body = statement_input_id(id, "ELSE", connections)
                .map(|child_id| statements_from_chain(child_id, blocks, connections))
                .unwrap_or_default();
            json!({
                "kind": "if",
                "block_id": id,
                "condition": input_expression(id, "IF0", blocks, connections),
                "then": then_body,
                "else": else_body,
            })
        }
        "repeat_n_times" => {
            let body = statement_input_id(id, "DO", connections)
                .map(|child_id| statements_from_chain(child_id, blocks, connections))
                .unwrap_or_default();
            json!({
                "kind": "repeat_times",
                "block_id": id,
                "times": input_expression(id, "times", blocks, connections),
                "body": body,
            })
        }
        "repeat_forever_until" => {
            let body = statement_input_id(id, "DO", connections)
                .map(|child_id| statements_from_chain(child_id, blocks, connections))
                .unwrap_or_default();
            json!({
                "kind": "repeat_until",
                "block_id": id,
                "condition": input_expression(id, "condition", blocks, connections),
                "body": body,
            })
        }
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
        "break" => json!({
            "kind": "break",
            "block_id": id,
        }),
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
        "math_arithmetic" => json!({
            "kind": "binary",
            "block_id": child_id,
            "op": block.pointer("/fields/type").cloned().unwrap_or(Value::Null),
            "left": input_expression(child_id, "A", blocks, connections),
            "right": input_expression(child_id, "B", blocks, connections),
        }),
        "math_trig" => json!({
            "kind": "trig",
            "block_id": child_id,
            "op": block.pointer("/fields/type").cloned().unwrap_or(Value::Null),
            "value": input_expression(child_id, "num", blocks, connections),
        }),
        "logic_compare" => json!({
            "kind": "compare",
            "block_id": child_id,
            "op": block.pointer("/fields/OP").cloned().unwrap_or(Value::Null),
            "left": input_expression(child_id, "A", blocks, connections),
            "right": input_expression(child_id, "B", blocks, connections),
        }),
        "logic_operation" => json!({
            "kind": "logic",
            "block_id": child_id,
            "op": block.pointer("/fields/type").cloned().unwrap_or(Value::Null),
            "left": input_expression(child_id, "A", blocks, connections),
            "right": input_expression(child_id, "B", blocks, connections),
        }),
        "logic_negate" => json!({
            "kind": "not",
            "block_id": child_id,
            "value": input_expression(child_id, "logic", blocks, connections),
        }),
        "logic_boolean" => {
            let value = block
                .pointer("/fields/BOOL")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "true");
            json!({
                "kind": "boolean",
                "value": value,
            })
        }
        "get_screens" => json!({
            "kind": "screen",
            "target": block.pointer("/fields/screen_id").cloned().unwrap_or(Value::Null),
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
