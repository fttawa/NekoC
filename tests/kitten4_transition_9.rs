use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

#[test]
fn transition_completion_changes_running_group_after_strict_endpoint() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-transition-9-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(format!(
                "tests/fixtures/kitten4/partial-transition-9-{name}.bcm"
            ))
            .unwrap(),
        )
        .unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        for (index, expected) in case["frames"].as_array().unwrap().iter().enumerate() {
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            let actual = engine.oracle_snapshot((index + 1) as u32);
            assert_eq!(actual["current_scene_id"], expected["current_scene_id"]);
            for key in ["tail", "activated", "oldTicks", "newTicks"] {
                // Existing no-transition start/activation ordering is a known
                // negative; don't silently bless it or change the common scheduler.
                if name == "none-left" && key == "oldTicks" {
                    assert_eq!(actual["variables"][key].as_f64(), Some(1.0));
                    assert_eq!(expected["variables"][key].as_f64(), Some(0.0));
                    continue;
                }
                assert_eq!(
                    actual["variables"][key].as_f64(),
                    expected["variables"][key].as_f64(),
                    "{name}/frame {}/{key}",
                    index + 1
                );
            }
        }
        engine.start();
        assert_eq!(engine.variable_text("activated"), "0");
    }
}
