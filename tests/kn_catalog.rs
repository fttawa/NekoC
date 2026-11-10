//! Native KN catalog regressions. No third-party project/assets are fixtures.
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}
fn local() -> Value {
    json!({"type":"script_variables_value","fields":{"TEXT":"x"}})
}
fn chain(blocks: Vec<Value>) -> Value {
    blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}
fn project(blocks: Vec<Value>) -> Value {
    let mut project = Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","id":"kncat-start","next":chain(blocks)}
    ]);
    project
}
fn run(project: &Value, jit: bool) -> Vec<String> {
    let mut vm = Engine::new(Program::compile(project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.start();
    let mut logs = vec![];
    for _ in 0..120 {
        logs.extend(
            vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
                .unwrap()
                .logs,
        );
    }
    logs
}

#[test]
fn script_set_and_change_resolve_declared_names_json_ids_and_global_fallback() {
    let id = r#"{"type":"NEKO_SCRIPT_VARIABLE_TYPE","name":"x"}"#;
    let p = project(vec![
        json!({"type":"script_variables","inputs":{"PARAMS0":{"type":"script_variables_param","fields":{"TEXT":"x"}}}}),
        json!({"type":"script_variables_set","fields":{"variable":id},"inputs":{"value":text("7")}}),
        log(local()),
        json!({"type":"change_script_variables","fields":{"variable":"x","method":"decrease"},"inputs":{"value":num(2.0)}}),
        log(local()),
        json!({"type":"script_variables_set","fields":{"variable":"fallback"},"inputs":{"value":text("8")}}),
        json!({"type":"change_script_variables","fields":{"variable":"fallback","method":"increase"},"inputs":{"value":num(3.0)}}),
        log(json!({"type":"variables_get","fields":{"variable":"fallback"}})),
    ]);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["7", "5", "11"]);
    }
}

#[test]
fn while_pretests_rechecks_and_break_aliases_only_exit_innermost_loop() {
    for kind in ["__break__", "_break_statement"] {
        let p = project(vec![
            json!({"type":"script_variables_set","fields":{"variable":"n"},"inputs":{"value":num(0.0)}}),
            json!({"type":"controls_while","inputs":{"BOOL":{"type":"logic_boolean","fields":{"BOOL":"FALSE"}}},"statements":{"DO":log(text("unreachable"))}}),
            json!({"type":"controls_while","inputs":{"BOOL":{"type":"logic_compare","fields":{"OP":"LT"},"inputs":{"A":{"type":"variables_get","fields":{"variable":"n"}},"B":num(3.0)}}},"statements":{"DO":chain(vec![
                json!({"type":"change_script_variables","fields":{"variable":"n","method":"increase"},"inputs":{"value":num(1.0)}}),
                json!({"type":"repeat_forever","statements":{"DO":chain(vec![
                    log(text("inner")),json!({"type":kind}),log(text("unreachable"))
                ])}}),
                log(text("outer"))
            ])}}),
            log(json!({"type":"variables_get","fields":{"variable":"n"}})),
        ]);
        for jit in [false, true] {
            assert_eq!(
                run(&p, jit),
                ["inner", "outer", "inner", "outer", "inner", "outer", "3"]
            );
        }
        let invalid = project(vec![json!({"type":kind,"id":"bad-break"})]);
        assert!(
            format!("{:#}", Program::compile(&invalid).unwrap_err()).contains("break outside loop")
        );
    }
}

#[test]
fn continue_runs_loop_epilogue_for_repeat_range_and_while_including_warp() {
    for warp in [false, true] {
        for kind in ["repeat_n_times", "traverse_number", "controls_while"] {
            let mut loop_block = json!({"type":kind,"inputs":{
                "times":num(3.0),"from":num(1.0),"to":num(3.0),"by":num(1.0),
                "value":{"type":"traverse_number_param","fields":{"TEXT":"i"}},
                "BOOL":{"type":"logic_compare","fields":{"OP":"LT"},"inputs":{"A":{"type":"variables_get","fields":{"variable":"n"}},"B":num(3.0)}}
            },"statements":{"DO":chain(vec![
                json!({"type":"change_script_variables","fields":{"variable":"n","method":"increase"},"inputs":{"value":num(1.0)}}),
                json!({"type":"_continue_statement"}),
                log(text("unreachable")),
            ])}});
            if warp {
                loop_block = json!({"type":"warp","statements":{"DO":loop_block}});
            }
            let p = project(vec![
                loop_block,
                log(json!({"type":"variables_get","fields":{"variable":"n"}})),
            ]);
            for jit in [false, true] {
                assert_eq!(run(&p, jit), ["3"], "{kind}, warp={warp}");
            }
        }
    }
    let invalid = project(vec![json!({"type":"_continue_statement"})]);
    assert!(
        format!("{:#}", Program::compile(&invalid).unwrap_err()).contains("continue outside loop")
    );
}

#[test]
fn hot_warp_continue_and_script_aliases_have_same_interpreted_and_jit_result() {
    let p = project(vec![
        json!({"type":"script_variables","inputs":{"PARAMS0":{"type":"script_variables_param","fields":{"TEXT":"x"}}}}),
        json!({"type":"script_variables_set","fields":{"variable":"x"},"inputs":{"value":num(0.0)}}),
        json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(2500.0)},"statements":{"DO":chain(vec![
            json!({"type":"change_script_variables","fields":{"variable":"x","method":"increase"},"inputs":{"value":num(1.0)}}),
            json!({"type":"_continue_statement"}),
            log(text("unreachable"))
        ])}}}}),
        log(local()),
    ]);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["2500"]);
    }
}

