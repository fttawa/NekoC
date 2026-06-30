use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

pub fn decompile_to_ts(project: &Value) -> Result<String> {
    let mut output = String::new();
    let mut declared_vars = BTreeSet::new();

    // Collect all variable/list names used in the project for `let` declarations
    let mut all_vars = BTreeSet::new();
    let mut all_lists = BTreeSet::new();
    collect_names(project, &mut all_vars, &mut all_lists);

    // Decompile actors
    if let Some(actors) = project
        .pointer("/actors/actorsDict")
        .and_then(Value::as_object)
    {
        for (_id, actor) in actors {
            let name = actor.get("name").and_then(Value::as_str).unwrap_or("actor");
            let blocks = actor.get("nekoBlockJsonList").and_then(Value::as_array);
            let Some(blocks) = blocks else { continue };
            if blocks.is_empty() {
                continue;
            }

            output.push_str(&format!("// Actor: {name}\n"));
            for block in blocks {
                decompile_root_block(
                    block,
                    &all_vars,
                    &all_lists,
                    &mut declared_vars,
                    &mut output,
                );
            }
            output.push('\n');
        }
    }

    // Decompile stage (scenes)
    if let Some(scenes) = project
        .pointer("/scenes/scenesDict")
        .and_then(Value::as_object)
    {
        for (_id, scene) in scenes {
            let name = scene.get("name").and_then(Value::as_str).unwrap_or("stage");
            let blocks = scene.get("nekoBlockJsonList").and_then(Value::as_array);
            let Some(blocks) = blocks else { continue };
            if blocks.is_empty() {
                continue;
            }

            output.push_str(&format!("// Stage: {name}\n"));
            for block in blocks {
                decompile_root_block(
                    block,
                    &all_vars,
                    &all_lists,
                    &mut declared_vars,
                    &mut output,
                );
            }
            output.push('\n');
        }
    }

    Ok(output)
}

fn collect_names(project: &Value, vars: &mut BTreeSet<String>, lists: &mut BTreeSet<String>) {
    // Collect from variables
    if let Some(dict) = project
        .pointer("/variables/variablesDict")
        .and_then(Value::as_object)
    {
        for name in dict.keys() {
            vars.insert(name.clone());
        }
    }
    // Collect from lists
    if let Some(dict) = project
        .pointer("/lists/listsDict")
        .and_then(Value::as_object)
    {
        for name in dict.keys() {
            lists.insert(name.clone());
        }
    }
    // Also scan blocks for variable/list references
    scan_blocks_for_names(project, vars, lists);
}

#[allow(clippy::only_used_in_recursion)]
fn scan_blocks_for_names(value: &Value, vars: &mut BTreeSet<String>, lists: &mut BTreeSet<String>) {
    if let Some(obj) = value.as_object() {
        if let Some(block_type) = obj.get("type").and_then(Value::as_str) {
            match block_type {
                "variables_set" | "change_variables" | "variables_get" => {
                    if let Some(name) = obj
                        .get("fields")
                        .and_then(|f| f.get("variable"))
                        .and_then(Value::as_str)
                    {
                        vars.insert(name.to_owned());
                    }
                }
                "list_append" | "list_insert_value" | "replace_list_item" | "delete_list_item"
                | "list_copy" | "list_length" | "list_index_of" | "list_is_exist"
                | "data_itemoflist" | "data_itemnumoflist" => {
                    // Lists are referenced through expression inputs
                }
                _ => {}
            }
        }
        // Recurse into all values
        for value in obj.values() {
            scan_blocks_for_names(value, vars, lists);
        }
    }
    if let Some(arr) = value.as_array() {
        for value in arr {
            scan_blocks_for_names(value, vars, lists);
        }
    }
}

// ---------------------------------------------------------------------------
// Root block (event handler or standalone chain)
// ---------------------------------------------------------------------------

