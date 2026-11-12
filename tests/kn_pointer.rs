use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

const ACTOR: &str = "nekoc-default-actor";

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

fn probe(target: &str, state: &str) -> Value {
    json!({"type":"console_log","inputs":{"console_log":{
        "type":"mouse_down","fields":{"sprite":target,"type":state}
    }}})
}

fn project(clone: bool) -> Value {
    let mut p = Document::blank().value().clone();
    let body = chain(
        ["--screen", "--self", ACTOR]
            .into_iter()
            .flat_map(|target| ["down", "click", "up"].map(|state| probe(target, state)))
            .collect(),
    );
    let body = json!({"type":"repeat_forever","statements":{"DO":body}});
    let body = if clone {
        chain(vec![
            json!({"type":"mirror","fields":{"sprite":"--self"}}),
            body,
        ])
    } else {
        body
    };
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":body}
    ]);
    p
}

fn tick(vm: &mut Engine) -> Vec<String> {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap()
        .logs
}

#[test]
fn kn_mouse_reporter_distinguishes_screen_actor_and_pulses() {
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&project(false)).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        assert_eq!(tick(&mut vm), ["false"; 9]);
        vm.pointer_event("--screen", "mouse_down", 0.0, 0.0);
        assert_eq!(
            tick(&mut vm),
            [
                "true", "false", "false", "false", "false", "false", "false", "false", "false"
            ]
        );
        vm.pointer_event(ACTOR, "mouse_down", 0.0, 0.0);
        assert_eq!(
            tick(&mut vm),
            [
                "true", "false", "false", "true", "false", "false", "true", "false", "false"
            ]
        );
        assert_eq!(
            tick(&mut vm),
            [
                "true", "false", "false", "true", "false", "false", "true", "false", "false"
            ]
        );
        vm.pointer_event(ACTOR, "mouse_up", 0.0, 0.0);
        vm.pointer_event(ACTOR, "mouse_click", 0.0, 0.0);
        assert_eq!(
            tick(&mut vm),
            [
                "false", "true", "true", "false", "true", "true", "false", "true", "true"
            ]
        );
        assert_eq!(tick(&mut vm), ["false"; 9]);
        vm.start();
        assert_eq!(tick(&mut vm), ["false"; 9]);
    }
}

#[test]
fn named_actor_includes_clones_but_self_means_current_instance() {
    let mut vm = Engine::new(Program::compile(&project(true)).unwrap());
    vm.start();
    tick(&mut vm);
    let snapshot = vm.oracle_snapshot(1);
    let clone = snapshot["actors"]
        .as_object()
        .unwrap()
        .keys()
        .find(|id| id.as_str() != ACTOR)
        .unwrap()
        .to_owned();
    vm.pointer_event(&clone, "mouse_down", 0.0, 0.0);
    assert_eq!(
        tick(&mut vm),
        [
            "true", "false", "false", "false", "false", "false", "true", "false", "false"
        ]
    );
    vm.pointer_event(&clone, "mouse_up", 0.0, 0.0);
    vm.pointer_event(&clone, "mouse_click", 0.0, 0.0);
    assert_eq!(
        tick(&mut vm),
        [
            "false", "true", "true", "false", "false", "false", "false", "true", "true"
        ]
    );
}

#[test]
fn invalid_pointer_target_and_state_return_false_not_global() {
    for (target, state) in [("missing-actor", "down"), ("?", "down")] {
        let mut p = project(false);
        p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":probe(target, state)}
        ]);
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        vm.pointer_event("--screen", "mouse_down", 0.0, 0.0);
        assert_eq!(tick(&mut vm), ["false"]);
    }
    let mut p = project(false);
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":probe(ACTOR, "invalid")}
    ]);
    assert!(Program::compile(&p).is_err());
}
