use nekoc::{
    engine::{Cell, Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}

fn literal(value: &Value) -> Value {
    match value {
        Value::Null | Value::Object(_) => {
            json!({"type":"JSON.parse","inputs":{"text":text(&value.to_string())}})
        }
        Value::Array(items) => array(items.iter().map(literal).collect()),
        Value::Bool(b) => {
            json!({"type":"logic_boolean","fields":{"BOOL":if *b {"TRUE"} else {"FALSE"}}})
        }
        Value::Number(n) => json!({"type":"math_number","fields":{"NUM":n}}),
        Value::String(s) => text(s),
    }
}

fn array(items: Vec<Value>) -> Value {
    let inputs: serde_json::Map<String, Value> = items
        .into_iter()
        .enumerate()
        .map(|(i, v)| (format!("items{i}"), v))
        .collect();
    json!({"type":"_array_literal","inputs":inputs})
}

fn undefined() -> Value {
    json!({"type":"_object_get","inputs":{"obj":{"type":"_object_literal"},"key":text("missing")}})
}

#[test]
fn conversions_match_all_archived_official_typed_results() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kn-conversion-evidence.json")).unwrap();
    assert_eq!(evidence["ok"], true);
    let calls = evidence["editor"]["calls"].as_array().unwrap();
    assert_eq!(calls.len(), 63);
    for call in calls {
        let label = call["label"].as_str().unwrap();
        let input = match label {
            "undefined" => undefined(),
            "undefined item" => array(vec![undefined()]),
            "NaN" | "Infinity" => {
                json!({"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{"A":literal(&json!(if label == "NaN" {0} else {1})),"B":literal(&json!(0))}})
            }
            _ => evidence_input(&call["input"]),
        };
        let convert =
            json!({"type":"convert_type","fields":{"type":call["target"]},"inputs":{"text":input}});
        let mut p = Document::blank().value().clone();
        p["variables"]["variablesDict"]["result"] =
            json!({"id":"result","name":"result","type":"variable","value":0});
        p["variables"]["variableIds"] = json!(["result"]);
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":{"type":"repeat_n_times","inputs":{"times":literal(&json!(80))},"statements":{"DO":{"type":"variables_set","fields":{"variable":"result"},"inputs":{"value":convert}}}}}
        ]);
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&p).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            for _ in 0..85 {
                vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap();
            }
            let actual = vm.variable_value("result");
            let expected = &call["result"];
            let matches = match expected["type"].as_str().unwrap() {
                "string" => {
                    matches!(&actual, Cell::Text(s) if Some(s.as_ref()) == expected["value"].as_str())
                }
                "boolean" => {
                    matches!(actual, Cell::Bool(b) if Some(b) == expected["value"].as_bool())
                }
                "number" => {
                    matches!(actual, Cell::Number(n) if if expected["value"] == "NaN" { n.is_nan() } else if expected["value"] == "Infinity" { n == f64::INFINITY } else { Some(n) == expected["value"].as_f64() })
                }
                other => panic!("unexpected evidence type {other}"),
            };
            assert!(
                matches,
                "{label}, target={}, jit={jit}: {actual:?} != {expected}",
                call["target"]
            );
        }
    }
}

fn evidence_input(input: &Value) -> Value {
    if let Some(items) = input["items"].as_array() {
        array(items.iter().map(evidence_input).collect())
    } else if input["type"] == "undefined" {
        undefined()
    } else {
        literal(&input["value"])
    }
}

#[test]
fn conversion_preserves_input_side_effect_and_rejects_unknown_target() {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    p["variables"]["variableIds"] = json!(["obj"]);
    let assignment = json!({"type":"_object_set","inputs":{"obj":{"type":"variables_get","fields":{"variable":"obj"}},"key":text("seen"),"value":text("12")}});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{"type":"console_log","inputs":{"console_log":{"type":"convert_type","fields":{"type":"number"},"inputs":{"text":assignment}}},"next":{"type":"console_log","inputs":{"console_log":{"type":"_object_get","inputs":{"obj":{"type":"variables_get","fields":{"variable":"obj"}},"key":text("seen")}}}}}}
    ]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        assert_eq!(
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap()
                .logs,
            ["[object Object]", "12"]
        );
    }
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["inputs"]["console_log"]
        ["fields"]["type"] = json!("not-a-type");
    let error = format!("{:#}", Program::compile(&p).unwrap_err());
    assert!(error.contains("unsupported conversion"), "{error}");
}
