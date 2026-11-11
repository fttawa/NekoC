//! Original native KN regressions. 0.27.4 drops callback statement arguments:
//! the visible C-slot is not evidence that its body executes in the player.
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn n(value: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":value}})
}
fn text(value: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":value}})
}
fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
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
    let mut p = Document::blank().value().clone();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"id":"async-start","type":"on_running_group_activated","next":chain(blocks)}
    ]);
    p
}
fn tick(vm: &mut Engine) -> nekoc::engine::Frame {
    vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap()
}

#[test]
fn native_timers_evaluate_delay_once_but_do_not_execute_callback_slots() {
    let mut p = project(vec![
        json!({"type":"setTimeout","inputs":{"delay":n(0.0)},"statements":{"callback":log(text("must-not-run"))}}),
        json!({"type":"setInterval","inputs":{"delay":n(0.0),"callback":{"type":"unknown-unexecuted-body"}}}),
        log(text("after")),
    ]);
    p["procedures"]["proceduresDict"]["delay"] = json!({
        "id":"delay","name":"delay","type":"return","params":[],"nekoBlockJsonList":[{
            "id":"delay-def","type":"procedures_2_defreturn","statements":{"STACK":chain(vec![
                log(text("delay")), json!({"type":"procedures_2_return_value","inputs":{"VALUE":n(0.0)}})
            ])}
        }]
    });
    let first =
        &mut p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"];
    first["inputs"]["delay"] = json!({"type":"procedures_2_callreturn","fields":{"NAME":"delay"}});
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.use_virtual_clock();
        vm.start();
        let mut logs = vec![];
        for _ in 0..10 {
            logs.extend(tick(&mut vm).logs);
        }
        assert_eq!(logs, ["delay", "after"]);
        assert_eq!(vm.active_tasks(), 1, "only interval remains pending");
        vm.start();
        assert_eq!(
            vm.active_tasks(),
            1,
            "restart removes timers before spawning start"
        );
    }
}

#[test]
fn timer_clear_aliases_cancel_shared_handles_and_stop_clears_intervals() {
    for clear in ["clearTimeout", "clearInterval"] {
        let socket = if clear == "clearTimeout" {
            "timeoutId"
        } else {
            "intervalId"
        };
        let p = project(vec![
            json!({"type":"setInterval","inputs":{"delay":n(0.0)}}),
            json!({"type":clear,"inputs":{socket:text("1")}}),
            log(text("continued")),
        ]);
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        assert_eq!(tick(&mut vm).logs, ["continued"]);
        assert_eq!(vm.active_tasks(), 0);
    }
    let p = project(vec![
        json!({"type":"setInterval","inputs":{"delay":n(0.0)}}),
        json!({"type":"stop","fields":{"scope":"0"}}),
        log(text("unreachable")),
    ]);
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(tick(&mut vm).logs.is_empty());
    assert_eq!(vm.active_tasks(), 0);
}

#[test]
fn malformed_native_timer_sockets_and_reporter_timer_usage_remain_errors() {
    for node in [
        json!({"type":"setTimeout"}),
        json!({"type":"setInterval"}),
        json!({"type":"clearTimeout","inputs":{"intervalId":n(1.0)}}),
        json!({"type":"clearInterval","inputs":{"timeoutId":n(1.0)}}),
        log(json!({"type":"setTimeout","inputs":{"delay":n(1.0)}})),
    ] {
        assert!(Program::compile(&project(vec![node])).is_err());
    }
}

#[test]
fn timer_registration_and_clear_side_exit_hot_loops() {
    let p = project(vec![
        json!({"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":n(1500.0)},"statements":{"DO":chain(vec![
                json!({"type":"setTimeout","inputs":{"delay":n(0.0)},"statements":{"callback":log(text("unreachable"))}}),
                json!({"type":"clearTimeout","inputs":{"timeoutId":n(-1.0)}})
            ])}
        }}}),
        log(text("done")),
    ]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        // The official 4 ms warp slice is wall-clock; keep this check host-independent.
        vm.use_virtual_clock();
        vm.start();
        assert_eq!(tick(&mut vm).logs, ["done"]);
        assert_eq!(vm.active_tasks(), 1500);
        assert!(tick(&mut vm).logs.is_empty());
        assert_eq!(vm.active_tasks(), 0);
    }
}

#[test]
fn pending_timer_safety_limit_reports_an_error_instead_of_hanging() {
    let p = project(vec![json!({"type":"warp","statements":{"DO":{
        "type":"repeat_n_times","inputs":{"times":n(4097.0)},"statements":{"DO":{
            "type":"setInterval","inputs":{"delay":n(0.0)}
        }}
    }}})]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.use_virtual_clock();
        vm.start();
        let error = vm
            .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
            .unwrap_err();
        assert!(error.to_string().contains("KN timer limit exceeded"));
    }
}