#[test]
fn native_import_reports_new_paths_ready_without_rewriting_canonical_blocks() {
    let p = project(vec![
        json!({"type":"_execute","inputs":{"action":{"type":"_array_literal","inputs":{"ITEM0":text("kept")}}}}),
        json!({"type":"controls_while","inputs":{"BOOL":{"type":"logic_boolean","fields":{"BOOL":"FALSE"}}},"statements":{"DO":{"type":"_continue_statement"}}}),
        json!({"type":"reset_timer"}),
        log(json!({"type":"get_timer"})),
    ]);
    let (imported, report) = nekoc::bcmkn::import(p.clone()).unwrap();
    assert_eq!(*imported, p);
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(report["script_diagnostics"], json!([]));
    assert_eq!(report["block_types"]["_execute"], 1);
}

#[test]
fn array_literal_preserves_socket_order_types_and_numeric_property_order() {
    let mut inputs = serde_json::Map::new();
    for (key, value) in [
        ("z", text("first")),
        ("ITEM10", text("second")),
        ("ITEM2", num(3.0)),
        ("2", text("two")),
        ("0", text("zero")),
    ] {
        inputs.insert(key.into(), value);
    }
    let array = json!({"type":"_array_literal","inputs":Value::Object(inputs)});
    let p = project(vec![
        log(array),
        log(
            json!({"type":"_array_literal","mutation":"<mutation items=\"3\"></mutation>","inputs":{"items0":num(3.0),"items1":num(1.0),"items2":num(2.0)}}),
        ),
        log(json!({"type":"_array_literal","inputs":{}})),
        json!({"type":"_variable_set","fields":{"VAR":"a"},"inputs":{"VALUE":{"type":"_array_literal","inputs":{"ITEM0":num(9.0)}}}}),
        log(json!({"type":"_variable_get","fields":{"VAR":"a"}})),
        json!({"type":"list_append","inputs":{"list":{"type":"_variable_get","fields":{"VAR":"a"}},"list_item_value":text("tail")}}),
        log(json!({"type":"_variable_get","fields":{"VAR":"a"}})),
        log(
            json!({"type":"list_length","inputs":{"list":{"type":"_array_literal","inputs":{"ITEM0":num(1.0),"ITEM1":num(2.0)}}}}),
        ),
    ]);
    for jit in [false, true] {
        assert_eq!(
            run(&p, jit),
            ["zero,two,first,second,3", "3,1,2", "", "9", "9,tail", "2"]
        );
    }
}

#[test]
fn execute_evaluates_action_once_without_logging_or_losing_side_effects() {
    let mut p = project(vec![
        json!({"type":"_execute","inputs":{"action":{"type":"procedures_2_callreturn","fields":{"NAME":"f"}}}}),
        log(json!({"type":"variables_get","fields":{"variable":"count"}})),
    ]);
    p["procedures"]["proceduresDict"]["f"] = json!({
        "id":"f","name":"f","params":[],"nekoBlockJsonList":[{
            "type":"procedures_2_defnoreturn","id":"def","statements":{"STACK":chain(vec![
                json!({"type":"change_variables","fields":{"variable":"count","method":"increase"},"inputs":{"value":num(1.0)}}),
                json!({"type":"_return_statement","inputs":{"VALUE":num(42.0)}}),
                log(text("unreachable")),
            ])}
        }]
    });
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["1"]);
    }
}

#[test]
fn formula_alias_evaluates_degrees_precedence_and_rejects_invalid_input() {
    for jit in [false, true] {
        let p = project(vec![
            log(json!({"type":"calculate","inputs":{"input":text("2+3*4")}})),
            log(json!({"type":"calculate","inputs":{"input":text("sin(90)")}})),
            log(json!({"type":"calculate","inputs":{"input":text("2^3^2")}})),
            log(json!({"type":"calculate","inputs":{"input":text("1e2+1")}})),
        ]);
        let logs = run(&p, jit);
        assert_eq!(&logs[..3], ["14", "1", "64"]);
        assert!((logs[3].parse::<f64>().unwrap() - 6.43656365691809).abs() < 1e-12);
    }
    let p = project(vec![log(
        json!({"type":"calculate","inputs":{"input":text("bad")}}),
    )]);
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    let err = vm
        .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap_err();
    assert!(format!("{err:#}").contains("block_bad_math_expression"));
}

#[test]
fn block_timer_reset_does_not_reset_or_resume_stage_timer_and_restart_clears_origin() {
    let p = project(vec![
        json!({"type":"set_timer_state","fields":{"type":"stop"}}),
        json!({"type":"wait","inputs":{"time":num(0.1)}}),
        log(json!({"type":"get_timer"})),
        json!({"type":"reset_timer"}),
        log(json!({"type":"get_timer"})),
        json!({"type":"wait","inputs":{"time":num(0.1)}}),
        log(json!({"type":"get_timer"})),
        log(json!({"type":"timer"})),
    ]);
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    for _ in 0..2 {
        vm.start();
        let mut logs = vec![];
        for _ in 0..60 {
            logs.extend(
                vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
                    .unwrap()
                    .logs,
            );
        }
        let values: Vec<f64> = logs.iter().map(|s| s.parse().unwrap()).collect();
        assert!(values[0] >= 0.1);
        assert_eq!(values[1], 0.0);
        assert!(values[2] >= 0.1);
        assert!((values[3] - 1.0 / 60.0).abs() < 1e-9);
    }
}
