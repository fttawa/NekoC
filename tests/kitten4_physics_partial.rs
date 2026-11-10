//! Original workspace fixtures, compared to checked-in offline .orig traces.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, time::Duration};

const NAMES: &[&str] = &[
    "legacy-flags",
    "legacy-hidden",
    "velocity-validation",
    "legacy-no-world",
    "modern-flags",
    "modern-disable-both",
    "modern-speed",
];

#[test]
fn original_physics_control_probes_match_offline_oracle_in_both_vm_modes() {
    let report: Value =
        serde_json::from_slice(&fs::read("docs/kitten4-physics-partial-evidence.json").unwrap())
            .unwrap();
    for name in NAMES {
        let evidence = &report["cases"][name];
        let bytes = fs::read(format!("tests/fixtures/kitten4/partial-physics-{name}.bcm")).unwrap();
        assert_eq!(
            evidence["sha256"],
            format!(
                "{:x}",
                Sha256::digest(
                    String::from_utf8_lossy(&bytes)
                        .replace("\r\n", "\n")
                        .as_bytes()
                )
            ),
            "{name}: stale evidence"
        );
        assert_eq!(evidence["frameCount"], 30, "{name}");
        assert_eq!(evidence["errors"], serde_json::json!([]), "{name}");
        assert_eq!(
            evidence["diagnostics"]["pageErrors"],
            serde_json::json!([]),
            "{name}"
        );
        let source: Value = serde_json::from_slice(&bytes).unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        assert_eq!(
            kitten4::from_neko(&canonical).unwrap(),
            source,
            "{name}: roundtrip"
        );
        for interpreted in [false, true] {
            let mut e = Engine::new(Program::compile(&canonical).unwrap());
            if interpreted {
                e.disable_jit();
            }
            e.use_virtual_clock();
            e.start();
            for _ in 0..30 {
                e.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                    .unwrap();
            }
            for (key, expected) in evidence["variables"].as_object().unwrap() {
                let actual: f64 = e.variable_text(key).parse().unwrap();
                let expected = expected.as_f64().unwrap();
                assert!(
                    (actual - expected).abs() <= 0.011,
                    "{name}/{key} interpreted={interpreted}: {actual} != {expected}"
                );
            }
        }
    }
}
