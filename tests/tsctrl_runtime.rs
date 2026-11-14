use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn reporter_call(procedure: &str) -> Value {
    json!({"type":"procedures_2_callreturn", "fields":{"NAME":procedure},
        "mutation":format!("<mutation def_id=\"{procedure}\"/>")})
}

fn recursion_error(mutual: bool, jit: bool) -> String {
    // Exercise the error-location propagation, not the platform-specific
    // default stack size of Rust's test worker threads.
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(move || recursion_error_inner(mutual, jit))
        .unwrap()
        .join()
        .unwrap()
}

fn recursion_error_inner(mutual: bool, jit: bool) -> String {
    let mut project = Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"id":"start", "type":"on_running_group_activated", "next":{
            "id":"outer", "type":"self_set_position_x", "inputs":{"value":reporter_call("recur")}}}
    ]);
    for (name, next, block) in if mutual {
        vec![("recur", "other", "b7"), ("other", "recur", "b8")]
    } else {
        vec![("recur", "recur", "b7")]
    } {
        project["procedures"]["proceduresDict"][name] = json!({"params":[],
            "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn", "statements":{"STACK":{
                "id":block, "type":"procedures_2_return_value", "inputs":{"VALUE":reporter_call(next)}}}}]});
    }
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.start();
    format!(
        "{:#}",
        vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
            .unwrap_err()
    )
}

#[test]
fn deep_reporter_recursion_reports_the_origin_once() {
    // The depth is a native safety guard, not an assertion of official KN parity.
    for jit in [false, true] {
        let error = recursion_error(false, jit);
        assert_eq!(
            error,
            "reporter procedure recursion exceeds 200 at block b7"
        );
    }
}

#[test]
fn mutual_reporter_recursion_does_not_accumulate_distinct_call_sites() {
    for jit in [false, true] {
        let error = recursion_error(true, jit);
        assert_eq!(
            error,
            "reporter procedure recursion exceeds 200 at block b8"
        );
    }
}

#[test]
fn legacy_reporter_conditionals_return_only_the_selected_branch() {
    let mut project = Document::blank().value().clone();
    project["variables"]["out"] = json!({"name":"out", "value":0});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated", "next":{
            "type":"variables_set", "fields":{"variable":"out"},
            "inputs":{"value":reporter_call("choice")}}}
    ]);
    let ret = |value| {
        json!({"type":"procedures_2_return_value", "inputs":{"VALUE":{
        "type":"math_number", "fields":{"NUM":value}}}})
    };
    project["procedures"]["proceduresDict"]["choice"] = json!({"params":[],
        "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn", "statements":{"STACK":{
            "type":"controls_if", "inputs":{"IF0":{"type":"logic_boolean", "fields":{"BOOL":"FALSE"}}},
            "statements":{"DO0":ret("11"), "ELSE":ret("23")}, "next":ret("99")}}}]});
    let result = nekoc::runtime::run_project(&project, 1).unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap()["variables"]["out"],
        23.0
    );
}
