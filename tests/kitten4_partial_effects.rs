use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn close(actual: f64, expected: &Value, message: &str) {
    let expected = expected.as_f64().unwrap();
    assert!(
        (actual - expected).abs() < 1e-8,
        "{message}: {actual} != {expected}"
    );
}

fn same_values(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-8
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_values(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| same_values(a, b)))
        }
        _ => actual == expected,
    }
}

/// Check every boundary observation on its actual official execution frame, not
/// an assumed wait cadence. Both VM modes use the same command implementation.
#[test]
fn offline_official_effect_boundaries_and_aliases() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-effects-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        assert_eq!(case["errors"], serde_json::json!([]), "{name}");
        assert!(
            case["externalRequests"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["action"] == "blocked")
        );
        let source =
            std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-effects-{name}.bcm"))
                .unwrap();
        let source = nekoc::json::from_str(&source).unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        assert_eq!(
            kitten4::from_neko(&project).unwrap(),
            source,
            "{name}: opaque round trip"
        );
        for interpreter in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            // Same original inline SVG source dimensions as the official page;
            // headless Engine does not decode image data URLs itself.
            for (id, width, height) in [
                ("background", 1280.0, 720.0),
                (
                    "costume-a",
                    if name.starts_with("wide-") {
                        80.0
                    } else {
                        20.0
                    },
                    if name.starts_with("wide-") {
                        40.0
                    } else {
                        20.0
                    },
                ),
                ("costume-b", 30.0, 20.0),
            ] {
                vm.set_costume(
                    id,
                    nekoc::engine::Costume {
                        width,
                        height,
                        center_point: [0.0; 2],
                        mask: None,
                        rgb: None,
                    },
                );
            }
            vm.use_virtual_clock();
            if interpreter {
                vm.disable_jit();
            }
            vm.start();
            for i in 1..=case["frames"].as_u64().unwrap() {
                let frame = vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
                assert!(!frame.budget_yield, "{name}/{i}");
                assert!(
                    same_values(
                        &vm.oracle_snapshot(i as u32)["variables"],
                        &case["variables"][i as usize - 1]
                    ),
                    "{name}/{i}: variable reporters"
                );
                for observation in case["observations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|o| o["frame"].as_u64() == Some(i))
                {
                    let a = frame
                        .sprites
                        .iter()
                        .find(|s| s.id == case["entity"].as_str().unwrap())
                        .unwrap();
                    let message = format!("{name}/{i}/{observation}/interpreter={interpreter}");
                    let state = &observation["state"];
                    close(a.opacity, &state["opacity"], &message);
                    let raw = [
                        a.effects[0],
                        a.effects[2] + 100.0,
                        a.effects[3],
                        a.effects[4],
                        a.effects[5],
                        -a.effects[6],
                        a.effects[7],
                    ];
                    for (actual, expected) in raw.iter().zip(state["effects"].as_array().unwrap()) {
                        close(*actual, expected, &message);
                    }
                }
            }
        }
    }
}
