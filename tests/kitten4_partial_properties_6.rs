//! Repository-original probes compared with archived offline-player updates.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| same(a, b)))
        }
        _ => a == b,
    }
}

#[test]
fn properties_clones_costumes_and_visibility_match_all_official_updates() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-properties-6-evidence.json"
    ))
    .unwrap();
    assert_eq!(evidence["cases"].as_object().unwrap().len(), 8);
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!(
                "tests/fixtures/kitten4/partial-properties-6-{name}.bcm"
            ))
            .unwrap(),
        )
        .unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
        for interpreted in [false, true] {
            let mut engine = Engine::new(Program::compile(&canonical).unwrap());
            if interpreted {
                engine.disable_jit();
            }
            engine.use_virtual_clock();
            for restart in 0..2 {
                engine.start();
                let mut sprites = BTreeMap::new();
                for expected in case["frames"].as_array().unwrap() {
                    let frame = expected["frame"].as_u64().unwrap() as u32;
                    let result = engine
                        .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                        .unwrap();
                    assert!(!result.budget_yield);
                    for id in result.removed {
                        sprites.remove(&id);
                    }
                    for sprite in result.sprites {
                        sprites.insert(
                            sprite.id.clone(),
                            (sprite.visible, sprite.opacity, sprite.style),
                        );
                    }
                    let context =
                        format!("{name}/{frame}/interpreted={interpreted}/restart={restart}");
                    let actual = engine.oracle_snapshot(frame);
                    for (id, value) in expected["variables"].as_object().unwrap() {
                        let observed = if id == "30000000-0000-4000-8000-000000000061" {
                            &actual["entity_variables"]["20000000-0000-4000-8000-000000000001"][id]
                        } else {
                            &actual["variables"][id]
                        };
                        assert!(
                            same(observed, value),
                            "{context}/{id}: {observed} != {value}"
                        );
                    }
                    assert_eq!(
                        actual["actors"].as_object().unwrap().len(),
                        expected["actors"].as_object().unwrap().len(),
                        "{context}"
                    );
                    for (id, actor) in expected["actors"].as_object().unwrap() {
                        for key in ["x", "y", "visible"] {
                            assert!(
                                same(&actual["actors"][id][key], &actor[key]),
                                "{context}/{id}/{key}"
                            );
                        }
                        let (visible, opacity, style) = &sprites[id];
                        assert_eq!(
                            *visible,
                            actor["visible"].as_bool().unwrap(),
                            "{context}/{id}"
                        );
                        assert!(
                            (*opacity - actor["opacity"].as_f64().unwrap()).abs() < 1e-9,
                            "{context}/{id}/alpha"
                        );
                        assert_eq!(
                            style.as_deref(),
                            actor["style"].as_str(),
                            "{context}/{id}/style"
                        );
                    }
                }
            }
        }
    }
}
