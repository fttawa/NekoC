//! Independent plane-contact path: subpixel bounds, explicitly not solver equality.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, time::Duration};

#[test]
fn single_locked_convex_actor_edge_contacts_are_subpixel_in_both_vm_modes() {
    let report: Value =
        serde_json::from_slice(&fs::read("docs/kitten4-partial-physics-8-evidence.json").unwrap())
            .unwrap();
    for (name, case) in report["cases"].as_object().unwrap() {
        let text = fs::read_to_string(case["fixture"].as_str().unwrap())
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(case["sha256"], format!("{:x}", Sha256::digest(&text)));
        assert_eq!(case["errors"], serde_json::json!([]));
        assert_eq!(case["diagnostics"]["pageErrors"], serde_json::json!([]));
        let source: Value = serde_json::from_str(&text).unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        for interpreted in [false, true] {
            let mut e = Engine::new(Program::compile(&canonical).unwrap());
            e.set_costume(
                "probe-style",
                Costume {
                    width: 20.0,
                    height: 20.0,
                    mask: Some((20, 20, vec![255; 50])),
                    ..Default::default()
                },
            );
            if interpreted {
                e.disable_jit();
            }
            e.use_virtual_clock();
            e.start();
            let mut maximum = 0.0_f64;
            for frame in case["frames"].as_array().unwrap() {
                e.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                    .unwrap();
                let snapshot = e.oracle_snapshot(frame["frame"].as_u64().unwrap() as u32);
                let actual = &snapshot["actors"]["20000000-0000-4000-8000-000000000001"];
                for axis in ["x", "y"] {
                    let error = (actual[axis].as_f64().unwrap()
                        - frame["actor"][axis].as_f64().unwrap())
                    .abs();
                    maximum = maximum.max(error);
                    assert!(
                        error < 0.15,
                        "{name} interpreted={interpreted} frame={} {axis} error={error}",
                        frame["frame"]
                    );
                }
                assert!(
                    (actual["rotation"].as_f64().unwrap()
                        - frame["actor"]["rotation"].as_f64().unwrap())
                    .abs()
                        < 1e-7
                );
                for (key, expected) in frame["variables"].as_object().unwrap() {
                    let got = &snapshot["variables"][key];
                    if let (Some(a), Some(b)) = (got.as_f64(), expected.as_f64()) {
                        assert!(
                            (a - b).abs() < 1e-9,
                            "{name} frame={} variable={key}: {got} != {expected}",
                            frame["frame"]
                        );
                    } else {
                        assert_eq!(got, expected, "{name}/{key}");
                    }
                }
            }
            println!("{name} interpreted={interpreted} maximum position error={maximum:.12}px");
        }
    }
}
