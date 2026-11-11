use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

/// Every update, not only final state; native oracle has no hardcoded wait cadence.
#[test]
fn round6_effects_and_cross_frame_stamps() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-effects-6-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let input = std::fs::read_to_string(format!(
            "tests/fixtures/kitten4/partial-effects-6-{name}.bcm"
        ))
        .unwrap();
        let source = nekoc::json::from_str(&input).unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        for interpreter in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            for (id, width, height) in [("background", 960.0, 720.0), ("costume-a", 96.0, 64.0)] {
                vm.set_costume(
                    id,
                    Costume {
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
            let mut stamps = 0;
            let mut actor_state = None;
            for observation in case["observations"].as_array().unwrap() {
                let frame = vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
                assert!(!frame.budget_yield, "{name}/{observation}");
                // Sprite deltas omit unchanged actors; retain the last complete
                // state so idle/wait updates are still compared with the oracle.
                if let Some(actor) = frame
                    .sprites
                    .iter()
                    .find(|s| s.id == "20000000-0000-4000-8000-000000000001")
                {
                    actor_state = Some(actor.clone());
                }
                let actor = actor_state.as_ref().expect("initial actor delta missing");
                let actual = [
                    actor.effects[0],
                    actor.effects[2] + 100.0,
                    actor.effects[3],
                    actor.effects[4],
                    actor.effects[5],
                    -actor.effects[6],
                    actor.effects[7],
                ];
                for (a, b) in actual
                    .iter()
                    .zip(observation["effects"].as_array().unwrap())
                {
                    assert!(
                        (a - b.as_f64().unwrap()).abs() < 1e-8,
                        "{name}/{observation}/interpreter={interpreter}"
                    );
                }
                assert!(
                    (actor.opacity - observation["opacity"].as_f64().unwrap()).abs() < 1e-8,
                    "{name}/{observation}/interpreter={interpreter}"
                );
                stamps += frame.text_stamps.len() + frame.image_stamps.len();
                assert_eq!(
                    stamps,
                    observation["calls"].as_array().unwrap().len(),
                    "{name}/{observation}/interpreter={interpreter}: stamp update cadence"
                );
            }
        }
    }
}
