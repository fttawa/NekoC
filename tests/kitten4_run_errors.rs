use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| same_value(a, b)))
        }
        _ => actual == expected,
    }
}

#[test]
fn run_error_probes_match_recorded_official_values() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-run-error-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/runerr-{name}.bcm")).unwrap(),
        )
        .unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        for interpreter in [false, true] {
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            if interpreter {
                engine.disable_jit();
            }
            engine.set_random_seed(6);
            engine.start();
            for (frame, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                let result = engine
                    .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert!(!result.budget_yield, "{name}");
                let actual = &engine.oracle_snapshot(frame as u32 + 1)["variables"];
                assert!(
                    same_value(actual, expected),
                    "{name}, frame {}, interpreter={interpreter}: {actual} != {expected}",
                    frame + 1
                );
            }
        }
    }
}

#[test]
fn warm_native_warp_body_does_not_skip_the_suspension_boundary() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/runerr-warp-10002.bcm")).unwrap();
    let mut engine = Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
    // One run already makes the loop body hot (>500 entries). A second run
    // re-enters the retained native regions, but the loop boundary stays in exec.
    for _ in 0..2 {
        engine.start();
        engine
            .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(engine.oracle_snapshot(1)["variables"]["log"], 10002.0);
        engine
            .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(engine.oracle_snapshot(2)["variables"]["log"], -1.0);
    }
}