fn decompile_root_block(
    block: &Value,
    all_vars: &BTreeSet<String>,
    all_lists: &BTreeSet<String>,
    declared_vars: &mut BTreeSet<String>,
    output: &mut String,
) {
    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
    let next = block.get("next");

    match block_type {
        "on_running_group_activated" => {
            output.push_str("onStart(() => {\n");
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            output.push_str("});\n\n");
        }
        "start_on_click" | "sprite_on_tap" => {
            output.push_str("onClick(() => {\n");
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            output.push_str("});\n\n");
        }
        "on_keydown" => {
            let key = field_str(block, "key").unwrap_or("space");
            output.push_str(&format!("onKey({:?}, () => {{\n", key));
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            output.push_str("});\n\n");
        }
        "on_broadcast_received" | "self_listen" | "self_listen_with_param" => {
            let msg = input_expr(block, "message");
            output.push_str(&format!("onBroadcast({msg}, () => {{\n"));
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            output.push_str("});\n\n");
        }
        "start_as_clone" => {
            output.push_str("onCloneStart(() => {\n");
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            output.push_str("});\n\n");
        }
        "on_custom_procedure" => {
            let name = field_str(block, "name").unwrap_or("proc");
            let is_reporter = block
                .get("fields")
                .and_then(|f| f.get("type"))
                .and_then(Value::as_str)
                == Some("reporter");
            // Collect params
            let params = collect_procedure_params(block);
            let params_str = params.join(", ");
            output.push_str(&format!("function {name}({params_str}) {{\n"));
            decompile_chain(next, 1, all_vars, all_lists, declared_vars, output);
            // Check for return value
            if is_reporter && let Some(ret) = find_return_value(block) {
                output.push_str(&format!("  return {};\n", decompile_expr(ret)));
            }
            output.push_str("}\n\n");
        }
        _ => {
            // Standalone statement chain (e.g. global variable init)
            decompile_chain(Some(block), 0, all_vars, all_lists, declared_vars, output);
            output.push('\n');
        }
    }
}

fn collect_procedure_params(block: &Value) -> Vec<String> {
    let mut params = Vec::new();
    if let Some(args) = block
        .get("mutation")
        .and_then(|m| m.get("args"))
        .and_then(Value::as_array)
    {
        for arg in args {
            if let Some(name) = arg.get("name").and_then(Value::as_str) {
                params.push(name.to_owned());
            }
        }
    }
    params
}

fn find_return_value(block: &Value) -> Option<&Value> {
    let mut current = block.get("next");
    while let Some(b) = current {
        if b.get("type").and_then(Value::as_str) == Some("procedures_2_return_value") {
            return b.get("inputs").and_then(|i| i.get("VALUE"));
        }
        current = b.get("next");
    }
    None
}

// ---------------------------------------------------------------------------
// Statement chain (follows `next` links)
// ---------------------------------------------------------------------------

fn decompile_chain(
    mut current: Option<&Value>,
    indent: usize,
    all_vars: &BTreeSet<String>,
    all_lists: &BTreeSet<String>,
    declared_vars: &mut BTreeSet<String>,
    output: &mut String,
) {
    while let Some(block) = current {
        decompile_statement(block, indent, all_vars, all_lists, declared_vars, output);
        current = block.get("next");
    }
}

// ---------------------------------------------------------------------------
// Single statement
// ---------------------------------------------------------------------------

