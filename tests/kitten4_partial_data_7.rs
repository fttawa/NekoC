use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => a.iter().map(normalize).collect(),
        Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect(),
        _ => value.clone(),
    }
}

#[test]
fn data_and_midi_wait_match_every_official_frame() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-partial-data-7-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        if name.starts_with("shake-") {
            continue; // Negative probes are pinned independently below, not certified.
        }
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-data-7-{name}.bcm"))
                .unwrap(),
        )
        .unwrap();
        for interpreted in [false, true] {
            let mut vm =
                Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
            if interpreted {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.start();
            for (frame, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert_eq!(
                    normalize(&vm.oracle_snapshot((frame + 1) as u32)["variables"]),
                    normalize(expected),
                    "{name}/{}/{interpreted}",
                    frame + 1
                );
                if let Some(actors) = case["actors"].get(frame) {
                    let snapshot = vm.oracle_snapshot((frame + 1) as u32);
                    for (id, state) in actors.as_object().unwrap() {
                        for key in ["x", "y"] {
                            assert_eq!(
                                snapshot["actors"][id][key].as_f64(),
                                state[key].as_f64(),
                                "{name}/{}/{interpreted}/{key}",
                                frame + 1
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn shake_negative_probe_preserves_unresolved_task_phase_evidence() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-partial-data-7-evidence.json")).unwrap();
    let source: Value = serde_json::from_str(
        &std::fs::read_to_string("tests/fixtures/kitten4/partial-data-7-shake-0.14.bcm").unwrap(),
    )
    .unwrap();
    let case = &evidence["cases"]["shake-0.14"];
    for interpreted in [false, true] {
        let mut vm = Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
        if interpreted {
            vm.disable_jit();
        }
        vm.start();
        for frame in 1..=11 {
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                .unwrap();
            let snapshot = vm.oracle_snapshot(frame);
            if frame == 10 {
                assert_eq!(snapshot["variables"]["phase"].as_f64(), Some(2.0));
                assert_eq!(case["variables"][9]["phase"].as_f64(), Some(1.0));
            }
        }
    }
}
