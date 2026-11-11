use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

const EVIDENCE: &str = include_str!("../docs/kn-partial-conversion.json");

fn fixture(name: &str) -> Value {
    serde_json::from_str(match name {
        "graphs" => include_str!("fixtures/kn-partial-conversion/graphs.bcmkn"),
        "deep" => include_str!("fixtures/kn-partial-conversion/deep.bcmkn"),
        "values" => include_str!("fixtures/kn-partial-conversion/values.bcmkn"),
        _ => panic!("unknown conversion fixture {name}"),
    })
    .unwrap()
}

#[test]
fn original_projects_match_official_typed_conversion_results() {
    let evidence: Value = serde_json::from_str(EVIDENCE).unwrap();
    assert_eq!(evidence["ok"], true);
    assert_eq!(evidence["local"]["editorVersion"], "0.27.4");
    assert_eq!(evidence["editorCompat"]["ok"], true);
    let mut conversions = 0;
    for name in ["graphs", "deep", "values"] {
        let p = fixture(name);
        let expected = evidence["cases"][name]["variables"].as_object().unwrap();
        assert_eq!(expected["done"], 1);
        conversions += expected.len() - 3;
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&p).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.start();
            for _ in 0..180 {
                let update = vm
                    .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                    .unwrap();
                assert!(
                    !update.budget_yield,
                    "{name}, jit={jit}: fixture exceeded execution budget"
                );
            }
            assert!(
                matches!(vm.variable_value("done"), Cell::Number(1.0)),
                "{name}, jit={jit}: unfinished fixture is not a conversion mismatch"
            );
            for (id, expected) in expected {
                let value = vm.variable_value(id);
                let same = match expected {
                    Value::Bool(b) => matches!(value, Cell::Bool(actual) if actual == *b),
                    Value::Number(n) => {
                        matches!(value, Cell::Number(actual) if Some(actual) == n.as_f64())
                    }
                    Value::String(s) => {
                        matches!(&value, Cell::Text(actual) if actual.as_ref() == s)
                    }
                    other => panic!("unexpected scalar evidence {other}"),
                };
                assert!(same, "{name}/{id}, jit={jit}: {value:?} != {expected}");
            }
        }
    }
    assert_eq!(conversions, 51);
}

fn shadow_project(target: &str, nested: bool) -> Value {
    let mut p = fixture("values");
    let object = json!({"type":"JSON.parse","inputs":{"text":{"type":"text","fields":{"TEXT":"{\"toString\":\"17\"}"}}}});
    let input = if nested {
        json!({"type":"_array_literal","inputs":{"items0":object}})
    } else {
        object
    };
    let actor = p["actors"]["actorsDict"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap();
    actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated","next":{
        "type":"variables_set","fields":{"variable":"b"},"inputs":{"value":input},"next":{
            "type":"variables_set","fields":{"variable":"a"},"inputs":{"value":{
                "type":"convert_type","fields":{"type":target},"inputs":{"text":{"type":"variables_get","fields":{"variable":"b"}}}
            }}
        }
    }}]);
    p
}

#[test]
fn noncallable_own_tostring_is_an_error_not_a_successful_object_string() {
    let evidence: Value = serde_json::from_str(EVIDENCE).unwrap();
    for target in ["number", "string"] {
        let call = evidence["local"]["calls"]
            .as_array()
            .unwrap()
            .iter()
            .find(|call| call["label"] == "object_shadow_tostring" && call["target"] == target)
            .unwrap();
        assert_eq!(
            call["error"],
            "TypeError: Cannot convert object to primitive value"
        );
        for nested in [false, true] {
            for jit in [false, true] {
                let mut vm =
                    Engine::new(Program::compile(&shadow_project(target, nested)).unwrap());
                if !jit {
                    vm.disable_jit();
                }
                vm.start();
                let error = vm
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap_err();
                assert!(
                    format!("{error:#}").contains("Cannot convert object to primitive value"),
                    "{error:#}"
                );
            }
        }
    }
}

#[test]
fn boolean_conversion_never_invokes_object_tostring() {
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&shadow_project("boolean", false)).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert!(matches!(vm.variable_value("a"), Cell::Bool(true)));
    }
}
