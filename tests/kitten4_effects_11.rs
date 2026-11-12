use nekoc::{engine::Engine, engine::Program, kitten4};
use serde_json::Value;
use std::time::Duration;

#[test]
fn same_update_effects_are_in_the_transition_snapshot_in_both_tiers() {
    for kind in ["slide", "distrot", "fadeInOut"] {
        let file = format!("tests/fixtures/kitten4/partial-transition-10-{kind}-filters.bcm");
        let source = nekoc::json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        for jit in [false, true] {
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            engine.use_virtual_clock();
            if !jit {
                engine.disable_jit();
            }
            engine.start();
            let frame = engine
                .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                .unwrap();
            let wire = serde_json::to_value(frame).unwrap();
            let outgoing = &wire["transition"]["outgoing"];
            assert_eq!(outgoing["scene"], source["theatre"]["scenes_order"][0]);
            let background = outgoing["sprites"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["id"] == outgoing["scene"])
                .unwrap();
            assert_eq!(
                background["effects"],
                serde_json::json!([65.0, 0.0, 25.0, 9.0, 0.0, 17.0, 60.0, 8.0])
            );
            assert_eq!(background["style"], "background");
            assert_eq!(
                outgoing["order"],
                serde_json::json!(["20000000-0000-4000-8000-000000000001"])
            );
            assert!(wire["sprites"].as_array().unwrap().iter().all(|a| {
                a["id"] != outgoing["scene"] && a["effects"] == serde_json::json!(vec![0.0; 8])
            }));
            let next = engine
                .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(
                serde_json::to_value(next).unwrap()["transition"],
                Value::Null
            );
        }
    }
}
