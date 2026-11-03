use nekoc::{
    engine::{Costume, Engine, Program},
    runtime::{Runtime, RuntimeValue},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn movement(n: f64) -> Value {
    json!({"type":"self_go_forward","inputs":{"steps":num(n)}})
}
fn project(body: Value) -> Value {
    let mut project = Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] =
        json!([{"id":"start","type":"on_running_group_activated","next":body}]);
    project
}
fn frame(vm: &mut Engine) -> nekoc::engine::Frame {
    vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap()
}

#[test]
fn key_release_and_pointer_targets_dispatch_only_matching_hats() {
    let mut p = project(json!({"type":"self_appear","fields":{"value":"appear"}}));
    let hats = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    let log = |text| json!({"type":"console_log","inputs":{"console_log":{"type":"text","fields":{"TEXT":text}}}});
    for (kind, fields, text) in [
        ("on_keydown", json!({"key":"13","type":"down"}), "down"),
        ("on_keydown", json!({"key":"13","type":"up"}), "up"),
        (
            "sprite_on_tap",
            json!({"sprite":"--self","type":"mouse_click"}),
            "self",
        ),
        (
            "sprite_on_tap",
            json!({"sprite":"--screen","type":"mouse_click"}),
            "screen",
        ),
    ] {
        hats.push(json!({"type":kind,"fields":fields,"next":log(text)}));
    }
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(frame(&mut vm).logs.is_empty());
    vm.key_event("13", true);
    vm.key_event("13", false);
    assert_eq!(frame(&mut vm).logs, ["down", "up"]);
    assert!(frame(&mut vm).logs.is_empty());
    vm.pointer_event("other", "mouse_click", 12.0, 34.0);
    assert_eq!(frame(&mut vm).logs, ["screen"]);
    vm.pointer_event("nekoc-default-actor", "mouse_click", 12.0, 34.0);
    assert_eq!(frame(&mut vm).logs, ["self", "screen"]);
    vm.start();
    assert!(frame(&mut vm).logs.is_empty());
}

#[test]
fn costume_selection_opacity_and_pen_order_survive_idle_and_reset() {
    let mut p = project(
        json!({"type":"set_sprite_style","inputs":{"style_id":num(1.6)},"next":{
            "type":"self_set_effect","fields":{"scope":"1"},"inputs":{"value":num(25.0)},"next":{
                "type":"set_pen_layer","fields":{"layer":"peak","target_layer":""}
            }
        }}),
    );
    p["actors"]["actorsDict"]["nekoc-default-actor"]["styles"] = json!(["nekoc-costume", "second"]);
    let hats = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    hats.push(json!({"type":"on_keydown","fields":{"key":"32","type":"up"},"next":{
        "type":"set_sprite_style","inputs":{"style_id":{"type":"get_styles","fields":{"style_id":"nekoc-costume"}}},"next":{
            "type":"set_pen_layer","fields":{"layer":"bottom"}}
    }}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.sprites[1].style.as_deref(), Some("second"));
    assert_eq!(f.sprites[1].opacity, 0.75);
    assert_eq!(f.pen_layer, 1);
    assert!(frame(&mut vm).sprites.is_empty());
    vm.key_event("32", false);
    let f = frame(&mut vm);
    assert_eq!(f.sprites[0].style.as_deref(), Some("nekoc-costume"));
    assert_eq!(f.pen_layer, 0);
    vm.start();
    assert_eq!(frame(&mut vm).pen_layer, 1);
}

#[test]
fn starhold_compiles_and_key_release_enters_level_selection() {
    let p = nekoc::project::load_project("samples/starhold.bcmkn")
        .unwrap()
        .value;
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    let mode = vm
        .program
        .variable_names
        .iter()
        .position(|id| id == "kn-var-mode")
        .unwrap();
    vm.start();
    for _ in 0..5 {
        frame(&mut vm);
    }
    assert_eq!(vm.numeric_variables()[mode], 0.0);
    vm.key("13");
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[mode], 0.0);
    vm.key_event("13", false);
    for _ in 0..5 {
        frame(&mut vm);
    }
    assert_eq!(vm.numeric_variables()[mode], 1.0);
}

#[test]
fn pen_layer_moves_and_relative_targets_use_back_to_front_order() {
    let mut p = project(json!({"type":"wait","inputs":{"time":num(1.0)}}));
    let back = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    p["actors"]["actorsDict"]["back"] = back;
    p["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"] =
        json!(["nekoc-default-actor", "back"]);
    let hats = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    for (key, layer, target) in [
        ("1", "prev_layer", ""),
        ("2", "next_layer", ""),
        ("3", "nekoc-default-actor", "prev_layer"),
        ("4", "back", "next_layer"),
    ] {
        hats.push(json!({"type":"on_keydown","fields":{"key":key,"type":"down"},"next":{"type":"set_pen_layer","fields":{"layer":layer,"target_layer":target}}}));
    }
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).pen_layer, 0);
    for (key, expected) in [
        ("1", 1),
        ("1", 2),
        ("1", 2),
        ("2", 1),
        ("3", 2),
        ("4", 0),
        ("2", 0),
    ] {
        vm.key(key);
        assert_eq!(frame(&mut vm).pen_layer, expected);
    }
    vm.start();
    assert_eq!(frame(&mut vm).pen_layer, 0);
}

#[test]
fn mouse_utf16_length_and_random_integer_reporters_evaluate_in_numeric_expressions() {
    let mut body = json!({"type":"variables_set","fields":{"variable":"angle"},"inputs":{"value":{"type":"math_trig","fields":{"type":"atan"},"inputs":{"num":num(1.0)}}}});
    for (name, value) in [
        (
            "mouse",
            json!({"type":"get_mouse_info","fields":{"type":"y"}}),
        ),
        (
            "length",
            json!({"type":"text_length","inputs":{"text":{"type":"text","fields":{"TEXT":"猫😀"}}}}),
        ),
        (
            "random",
            json!({"type":"random_num","inputs":{"A":num(5.7),"B":num(6.2)}}),
        ),
    ] {
        body = json!({"type":"variables_set","fields":{"variable":name},"inputs":{"value":value},"next":body});
    }
    let mut vm = Engine::new(Program::compile(&project(body)).unwrap());
    vm.start();
    vm.set_mouse(12.0, -42.0);
    frame(&mut vm);
    for (name, expected) in [
        ("mouse", -42.0),
        ("length", 3.0),
        ("random", 6.0),
        ("angle", 45.0),
    ] {
        let index = vm
            .program
            .variable_names
            .iter()
            .position(|id| id == name)
            .unwrap();
        assert_eq!(vm.numeric_variables()[index], expected);
    }
}

#[test]
fn compiled_control_and_values_match_reference_interpreter() {
    let project = project(json!({"type":"warp","statements":{"DO":{
        "type":"repeat_n_times","inputs":{"times":num(77.0)},"statements":{"DO":{
            "type":"variables_set","fields":{"variable":"score"},"inputs":{"value":{
                "type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":{"type":"variables_get","fields":{"variable":"score"}},"B":num(3.0)}
            }},"next":movement(2.0)
        }}
    }}}));
    // Declare the variable so both engines start at zero rather than undefined.
    let mut project = project;
    project["variables"]["variablesDict"]["score"] = json!({"id":"score","value":0});
    let mut reference = Runtime::from_project(&project).unwrap();
    reference.set_cooperative(true);
    reference.start();
    reference.run_ticks(1).unwrap();
    let old = reference.snapshot();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let new = frame(&mut vm);
    assert_eq!(new.active, 0);
    assert_eq!(new.variables[0], 231.0);
    assert_eq!(old.variables["score"], RuntimeValue::Number(231.0));
    assert_eq!(new.sprites[1].y, old.actors["nekoc-default-actor"].y);
}

#[test]
fn pen_stream_is_ordered_and_clear_discards_earlier_commands() {
    let mut project = project(json!({"type":"self_pen_down","next":{
        "type":"self_go_forward","inputs":{"steps":num(5.0)},"next":{
            "type":"clear_drawing","next":movement(8.0)
        }
    }}));
    // Second actor draws after the first; the stream must preserve scheduling order.
    project["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"]
        .as_array_mut()
        .unwrap()
        .push(json!("other"));
    let mut other = project["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    other["id"] = json!("other");
    other["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated","next":{"type":"self_pen_down","next":movement(2.0)}}]);
    project["actors"]["actorsDict"]["other"] = other;
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let result = frame(&mut vm);
    assert!(result.clear);
    assert_eq!(result.lines.len(), 27); // post-clear line, second actor dot and line
    assert_eq!(&result.lines[..4], &[0.0, 5.0, 0.0, 13.0]);
    assert_eq!(&result.lines[18..22], &[0.0, 0.0, 0.0, 2.0]);
    vm.recycle_lines(result.lines);
    let next = frame(&mut vm);
    assert!(next.lines.is_empty());
    assert!(!next.clear);
}

#[test]
fn forever_yields_and_warp_budget_resumes_without_losing_state() {
    let project = project(
        json!({"type":"warp","statements":{"DO":{"type":"repeat_forever","statements":{"DO":movement(1.0)}}}}),
    );
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let first = vm.advance(1.0 / 60.0, 10, Duration::from_secs(2)).unwrap();
    assert!(first.budget_yield);
    assert_eq!(first.sprites[1].y, 5.0);
    let second = vm.advance(1.0 / 60.0, 10, Duration::from_secs(2)).unwrap();
    assert_eq!(second.sprites[0].y, 10.0);
    let ordinary = project_without_warp();
    let mut vm = Engine::new(Program::compile(&ordinary).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).sprites[1].y, 1.0);
    assert_eq!(frame(&mut vm).sprites[0].y, 2.0);
}
fn project_without_warp() -> Value {
    project(json!({"type":"repeat_forever","statements":{"DO":movement(1.0)}}))
}

#[test]
fn budget_rotation_prevents_starvation() {
    let mut p = project(
        json!({"type":"warp","statements":{"DO":{"type":"repeat_forever","statements":{"DO":movement(1.0)}}}}),
    );
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"].as_array_mut().unwrap().push(json!({"type":"on_running_group_activated","next":{"type":"self_set_position_x","inputs":{"value":num(42.0)}}}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let first = vm.advance(0.01, 8, Duration::from_secs(2)).unwrap();
    assert_eq!(first.sprites[1].x, 0.0);
    let second = vm.advance(0.01, 8, Duration::from_secs(2)).unwrap();
    assert_eq!(second.sprites[0].x, 42.0);
}

