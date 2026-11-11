//! Exact-original milestone regressions, not a fixed-tick KN scheduler oracle.
use nekoc::engine::{Engine, Program};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;

fn run(source: &str, jit: bool, frames: usize) -> Engine {
    let project: Value = serde_json::from_str(source).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.use_virtual_clock();
    vm.start();
    for _ in 0..frames {
        let update = vm
            .advance(1.0 / 60.0, 200_000_000, Duration::from_secs(30))
            .unwrap();
        assert!(!update.budget_yield);
        vm.recycle_lines(update.lines);
    }
    vm
}

fn official() -> Value {
    serde_json::from_str(include_str!(
        "../docs/compatibility/hncompat2-progress-official.json"
    ))
    .unwrap()
}

#[test]
fn exact_fangjie_initialization_matches_official_full_original_milestone_jit_on_and_off() {
    let evidence = official();
    let case = &evidence["cases"]["fangjie"];
    let source = include_str!("../projects/fangjie/fangjie.bcmkn");
    assert_eq!(
        format!("{:x}", Sha256::digest(source.as_bytes())),
        case["sha256"].as_str().unwrap()
    );
    assert_eq!(case["outcome"], "milestone-complete");
    let expected = case["samples"].as_array().unwrap().last().unwrap();
    for jit in [false, true] {
        let vm = run(source, jit, 600);
        for id in ["kn-list-world", "kn-list-chunk_x", "kn-list-chunk_z"] {
            let value = serde_json::to_value(vm.variable_value(id)).unwrap();
            let items = value.as_array().unwrap();
            assert_eq!(
                items.len() as u64,
                expected["variables"][id]["length"].as_u64().unwrap()
            );
            // JSON writes integral f64 cells with .0; hash the official value
            // encoding after verifying every element, not merely head/tail.
            let wanted = if id == "kn-list-world" { 0.0 } else { 99999.0 };
            assert!(items.iter().all(|item| item.as_f64() == Some(wanted)));
            let integral: Vec<i64> = items.iter().map(|v| v.as_f64().unwrap() as i64).collect();
            assert_eq!(
                format!(
                    "{:x}",
                    Sha256::digest(serde_json::to_vec(&integral).unwrap())
                ),
                expected["listDigests"][id]["jsonSha256"].as_str().unwrap(),
                "jit={jit}, {id}"
            );
        }
        let snapshot = vm.oracle_snapshot(600);
        let actor = &snapshot["actors"]["nekoc-default-actor"];
        assert_eq!(actor["y"].as_f64(), Some(-65.0), "jit={jit}");
        assert_eq!(vm.variable_text("kn-var-gui_dirty"), "0");
    }
}

#[test]
fn exact_tiny_lm_reaches_official_eos_and_complete_id_stream_jit_on_and_off() {
    let evidence = official();
    let case = &evidence["cases"]["tiny-lm"];
    let source = include_str!("../projects/tiny-lm/tiny_lm.bcmkn");
    assert_eq!(
        format!("{:x}", Sha256::digest(source.as_bytes())),
        case["sha256"].as_str().unwrap()
    );
    let expected = &case["samples"].as_array().unwrap().last().unwrap()["variables"];
    for jit in [false, true] {
        let vm = run(source, jit, 600);
        for id in [
            "kn-var-lm_status",
            "kn-var-lm_output",
            "kn-var-lm_running",
            "kn-var-lm_generated",
            "kn-var-lm_tokens_processed",
            "kn-var-lm_position",
            "kn-var-lm_next_token",
        ] {
            let actual = serde_json::to_value(vm.variable_value(id)).unwrap();
            if let Some(number) = expected[id].as_f64() {
                assert_eq!(actual.as_f64(), Some(number), "jit={jit}, {id}");
            } else {
                assert_eq!(actual, expected[id], "jit={jit}, {id}");
            }
        }
        let ids = serde_json::to_value(vm.variable_value("kn-list-lm_generated_ids")).unwrap();
        let actual: Vec<f64> = ids
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        let wanted: Vec<f64> = expected["kn-list-lm_generated_ids"]["head"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        assert_eq!(actual, wanted, "jit={jit}");
    }
}
