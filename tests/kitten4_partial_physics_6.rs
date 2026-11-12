//! Command paths are compared separately from the intentionally different contact solver.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, time::Duration};

#[test]
fn command_paths_compare_each_update_including_fixed_modern_membership() {
    let report: Value =
        serde_json::from_slice(&fs::read("docs/kitten4-partial-physics-6-evidence.json").unwrap())
            .unwrap();
    for (name, case) in report["cases"].as_object().unwrap() {
        let text = fs::read_to_string(case["fixture"].as_str().unwrap())
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(case["sha256"], format!("{:x}", Sha256::digest(&text)));
        assert_eq!(case["errors"], serde_json::json!([]));
        assert_eq!(case["diagnostics"]["pageErrors"], serde_json::json!([]));
        assert_eq!(case["frames"].as_array().unwrap().len(), 40);
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
                for axis in ["x", "y", "rotation"] {
                    let expected = frame["actor"][axis].as_f64().unwrap();
                    let actual = actor[axis].as_f64().unwrap();
                    // Round 7 closes the missing integration step; do not keep
                    // the former 5.01px membership exception after the repair.
                    let tolerance = 1e-7;
                    assert!(
                        (actual - expected).abs() < tolerance,
                        "{name} interpreted={interpreted} frame={} {axis}: {actual} != {expected}",
                        frame["frame"]
                    );
                }
                for (key, expected) in frame["variables"].as_object().unwrap() {
                    let actual = &snapshot["variables"][key];
                    if let (Some(actual), Some(expected)) = (actual.as_f64(), expected.as_f64()) {
                        assert!(
                            (actual - expected).abs() < 1e-9,
                            "{name} frame={} {key}: {actual} != {expected}",
                            frame["frame"]
                        );
                    } else {
                        assert_eq!(actual, expected, "{name} frame={} {key}", frame["frame"]);
                    }
                }
            }
            assert_eq!(engine.variable_text("done"), "1", "{name}");
        }
    }
}
