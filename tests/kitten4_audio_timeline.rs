//! Replay diagnostic-clock official observations, not acoustic parity.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(number) => json!(number.as_f64().unwrap()),
        Value::Array(values) => values.iter().map(normalize).collect(),
        Value::Object(values) => values
            .iter()
            .map(|(key, value)| (key.clone(), normalize(value)))
            .collect(),
        _ => value.clone(),
    }
}

#[test]
fn audio_and_midi_waits_match_each_official_diagnostic_update_in_both_tiers() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-audio-timeline-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(case["fixture"].as_str().unwrap()).unwrap(),
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
            for (frame, expected) in case["officialVariables"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert_eq!(
                    normalize(&vm.oracle_snapshot(frame as u32 + 1)["variables"]),
                    normalize(expected),
                    "{name} frame={} interpreted={interpreted}",
                    frame + 1
                );
            }
        }
    }
}
