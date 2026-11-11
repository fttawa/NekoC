//! Original end-to-end fixture, paired with official KN 0.27.4 observations.
use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

fn encode(value: Cell) -> Value {
    match value {
        Cell::Number(n) if n.is_nan() => json!({"$number":"NaN"}),
        Cell::Undefined => json!({"$undefined":true}),
        v => serde_json::to_value(v).unwrap(),
    }
}

#[test]
fn clone_properties_and_pointer_values_match_official_project() {
    let project: Value =
        serde_json::from_str(include_str!("fixtures/kn-semantics/partial-clone.bcmkn")).unwrap();
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kn-partial-official.json")).unwrap();
    for jit in [false, true] {
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        if !jit {
            engine.disable_jit();
        }
        engine.start();
        for _ in 0..180 {
            engine
                .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                .unwrap();
        }
        for (id, expected) in evidence["result"]["variables"].as_object().unwrap() {
            let variable = &project["variables"]["variablesDict"][id];
            let value = if variable["isGlobal"] == false {
                engine.entity_variable_value(variable["currentEntityId"].as_str().unwrap(), id)
            } else {
                engine.variable_value(id)
            };
            let actual = encode(value);
            if expected.is_number() {
                assert_eq!(actual.as_f64(), expected.as_f64(), "{id}; jit={jit}");
            } else {
                assert_eq!(actual, *expected, "{id}; jit={jit}");
            }
        }
    }
}

#[test]
fn clone_missing_attribute_and_index_types_do_not_use_legacy_codes() {
    let mut project: Value =
        serde_json::from_str(include_str!("fixtures/kn-semantics/partial-clone.bcmkn")).unwrap();
    let actor = project["actors"]["actorsDict"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    for attribute in ["camp", "distance", "unknown", "7", "?"] {
        project["actors"]["actorsDict"][&actor]["nekoBlockJsonList"] = json!([{
            "type":"on_running_group_activated","next":{
                "type":"variables_set","fields":{"variable":"done"},"inputs":{"value":{
                    "type":"get_clone_index_property","fields":{"sprite":"--self","attribute":attribute},
                    "inputs":{"index":{"type":"math_number","fields":{"NUM":"0"}}}
                }}
            }
        }]);
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        engine.start();
        engine
            .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(
            encode(engine.variable_value("done")),
            json!({"$number":"NaN"})
        );
    }
}
