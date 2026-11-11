//! Official KN 0.27.4 disconnected branches; no physical device simulation.
#[path = "../src/engine/kn_hardware.rs"]
mod profile;

use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

const REPORTERS: &[(&str, &str)] = &[
    ("microbit_get_volume", "undefined"),
    ("catbit_button_is_pressed", "false"),
    ("wand_button_is_pressed", "false"),
    ("wand_coordinate", "NaN"),
    ("wand_rotation", "NaN"),
    ("get_robot_master_motor_power", "NaN"),
    ("get_robot_master_infrared_sensor_distance", "NaN"),
    ("get_robot2_master_motor_power", "NaN"),
];

fn num(n: usize) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}
fn get(key: &str) -> Value {
    json!({"type":"_object_get","inputs":{
        "obj":{"type":"variables_get","fields":{"variable":"obj"}},"key":text(key)
    }})
}
fn set(key: &str, value: Value) -> Value {
    json!({"type":"_object_set","inputs":{
        "obj":{"type":"variables_get","fields":{"variable":"obj"}},
        "key":text(key),"value":value
    }})
}
fn project(blocks: Vec<Value>, hot: bool) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{"count":0,"null":null}});
    p["variables"]["variableIds"] = json!(["obj"]);
    let mut chain = blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap();
    if hot {
        chain = json!({"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":num(600)},"statements":{"DO":chain}
        }}});
    }
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] =
        json!([{"type":"on_running_group_activated","next":chain}]);
    p
}
fn run(p: &Value, jit: bool) -> Vec<String> {
    let mut vm = Engine::new(Program::compile(p).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.start();
    let mut logs = vec![];
    // Bound each output batch below the VM's 1024-log safety cap even for a
    // non-yielding hot warp; do not mistake truncated output for a value bug.
    for _ in 0..1000 {
        logs.extend(
            vm.advance(1.0 / 60.0, 500, Duration::from_secs(1))
                .unwrap()
                .logs,
        );
    }
    logs
}

#[test]
fn eight_new_synchronous_reporters_keep_official_types_for_all_recorded_fields() {
    let other: Value =
        serde_json::from_str(include_str!("../docs/kn-other-hardware-evidence.json")).unwrap();
    let micro: Value =
        serde_json::from_str(include_str!("../docs/kn-hardware-remaining-evidence.json")).unwrap();
    for name in [
        "microbit_get_volume",
        "microbit_set_bpm",
        "microbit_change_bpm",
    ] {
        let entry = micro["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == name)
            .unwrap();
        assert_eq!(entry["promise"], false, "{name}");
        assert_eq!(entry["result"], json!({"type":"undefined"}), "{name}");
        if let Some(sockets) = profile::command(name) {
            assert_eq!(entry["inputs"], json!(sockets), "{name}");
        } else {
            assert_eq!(
                profile::reporter(name).unwrap().result,
                profile::DisconnectedValue::Undefined
            );
        }
    }
    let mut blocks = vec![log(json!({"type":"microbit_get_volume"}))];
    let mut expected = vec!["undefined".to_owned()];
    for panel in other["editor"]["panels"].as_array().unwrap() {
        let name = panel["name"].as_str().unwrap();
        let Some((_, result)) = REPORTERS.iter().find(|(n, _)| *n == name) else {
            continue;
        };
        let spec = profile::reporter(name).unwrap();
        assert!(spec.inputs.is_empty(), "{name}");
        assert_eq!(
            spec.result,
            if *result == "false" {
                profile::DisconnectedValue::BooleanFalse
            } else {
                profile::DisconnectedValue::NumberNaN
            },
            "{name}"
        );
        for case in other["editor"]["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["name"] == name && c["boundary"] == "synchronous-return")
        {
            // Direct-domain malformed-object cases are not native block fields.
            let fields = case
                .get("args")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            blocks.push(log(json!({"type":name,"fields":fields})));
            expected.push((*result).into());
        }
    }
    // Explicit menus, invalid and empty fields must not become fake device data.
    for &(name, result) in REPORTERS {
        for key in ["A", "B", "x", "y", "z", "", "invalid"] {
            blocks.push(log(
                json!({"type":name,"fields":{"key":key,"motor":key,"num":key}}),
            ));
            expected.push(result.into());
        }
    }
    let p = project(blocks, true);
    for jit in [false, true] {
        assert_eq!(
            run(&p, jit),
            (0..600).flat_map(|_| expected.clone()).collect::<Vec<_>>()
        );
    }
}

#[test]
fn undefined_boolean_and_nan_are_not_coerced_to_zero_or_null() {
    let equal = |a: Value, b: Value| json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":a,"B":b}});
    let mut blocks = vec![
        log(equal(json!({"type":"microbit_get_volume"}), get("absent"))),
        log(equal(json!({"type":"microbit_get_volume"}), get("null"))),
    ];
    for &(name, _) in REPORTERS {
        blocks.push(log(equal(json!({"type":name}), num(0))));
        let mut deep = json!({"type":name});
        for _ in 0..70 {
            deep = json!({"type":"logic_negate","inputs":{"logic":deep}});
        }
        blocks.push(log(deep));
        blocks.push(log(
            json!({"type":"math_arithmetic","fields":{"type":"add"},
            "inputs":{"A":{"type":name},"B":num(1)}}),
        ));
    }
    let mut expected = vec!["true", "false"];
    for &(name, _) in REPORTERS {
        expected.extend([
            "false",
            "false",
            if name.ends_with("button_is_pressed") {
                "1"
            } else {
                "NaN"
            },
        ]);
    }
    let p = project(blocks, false);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), expected);
    }
}

