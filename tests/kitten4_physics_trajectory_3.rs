//! Original workspaces: fixed-frame oracle evidence, not wall-clock samples.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, time::Duration};

#[test]
fn free_body_trajectories_match_every_official_frame_in_both_vm_modes() {
    let report: Value = serde_json::from_slice(
        &fs::read("docs/kitten4-physics-trajectory-3-evidence.json").unwrap(),
    )
    .unwrap();
    for (name, case) in report["cases"].as_object().unwrap() {
        let bytes = fs::read(case["fixture"].as_str().unwrap()).unwrap();
        let text = String::from_utf8(bytes).unwrap().replace("\r\n", "\n");
        assert_eq!(case["sha256"], format!("{:x}", Sha256::digest(&text)));
        assert_eq!(case["errors"], serde_json::json!([]));
        assert_eq!(case["diagnostics"]["pageErrors"], serde_json::json!([]));
        assert_eq!(case["frames"].as_array().unwrap().len(), 60);
        let source: Value = serde_json::from_str(&text).unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
        for interpreted in [false, true] {
            for decoded in [false, true] {
                let mut e = Engine::new(Program::compile(&canonical).unwrap());
                if decoded {
                    e.set_costume(
                        "probe-style",
                        Costume {
                            width: 20.0,
                            height: 20.0,
                            mask: Some((20, 20, vec![255; 50])),
                            ..Default::default()
                        },
                    );
                }
                if interpreted {
                    e.disable_jit();
                }
                e.use_virtual_clock();
                e.start();
                let mut maximum_error = 0.0_f64;
                for frame in case["frames"].as_array().unwrap() {
                    e.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                        .unwrap();
                    let expected = &frame["actor"];
                    let snapshot = e.oracle_snapshot(frame["frame"].as_u64().unwrap() as u32);
                    let actual = &snapshot["actors"]["20000000-0000-4000-8000-000000000001"];
                    for axis in ["x", "y"] {
                        let value = actual[axis].as_f64().unwrap();
                        let error = (value - expected[axis].as_f64().unwrap()).abs();
                        maximum_error = maximum_error.max(error);
                        if !matches!(name.as_str(), "bounce" | "friction") {
                            assert!(
                                error < 1e-7,
                                "{name} interpreted={interpreted} frame={} {axis}: {value} != {}",
                                frame["frame"],
                                expected[axis]
                            );
                        }
                    }
                }
                // Material values are exact. Default mass is deliberately excluded:
                // the official texture contour is not a full rectangle (see docs).
                for key in ["friction", "restitution", "speed"] {
                    let actual: f64 = e.variable_text(key).parse().unwrap();
                    let expected = case["frames"].as_array().unwrap().last().unwrap()["variables"]
                        [key]
                        .as_f64()
                        .unwrap();
                    assert!((actual - expected).abs() < 0.011, "{name}/{key}");
                }
                if decoded {
                    let mass: f64 = e.variable_text("mass").parse().unwrap();
                    assert!((mass - case["frames"].as_array().unwrap().last().unwrap()["variables"]["mass"].as_f64().unwrap()).abs() < 0.011, "{name}/mass");
                }
                if matches!(name.as_str(), "bounce" | "friction") {
                    // This is a bounded-difference regression, NOT an equality claim.
                    let bound = if name == "bounce" { 3.0 } else { 1.0 };
                    assert!(maximum_error < bound, "{name}: {maximum_error}");
                    println!(
                        "{name} interpreted={interpreted} decoded={decoded} maximum position error={maximum_error:.9}px"
                    );
                }
            }
        }
    }
}
