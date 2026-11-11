//! Disconnected hardware profile, not a synthetic mapping implementation.
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

const SOCKETS: [&str; 5] = ["value", "fromStart", "fromEnd", "toStart", "toEnd"];
fn num(n: usize) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn project(inputs: Value, observe: bool) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    p["variables"]["variableIds"] = json!(["obj"]);
    let mut blocks = vec![
        json!({"type":"console_log","inputs":{"console_log":{"type":"microbit_math_map","inputs":inputs}}}),
    ];
    if observe {
        for key in SOCKETS {
            blocks.push(
                json!({"type":"console_log","inputs":{"console_log":{"type":"_object_get","inputs":{
                    "obj":{"type":"variables_get","fields":{"variable":"obj"}},
                    "key":{"type":"text","fields":{"TEXT":key}}
                }}}}),
            );
        }
    }
    let body = blocks
        .into_iter()
        .rev()
        .reduce(|next, mut head| {
            head["next"] = next;
            head
        })
        .unwrap();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{"type":"repeat_n_times","inputs":{"times":num(80)},"statements":{"DO":body}}}
    ]);
    p
}

#[test]
fn disconnected_map_evaluates_every_socket_then_returns_typed_nan() {
    let inputs: serde_json::Map<String, Value> = SOCKETS
        .into_iter()
        .enumerate()
        .map(|(i, key)| {
            (
                key.to_owned(),
                json!({"type":"_object_set","inputs":{
                    "obj":{"type":"variables_get","fields":{"variable":"obj"}},
                    "key":{"type":"text","fields":{"TEXT":key}},"value":num(i+1)
                }}),
            )
        })
        .collect();
    for jit in [false, true] {
        let mut vm =
            Engine::new(Program::compile(&project(Value::Object(inputs.clone()), true)).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        let mut logs = Vec::new();
        for _ in 0..100 {
            logs.extend(
                vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap()
                    .logs,
            );
        }
        assert_eq!(logs, ["NaN", "1", "2", "3", "4", "5"].repeat(80));
    }
}

#[test]
fn disconnected_map_is_not_replaced_with_linear_arithmetic() {
    let p = project(
        json!({"value":num(5),"fromStart":num(0),"fromEnd":num(10),"toStart":num(0),"toEnd":num(100)}),
        false,
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert_eq!(
        vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap()
            .logs,
        ["NaN"]
    );
}

#[test]
fn disconnected_map_does_not_swallow_invalid_or_missing_sockets() {
    for key in SOCKETS {
        let mut inputs = json!({"value":num(5),"fromStart":num(0),"fromEnd":num(10),"toStart":num(0),"toEnd":num(100)});
        inputs[key] = json!({"type":"unknown-side-effect"});
        assert!(
            Program::compile(&project(inputs.clone(), false)).is_err(),
            "{key}"
        );
        inputs.as_object_mut().unwrap().remove(key);
        assert!(
            Program::compile(&project(inputs, false)).is_err(),
            "missing {key}"
        );
    }
}