#[test]
fn synchronous_bpm_commands_evaluate_once_continue_and_do_not_change_volume() {
    let increment = || {
        json!({"type":"math_arithmetic","fields":{"type":"add"},
        "inputs":{"A":get("count"),"B":num(1)}})
    };
    let p = project(
        vec![
            json!({"type":"microbit_set_bpm","inputs":{"bpm":set("count", increment())}}),
            json!({"type":"microbit_change_bpm","fields":{"change":"invalid"},
            "inputs":{"offset":set("count", increment())}}),
            log(get("count")),
            log(json!({"type":"microbit_get_volume"})),
        ],
        true,
    );
    assert_eq!(
        profile::command("microbit_set_bpm"),
        Some(["bpm"].as_slice())
    );
    assert_eq!(
        profile::command("microbit_change_bpm"),
        Some(["offset"].as_slice())
    );
    let expected: Vec<String> = (1..=600)
        .flat_map(|i| [(2 * i).to_string(), "undefined".into()])
        .collect();
    for jit in [false, true] {
        assert_eq!(run(&p, jit), expected);
    }
    for (name, socket) in [
        ("microbit_set_bpm", "bpm"),
        ("microbit_change_bpm", "offset"),
    ] {
        assert!(Program::compile(&project(vec![json!({"type":name})], false)).is_err());
        let b = json!({"type":name,"inputs":{socket:{"type":"unknown-child"}}});
        assert!(Program::compile(&project(vec![b], false)).is_err());
        let b = json!({"type":name,"inputs":{socket:json!({"type":"calculate","inputs":{"input":text("1+")}})},
            "next":log(text("must not run"))});
        let mut vm = Engine::new(Program::compile(&project(vec![b], false)).unwrap());
        vm.start();
        assert!(vm.advance(0.0, 1000, Duration::from_secs(1)).is_err());
    }
}

#[test]
fn every_unproven_promise_command_reporter_and_event_remains_rejected() {
    let micro: Value =
        serde_json::from_str(include_str!("../docs/kn-hardware-remaining-evidence.json")).unwrap();
    let other: Value =
        serde_json::from_str(include_str!("../docs/kn-other-hardware-evidence.json")).unwrap();
    let entries = micro["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .chain(other["editor"]["panels"].as_array().unwrap());
    let mut rejected = 0;
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        if profile::reporter(name).is_some()
            || profile::command(name).is_some()
            || entry["inCatalog"] == false
        {
            continue;
        }
        assert_eq!(profile::reporter(name), None, "{name}");
        assert_eq!(profile::command(name), None, "{name}");
        let block = json!({"type":name});
        let p = match entry["kind"].as_str().unwrap() {
            "reporter" => project(vec![log(block)], false),
            "event" => {
                let mut p = project(vec![log(text("ordinary start"))], false);
                p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
                    .as_array_mut()
                    .unwrap()
                    .push(block);
                p
            }
            "command" => project(vec![block], false),
            kind => panic!("unexpected {kind}"),
        };
        let error = Program::compile(&p)
            .err()
            .unwrap_or_else(|| panic!("accepted {name}"));
        assert!(format!("{error:#}").contains(name), "{name}: {error:#}");
        assert!(
            format!("{error:#}").contains("unsupported"),
            "{name}: {error:#}"
        );
        rejected += 1;
    }
    assert_eq!(rejected, 43);
    assert!(profile::reporter("microbit_future").is_none());
    assert!(profile::command("set_robot_future").is_none());
}
