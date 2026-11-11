//! Independent command paths; contact-solver differences remain explicit.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, time::Duration};

#[test]
fn remaining_physics_commands_match_every_official_update() {
    let report: Value =
        serde_json::from_slice(&fs::read("docs/kitten4-partial-physics-7-evidence.json").unwrap())
            .unwrap();
    for (name, case) in report["cases"].as_object().unwrap() {
        let text = fs::read_to_string(case["fixture"].as_str().unwrap())
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(case["sha256"], format!("{:x}", Sha256::digest(&text)));
        let source: Value = serde_json::from_str(&text).unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
        for interpreted in [false, true] {
            let mut engine = Engine::new(Program::compile(&canonical).unwrap());
            engine.set_costume(
                "probe-style",
                Costume {
                    width: 20.0,
                    height: 20.0,
                    mask: Some((20, 20, vec![255; 50])),
                    ..Default::default()
                },
            );
            if interpreted {
                engine.disable_jit();
            }
            engine.use_virtual_clock();
            engine.start();
            for frame in case["frames"].as_array().unwrap() {
                engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                    .unwrap();
                let snapshot = engine.oracle_snapshot(frame["frame"].as_u64().unwrap() as u32);
                let actor = &snapshot["actors"]["20000000-0000-4000-8000-000000000001"];
                // No claim of LiquidFun/Rapier contact equality. Right-edge
                // probes have a recorded 1.816px transient solver difference.
                let contact = case["contact"].as_bool().unwrap_or(false);
                for key in ["x", "y", "rotation"] {
                    let actual = actor[key].as_f64().unwrap();
                    let expected = frame["actor"][key].as_f64().unwrap();
                    assert!(
                        (actual - expected).abs() < if contact { 1.82 } else { 1e-7 },
                        "{name} interpreted={interpreted} frame={} {key}: {actual} != {expected}",
                        frame["frame"]
                    );
                }
                for (key, expected) in frame["variables"].as_object().unwrap() {
                    let actual = &snapshot["variables"][key];
                    if let (Some(actual), Some(expected)) = (actual.as_f64(), expected.as_f64()) {
                        let tolerance = if contact && key == "crossed" {
                            0.22
                        } else {
                            1e-9
                        };
                        assert!(
                            (actual - expected).abs() < tolerance,
                            "{name} interpreted={interpreted} frame={} {key}: {actual} != {expected}",
                            frame["frame"]
                        );
                    } else {
                        assert_eq!(actual, expected, "{name} {key}");
                    }
                }
            }
            assert_eq!(engine.variable_text("done"), "1", "{name}");
        }
    }
}