#[test]
fn empty_forever_is_live_and_until_exits_correctly() {
    let p = project(json!({"type":"repeat_forever","statements":{}}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).active, 1);
    let p = project(
        json!({"type":"repeat_forever_until","inputs":{"condition":{"type":"logic_boolean","fields":{"BOOL":"true"}}},"next":movement(7.0)}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.active, 0);
    assert_eq!(f.sprites[1].y, 7.0);
}

#[test]
fn nested_loop_break_restores_outer_counter() {
    let p = project(json!({"type":"warp","statements":{"DO":{
        "type":"repeat_n_times","inputs":{"times":num(4.0)},"statements":{"DO":{
            "type":"repeat_forever","statements":{"DO":{"type":"break"}},"next":movement(2.0)
        }}
    }}}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.active, 0);
    assert_eq!(f.sprites[1].y, 8.0);
}

#[test]
fn unsupported_block_is_a_diagnostic_not_silent_success() {
    let p = project(json!({"id":"sound-123","type":"future_unsupported_block"}));
    let e = Program::compile(&p).unwrap_err();
    assert!(format!("{e:#}").contains("sound-123"));
}

#[test]
fn text_split_copies_expression_lists_with_numeric_tokens_and_blank_preservation() {
    let mut p = project(json!({"type":"list_copy","inputs":{
        "list":{"type":"text_split","inputs":{
            "TEXT_TO_SPLIT":{"type":"text","fields":{"TEXT":"001| -2.5 | |猫||0x10|NaN|1e2"}},
            "SPLIT_TEXT":{"type":"text","fields":{"TEXT":"|"}}
        }},"target_list":{"type":"pure_list_get","fields":{"list":"out"}}
    }}));
    p["variables"]["variablesDict"]["out"] = json!({"type":"list","value":["old"]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(
        serde_json::to_value(vm.list_values(0)).unwrap(),
        json!([1.0, -2.5, " ", "猫", "", 16.0, "NaN", 100.0])
    );
    vm.start();
    assert_eq!(
        serde_json::to_value(vm.list_values(0)).unwrap(),
        json!(["old"])
    );
}

#[test]
fn audio_commands_preserve_order_and_are_deltas_across_frames_and_restart() {
    let p = project(
        json!({"type":"play_audio","inputs":{"audio_id":{"type":"get_play_audio","fields":{"audio_id":"song"}}},"next":{
            "type":"stop_audio","inputs":{"audio_id":{"type":"get_stop_audio","fields":{"audio_id":"song"}}},"next":{
                "type":"play_audio","inputs":{"audio_id":{"type":"get_play_audio","fields":{"audio_id":"song"}}}
            }
        }}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let expected = json!([{"audio":"song","play":true},{"audio":"song","play":false},{"audio":"song","play":true}]);
    assert_eq!(
        serde_json::to_value(frame(&mut vm).audio_commands).unwrap(),
        expected
    );
    assert!(frame(&mut vm).audio_commands.is_empty());
    vm.start();
    assert_eq!(
        serde_json::to_value(frame(&mut vm).audio_commands).unwrap(),
        expected
    );
}

#[test]
fn wait_uses_elapsed_seconds_and_zero_wait_yields() {
    let p = project(json!({"type":"wait","inputs":{"time":num(0.1)},"next":movement(10.0)}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(
        vm.advance(0.01, 100, Duration::from_secs(1))
            .unwrap()
            .sprites[1]
            .y,
        0.0
    );
    assert!(
        vm.advance(0.05, 100, Duration::from_secs(1))
            .unwrap()
            .sprites
            .is_empty()
    );
    assert_eq!(
        vm.advance(0.06, 100, Duration::from_secs(1))
            .unwrap()
            .sprites[0]
            .y,
        10.0
    );
}

#[test]
fn persistent_pen_memory_does_not_grow_with_execution_history() {
    let p = project(
        json!({"type":"self_pen_down","next":{"type":"repeat_forever","statements":{"DO":movement(1.0)}}}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    for n in 0..10000 {
        let f = frame(&mut vm);
        assert_eq!(f.lines.len(), if n == 0 { 18 } else { 9 });
        vm.recycle_lines(f.lines);
    }
}

#[test]
fn statement_procedures_are_compiled_once_and_inherit_warp() {
    let mut p = project(json!({"type":"warp","statements":{"DO":{
        "type":"procedures_2_callnoreturn","fields":{"NAME":"draw"},"mutation":"<mutation def_id=\"draw\"/>"
    }},"next":movement(1.0)}));
    p["procedures"]["proceduresDict"]["draw"] = json!({"id":"draw","nekoBlockJsonList":[{
        "type":"procedures_2_defnoreturn","id":"draw","statements":{"STACK":{
            "type":"repeat_n_times","inputs":{"times":num(3.0)},"statements":{"DO":movement(2.0)}
        }}
    }]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.active, 0);
    assert_eq!(f.sprites[1].y, 7.0);
}

#[test]
fn idle_frames_send_no_sprite_or_pen_history() {
    let p = project(movement(1.0));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let first = frame(&mut vm);
    assert!(first.reset);
    assert_eq!(first.sprites.len(), 2);
    let second = frame(&mut vm);
    assert!(!second.reset);
    assert!(second.sprites.is_empty());
    assert!(second.lines.is_empty());
}

#[test]
fn stress_bcmkn_compiles_and_streams_bounded_frames() {
    let project = nekoc::project::load_project("samples/web-pen-stress.bcmkn").unwrap();
    assert_eq!(
        nekoc::validate::build_report(&project.value).unwrap()["ok"],
        true
    );
    let mut vm = Engine::new(Program::compile(&project.value).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.lines.len(), 10001 * 9);
    assert!(f.clear);
    assert_eq!(f.active, 1);
    vm.recycle_lines(f.lines);
    let f = frame(&mut vm);
    assert!(f.clear);
    assert_eq!(f.lines.len(), 10001 * 9);
}

fn chain(blocks: Vec<Value>) -> Value {
    blocks
        .into_iter()
        .rev()
        .reduce(|next, mut block| {
            block["next"] = next;
            block
        })
        .unwrap()
}
fn log_value(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}

fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn local(s: &str) -> Value {
    json!({"type":"script_variables_value","fields":{"TEXT":s}})
}
fn set_local(s: &str, value: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":json!({"name":s,"type":"NEKO_SCRIPT_VARIABLE_TYPE-test"}).to_string()},"inputs":{"value":value}})
}
fn declare(s: &str) -> Value {
    json!({"type":"script_variables","inputs":{"PARAMS0":{"type":"script_variables_param","fields":{"TEXT":s}}}})
}
fn item(list: Value, index: f64) -> Value {
    json!({"type":"list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":num(index)}})
}

#[test]
fn mixed_lists_preserve_aliases_deep_copy_and_restart_isolation() {
    let list = json!({"type":"pure_list_get","fields":{"list":"items"}});
    let p = project(chain(vec![
        declare("alias"),
        declare("copy"),
        declare("nested"),
        declare("copiedNested"),
        set_local("alias", list.clone()),
        json!({"type":"list_insert_value","inputs":{"list":local("alias"),"list_index":num(2.0),"list_item_value":text("Stone")}}),
        json!({"type":"replace_list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":num(1.0),"list_item_value":text("Dirt")}}),
        set_local("copy", json!({"type":"temporary_list"})),
        json!({"type":"list_copy","inputs":{"list":list,"target_list":local("copy")}}),
        set_local("nested", item(list.clone(), 4.0)),
        set_local("copiedNested", item(local("copy"), 4.0)),
        json!({"type":"list_append","inputs":{"list":local("nested"),"list_item_value":text("new")}}),
        log_value(local("copy")),
        log_value(local("alias")),
        // Copying onto the same list is safe, including nested elements.
        json!({"type":"list_copy","inputs":{"list":list,"target_list":list}}),
        log_value(item(local("copiedNested"), 1.0)),
    ]));
    let mut p = p;
    p["variables"]["variablesDict"]["items"] =
        json!({"type":"list","value":["Grass",true,["seed"]]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(
        frame(&mut vm).logs,
        ["Dirt,Stone,true,seed", "Dirt,Stone,true,seed,new", "seed"]
    );
    assert_eq!(
        serde_json::to_value(vm.list_values(0)).unwrap(),
        json!(["Dirt", "Stone", true, ["seed", "new"]])
    );
    vm.start();
    assert_eq!(
        serde_json::to_value(vm.list_values(0)).unwrap(),
        json!(["Grass", true, ["seed"]])
    );
    assert_eq!(
        frame(&mut vm).logs,
        ["Dirt,Stone,true,seed", "Dirt,Stone,true,seed,new", "seed"]
    );
}

#[test]
fn cyclic_lists_report_the_source_block_instead_of_panicking() {
    let list = json!({"type":"pure_list_get","fields":{"list":"items"}});
    let mut p = project(
        json!({"id":"cycle-source","type":"list_append","inputs":{"list":list,"list_item_value":list}}),
    );
    p["variables"]["variablesDict"]["items"] = json!({"type":"list","value":[]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let error = vm
        .advance(0.0, 100, Duration::from_secs(1))
        .unwrap_err()
        .to_string();
    assert!(error.contains("cyclic list at cycle-source"), "{error}");
    vm.start();
    assert!(vm.list_values(0).is_empty());
}

#[test]
fn task_locals_survive_yields_and_procedure_calls_but_redeclarations_reset() {
    let call =
        json!({"type":"procedures_2_callnoreturn","mutation":"<mutation def_id=\"nested\"/>"});
    let script = |n| {
        chain(vec![
            declare("scratch"),
            set_local("scratch", num(n)),
            json!({"type":"wait","inputs":{"time":num(0.0)}}),
            call.clone(),
            log_value(local("scratch")),
            declare("scratch"),
            log_value(local("scratch")),
        ])
    };
    let mut p = project(script(35.0));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"on_running_group_activated","next":script(100.0)}));
    p["procedures"]["proceduresDict"]["nested"] = json!({"nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","id":"nested","statements":{"STACK":set_local("scratch",json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":local("scratch"),"B":num(7.0)}}))}}]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(frame(&mut vm).logs.is_empty());
    assert_eq!(frame(&mut vm).logs, ["42", "0", "107", "0"]);
}

#[test]
fn nested_values_boolean_truth_and_utf16_text_slices() {
    let select = |start, end| json!({"type":"text_select","inputs":{"text":text("A😀中文Z"),"start_index":num(start),"end_index":num(end)}});
    let compare = json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":select(4.0,5.0),"B":text("中文")}});
    let arithmetic = json!({"type":"math_arithmetic","fields":{"type":"multiply"},"inputs":{"A":num(3.0),"B":{"type":"convert_type","fields":{"type":"number"},"inputs":{"text":{"type":"text_join","inputs":{"ADD0":num(1.0),"ADD1":num(2.0)}}}}}});
    let p = project(chain(vec![
        log_value(arithmetic),
        log_value(compare),
        log_value(select(2.0, 3.0)),
        log_value(select(5.0, 4.0)),
        log_value(select(100.0, 100.0)),
        log_value(select(-2.0, -1.0)),
        json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_operation","fields":{"type":"and"},"inputs":{"A":text("hello"),"B":{"type":"logic_negate","inputs":{"logic":text("")}}}}},"statements":{"DO0":log_value(text("truthy"))}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(
        frame(&mut vm).logs,
        ["36", "true", "😀", "文中", "", "", "truthy"]
    );
}

#[test]
fn held_key_state_and_timer_visibility_reset() {
    let p = project(chain(vec![
        json!({"type":"show_hide_timer","fields":{"showHide":"show"}}),
        json!({"type":"repeat_forever","statements":{"DO":log_value(json!({"type":"check_key","fields":{"type":"down","key":"87"}}))}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    vm.set_pressed_keys(["87".into()]);
    let f = frame(&mut vm);
    assert_eq!(f.logs, ["1"]);
    assert!(f.timer_visible);
    assert_eq!(frame(&mut vm).logs, ["1"]);
    vm.set_pressed_keys([]);
    assert_eq!(frame(&mut vm).logs, ["0"]);
    vm.set_pressed_keys(["87".into()]);
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["0"]);
}
fn range_value(name: &str) -> Value {
    json!({"type":"traverse_number_value","fields":{"TEXT":name}})
}

fn broadcast(kind: &str, message: Value) -> Value {
    json!({"type":kind,"inputs":{"message":message}})
}
fn listener(message: &str, body: Value, parameter: bool) -> Value {
    json!({"type":if parameter {"self_listen_with_param"} else {"self_listen"},
        "inputs":{"message":{"type":"broadcast_input","fields":{"message":message}}},"statements":{"DO":body}})
}
fn add_hat(p: &mut Value, hat: Value) {
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(hat);
}

#[test]
fn broadcast_wait_runs_listener_bodies_and_nested_waits_under_tiny_budgets() {
    let mut p = project(chain(vec![
        broadcast("self_broadcast_and_wait", text("outer")),
        log_value(text("sender complete")),
        broadcast("self_broadcast_and_wait", text("nobody")),
        log_value(text("no receivers")),
    ]));
    add_hat(
        &mut p,
        listener(
            "outer",
            chain(vec![
                log_value(text("outer")),
                broadcast("self_broadcast_and_wait", text("inner")),
                log_value(text("outer complete")),
            ]),
            false,
        ),
    );
    add_hat(
        &mut p,
        listener(
            "inner",
            chain(vec![
                json!({"type":"wait","inputs":{"time":num(0.05)}}),
                log_value(text("inner complete")),
            ]),
            false,
        ),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let mut logs = vec![];
    for _ in 0..100 {
        let f = vm.advance(1.0 / 60.0, 2, Duration::from_secs(1)).unwrap();
        logs.extend(f.logs);
        if f.active == 0 {
            break;
        }
    }
    assert_eq!(vm.active_tasks(), 0);
    assert_eq!(
        logs,
        [
            "outer",
            "inner complete",
            "outer complete",
            "sender complete",
            "no receivers"
        ]
    );
}

#[test]
fn concurrent_broadcast_payloads_are_per_task_and_received_is_a_frame_pulse() {
    let send = |param| json!({"type":"self_broadcast_with_param","inputs":{"message":text("data"),"param":text(param)}});
    let received = json!({"type":"received_broadcast","inputs":{"message":text("data")}});
    let payload = json!({"type":"self_listen_value"});
    let mut p = project(chain(vec![
        send("甲"),
        send("乙"),
        log_value(received.clone()),
        json!({"type":"wait","inputs":{"time":num(0.0)}}),
        log_value(received),
    ]));
    add_hat(
        &mut p,
        listener(
            "data",
            chain(vec![
                declare("private"),
                set_local("private", payload.clone()),
                json!({"type":"wait","inputs":{"time":num(0.0)}}),
                log_value(local("private")),
                log_value(payload),
            ]),
            true,
        ),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["true"]);
    assert_eq!(frame(&mut vm).logs, ["false", "甲", "甲", "乙", "乙"]);
    assert_eq!(vm.active_tasks(), 0);
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["true"]);
}

#[test]
fn stop_scopes_target_entities_and_release_broadcast_waiters() {
    for scope in ["0", "1", "2", "3"] {
        let mut p = project(chain(vec![
            json!({"type":"stop","fields":{"scope":scope}}),
            log_value(text("current")),
        ]));
        add_hat(
            &mut p,
            json!({"type":"on_running_group_activated","next":log_value(text("same"))}),
        );
        let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
        other["nekoBlockJsonList"] =
            json!([{"type":"on_running_group_activated","next":log_value(text("other"))}]);
        p["actors"]["actorsDict"]["other"] = other;
        let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
        p["scenes"]["scenesDict"][&scene]["actorIds"]
            .as_array_mut()
            .unwrap()
            .push(json!("other"));
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        let expected = match scope {
            "0" => vec![],
            "1" => vec!["same", "other"],
            "2" => vec!["current", "other"],
            _ => vec!["current", "same"],
        };
        assert_eq!(frame(&mut vm).logs, expected, "scope {scope}");
        if scope == "0" {
            vm.key("32");
            assert_eq!(vm.active_tasks(), 0);
        }
    }
    let mut p = project(chain(vec![
        broadcast("self_broadcast_and_wait", text("cancel")),
        log_value(text("released")),
    ]));
    add_hat(
        &mut p,
        listener(
            "cancel",
            json!({"type":"repeat_forever","statements":{"DO":movement(1.0)}}),
            false,
        ),
    );
    add_hat(
        &mut p,
        listener(
            "cancel",
            json!({"type":"stop","fields":{"scope":"1"}}),
            false,
        ),
    );
    add_hat(
        &mut p,
        json!({"type":"on_keydown","fields":{"key":"32","type":"down"},"next":{"type":"stop","fields":{"scope":"2"}}}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(frame(&mut vm).logs.is_empty());
    vm.key("32");
    let f = frame(&mut vm);
    assert_eq!(f.active, 0);
    assert!(f.logs.is_empty(), "stopped sender must not resume");
}

#[test]
fn listener_stop_current_unblocks_sender_and_recursive_broadcast_is_bounded() {
    let mut p = project(chain(vec![
        broadcast("self_broadcast_and_wait", text("stop")),
        log_value(text("released")),
    ]));
    add_hat(
        &mut p,
        listener("stop", json!({"type":"stop","fields":{"scope":"1"}}), false),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["released"]);
    assert_eq!(vm.active_tasks(), 0);
    let mut p = project(broadcast("self_broadcast_and_wait", text("loop")));
    add_hat(
        &mut p,
        listener(
            "loop",
            broadcast("self_broadcast_and_wait", text("loop")),
            false,
        ),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = vm.advance(0.0, 20, Duration::from_secs(1)).unwrap();
    assert!(f.budget_yield);
    assert_eq!(f.instructions, 20);
    let err = vm
        .advance(0.0, 100_000, Duration::from_secs(2))
        .unwrap_err();
    assert!(err.to_string().contains("task limit"), "{err}");
}

#[test]
fn plain_broadcast_does_not_wait_and_stopping_other_actors_releases_waiters() {
    let mut p = project(chain(vec![
        broadcast("self_broadcast", text("work")),
        log_value(text("sender")),
    ]));
    add_hat(
        &mut p,
        listener(
            "work",
            chain(vec![
                json!({"type":"wait","inputs":{"time":num(0.05)}}),
                log_value(text("receiver")),
            ]),
            false,
        ),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["sender"]);
    assert!(frame(&mut vm).logs.is_empty());
    let logs = (0..5).flat_map(|_| frame(&mut vm).logs).collect::<Vec<_>>();
    assert_eq!(logs, ["receiver"]);

    let mut p = project(chain(vec![
        broadcast("self_broadcast_and_wait", text("work")),
        log_value(text("released")),
    ]));
    add_hat(
        &mut p,
        json!({"type":"on_keydown","fields":{"key":"32","type":"down"},"next":{"type":"stop","fields":{"scope":"3"}}}),
    );
    let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    other["nekoBlockJsonList"] = json!([listener(
        "work",
        json!({"type":"repeat_forever","statements":{"DO":movement(1.0)}}),
        false
    )]);
    p["actors"]["actorsDict"]["other"] = other;
    let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
    p["scenes"]["scenesDict"][&scene]["actorIds"]
        .as_array_mut()
        .unwrap()
        .push(json!("other"));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(frame(&mut vm).logs.is_empty());
    vm.key("32");
    let f = frame(&mut vm);
    assert_eq!(f.logs, ["released"]);
    assert_eq!(f.active, 0);
}

#[test]
fn actual_32_column_display_has_a_complete_frame_barrier_across_budget_yields() {
    let project = nekoc::project::load_project("samples/pen_display_columns.bcmkn").unwrap();
    let program = Program::compile(&project.value).unwrap();
    let frames = program
        .variable_names
        .iter()
        .position(|n| n == "kn-var-__pd_frames")
        .unwrap();
    let front = program
        .list_names
        .iter()
        .position(|n| n == "kn-list-__pd_front")
        .unwrap();
    let back = program
        .list_names
        .iter()
        .position(|n| n == "kn-list-__pd_back")
        .unwrap();
    assert_eq!(program.stats().scripts, 36);
    let mut vm = Engine::new(program);
    vm.start();
    let mut completed = 0.0;
    let mut lines = 0;
    let mut green_band = false;
    for _ in 0..10000 {
        let f = vm.advance(1.0 / 60.0, 500, Duration::from_secs(1)).unwrap();
        lines += f.lines.len() / 9;
        green_band |=
            f.lines.as_chunks::<9>().0.iter().any(|line| {
                line[5] < 0.05 && line[6] > 0.95 && (line[7] - 128.0 / 255.0).abs() < 0.01
            });
        if f.variables[frames] > completed {
            assert_eq!(vm.numeric_lists()[front], vm.numeric_lists()[back]);
            completed = f.variables[frames];
        }
        assert!(f.active <= 33, "receiver tasks leaked across broadcasts");
        vm.recycle_lines(f.lines);
        if completed >= 5.0 {
            break;
        }
    }
    assert_eq!(completed, 5.0);
    assert!(lines > 1000);
    assert!(
        green_band,
        "column brush must establish brightness before HSV saturation at black"
    );
}

#[test]
fn native_blank_numeric_shadows_accept_num_and_text_without_masking_bad_numbers() {
    let mut p = project(chain(vec![
        log_value(json!({"type":"math_number","fields":{"NUM":""}})),
        log_value(json!({"type":"math_number","fields":{"TEXT":"  "}})),
        log_value(json!({"type":"math_number","fields":{"TEXT":"12.5"}})),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["0", "0", "12.5"]);
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
        log_value(json!({"id":"bad-num","type":"math_number","fields":{"NUM":"not numeric"}}));
    assert!(format!("{:#}", Program::compile(&p).unwrap_err()).contains("bad-num"));
}

#[test]
fn released_key_reporter_is_an_event_pulse_not_a_never_pressed_key() {
    let mut p = project(
        json!({"type":"repeat_forever","statements":{"DO":chain(vec![
            log_value(json!({"type":"check_key","fields":{"type":"up","key":"32"}})),
            log_value(json!({"type":"check_key","fields":{"type":"down","key":"any"}})),
        ])}}),
    );
    add_hat(
        &mut p,
        json!({"type":"on_keydown","fields":{"type":"up","key":"any"},"next":log_value(text("released any"))}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["0", "0"]);
    vm.set_pressed_keys(["32".into()]);
    assert_eq!(frame(&mut vm).logs, ["0", "1"]);
    vm.key_event("32", false);
    assert_eq!(frame(&mut vm).logs, ["1", "0", "released any"]);
    assert_eq!(frame(&mut vm).logs, ["0", "0"]);
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["0", "0"]);
}

#[test]
fn parameterized_statement_procedures_preserve_dynamic_values_and_list_identity() {
    let param = |name| json!({"type":"procedures_2_parameter","fields":{"param_name":name}});
    let args = json!({"s":text("中文😀"),"flag":{"type":"logic_boolean","fields":{"BOOL":"true"}},"items":{"type":"pure_list_get","fields":{"list":"items"}}});
    let mut p = project(
        json!({"type":"warp","statements":{"DO":{"type":"procedures_2_callnoreturn","mutation":"<mutation def_id=\"values\"></mutation>","inputs":args}}}),
    );
    p["variables"]["variablesDict"]["items"] = json!({"type":"list","value":[]});
    p["procedures"]["proceduresDict"]["values"] = json!({"params":[
        {"type":"String","id":"s","name":"s"},{"type":"Boolean","id":"flag","name":"flag"},{"type":"String","id":"items","name":"items"}
    ],"nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","statements":{"STACK":chain(vec![
        log_value(param("s")),log_value(param("flag")),
        json!({"type":"list_append","inputs":{"list":param("items"),"list_item_value":param("s")}}),
    ])}}]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["中文😀", "true"]);
    assert_eq!(
        serde_json::to_value(vm.list_values(0)).unwrap(),
        json!(["中文😀"])
    );
    vm.start();
    assert!(vm.list_values(0).is_empty());
}

#[test]
fn current_polyhedron_prefix_negations_have_operands_and_compile() {
    let p = nekoc::project::load_project("samples/pen_polyhedron.bcmkn").unwrap();
    fn walk(b: &Value, count: &mut usize) {
        if let Some(map) = b.as_object() {
            if b["type"] == "logic_negate" {
                assert!(
                    b["inputs"]["logic"].is_object(),
                    "missing operand at {}",
                    b["id"]
                );
                *count += 1;
            }
            for value in map.values() {
                walk(value, count);
            }
        } else if let Some(values) = b.as_array() {
            for value in values {
                walk(value, count);
            }
        }
    }
    let mut count = 0;
    walk(&p.value, &mut count);
    assert!(count > 0);
    let mut vm = Engine::new(Program::compile(&p.value).unwrap());
    vm.start();
    for _ in 0..3 {
        frame(&mut vm);
    }
}

#[test]
fn parameterized_procedures_restore_recursive_arguments_across_yields() {
    let param = json!({"type":"procedures_2_parameter","fields":{"param_name":"n"}});
    let call = |value| json!({"type":"procedures_2_callnoreturn","mutation":"<mutation def_id=\"recurse\"></mutation>","inputs":{"arg-n":value}});
    let mut p = project(call(num(3.0)));
    add_hat(
        &mut p,
        json!({"type":"on_running_group_activated","next":call(num(1.0))}),
    );
    p["procedures"]["proceduresDict"]["recurse"] = json!({
    "params":[{"type":"Label","name":"count"},{"type":"String","id":"arg-n","name":"n"}],
    "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","mutation":"<mutation><arg type=\"String\" name=\"n\" id=\"arg-n\"></arg></mutation>","statements":{"STACK":chain(vec![
        log_value(param.clone()),
        json!({"type":"wait","inputs":{"time":num(0.0)}}),
        json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":param,"B":num(1.0)}}},"statements":{"DO0":call(json!({"type":"math_arithmetic","fields":{"type":"minus"},"inputs":{"A":param,"B":num(1.0)}}))}}),
        log_value(param.clone()),
    ])}}]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let logs = (0..5).flat_map(|_| frame(&mut vm).logs).collect::<Vec<_>>();
    assert_eq!(logs, ["3", "1", "2", "1", "1", "1", "2", "3"]);
    assert_eq!(vm.active_tasks(), 0);
}

#[test]
fn wait_until_key_up_list_search_text_contains_cross_actor_and_costume_wrap() {
    let list = json!({"type":"temporary_list","inputs":{"ITEM0":text("1"),"ITEM1":num(1.0),"ITEM2":text("猫")}});
    let find = |kind, value| json!({"type":kind,"inputs":{"list":list,"list_item_value":value}});
    let mut p = project(chain(vec![
        json!({"type":"wait_until","inputs":{"condition":{"type":"check_key","fields":{"type":"up","key":"32"}}}}),
        log_value(find("list_index_of", num(1.0))),
        log_value(find("list_index_of", text("1"))),
        log_value(find("list_index_of", text("absent"))),
        log_value(find("list_is_exist", text("猫"))),
        log_value(json!({"type":"text_contain","inputs":{"A":text("中文😀"),"B":text("😀")}})),
        log_value(
            json!({"type":"coordinate_of_sprite","fields":{"sprite":"other","coordinate":"x"}}),
        ),
        log_value(
            json!({"type":"appearance_of_sprite","fields":{"sprite":"other","appearance":"direction"}}),
        ),
        log_value(json!({"type":"get_orientation","fields":{"target":"left"}})),
        json!({"type":"self_change_coordinate_x","fields":{"increase":"decrease"},"inputs":{"value":num(7.0)}}),
        json!({"type":"self_prev_next_style","fields":{"prev_next":"prev"}}),
    ]));
    let actor = &mut p["actors"]["actorsDict"]["nekoc-default-actor"];
    actor["styles"] = json!(["one", "two", "three"]);
    actor["currentStyleId"] = json!("one");
    let mut other = actor.clone();
    other["position"]["x"] = json!(123);
    other["rotation"] = json!(std::f64::consts::FRAC_PI_2);
    other["nekoBlockJsonList"] = json!([]);
    p["actors"]["actorsDict"]["other"] = other;
    let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
    p["scenes"]["scenesDict"][&scene]["actorIds"]
        .as_array_mut()
        .unwrap()
        .push(json!("other"));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    vm.set_pressed_keys(["32".into()]);
    assert!(frame(&mut vm).logs.is_empty());
    vm.set_pressed_keys([]);
    let f = frame(&mut vm);
    assert_eq!(f.logs, ["2", "1", "0", "true", "true", "123", "90", "0"]);
    assert_eq!(f.sprites[0].x, -7.0);
    assert_eq!(f.sprites[0].style.as_deref(), Some("three"));
}
fn range(name: &str, from: f64, to: f64, by: f64, body: Value) -> Value {
    json!({"type":"traverse_number","inputs":{"value":{"type":"traverse_number_param","fields":{"TEXT":name}},"from":num(from),"to":num(to),"by":num(by)},"statements":{"DO":body}})
}

#[test]
fn ranges_round_endpoints_descend_and_restore_nested_values_across_budgets() {
    let p = project(
        json!({"type":"warp","statements":{"DO":range("i",1.2,3.0,1.0,chain(vec![
            log_value(range_value("i")),
            range("i",5.8,2.2,1.6,chain(vec![log_value(range_value("i")),json!({"type":"break"})])),
            log_value(range_value("i")),
            range("j",5.8,2.2,1.6,log_value(range_value("j"))),
        ]))}}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let mut logs = vec![];
    for _ in 0..200 {
        let f = vm.advance(0.0, 2, Duration::from_secs(1)).unwrap();
        logs.extend(f.logs);
        if f.active == 0 {
            break;
        }
    }
    assert_eq!(vm.active_tasks(), 0);
    assert_eq!(logs, ["2", "5", "2", "5", "3", "3", "5", "3", "5", "3"]);
    let p = project(range("bad", 0.0, 10.0, 0.0, movement(1.0)));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(
        vm.advance(0.0, 100, Duration::from_secs(1))
            .unwrap_err()
            .to_string()
            .contains("positive rounded step")
    );
}

#[test]
fn concurrent_range_scripts_have_independent_counters() {
    let mut p = project(range("i", 1.0, 3.0, 1.0, log_value(range_value("i"))));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"].as_array_mut().unwrap().push(
        json!({"type":"on_running_group_activated","next":range("i",10.0,12.0,1.0,log_value(range_value("i")))}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let logs = (0..3).flat_map(|_| frame(&mut vm).logs).collect::<Vec<_>>();
    assert_eq!(logs, ["1", "10", "2", "11", "3", "12"]);
    assert_eq!(vm.active_tasks(), 0);
}

#[test]
fn numeric_lists_use_rounded_one_based_indices_and_reset_on_restart() {
    let list = json!({"type":"pure_list_get","fields":{"list":"items"}});
    let mut p = project(chain(vec![
        json!({"type":"list_append","inputs":{"list":list,"list_item_value":num(40.0)}}),
        json!({"type":"delete_list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":num(1.5)}}),
        log_value(json!({"type":"list_length","inputs":{"list":list}})),
        log_value(
            json!({"type":"list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":num(0.0)}}),
        ),
        log_value(json!({"type":"list_item","fields":{"item":"last"},"inputs":{"list":list}})),
        json!({"type":"delete_list_item","fields":{"item":"last"},"inputs":{"list":list}}),
        json!({"type":"delete_list_item","fields":{"item":"all"},"inputs":{"list":list}}),
    ]));
    p["variables"]["variablesDict"]["items"] = json!({"type":"list","value":[10,20,30]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(frame(&mut vm).logs, ["3", "10", "40"]);
    assert!(vm.numeric_lists()[0].is_empty());
    vm.start();
    assert_eq!(vm.numeric_lists()[0], [10.0, 20.0, 30.0]);
}

#[test]
fn timer_stop_does_not_stop_waits_and_reset_restarts_timer() {
    let timer = json!({"type":"timer"});
    let p = project(chain(vec![
        json!({"type":"set_timer_state","fields":{"type":"stop"}}),
        json!({"type":"wait","inputs":{"time":num(0.1)}}),
        log_value(timer.clone()),
        json!({"type":"set_timer_state","fields":{"type":"reset"}}),
        json!({"type":"wait","inputs":{"time":num(0.1)}}),
        log_value(timer),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    vm.advance(0.0, 100, Duration::from_secs(1)).unwrap();
    assert_eq!(
        vm.advance(0.1, 100, Duration::from_secs(1)).unwrap().logs,
        ["0"]
    );
    assert_eq!(
        vm.advance(0.1, 100, Duration::from_secs(1)).unwrap().logs,
        ["0.1"]
    );
}

#[test]
fn text_stamps_capture_color_position_and_execution_order() {
    let stamp = json!({"type":"stamp","fields":{"align":"right"},"inputs":{"size":num(24.0),"text":{
        "type":"text_join","inputs":{"ADD10":{"type":"text","fields":{"TEXT":"!"}},"ADD2":num(12.0),"ADD0":{"type":"text","fields":{"TEXT":"FPS: "}}}
    }}});
    let p = project(chain(vec![
        json!({"type":"self_set_pen_color","fields":{"color":"#ff0000"}}),
        json!({"type":"self_set_pen_color_property","fields":{"scope":"hue"},"inputs":{"val":num(-240.0)}}),
        json!({"type":"self_set_pen_color_property","fields":{"scope":"brightness"},"inputs":{"val":num(50.0)}}),
        json!({"type":"self_set_pen_color_property","fields":{"scope":"alpha"},"inputs":{"val":num(25.0)}}),
        stamp.clone(),
        json!({"type":"clear_drawing"}),
        json!({"type":"self_pen_down"}),
        movement(3.0),
        stamp,
        json!({"type":"self_set_pen_color","fields":{"color":"#0000ff"}}),
        movement(2.0),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.text_stamps.len(), 1);
    let stamp = &f.text_stamps[0];
    assert_eq!(stamp.text, "FPS: 12!");
    assert_eq!(stamp.before_line, 2);
    assert_eq!(stamp.y, 3.0);
    assert_eq!(stamp.color, [0.0, 0.5, 0.0, 0.75]);
    assert_eq!(&f.lines[23..27], &[0.0, 0.0, 1.0, 0.75]);
}

#[test]
fn actual_pen_display_runs_with_bands_fps_stamps_and_refresh_keys() {
    let p = nekoc::project::load_project("samples/pen_display_fast.bcmkn").unwrap();
    let mut vm = Engine::new(Program::compile(&p.value).unwrap());
    vm.start();
    let mut strokes = 0;
    let mut stamps = vec![];
    let mut colors = std::collections::BTreeSet::new();
    for _ in 0..180 {
        let f = frame(&mut vm);
        assert_eq!(f.active, 1);
        strokes += f.lines.len() / 9;
        for line in f.lines.as_chunks::<9>().0 {
            assert_eq!(line[8], 1.0);
            colors.insert(
                line[5..8]
                    .iter()
                    .map(|c| (c * 255.0).round() as u8)
                    .collect::<Vec<_>>(),
            );
        }
        stamps.extend(f.text_stamps);
        vm.recycle_lines(f.lines);
    }
    assert!(strokes > 500);
    assert!(stamps.len() >= 3);
    assert!(stamps.iter().all(|s| s.text.starts_with("FPS: ")));
    assert!(colors.contains(&vec![0, 255, 128]));
    assert!(colors.contains(&vec![252, 3, 128]));
    assert!(vm.numeric_lists()[0].is_empty());
    let fps = vm
        .program
        .variable_names
        .iter()
        .position(|n| n == "kn-var-__pd_fps")
        .unwrap();
    for (key, expected) in [("49", 15.0), ("50", 30.0), ("51", 60.0)] {
        vm.key(key);
        frame(&mut vm);
        assert_eq!(vm.numeric_variables()[fps], expected);
    }
}

#[test]
fn pen_properties_match_hsl_backed_black_and_preserve_transparency() {
    let property = |scope: &str, value: f64| json!({"type":"self_set_pen_color_property","fields":{"scope":scope},"inputs":{"val":num(value)}});
    let p = project(chain(vec![
        property("hue", 120.0),
        property("saturation", 100.0),
        property("brightness", 100.0),
        json!({"type":"self_pen_down"}),
        json!({"type":"self_change_pen_color_property","fields":{"scope":"alpha","increase":"increase"},"inputs":{"steps":num(20.0)}}),
        json!({"type":"self_set_pen_color","fields":{"color":"#ff0000"}}),
        movement(1.0),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(&f.lines[5..9], &[1.0, 1.0, 1.0, 1.0]);
    assert_eq!(&f.lines[14..18], &[1.0, 0.0, 0.0, 0.8]);
}

#[test]
fn pencraft_imported_mixed_lists_locals_and_procedures_execute() {
    let project = nekoc::project::load_project("samples/pencraft.bcmkn").unwrap();
    let program = Program::compile(&project.value).unwrap();
    let frames = program
        .variable_names
        .iter()
        .position(|n| n == "kn-var-frames");
    let mut vm = Engine::new(program);
    vm.start();
    let mut strokes = 0;
    let mut stamps = vec![];
    for _ in 0..120 {
        let f = vm
            .advance(1.0 / 60.0, 500_000, Duration::from_millis(100))
            .unwrap();
        strokes += f.lines.len() / 9;
        stamps.extend(f.text_stamps);
        vm.recycle_lines(f.lines);
        if stamps.len() > 10 {
            break;
        }
    }
    assert!(strokes > 100, "strokes={strokes}");
    assert!(!stamps.is_empty());
    eprintln!(
        "pencraft strokes={strokes} stamps={} frames={:?}",
        stamps.len(),
        frames.map(|i| vm.numeric_variables()[i])
    );
}

#[test]
fn coalescing_runs_invisible_ticks_but_never_shortens_waits() {
    // forever { score += 1; wait 0 } has no visible output: coalescing runs it
    // repeatedly in one frame; the default keeps one tick per frame.
    let mut p = project(json!({"type":"repeat_forever","statements":{"DO":{
        "type":"change_variables","fields":{"variable":"score","method":"increase"},"inputs":{"value":num(1.0)},
        "next":{"type":"wait","inputs":{"time":num(0.0)}}}}}));
    p["variables"]["variablesDict"]["score"] = json!({"id":"score","value":0});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let budget = Duration::from_secs(2);
    let f = vm.advance_with(1.0 / 60.0, 1_000_000, budget, 1).unwrap();
    assert_eq!((f.ticks, vm.numeric_variables()[0]), (1, 1.0));
    let f = vm.advance_with(1.0 / 60.0, 1_000_000, budget, 16).unwrap();
    // Each iteration yields twice (wait 0, loop end): 16 ticks = 8 more iterations.
    assert_eq!((f.ticks, vm.numeric_variables()[0]), (16, 9.0));

    // A timed wait is not completed by extra zero-dt ticks.
    let p = project(json!({"type":"wait","inputs":{"time":num(0.1)},"next":movement(10.0)}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    vm.advance_with(0.01, 1_000, budget, 16).unwrap();
    let f = vm.advance_with(0.05, 1_000, budget, 16).unwrap();
    assert!(f.sprites.is_empty() && f.active == 1, "wait finished early");
    let f = vm.advance_with(0.06, 1_000, budget, 16).unwrap();
    assert_eq!(f.sprites[0].y, 10.0);

    // A visible change ends the frame: one stroke per tick, one tick per frame.
    let mut vm = Engine::new(
        Program::compile(&project(
            json!({"type":"repeat_forever","statements":{"DO":movement(1.0)}}),
        ))
        .unwrap(),
    );
    vm.start();
    vm.advance_with(1.0 / 60.0, 1_000, budget, 16).unwrap();
    assert_eq!(
        vm.advance_with(1.0 / 60.0, 1_000, budget, 16)
            .unwrap()
            .ticks,
        1
    );
}

fn var_project(body: Value, names: &[&str]) -> Value {
    let mut p = project(body);
    for name in names {
        p["variables"]["variablesDict"][*name] = json!({"id":name,"value":0});
    }
    p
}
fn set(name: &str, value: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":name},"inputs":{"value":value}})
}

#[test]
fn operator_reporters_follow_native_dropdowns() {
    let unary = |kind: &str, field: Value, n: f64| json!({"type":kind,"fields":field,"inputs":{"num":num(n)}});
    let p = var_project(
        chain(vec![
            set(
                "a",
                json!({"type":"divisible_by","inputs":{"A":num(12.0),"B":num(4.0)}}),
            ),
            set(
                "b",
                json!({"type":"divisible_by","inputs":{"NUMBER_TO_CHECK":num(7.0),"DIVISOR":num(2.0)}}),
            ),
            set(
                "c",
                unary("math_number_property", json!({"type":"prime"}), 13.0),
            ),
            set(
                "d",
                json!({"type":"math_number_property","fields":{"PROPERTY":"EVEN"},"inputs":{"NUMBER_TO_CHECK":num(9.0)}}),
            ),
            set("e", unary("math_function", json!({"type":"6"}), 2.0)),
            set(
                "f",
                unary("math_function", json!({"type":"3"}), std::f64::consts::E),
            ),
            set(
                "g",
                json!({"type":"math_round","fields":{"OP":"ROUNDUP"},"inputs":{"NUM":num(1.2)}}),
            ),
            set(
                "h",
                json!({"type":"get_stage_info","fields":{"info":"height"}}),
            ),
        ]),
        &["a", "b", "c", "d", "e", "f", "g", "h"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    let v = vm.numeric_variables();
    assert_eq!(&v[..5], &[1.0, 0.0, 1.0, 0.0, 100.0]);
    assert!((v[5] - 1.0).abs() < 1e-12);
    assert_eq!(v[6], 2.0);
    assert_eq!(v[7], vm.program.height);
}

#[test]
fn else_if_chain_takes_first_true_branch() {
    let mut p = var_project(
        json!({"type":"controls_if",
        "inputs":{"IF0":{"type":"logic_boolean","fields":{"BOOL":"FALSE"}},"IF1":{"type":"logic_boolean","fields":{"BOOL":"TRUE"}},"IF2":{"type":"logic_boolean","fields":{"BOOL":"TRUE"}}},
        "statements":{"DO0":set("r", num(1.0)),"DO1":set("r", num(2.0)),"DO2":set("r", num(3.0)),"ELSE":set("r", num(4.0))}}),
        &["r"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 2.0);
    // All false falls through to ELSE.
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["inputs"]["IF1"]
        ["fields"]["BOOL"] = json!("FALSE");
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["inputs"]["IF2"]
        ["fields"]["BOOL"] = json!("FALSE");
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 4.0);
}

#[test]
fn glide_interpolates_over_time_and_draws_pen_segments() {
    let p = project(chain(vec![
        json!({"type":"self_pen_down"}),
        json!({"type":"self_glide_to","inputs":{"time":num(0.5),"x":num(100.0),"y":num(50.0)}}),
        json!({"type":"self_glide_coordinate","fields":{"coordinary":"x","increase":"decrease"},"inputs":{"time":num(0.0),"value":num(30.0)}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let budget = Duration::from_secs(1);
    let f = vm.advance(0.0, 1000, budget).unwrap();
    assert_eq!((f.sprites[1].x, f.sprites[1].y), (0.0, 0.0));
    let f = vm.advance(0.25, 1000, budget).unwrap();
    assert_eq!((f.sprites[0].x, f.sprites[0].y), (50.0, 25.0));
    assert!(!f.lines.is_empty());
    let f = vm.advance(0.25, 1000, budget).unwrap();
    // Glide ends at its target; the zero-time relative glide applies immediately.
    assert_eq!((f.sprites[0].x, f.sprites[0].y), (70.0, 50.0));
    assert_eq!(f.active, 0);
}

#[test]
fn face_move_and_rotate_around_targets() {
    let p = project(chain(vec![
        json!({"type":"self_move_to","inputs":{"x":num(10.0),"y":num(0.0)}}),
        json!({"type":"self_face_to","fields":{"sprite":"__mouse"}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    vm.set_mouse(10.0, 50.0);
    let f = frame(&mut vm);
    assert!((f.sprites[1].direction - 0.0).abs() < 1e-9);

    let p = project(chain(vec![
        json!({"type":"self_move_to","inputs":{"x":num(0.0),"y":num(10.0)}}),
        json!({"type":"self_rotate_around","fields":{"sprite":"nekoc-default-scene"},"inputs":{"degrees":num(90.0)}}),
    ]));
    let mut p = p;
    if let Some(scene) = p["scenes"]["currentSceneId"].as_str().map(str::to_owned) {
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["next"]
            ["fields"]["sprite"] = json!(scene);
    }
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    let a = &f.sprites[1];
    assert!(
        (a.x - 10.0).abs() < 1e-9 && a.y.abs() < 1e-9,
        "{} {}",
        a.x,
        a.y
    );
    assert_eq!(a.direction, 90.0);
}

#[test]
fn effects_size_and_fade_update_sprite_state() {
    let p = project(chain(vec![
        json!({"type":"self_set_effect","fields":{"scope":"2"},"inputs":{"value":num(150.0)}}),
        json!({"type":"self_change_effect","fields":{"scope":"1","increase":"increase"},"inputs":{"steps":num(40.0)}}),
        json!({"type":"set_width_height_scale","fields":{"type":"height"},"inputs":{"value":num(50.0)}}),
        json!({"type":"self_change_scale","fields":{"increase":"decrease"},"inputs":{"scale":num(20.0)}}),
        json!({"type":"self_set_rotation_type","fields":{"rotation_type":"1"}}),
        json!({"type":"self_gradually_show_hide","fields":{"is_show":"hide"},"inputs":{"time":num(0.5)}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = vm.advance(0.0, 1000, Duration::from_secs(1)).unwrap();
    let a = &f.sprites[1];
    assert_eq!(a.effects[2], 100.0);
    assert!((a.opacity - 0.6).abs() < 1e-9);
    assert_eq!((a.size_y, a.scale, a.rotation_type), (50.0, 80.0, 1));
    let f = vm.advance(0.25, 1000, Duration::from_secs(1)).unwrap();
    assert!((f.sprites[0].opacity - 0.3).abs() < 1e-9);
    let f = vm.advance(0.25, 1000, Duration::from_secs(1)).unwrap();
    assert!(!f.sprites[0].visible && (f.sprites[0].opacity - 0.6).abs() < 1e-9);
}

#[test]
fn when_statement_waits_and_sync_tell_runs_as_target() {
    let p = var_project(
        chain(vec![
            json!({"type":"when","inputs":{"condition":{"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":{"type":"timer"},"B":num(0.05)}}},
                "statements":{"DO":set("hit", num(1.0))}}),
            json!({"type":"sync_tell","fields":{"sprite":"__self"},"statements":{"DO":chain(vec![
                json!({"type":"wait","inputs":{"time":num(0.0)}}),
                set("told", num(1.0))])}}),
            set("after", {
                json!({"type":"variables_get","fields":{"variable":"told"}})
            }),
        ]),
        &["hit", "told", "after"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables(), &[0.0, 0.0, 0.0]);
    for _ in 0..5 {
        frame(&mut vm);
    }
    assert_eq!(vm.numeric_variables(), &[1.0, 1.0, 1.0]);
}

#[test]
fn restart_resets_state_and_runs_start_scripts_again() {
    let p = var_project(
        chain(vec![
            json!({"type":"change_variables","fields":{"variable":"n","method":"increase"},"inputs":{"value":num(1.0)}}),
            json!({"type":"wait","inputs":{"time":num(0.0)}}),
            json!({"type":"restart"}),
        ]),
        &["n"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 1.0);
    let f = frame(&mut vm);
    // Restart reinitialised variables and re-dispatched the start hat.
    assert!(f.active == 1 && vm.numeric_variables()[0] == 0.0);
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 1.0);
}

#[test]
fn reporter_procedures_return_values_recursively_and_early() {
    let n = || json!({"type":"procedures_2_parameter","fields":{"param_name":"n"}});
    let call = |arg: Value| {
        json!({"type":"procedures_2_callreturn","fields":{"NAME":"fact"},
        "mutation":"<mutation def_id=\"fact\"/>","inputs":{"n":arg}})
    };
    let mut p = var_project(set("r", call(num(6.0))), &["r"]);
    // fact(n): if n <= 1 return 1 (early, inside a loop); return n * fact(n - 1)
    p["procedures"]["proceduresDict"]["fact"] = json!({"params":[{"type":"String","id":"n","name":"n"}],
    "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","statements":{"STACK":chain(vec![
        json!({"type":"repeat_forever","statements":{"DO":{"type":"controls_if",
            "inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"LTE"},"inputs":{"A":n(),"B":num(1.0)}}},
            "statements":{"DO0":{"type":"procedures_2_return_value","inputs":{"VALUE":num(1.0)}},
                          "ELSE":{"type":"break"}}}}}),
        json!({"type":"procedures_2_return_value","inputs":{"VALUE":{"type":"math_arithmetic","fields":{"type":"multiply"},
            "inputs":{"A":n(),"B":call(json!({"type":"math_arithmetic","fields":{"type":"minus"},"inputs":{"A":n(),"B":num(1.0)}}))}}}}),
    ])}}]});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 720.0);
    assert_eq!(f.active, 0);

    // A reporter that never returns is a reported error, not a hang.
    p["procedures"]["proceduresDict"]["fact"]["nekoBlockJsonList"][0]["statements"]["STACK"] =
        json!({"type":"repeat_forever","statements":{"DO":movement(1.0)}});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let error = vm
        .advance(1.0 / 60.0, 10_000_000, Duration::from_secs(5))
        .unwrap_err();
    assert!(format!("{error:#}").contains("did not return"), "{error:#}");
}

#[test]
fn clones_run_clone_hats_share_events_and_are_deleted() {
    let mut p = var_project(
        chain(vec![
            json!({"type":"repeat_n_times","inputs":{"times":num(3.0)},"statements":{"DO":{"type":"mirror","fields":{"sprite":"__self"}}}}),
            set(
                "count",
                json!({"type":"get_clone_num","fields":{"sprite":"__self"}}),
            ),
        ]),
        &["count", "sum", "key"],
    );
    let hats = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    // Each clone moves by its own index, then deletes itself after a key press.
    hats.push(json!({"type":"start_as_a_mirror","statements":{"DO":chain(vec![
        json!({"type":"self_set_position_x","inputs":{"value":{"type":"get_current_clone_index"}}}),
        json!({"type":"change_variables","fields":{"variable":"sum","method":"increase"},"inputs":{"value":{"type":"get_current_clone_index"}}}),
    ])}}));
    hats.push(json!({"type":"on_keydown","fields":{"key":"32","type":"down"},"next":chain(vec![
        json!({"type":"change_variables","fields":{"variable":"key","method":"increase"},"inputs":{"value":num(1.0)}}),
        json!({"type":"dispose_clone"}),
    ])}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    // Slots are sorted by name: count, key, sum. The loop yields per iteration.
    let mut order = None;
    for _ in 0..4 {
        let f = frame(&mut vm);
        order = f.order.or(order);
    }
    assert_eq!(vm.numeric_variables(), &[3.0, 0.0, 6.0]);
    let order = order.unwrap();
    assert_eq!(order.len(), 4);
    // Clones sit behind their source; the newest is directly behind it.
    assert_eq!(order[3], "nekoc-default-actor");
    vm.key("32");
    let f = frame(&mut vm);
    // The original and all three clones receive the key; clones delete themselves.
    assert_eq!(vm.numeric_variables()[1], 4.0);
    assert_eq!(f.removed.len(), 3);
    assert_eq!(f.order.unwrap(), ["nekoc-default-actor"]);
    // Slots are reused: creating clones again does not grow without bound.
    let mut peak = 0;
    for _ in 0..50 {
        vm.start();
        for _ in 0..4 {
            peak = peak.max(frame(&mut vm).sprites.len());
        }
        vm.key("32");
        frame(&mut vm);
    }
    assert!(peak <= 5, "{peak}");
}

#[test]
fn layer_blocks_reorder_drawing() {
    let mut p = project(
        json!({"type":"set_top_bottom_layer","fields":{"layer":"bottom","target_layer":""}}),
    );
    let actor = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    let mut other = actor.clone();
    other["id"] = json!("other");
    other["nekoBlockJsonList"] = json!([]);
    p["actors"]["actorsDict"]["other"] = other;
    let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
    p["scenes"]["scenesDict"][&scene]["actorIds"] = json!(["nekoc-default-actor", "other"]);
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let first = frame(&mut vm).order.unwrap();
    // actorIds are front to back, so the default actor starts in front and moves to the back.
    assert_eq!(first, ["nekoc-default-actor", "other"]);
}

#[test]
fn ask_suspends_until_answered_and_dialogs_time_out() {
    let p = var_project(
        chain(vec![
            json!({"type":"self_dialog","fields":{"type":"say"},"inputs":{"text":{"type":"text","fields":{"TEXT":"hi"}},"time":num(0.1)}}),
            json!({"type":"self_ask","inputs":{"text":{"type":"text","fields":{"TEXT":"name?"}}}}),
            log_value(json!({"type":"get_answer"})),
            json!({"type":"ask_and_choose","inputs":{"question":{"type":"text","fields":{"TEXT":"pick"}},
                "CHOICE0":{"type":"text","fields":{"TEXT":"red"}},"CHOICE1":{"type":"text","fields":{"TEXT":"blue"}}}}),
            set(
                "i",
                json!({"type":"get_choice_and_index","fields":{"type":"index"}}),
            ),
            log_value(json!({"type":"get_choice_and_index","fields":{"type":"content"}})),
        ]),
        &["i"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(f.sprites[1].dialog.as_ref().unwrap().text, "hi");
    assert!(f.ask.is_none());
    let mut f = frame(&mut vm);
    for _ in 0..10 {
        f = frame(&mut vm);
    }
    // The dialog closed after its time and the question is shown, every frame.
    assert!(f.sprites.is_empty() || f.sprites[0].dialog.is_none());
    let ask = f.ask.clone().expect("question shown");
    assert_eq!(ask.question, "name?");
    vm.answer(ask.id + 99, "ignored", None);
    vm.answer(ask.id, "Neko", None);
    let f = frame(&mut vm);
    assert_eq!(f.logs, ["Neko"]);
    let ask = f.ask.expect("choice shown");
    assert_eq!(
        ask.choices.as_deref(),
        Some(&["red".to_owned(), "blue".to_owned()][..])
    );
    vm.answer(ask.id, "", Some(2));
    let f = frame(&mut vm);
    assert_eq!(f.logs, ["blue"]);
    assert_eq!(vm.numeric_variables()[0], 2.0);
    assert!(f.ask.is_none() && f.active == 0);
}

fn two_actor_project(main: Value, other_pos: (f64, f64)) -> Value {
    let mut p = project(main);
    let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    other["id"] = json!("other");
    other["position"] = json!({"x":other_pos.0,"y":other_pos.1});
    other["nekoBlockJsonList"] = json!([]);
    p["actors"]["actorsDict"]["other"] = other;
    let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
    p["scenes"]["scenesDict"][&scene]["actorIds"] = json!(["nekoc-default-actor", "other"]);
    p
}
fn square(vm: &mut Engine, ring: bool) {
    // 4x4 costume; a ring mask leaves the centre 2x2 transparent.
    let mut bits = vec![0u8; 2];
    for y in 0..4 {
        for x in 0..4 {
            let opaque = !ring || !(1..3).contains(&x) || !(1..3).contains(&y);
            if opaque {
                bits[(y * 4 + x) / 8] |= 1 << ((y * 4 + x) % 8);
            }
        }
    }
    let style = vm.program.sprites[1].style.clone().unwrap();
    vm.set_costume(
        &style,
        Costume {
            width: 40.0,
            height: 40.0,
            mask: Some((4, 4, bits)),
        },
    );
}

#[test]
fn touching_uses_costume_bounds_masks_and_edges() {
    let touch = |other: &str| {
        set(
            "t",
            json!({"type":"bump_into","fields":{"sprite":"__self","sprite1":other}}),
        )
    };
    for (pos, ring, expected) in [
        ((30.0, 0.0), false, 1.0),
        ((45.0, 0.0), false, 0.0),
        ((0.0, 0.0), true, 1.0),
    ] {
        let mut p = two_actor_project(touch("other"), pos);
        p["variables"]["variablesDict"]["t"] = json!({"id":"t","value":0});
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        square(&mut vm, ring);
        vm.start();
        frame(&mut vm);
        assert_eq!(vm.numeric_variables()[0], expected, "{pos:?} ring={ring}");
    }
    // Mouse inside the transparent centre of a ring does not touch.
    let mut p = project(chain(vec![
        touch("--mouse"),
        set(
            "e",
            json!({"type":"bump_into","fields":{"sprite":"__self","sprite1":"--edge"}}),
        ),
    ]));
    p["variables"]["variablesDict"]["t"] = json!({"id":"t","value":0});
    p["variables"]["variablesDict"]["e"] = json!({"id":"e","value":0});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    square(&mut vm, true);
    vm.start();
    vm.set_mouse(1.0, 1.0);
    frame(&mut vm);
    assert_eq!(vm.numeric_variables(), &[0.0, 0.0]);
}

#[test]
fn bounce_reflects_off_the_nearest_edge_and_moves_inside() {
    let p = project(chain(vec![
        json!({"type":"self_move_to","inputs":{"x":num(445.0),"y":num(0.0)}}),
        json!({"type":"self_point_towards","inputs":{"degrees":num(45.0)}}),
        json!({"type":"self_bounce_off_edge"}),
        set(
            "o",
            json!({"type":"out_of_boundary","fields":{"boundary":"right"}}),
        ),
    ]));
    let mut p = p;
    p["variables"]["variablesDict"]["o"] = json!({"id":"o","value":0});
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    square(&mut vm, false);
    vm.start();
    let f = frame(&mut vm);
    let a = &f.sprites[1];
    assert!((a.direction + 45.0).abs() < 1e-9, "{}", a.direction);
    // Rotated 45 degrees, the 40x40 bounds are 20*sqrt(2) wide on each side.
    assert!(
        (a.x - (vm.program.width / 2.0 - 20.0 * 2f64.sqrt())).abs() < 1e-9,
        "{}",
        a.x
    );
    assert_eq!(vm.numeric_variables()[0], 0.0);
}

#[test]
fn monitors_image_stamps_audio_waits_swipes_and_drags() {
    let mut p = var_project(
        chain(vec![
            json!({"type":"show_hide_variables","fields":{"show_hide":"show","variable":"score"}}),
            set("score", num(7.0)),
            json!({"type":"image_stamp"}),
            json!({"type":"self_set_draggable","fields":{"draggable":"1"}}),
            json!({"type":"play_audio_and_wait","inputs":{"audio_id":{"type":"text","fields":{"TEXT":"boom"}}}}),
            set("score", num(8.0)),
        ]),
        &["score"],
    );
    p["variables"]["variablesDict"]["score"]["name"] = json!("分数");
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"on_swipe","fields":{"type":"left"},"statements":{"DO":log_value(json!({"type":"text","fields":{"TEXT":"swiped"}}))}}));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    assert_eq!(
        (f.monitors[0].name.as_str(), f.monitors[0].value.as_str()),
        ("分数", "7")
    );
    assert_eq!(f.image_stamps.len(), 1);
    let wait = f.audio_commands[0].wait.unwrap();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 7.0);
    vm.audio_finished(wait);
    vm.swipe("left");
    vm.drag("nekoc-default-actor", 12.0, -3.0);
    let f = frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 8.0);
    assert_eq!(f.logs, ["swiped"]);
    assert_eq!((f.sprites[0].x, f.sprites[0].y), (12.0, -3.0));
}

#[test]
fn number_shadow_variants_and_start_on_click_hat() {
    let mut p = var_project(
        set(
            "v",
            json!({"type":"math_number_with_slider","fields":{"NUM":42}}),
        ),
        &["v"],
    );
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["type"] =
        json!("start_on_click");
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 42.0);
}

/// Two scenes: the default one (A) and "B" with actor "b".
fn two_scene_project(a: Value, b: Value, names: &[&str]) -> Value {
    let mut p = var_project(a, names);
    let scene_a = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
    let mut scene_b = p["scenes"]["scenesDict"][&scene_a].clone();
    scene_b["id"] = json!("scene-b");
    scene_b["name"] = json!("B");
    scene_b["screenName"] = json!("B");
    scene_b["actorIds"] = json!(["b"]);
    scene_b["nekoBlockJsonList"] = json!([]);
    p["scenes"]["scenesDict"]["scene-b"] = scene_b;
    p["scenes"]["sortList"] = json!([scene_a, "scene-b"]);
    let mut actor = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    actor["id"] = json!("b");
    actor["position"] = json!({"x":40,"y":0});
    actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated","next":b}]);
    p["actors"]["actorsDict"]["b"] = actor;
    p
}
fn change(name: &str, n: f64) -> Value {
    json!({"type":"change_variables","fields":{"variable":name,"method":"increase"},"inputs":{"value":num(n)}})
}
fn switch(target: Value) -> Value {
    json!({"type":"switch_to_screen","inputs":{"screen_id":target}})
}

#[test]
fn switching_scenes_stops_old_scripts_and_starts_the_new_scene() {
    let mut p = two_scene_project(
        chain(vec![
            change("a", 1.0),
            json!({"type":"self_move_to","inputs":{"x":num(-30.0),"y":num(5.0)}}),
            json!({"type":"set_screen_transition","fields":{"direction":"left","type":"slide"}}),
            json!({"type":"wait","inputs":{"time":num(0.0)}}),
            switch(json!({"type":"get_screens","fields":{"screen_id":"scene-b"}})),
            change("a", 100.0),
        ]),
        chain(vec![
            change("b", 1.0),
            json!({"type":"wait","inputs":{"time":num(0.0)}}),
            // Back to the first scene by number.
            switch(num(1.0)),
        ]),
        &["a", "b", "k"],
    );
    // A forever loop and a key hat in scene A; only active-scene hats react.
    let hats = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    hats.push(
        json!({"type":"on_keydown","fields":{"key":"32","type":"down"},"next":change("k", 1.0)}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let f = frame(&mut vm);
    let scene_a = f.scene.clone();
    assert_eq!(
        f.sprites.len(),
        2,
        "only scene A's stage and actor are drawn"
    );
    let f = frame(&mut vm);
    // Switched: scene A's remaining blocks never run, scene B is active.
    assert!(f.scene_changed && f.scene == "scene-b");
    assert_eq!(
        f.transition.as_ref().map(|t| t.kind.as_str()),
        Some("slide")
    );
    assert_eq!(f.order.as_deref(), Some(&["b".to_owned()][..]));
    assert!(f.sprites.iter().all(|s| s.id == "b" || s.id == "scene-b"));
    vm.key("32");
    let f = frame(&mut vm);
    // Slots sorted: a, b, k. Scene A's key hat did not run.
    assert_eq!(vm.numeric_variables(), &[1.0, 1.0, 0.0]);
    assert!(!f.scene_changed);
    frame(&mut vm);
    let f = frame(&mut vm);
    // Back in A: its start script runs again; the actor kept its position.
    assert_eq!(f.scene, scene_a);
    assert!(
        f.sprites
            .iter()
            .any(|s| s.id == "nekoc-default-actor" && s.x == -30.0)
    );
    frame(&mut vm);
    assert_eq!(vm.numeric_variables()[0], 2.0);
}

#[test]
fn unknown_scene_is_a_reported_error_and_names_resolve() {
    let p = two_scene_project(
        switch(json!({"type":"text","fields":{"TEXT":"B"}})),
        json!({"type":"self_appear","fields":{"value":"appear"}}),
        &[],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    assert_eq!(frame(&mut vm).scene, "scene-b");
    let p = two_scene_project(
        switch(json!({"type":"text","fields":{"TEXT":"nowhere"}})),
        json!({"type":"self_appear","fields":{"value":"appear"}}),
        &[],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let error = vm
        .advance(1.0 / 60.0, 1000, Duration::from_secs(1))
        .unwrap_err();
    assert!(format!("{error:#}").contains("unknown scene nowhere"));
}

fn wait(seconds: f64) -> Value {
    json!({"type":"wait","inputs":{"time":num(seconds)}})
}
fn bump(subject: &str, other: &str) -> Value {
    json!({"type":"bump_into","fields":{"sprite":subject,"sprite1":other}})
}
fn run_frames(vm: &mut Engine, n: usize) -> Vec<nekoc::engine::Frame> {
    (0..n).map(|_| frame(vm)).collect()
}
fn sprite_in<'a>(
    frames: &'a [nekoc::engine::Frame],
    id: &str,
) -> Option<&'a nekoc::engine::Sprite> {
    frames
        .iter()
        .rev()
        .flat_map(|f| f.sprites.iter())
        .find(|s| s.id == id)
}

#[test]
fn camps_and_edge_sides_are_collision_targets() {
    let mut p = two_actor_project(
        chain(vec![
            wait(0.0),
            set("a", bump("__self", "camp_red")),
            set("b", bump("__self", "camp_blue")),
            set("c", bump("camp_red", "__self")),
            set("d", bump("__self", "--edge_left")),
            set("e", bump("__self", "no_camp")),
        ]),
        (30.0, 0.0),
    );
    p["actors"]["actorsDict"]["other"]["nekoBlockJsonList"] = json!([{"id":"s2","type":"on_running_group_activated",
        "next":{"type":"self_set_role_camp","fields":{"role_camp":"camp_red"}}}]);
    for name in ["a", "b", "c", "d", "e"] {
        p["variables"]["variablesDict"][name] = json!({"id":name,"value":-1});
    }
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    square(&mut vm, false);
    vm.start();
    run_frames(&mut vm, 3);
    // a, b, c, d, e: red touches, blue does not, the red camp touches self, the
    // left edge is far, and self is camp-less but self is never its own target.
    assert_eq!(vm.numeric_variables(), &[1.0, 0.0, 1.0, 0.0, 0.0]);
}

#[test]
fn bump_hat_fires_start_move_end_with_the_met_actor() {
    let mut p = two_actor_project(
        chain(vec![
            wait(0.05),
            json!({"type":"self_set_position_x","inputs":{"value":num(80.0)}}),
            wait(0.1),
            json!({"type":"self_set_position_x","inputs":{"value":num(-200.0)}}),
        ]),
        (100.0, 0.0),
    );
    for name in ["e", "m", "s", "v"] {
        p["variables"]["variablesDict"][name] = json!({"id":name,"value":0});
    }
    let hat = |phase: &str, body: Value| {
        json!({"id":format!("bump-{phase}"),"type":"on_bump_actor","fields":{"type":phase,"sprite":"other"},
            "inputs":{"actor":{"type":"on_bump_actor_param","fields":{"TEXT":"角色"}}},"statements":{"DO":body}})
    };
    add_hat(
        &mut p,
        hat(
            "start",
            chain(vec![
                change("s", 1.0),
                set(
                    "v",
                    json!({"type":"on_bump_actor_value","fields":{"TEXT":"角色","attribute":"x"}}),
                ),
            ]),
        ),
    );
    add_hat(&mut p, hat("move", change("m", 1.0)));
    add_hat(&mut p, hat("end", change("e", 1.0)));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    square(&mut vm, false);
    vm.start();
    run_frames(&mut vm, 30);
    let [e, m, s, v] = vm.numeric_variables() else {
        panic!()
    };
    assert_eq!((*s, *e, *v), (1.0, 1.0, 100.0));
    assert!((3.0..=8.0).contains(m), "move fired {m} times");
}

#[test]
fn arc_and_radian_trig_power_and_shadow_text() {
    let p = var_project(
        chain(vec![
            set(
                "a",
                json!({"type":"math_arc_trig","fields":{"type":"asin"},"inputs":{"num":num(1.0)}}),
            ),
            set(
                "b",
                json!({"type":"math_trig_rad","fields":{"type":"sin"},"inputs":{"num":num(std::f64::consts::FRAC_PI_2)}}),
            ),
            set(
                "c",
                json!({"type":"math_arithmetic_power","inputs":{"A":num(2.0),"B":num(10.0)}}),
            ),
            set(
                "d",
                json!({"type":"text_length","inputs":{"text":{"type":"shadow_text","inputs":{"text":text("abc")}}}}),
            ),
        ]),
        &["a", "b", "c", "d"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    frame(&mut vm);
    let v = vm.numeric_variables();
    assert!((v[0] - 90.0).abs() < 1e-9 && (v[1] - 1.0).abs() < 1e-12);
    assert_eq!(&v[2..], &[1024.0, 3.0]);
}

#[test]
fn emphasis_and_transition_animations_block_and_restore_state() {
    let p = var_project(
        chain(vec![
            json!({"type":"self_stress_animation","fields":{"animation":"shake"}}),
            set("a", num(1.0)),
            json!({"type":"self_appear","fields":{"value":"disappear"}}),
            json!({"type":"self_appear_animation","fields":{"appear":"appear","direction":"left","animation":"slideIn"}}),
            set("b", num(1.0)),
            json!({"type":"self_appear_animation","fields":{"appear":"appear","direction":"left","animation":"flyIn"}}),
            set("c", num(1.0)),
            json!({"type":"self_appear_animation","fields":{"appear":"disappear","direction":"up","animation":"slideOut"}}),
            set("d", num(1.0)),
        ]),
        &["a", "b", "c", "d"],
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let id = "nekoc-default-actor";
    let start = frame(&mut vm)
        .sprites
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .unwrap();
    // Shake lasts 0.45 s and ends on the original direction.
    run_frames(&mut vm, 20);
    assert_eq!(vm.numeric_variables()[0], 0.0);
    let frames = run_frames(&mut vm, 10);
    assert_eq!(vm.numeric_variables()[0], 1.0);
    let after = sprite_in(&frames, id).unwrap();
    assert_eq!(after.direction, start.direction);
    // slideIn from the left: the next frames show it fading in left of its spot.
    let frames = run_frames(&mut vm, 3);
    let mid = sprite_in(&frames, id).unwrap();
    assert!(
        mid.visible && mid.opacity < 1.0 && mid.x < start.x,
        "{mid:?}"
    );
    let frames = run_frames(&mut vm, 40);
    assert_eq!(vm.numeric_variables()[1], 1.0);
    // flyIn on an already visible sprite does nothing and does not wait.
    assert_eq!(vm.numeric_variables()[2], 1.0);
    let _ = frames;
    // slideOut (0.8 s) hides it and restores position and opacity.
    let frames = run_frames(&mut vm, 60);
    assert_eq!(vm.numeric_variables()[3], 1.0);
    let end = sprite_in(&frames, id).unwrap();
    assert!(!end.visible);
    assert_eq!(
        (end.x, end.y, end.opacity),
        (start.x, start.y, start.opacity)
    );
}

#[test]
fn text_effect_replaces_the_costume_until_the_costume_changes() {
    let p = project(chain(vec![
        json!({"type":"set_scale","inputs":{"scale":num(50.0)}}),
        json!({"type":"self_text_effect_size","inputs":{"size":num(50.0)}}),
        json!({"type":"self_text_effect_color","fields":{"color":"#ff0000"}}),
        json!({"type":"self_text_effect_text","inputs":{"text":text(" hi ")}}),
        wait(0.1),
        json!({"type":"self_prev_next_style","fields":{"prev_next":"next"}}),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let id = "nekoc-default-actor";
    let frames = run_frames(&mut vm, 3);
    let shown = sprite_in(&frames, id).unwrap();
    let look = shown.text.as_ref().expect("text look");
    assert_eq!(
        (look.text.as_str(), look.size, look.color.as_str()),
        ("hi", 50.0, "#ff0000")
    );
    assert_eq!(shown.scale, 100.0);
    let frames = run_frames(&mut vm, 10);
    let back = sprite_in(&frames, id).unwrap();
    assert!(back.text.is_none());
    assert_eq!(back.scale, 50.0);
}
