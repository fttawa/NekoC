//! Disconnected hardware profile: official typed results, not synthetic sensors.
#[path = "../src/engine/kn_hardware.rs"]
mod kn_hardware;

use kn_hardware::{DisconnectedValue, reporter};
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn num(n: usize) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}

fn project(blocks: Vec<Value>, repeat: bool) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    p["variables"]["variableIds"] = json!(["obj"]);
    let mut chain = blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap();
    if repeat {
        chain =
            json!({"type":"repeat_n_times","inputs":{"times":num(80)},"statements":{"DO":chain}});
    }
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] =
        json!([{"type":"on_running_group_activated","next":chain}]);
    p
}

fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}

fn run(p: &Value, jit: bool) -> Vec<String> {
    let mut vm = Engine::new(Program::compile(p).unwrap());
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
    logs
}

#[test]
fn profile_is_an_exact_typed_allowlist_with_actual_panel_inputs() {
    assert!(kn_hardware::async_command("microbit_future_command").is_none());
    assert_eq!(kn_hardware::command("microbit_future_command"), None);
    for name in [
        "microbit_button_is_pressed",
        "microbit_logo_is_pressed",
        "microbit_is_gesture",
    ] {
        let spec = reporter(name).unwrap();
        assert_eq!(spec.result, DisconnectedValue::BooleanFalse, "{name}");
        assert!(spec.inputs.is_empty(), "{name}");
    }
    let led = reporter("microbit_led_is_plot").unwrap();
    assert_eq!(led.result, DisconnectedValue::BooleanFalse);
    assert_eq!(led.inputs, ["x", "y"]);
    for name in ["microbit_pin_digital_read", "microbit_pin_analog_read"] {
        let spec = reporter(name).unwrap();
        assert_eq!(spec.result, DisconnectedValue::NumberNaN, "{name}");
        assert!(spec.inputs.is_empty(), "{name}");
    }
    let map = reporter("microbit_math_map").unwrap();
    assert_eq!(map.result, DisconnectedValue::NumberNaN);
    assert_eq!(
        map.inputs,
        ["value", "fromStart", "fromEnd", "toStart", "toEnd"]
    );
    for name in [
        "microbit_pin_is_pressed", // Domain exists, absent from measured panel.
        "microbit_led_plot",
        "microbit_button_when",
        "unknown",
    ] {
        assert_eq!(reporter(name), None, "{name}");
    }
}

#[test]
fn profile_matches_every_tracked_official_panel_and_typed_observation() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kn-hardware-evidence.json")).unwrap();
    let entries = evidence["reporters"].as_array().unwrap();
    assert_eq!(entries.len(), 7);
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        let spec = reporter(name).unwrap();
        let inputs: Vec<&str> = entry["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|input| input.as_str().unwrap())
            .collect();
        assert_eq!(spec.inputs, inputs, "{name}");
        assert_eq!(entry["promise"], false, "{name}");
        let expected = match spec.result {
            DisconnectedValue::BooleanFalse => json!({"type":"boolean","value":false}),
            DisconnectedValue::NumberNaN => json!({"type":"number","value":"NaN"}),
            DisconnectedValue::Undefined => json!({"type":"undefined"}),
        };
        assert_eq!(entry["result"], expected, "{name}");
    }
}

#[test]
fn native_disconnected_reporters_preserve_boolean_and_nan_values() {
    let mut blocks = Vec::new();
    for key in ["A", "B", "AB", "", "invalid"] {
        blocks.push(log(
            json!({"type":"microbit_button_is_pressed","fields":{"key":key}}),
        ));
    }
    blocks.push(log(json!({"type":"microbit_logo_is_pressed"})));
    blocks.push(log(
        json!({"type":"microbit_is_gesture","fields":{"gesture":"shake"}}),
    ));
    for name in ["microbit_pin_digital_read", "microbit_pin_analog_read"] {
        for key in ["0", "1", "2", "", "invalid"] {
            blocks.push(log(json!({"type":name,"fields":{"key":key}})));
        }
    }
    // Equality is strict in KN. Boolean(false) must not become Number(0).
    blocks.push(log(
        json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{
            "A":{"type":"microbit_button_is_pressed","fields":{"key":"A"}},"B":num(0)
        }}),
    ));
    let p = project(blocks, true);
    let mut expected = vec!["false"; 7];
    expected.extend(vec!["NaN"; 10]);
    expected.push("false");
    for jit in [false, true] {
        assert_eq!(run(&p, jit), expected.repeat(80));
    }
}

#[test]
fn disconnected_led_predicate_evaluates_both_child_inputs_in_panel_order() {
    let set = |key: &str, value: Value| {
        json!({"type":"_object_set","inputs":{
            "obj":{"type":"variables_get","fields":{"variable":"obj"}},
            "key":{"type":"text","fields":{"TEXT":key}},"value":value
        }})
    };
    let get = |key: &str| {
        json!({"type":"_object_get","inputs":{
            "obj":{"type":"variables_get","fields":{"variable":"obj"}},
            "key":{"type":"text","fields":{"TEXT":key}}
        }})
    };
    let increment = || {
        json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{
            "A":get("count"),"B":num(1)
        }})
    };
    let mut p = project(
        vec![
            log(json!({"type":"microbit_led_is_plot","inputs":{
                "x":set("count", increment()),
                "y":set("second", get("count"))
            }})),
            log(get("count")),
            log(get("second")),
        ],
        true,
    );
    p["variables"]["variablesDict"]["obj"]["value"] = json!({"count":0});
    let expected: Vec<String> = (1..=80)
        .flat_map(|i| ["false".to_owned(), i.to_string(), i.to_string()])
        .collect();
    for jit in [false, true] {
        assert_eq!(run(&p, jit), expected);
    }
}

#[test]
fn disconnected_led_predicate_does_not_hide_invalid_or_missing_sockets() {
    for key in ["x", "y"] {
        let mut block = json!({"type":"microbit_led_is_plot","inputs":{"x":num(1),"y":num(1)}});
        block["inputs"][key] = json!({"type":"unknown-hardware-child"});
        assert!(
            Program::compile(&project(vec![log(block.clone())], false)).is_err(),
            "{key}"
        );
        block["inputs"].as_object_mut().unwrap().remove(key);
        assert!(
            Program::compile(&project(vec![log(block)], false)).is_err(),
            "missing {key}"
        );
    }
}

#[test]
fn led_queries_remain_typed_inside_deep_value_trees_and_numeric_inputs() {
    let led = || json!({"type":"microbit_led_is_plot","inputs":{"x":num(1),"y":num(2)}});
    let mut deep = led();
    for _ in 0..70 {
        deep = json!({"type":"logic_negate","inputs":{"logic":deep}});
    }
    let numeric =
        json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":led(),"B":num(1)}});
    let p = project(vec![log(deep), log(numeric)], false);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["false", "1"]);
    }
}
