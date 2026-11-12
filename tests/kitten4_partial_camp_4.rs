use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|b| same(v, b)))
        }
        _ => a == b,
    }
}

#[test]
fn arbitrary_camps_initial_membership_and_clone_independence_match_every_official_frame() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-partial-camp-4-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let native: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-camp-4-{name}.bcm"))
                .unwrap(),
        )
        .unwrap();
        let project = kitten4::to_neko(&native).unwrap();
        assert_eq!(kitten4::from_neko(&project).unwrap(), native);
        for interpreted in [false, true] {
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            if interpreted {
                engine.disable_jit();
            }
            engine.set_costume(
                "costume-a",
                nekoc::engine::Costume {
                    width: 80.0,
                    height: 40.0,
                    ..Default::default()
                },
            );
            // Restart also restores arbitrary serialized groups and removes clones.
            for _ in 0..2 {
                engine.start();
                for (i, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                    engine
                        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                        .unwrap();
                    assert!(
                        same(&engine.oracle_snapshot(i as u32 + 1)["variables"], expected),
                        "{name} frame {} interpreted={interpreted}",
                        i + 1
                    );
                    for (id, group) in case["groups"][i].as_object().unwrap() {
                        assert_eq!(
                            engine.actor_group(id),
                            group.as_str(),
                            "{name} frame {} actor={id}",
                            i + 1
                        );
                    }
                }
            }
        }
    }
}
