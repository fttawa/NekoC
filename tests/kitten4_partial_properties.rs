use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn normalize_numbers(value: &Value) -> Value {
    match value {
        Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.iter().map(normalize_numbers).collect()),
        _ => value.clone(),
    }
}

#[test]
fn properties_match_recorded_official_kernel() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-properties-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!(
                "tests/fixtures/kitten4/partial-properties-{name}.bcm"
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
            engine.start();
            if let Some(expected) = case["variables"].as_array() {
                for (i, expected) in expected.iter().enumerate() {
                    let frame = engine
                        .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                        .unwrap();
                    assert!(!frame.budget_yield);
                    assert_eq!(
                        normalize_numbers(
                            &engine.oracle_snapshot(i as u32 + 1)["variables"]["result"]
                        ),
                        normalize_numbers(&expected["result"]),
                        "{name}, frame {}, interpreter={interpreter}",
                        i + 1
                    );
                    // JSON serializes NaN as null. Assert the native Cell text
                    // too, so an actual null/0 cannot accidentally pass here.
                    let text = expected["result"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|value| match value {
                            Value::Null => "NaN".to_owned(),
                            Value::String(value) => value.clone(),
                            Value::Number(value) => {
                                nekoc::engine::Cell::Number(value.as_f64().unwrap()).text()
                            }
                            _ => panic!("unexpected property probe value"),
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    assert_eq!(engine.variable_value("result").text(), text, "{name}");
                }
            } else {
                let error = engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                    .expect_err(name);
                let expected = if name.contains("scene") {
                    "use_actor_blocks_in_scene"
                } else if name.ends_with("text") || name.ends_with("bool") {
                    "clone_entity_index_only_support_number"
                } else {
                    "clone_entity_not_exist"
                };
                assert!(format!("{error:#}").contains(expected), "{name}: {error:#}");
            }
        }
    }
}
