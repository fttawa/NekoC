use nekoc::{
    engine::{Cell, Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn numeric(value: &Value) -> Value {
    match value {
        Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.iter().map(numeric).collect()),
        _ => value.clone(),
    }
}

#[test]
fn property_lists_lazy_slots_and_empty_costumes_match_official_frames() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-properties-5-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!(
                "tests/fixtures/kitten4/partial-properties-5-{name}.bcm"
            ))
            .unwrap(),
        )
        .unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
        for interpreter in [false, true] {
            let mut engine = Engine::new(Program::compile(&canonical).unwrap());
            if interpreter {
                engine.disable_jit();
            }
            for restart in 0..2 {
                engine.start();
                assert!(matches!(
                    engine.variable_value("40000000-0000-4000-8000-000000000099"),
                    Cell::Null
                ));
                for (i, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                    let frame = engine
                        .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                        .unwrap();
                    assert!(!frame.budget_yield);
                    let actual = engine.oracle_snapshot(i as u32 + 1);
                    for (id, actor) in case["actors"][i].as_object().unwrap() {
                        for key in ["x", "y"] {
                            assert_eq!(
                                numeric(&actual["actors"][id][key]),
                                numeric(&actor[key]),
                                "{name}, frame={}, actor={id}, key={key}",
                                i + 1
                            );
                        }
                    }
                    for (id, value) in expected.as_object().unwrap() {
                        // Local declarations are observed through their reporter elsewhere.
                        if id == "30000000-0000-4000-8000-000000000001" {
                            continue;
                        }
                        assert_eq!(
                            numeric(&actual["variables"][id]),
                            numeric(value),
                            "{name}, frame={}, jit={}, restart={restart}, id={id}",
                            i + 1,
                            !interpreter
                        );
                    }
                    for (id, raw) in case["raw"][i].as_object().unwrap() {
                        let value = engine.variable_value(id);
                        if raw["present"] == false {
                            assert!(
                                matches!(value, Cell::Null),
                                "{name}, frame={}, id={id}: {value:?}",
                                i + 1
                            );
                            assert!(actual["variables"].get(id).is_none());
                        } else {
                            assert_eq!(
                                numeric(&serde_json::to_value(&value).unwrap()),
                                numeric(&raw["value"]),
                                "{name}, frame={}, id={id}",
                                i + 1
                            );
                        }
                    }
                    if name.starts_with("no-costume") {
                        let Cell::List(items) = engine.variable_value("result") else {
                            panic!("{name}: result is not a list");
                        };
                        let items = items.borrow();
                        assert!(
                            matches!(&items[4], Cell::Number(n) if n.is_nan()),
                            "{name}: style name"
                        );
                        if name.ends_with("actor") {
                            assert!(
                                matches!(&items[2], Cell::Number(n) if n.is_nan()),
                                "{name}: style index"
                            );
                        }
                    }
                }
            }
        }
    }
}