fn decompile_statement(
    block: &Value,
    indent: usize,
    all_vars: &BTreeSet<String>,
    all_lists: &BTreeSet<String>,
    declared_vars: &mut BTreeSet<String>,
    output: &mut String,
) {
    let pad = "  ".repeat(indent);
    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");

    match block_type {
        // --- Variables ---
        "variables_set" => {
            let var = variable_name(block);
            let val = input_expr(block, "value");
            if declared_vars.contains(var.as_str()) {
                output.push_str(&format!("{pad}{var} = {val};\n"));
            } else {
                declared_vars.insert(var.clone());
                output.push_str(&format!("{pad}let {var} = {val};\n"));
            }
        }
        "change_variables" => {
            let var = variable_name(block);
            let val = input_expr(block, "value");
            let method = field_str(block, "method").unwrap_or("increase");
            if method == "decrease" {
                output.push_str(&format!("{pad}{var} -= {val};\n"));
            } else {
                output.push_str(&format!("{pad}{var} += {val};\n"));
            }
        }

        // --- Control flow ---
        "controls_if" => {
            let cond = input_expr(block, "IF0");
            output.push_str(&format!("{pad}if ({cond}) {{\n"));
            if let Some(body) = statement(block, "DO0") {
                decompile_chain(
                    Some(body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            if let Some(else_body) = statement(block, "ELSE") {
                output.push_str(&pad);
                output.push_str("} else {\n");
                decompile_chain(
                    Some(else_body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            output.push_str(&pad);
            output.push_str("}\n");
        }
        "repeat_forever" => {
            output.push_str(&format!("{pad}while (true) {{\n"));
            if let Some(body) = statement(block, "DO") {
                decompile_chain(
                    Some(body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            output.push_str(&pad);
            output.push_str("}\n");
        }
        "repeat_n_times" => {
            let times = input_expr(block, "times");
            output.push_str(&format!("{pad}for (let i = 0; i < {times}; i++) {{\n"));
            if let Some(body) = statement(block, "DO") {
                decompile_chain(
                    Some(body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            output.push_str(&pad);
            output.push_str("}\n");
        }
        "repeat_forever_until" => {
            let cond = input_expr(block, "condition");
            output.push_str(&format!("{pad}while (!({cond})) {{\n"));
            if let Some(body) = statement(block, "DO") {
                decompile_chain(
                    Some(body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            output.push_str(&pad);
            output.push_str("}\n");
        }
        "traverse_number" => {
            let var = traverse_var_name(block).unwrap_or("i");
            let from = input_expr(block, "from");
            let to = input_expr(block, "to");
            let by = input_expr(block, "by");
            output.push_str(&format!(
                "{pad}for (let {var} = {from}; {var} <= {to}; {var} += {by}) {{\n"
            ));
            if let Some(body) = statement(block, "DO") {
                decompile_chain(
                    Some(body),
                    indent + 1,
                    all_vars,
                    all_lists,
                    declared_vars,
                    output,
                );
            }
            output.push_str(&pad);
            output.push_str("}\n");
        }
        "when" => {
            let cond = input_expr(block, "condition");
            output.push_str(&format!("{pad}waitUntil({cond});\n"));
        }
        "wait" => {
            let secs = input_expr(block, "time");
            output.push_str(&format!("{pad}wait({secs});\n"));
        }
        "wait_until" => {
            let cond = input_expr(block, "condition");
            output.push_str(&format!("{pad}waitUntil({cond});\n"));
        }
        "break" => {
            output.push_str(&format!("{pad}break;\n"));
        }
        "stop" => {
            output.push_str(&format!("{pad}stop();\n"));
        }

        // --- Events / broadcast ---
        "self_broadcast" => {
            let msg = input_expr(block, "message");
            output.push_str(&format!("{pad}broadcast({msg});\n"));
        }
        "self_broadcast_and_wait" => {
            let msg = input_expr(block, "message");
            output.push_str(&format!("{pad}await broadcastAndWait({msg});\n"));
        }
        "self_broadcast_with_param" => {
            let msg = input_expr(block, "message");
            let param = input_expr(block, "param");
            output.push_str(&format!("{pad}broadcast({msg}, {param});\n"));
        }

        // --- Lists ---
        "list_append" => {
            let list = input_expr(block, "list");
            let val = input_expr(block, "list_item_value");
            output.push_str(&format!("{pad}{list}.push({val});\n"));
        }
        "list_insert_value" => {
            let list = input_expr(block, "list");
            let val = input_expr(block, "list_item_value");
            let idx = input_expr(block, "list_index");
            output.push_str(&format!("{pad}{list}.insert({val}, {idx});\n"));
        }
        "replace_list_item" => {
            let list = input_expr(block, "list");
            let idx = input_expr(block, "list_index");
            let val = input_expr(block, "list_item_value");
            output.push_str(&format!("{pad}{list}.set({idx}, {val});\n"));
        }
        "delete_list_item" => {
            let list = input_expr(block, "list");
            let item = field_str(block, "item").unwrap_or("any");
            if item == "all" {
                output.push_str(&format!("{pad}{list}.clear();\n"));
            } else {
                let idx = input_expr(block, "list_index");
                output.push_str(&format!("{pad}{list}.delete({idx});\n"));
            }
        }
        "list_copy" => {
            let src = input_expr(block, "list");
            let dst = input_expr(block, "target_list");
            output.push_str(&format!("{pad}{dst}.copy({src});\n"));
        }

        // --- Motion ---
        "self_go_forward" => {
            let steps = input_expr(block, "steps");
            output.push_str(&format!("{pad}moveForward({steps});\n"));
        }
        "self_move_to" | "self_glide_to" => {
            let x = input_expr(block, "x");
            let y = input_expr(block, "y");
            output.push_str(&format!("{pad}setXy({x}, {y});\n"));
        }
        "self_set_position_x" => {
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}setX({val});\n"));
        }
        "self_set_position_y" => {
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}setY({val});\n"));
        }
        "self_change_coordinate_x" | "self_glide_coordinate_x" => {
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}changeX({val});\n"));
        }
        "self_change_coordinate_y" | "self_glide_coordinate_y" => {
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}changeY({val});\n"));
        }
        "self_rotate" => {
            let deg = input_expr(block, "degrees");
            output.push_str(&format!("{pad}turnRight({deg});\n"));
        }
        "self_point_towards" => {
            let deg = input_expr(block, "degrees");
            output.push_str(&format!("{pad}pointTowards({deg});\n"));
        }

        // --- Appearance ---
        "self_appear" => {
            let val = field_str(block, "value").unwrap_or("appear");
            if val == "appear" {
                output.push_str(&format!("{pad}show();\n"));
            } else {
                output.push_str(&format!("{pad}hide();\n"));
            }
        }
        "set_scale" => {
            let val = input_expr(block, "scale");
            output.push_str(&format!("{pad}setSize({val});\n"));
        }
        "self_change_scale" => {
            let val = input_expr(block, "scale");
            output.push_str(&format!("{pad}changeSize({val});\n"));
        }
        "self_prev_next_style" => {
            let dir = field_str(block, "prev_next").unwrap_or("next");
            if dir == "prev" {
                output.push_str(&format!("{pad}prevStyle();\n"));
            } else {
                output.push_str(&format!("{pad}nextStyle();\n"));
            }
        }
        "self_set_style" => {
            let name = input_expr(block, "style");
            output.push_str(&format!("{pad}setStyle({name});\n"));
        }

        // --- Dialog ---
        "self_say" => {
            let text = input_expr(block, "text");
            output.push_str(&format!("{pad}say({text});\n"));
        }
        "self_think" => {
            let text = input_expr(block, "text");
            output.push_str(&format!("{pad}think({text});\n"));
        }
        "self_close_dialog" => {
            output.push_str(&format!("{pad}closeDialog();\n"));
        }

        // --- Effects ---
        "self_set_effect" => {
            let scope = field_str(block, "scope").unwrap_or("color");
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}setEffect({scope:?}, {val});\n"));
        }
        "self_change_effect" => {
            let scope = field_str(block, "scope").unwrap_or("color");
            let val = input_expr(block, "value");
            output.push_str(&format!("{pad}changeEffect({scope:?}, {val});\n"));
        }
        "clear_all_effects" => {
            output.push_str(&format!("{pad}clearEffects();\n"));
        }

        // --- Pen ---
        "clear_drawing" => {
            output.push_str(&format!("{pad}clearDrawing();\n"));
        }
        "self_pen_down" => {
            output.push_str(&format!("{pad}penDown();\n"));
        }
        "self_pen_up" => {
            output.push_str(&format!("{pad}penUp();\n"));
        }
        "self_set_pen_color" => {
            let color = input_expr(block, "color");
            output.push_str(&format!("{pad}setPenColor({color});\n"));
        }
        "self_set_pen_size" => {
            let size = input_expr(block, "size");
            output.push_str(&format!("{pad}setPenSize({size});\n"));
        }

        // --- Drag ---
        "self_set_draggable" => {
            let val = field_str(block, "value").unwrap_or("true");
            output.push_str(&format!("{pad}setDraggable({val});\n"));
        }

        // --- Clones ---
        "mirror" => {
            output.push_str(&format!("{pad}createClone();\n"));
        }
        "dispose_clone" => {
            output.push_str(&format!("{pad}deleteClone();\n"));
        }

        // --- Screen ---
        "switch_to_screen" => {
            let id = input_expr(block, "screen_id");
            output.push_str(&format!("{pad}switchScreen({id});\n"));
        }

        // --- Console ---
        "console_log" => {
            let val = input_expr(block, "console_log");
            output.push_str(&format!("{pad}console.log({val});\n"));
        }

        // --- Ask ---
        "self_ask" => {
            let prompt = input_expr(block, "question");
            output.push_str(&format!("{pad}ask({prompt});\n"));
        }
        "ask_and_choose" => {
            let prompt = input_expr(block, "question");
            output.push_str(&format!("{pad}askAndChoose({prompt});\n"));
        }

        // --- Timer ---
        "set_timer_state" => {
            let t = field_str(block, "type").unwrap_or("reset");
            match t {
                "start" => output.push_str(&format!("{pad}startTimer();\n")),
                "stop" => output.push_str(&format!("{pad}stopTimer();\n")),
                _ => output.push_str(&format!("{pad}resetTimer();\n")),
            }
        }

        // --- Script variables ---
        "script_variables" => {
            let names = script_var_names(block);
            for name in names {
                output.push_str(&format!("{pad}let {name} = scriptVar({name:?});\n"));
            }
        }

        // --- Procedure call (no return) ---
        "procedures_2_callnoreturn" => {
            let name = field_str(block, "name").unwrap_or("proc");
            let args = collect_call_args(block);
            let args_str = args.join(", ");
            output.push_str(&format!("{pad}{name}({args_str});\n"));
        }
        "procedures_2_return_value" => {
            // Handled by parent on_custom_procedure
        }

        // --- No-ops / unsupported display blocks ---
        "self_appear_animation"
        | "self_gradually_show_hide"
        | "create_stage_dialog"
        | "set_width_height_scale"
        | "add_width_height_scale"
        | "self_text_effect_text"
        | "self_text_effect_size"
        | "self_text_effect_color"
        | "set_top_bottom_layer"
        | "self_set_role_camp"
        | "self_stress_animation"
        | "global_animation"
        | "show_hide_variables"
        | "show_hide_list"
        | "show_hide_timer"
        | "face_to_body_part"
        | "set_pen_layer"
        | "play_audio"
        | "play_audio_and_wait"
        | "stop_audio"
        | "sound_color"
        | "warp"
        | "tell"
        | "sync_tell"
        | "restart" => {
            // No-op or display-only
        }

        // Expression blocks that appear at root level (not executable)
        "traverse_number_value"
        | "convert_type"
        | "variables_get"
        | "math_number"
        | "text"
        | "logic_boolean"
        | "script_variables_value"
        | "self_listen_value"
        | "get_answer"
        | "get_choice_and_index"
        | "broadcast_input"
        | "math_arithmetic"
        | "logic_compare"
        | "logic_operation"
        | "logic_negate"
        | "math_modulo"
        | "random_num"
        | "divisible_by"
        | "math_round"
        | "math_function"
        | "math_number_property"
        | "math_trig"
        | "text_join"
        | "text_length"
        | "text_contain"
        | "text_split"
        | "text_select"
        | "check_key"
        | "check_touching"
        | "mouse_position"
        | "get_mouse_button"
        | "timer"
        | "get_time"
        | "get_stage_info"
        | "distance_to"
        | "coordinate_of_sprite"
        | "get_orientation"
        | "style_of_sprite"
        | "appearance_of_sprite"
        | "effect_of_sprite"
        | "bump_into"
        | "out_of_boundary"
        | "get_clone_num"
        | "get_current_clone_index"
        | "get_clone_index_property"
        | "on_bump_actor_value"
        | "procedures_2_parameter"
        | "procedures_2_actor_param"
        | "procedures_2_callreturn"
        | "list_length"
        | "list_index_of"
        | "list_is_exist"
        | "data_itemoflist"
        | "data_itemnumoflist" => {
            // Expression block at root level - skip
        }

        _ => {
            output.push_str(&format!("{pad}/* unsupported: {block_type} */\n"));
        }
    }
}

// ---------------------------------------------------------------------------
// Expression decompilation
// ---------------------------------------------------------------------------

fn decompile_expr(block: &Value) -> String {
    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
    match block_type {
        // Literals
        "math_number" => {
            let num = block
                .get("fields")
                .and_then(|f| f.get("NUM"))
                .and_then(Value::as_str)
                .unwrap_or("0");
            num.to_owned()
        }
        "text" => {
            let text = block
                .get("fields")
                .and_then(|f| f.get("TEXT"))
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("{:?}", text)
        }
        "logic_boolean" => {
            let val = block
                .get("fields")
                .and_then(|f| f.get("BOOL"))
                .and_then(Value::as_str)
                .unwrap_or("true");
            if val.eq_ignore_ascii_case("true") {
                "true".to_owned()
            } else {
                "false".to_owned()
            }
        }

        // Variables
        "variables_get" => variable_name(block),
        "traverse_number_value" => block
            .get("fields")
            .and_then(|f| f.get("TEXT"))
            .and_then(Value::as_str)
            .unwrap_or("i")
            .to_owned(),
        "script_variables_value" => {
            let name = block
                .get("fields")
                .and_then(|f| f.get("TEXT"))
                .and_then(Value::as_str)
                .unwrap_or("var");
            format!("scriptVar({:?})", name)
        }
        "self_listen_value" => {
            let name = block
                .get("fields")
                .and_then(|f| f.get("TEXT"))
                .and_then(Value::as_str)
                .unwrap_or("msg");
            format!("messageValue({:?})", name)
        }
        "get_answer" => "getAnswer()".to_owned(),
        "get_choice_and_index" => {
            let field_type = field_str(block, "type").unwrap_or("content");
            if field_type == "index" {
                "getChoiceIndex()".to_owned()
            } else {
                "getChoiceContent()".to_owned()
            }
        }
        "broadcast_input" => {
            let msg = block
                .get("fields")
                .and_then(|f| f.get("BROADCAST_INPUT"))
                .and_then(Value::as_str)
                .unwrap_or("message1");
            format!("{:?}", msg)
        }

        // Comparison
        "logic_compare" => {
            let op = field_str(block, "OP").unwrap_or("EQ");
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            let op_str = match op {
                "GT" => ">",
                "GTE" => ">=",
                "LT" => "<",
                "LTE" => "<=",
                "NEQ" => "!=",
                _ => "==",
            };
            format!("({a} {op_str} {b})")
        }

        // Logic
        "logic_operation" => {
            let op = field_str(block, "type").unwrap_or("and");
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            if op == "or" {
                format!("({a} || {b})")
            } else {
                format!("({a} && {b})")
            }
        }
        "logic_negate" => {
            let val = input_expr(block, "logic");
            format!("(!{val})")
        }

        // Math
        "math_arithmetic" => {
            let op = field_str(block, "type").unwrap_or("add");
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            let op_str = match op {
                "minus" | "subtract" => "-",
                "multiply" => "*",
                "divide" => "/",
                "mod" => "%",
                "power" => "**",
                _ => "+",
            };
            format!("({a} {op_str} {b})")
        }
        "math_modulo" => {
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            format!("({a} % {b})")
        }
        "random_num" => {
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            format!("random({a}, {b})")
        }
        "divisible_by" => {
            let a = input_expr(block, "A");
            let b = input_expr(block, "B");
            format!("({a} % {b} == 0)")
        }
        "math_round" => {
            let op = field_str(block, "type").unwrap_or("round");
            let val = input_expr(block, "num");
            match op {
                "round_down" => format!("Math.floor({val})"),
                "round_up" => format!("Math.ceil({val})"),
                _ => format!("Math.round({val})"),
            }
        }
        "math_function" => {
            let op = field_str(block, "type").unwrap_or("0");
            let val = input_expr(block, "num");
            let func = match op {
                "0" | "abs" => "Math.abs",
                "1" | "floor" => "Math.floor",
                "2" | "ceil" => "Math.ceil",
                "3" | "sqrt" => "Math.sqrt",
                "4" | "ln" => "Math.log",
                "5" | "log" => "Math.log10",
                "6" | "pow2" => "Math.pow(2,", // special case
                "7" | "exp" => "Math.exp",
                _ => "Math.abs",
            };
            if op == "6" || op == "pow2" {
                format!("Math.pow(2, {val})")
            } else {
                format!("{func}({val})")
            }
        }
        "math_number_property" => {
            let op = field_str(block, "type").unwrap_or("integer");
            let val = input_expr(block, "num");
            match op {
                "odd" => format!("({val} % 2 === 1)"),
                "even" => format!("({val} % 2 === 0)"),
                "positive" => format!("({val} > 0)"),
                "negative" => format!("({val} < 0)"),
                "prime" => format!("isPrime({val})"),
                _ => format!("isInteger({val})"),
            }
        }
        "math_trig" => {
            let op = field_str(block, "type").unwrap_or("sin");
            let val = input_expr(block, "num");
            match op {
                "cos" => format!("Math.cos(({val}) * Math.PI / 180)"),
                "tan" => format!("Math.tan(({val}) * Math.PI / 180)"),
                _ => format!("Math.sin(({val}) * Math.PI / 180)"),
            }
        }

        // Text operations
        "text_join" => {
            let parts = collect_text_join_parts(block);
            let strings: Vec<String> = parts.into_iter().map(|(_, s)| s).collect();
            if strings.is_empty() {
                "\"\"".to_owned()
            } else if strings.len() == 1 {
                strings.into_iter().next().unwrap()
            } else {
                format!("({})", strings.join(" + "))
            }
        }
        "text_length" => {
            let val = input_expr(block, "text");
            format!("{val}.length")
        }
        "text_contain" => {
            let text = input_expr(block, "A");
            let needle = input_expr(block, "B");
            format!("{text}.contains({needle})")
        }
        "text_split" => {
            let text = input_expr(block, "TEXT_TO_SPLIT");
            let delim = input_expr(block, "SPLIT_TEXT");
            format!("{text}.split({delim})")
        }
        "text_select" => {
            let text = input_expr(block, "text");
            let start = input_expr(block, "start_index");
            let end = input_expr(block, "end_index");
            if end.is_empty() {
                format!("{text}.charAt({start})")
            } else {
                format!("{text}.substring({start}, {end})")
            }
        }
        "convert_type" => {
            let target = field_str(block, "type").unwrap_or("string");
            let val = input_expr(block, "text");
            match target {
                "number" => format!("Number({val})"),
                "boolean" => format!("Boolean({val})"),
                _ => format!("String({val})"),
            }
        }

        // Sensing
        "check_key" => {
            let key = field_str(block, "key").unwrap_or("space");
            format!("keyPressed({:?})", key)
        }
        "check_touching" => {
            let target = field_str(block, "target").unwrap_or("edge");
            format!("touching({:?})", target)
        }
        "mouse_position" => {
            let coord = field_str(block, "type").unwrap_or("x");
            if coord == "y" {
                "mouseY()".to_owned()
            } else {
                "mouseX()".to_owned()
            }
        }
        "get_mouse_button" => {
            let button = field_str(block, "button").unwrap_or("left");
            let state = field_str(block, "state").unwrap_or("down");
            format!("mouseButton({:?}, {:?})", button, state)
        }
        "timer" => "timer()".to_owned(),
        "get_time" => {
            let unit = field_str(block, "type").unwrap_or("year");
            format!("time({:?})", unit)
        }
        "get_stage_info" => {
            let prop = field_str(block, "type").unwrap_or("width");
            match prop {
                "height" => "stageHeight()".to_owned(),
                _ => "stageWidth()".to_owned(),
            }
        }
        "distance_to" => {
            let target = field_str(block, "sprite").unwrap_or("_mouse_");
            format!("distanceTo({:?})", target)
        }
        "coordinate_of_sprite" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            let coord = field_str(block, "type").unwrap_or("x");
            format!("{}Of({:?})", coord, sprite)
        }
        "get_orientation" => {
            let target = field_str(block, "target").unwrap_or("--self");
            format!("orientation({:?})", target)
        }
        "style_of_sprite" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            format!("styleOf({:?})", sprite)
        }
        "appearance_of_sprite" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            let appearance = field_str(block, "appearance").unwrap_or("scale");
            format!("appearanceOf({:?}, {:?})", sprite, appearance)
        }
        "effect_of_sprite" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            let effect = field_str(block, "effect").unwrap_or("color");
            format!("effectOf({:?}, {:?})", sprite, effect)
        }
        "bump_into" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            let target = field_str(block, "target")
                .or_else(|| field_str(block, "body"))
                .unwrap_or("--edge");
            if target == "--edge" {
                format!("touchingEdge({:?})", sprite)
            } else {
                format!("touchingActor({:?}, {:?})", sprite, target)
            }
        }
        "out_of_boundary" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            format!("outOfBounds({:?})", sprite)
        }
        "get_clone_num" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            format!("cloneCount({:?})", sprite)
        }
        "get_current_clone_index" => "cloneIndex()".to_owned(),
        "get_clone_index_property" => {
            let sprite = field_str(block, "sprite").unwrap_or("--self");
            let attr = field_str(block, "attribute").unwrap_or("x");
            let idx = input_expr(block, "index");
            format!("cloneProperty({:?}, {:?}, {})", sprite, attr, idx)
        }
        "on_bump_actor_value" => {
            let sprite = field_str(block, "TEXT").unwrap_or("--self");
            let attr = field_str(block, "attribute").unwrap_or("x");
            format!("bumpActorValue({:?}, {:?})", sprite, attr)
        }

        // Procedures
        "procedures_2_parameter" => {
            let name = field_str(block, "param_name").unwrap_or("param");
            format!("param({:?})", name)
        }
        "procedures_2_actor_param" => {
            let name = field_str(block, "param_name").unwrap_or("param");
            let attr = field_str(block, "attribute").unwrap_or("x");
            format!("actorParam({:?}, {:?})", name, attr)
        }
        "procedures_2_callreturn" => {
            let name = field_str(block, "name").unwrap_or("proc");
            let args = collect_call_args(block);
            let args_str = args.join(", ");
            format!("callReporter({:?}, {args_str})", name)
        }

        // List expressions
        "list_length" => {
            let list = input_expr(block, "list");
            format!("{list}.length")
        }
        "list_index_of" => {
            let list = input_expr(block, "list");
            let val = input_expr(block, "value");
            format!("{list}.indexOf({val})")
        }
        "list_is_exist" => {
            let list = input_expr(block, "list");
            let val = input_expr(block, "value");
            format!("{list}.contains({val})")
        }
        "data_itemoflist" => {
            let list = input_expr(block, "list");
            let idx = input_expr(block, "index");
            format!("{list}.item({idx})")
        }
        "data_itemnumoflist" => {
            let list = input_expr(block, "list");
            let val = input_expr(block, "value");
            format!("{list}.indexOf({val})")
        }

        _ => {
            format!("/* unsupported_expr: {} */", block_type)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn input_expr(block: &Value, name: &str) -> String {
    match block.get("inputs").and_then(|i| i.get(name)) {
        Some(inner) => decompile_expr(inner),
        None => "0".to_owned(),
    }
}

fn variable_name(block: &Value) -> String {
    block
        .get("fields")
        .and_then(|f| f.get("variable"))
        .and_then(Value::as_str)
        .unwrap_or("var")
        .to_owned()
}

fn field_str<'a>(block: &'a Value, name: &str) -> Option<&'a str> {
    block
        .get("fields")
        .and_then(|f| f.get(name))
        .and_then(Value::as_str)
}

fn statement<'a>(block: &'a Value, name: &str) -> Option<&'a Value> {
    block.get("statements").and_then(|s| s.get(name))
}

fn traverse_var_name(block: &Value) -> Option<&str> {
    block
        .get("inputs")
        .and_then(|i| i.get("value"))
        .and_then(|v| v.get("fields"))
        .and_then(|f| f.get("TEXT"))
        .and_then(Value::as_str)
}

fn script_var_names(block: &Value) -> Vec<String> {
    let Some(vars) = block
        .get("fields")
        .and_then(|f| f.get("variables"))
        .and_then(Value::as_str)
    else {
        return Vec::new();
    };
    vars.split(',')
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

fn collect_call_args(block: &Value) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(inputs) = block.get("inputs").and_then(Value::as_object) {
        for (name, value) in inputs {
            if name.starts_with("PARAM") || name.starts_with("param") {
                args.push(decompile_expr(value));
            }
        }
    }
    args
}

fn collect_text_join_parts(block: &Value) -> Vec<(usize, String)> {
    let mut parts: Vec<(usize, String)> = Vec::new();
    if let Some(inputs) = block.get("inputs").and_then(Value::as_object) {
        for (name, value) in inputs {
            if let Some(rest) = name.strip_prefix("TEXT")
                && let Ok(index) = rest.parse::<usize>()
            {
                parts.push((index, decompile_expr(value)));
            }
        }
    }
    parts.sort_by_key(|(i, _)| *i);
    parts
}

// Kept for future use by build_report
#[allow(dead_code)]
fn is_block(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str).is_some()
}

// ---------------------------------------------------------------------------
// Existing JSON report (unchanged)
// ---------------------------------------------------------------------------

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

fn object_keys(value: Option<&Value>) -> Vec<String> {
    let Some(map) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    map.keys().cloned().collect()
}
