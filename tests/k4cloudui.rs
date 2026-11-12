use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

#[test]
fn cloud_ui_payload_matches_every_official_frame_in_both_vms() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/k4cloudui-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/k4cloud-{name}.bcm")).unwrap(),
        )
        .unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        for interpreter in [false, true] {
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            if interpreter {
                engine.disable_jit();
            }
            engine.start();
            for expected in case["frames"].as_array().unwrap() {
                let frame = engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                    .unwrap();
                let official = &expected["official"]["ranking"];
                assert_eq!(
                    frame.cloud_ui.ranking.is_some(),
                    official["show"] == true,
                    "{name}: {}",
                    expected["frame"]
                );
                if let Some(ranking) = frame.cloud_ui.ranking {
                    assert_eq!(ranking.variable, official["var_id"].as_str().unwrap());
                    assert_eq!(ranking.value, official["value"].as_f64());
                }
                // Rows are independently compared against the committed official
                // snapshot, including [] vs [""] and embedded newlines.
                if name == "ui-empty-rows"
                    && let Some(rows) = frame.cloud_ui.lists.get("items")
                {
                    let wanted: Vec<String> = expected["official"]["items"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            _ => v.to_string(),
                        })
                        .collect();
                    assert_eq!(*rows, wanted);
                }
            }
            engine.close_cloud_ranking();
            assert!(engine.cloud_ui().ranking.is_none());
            engine.start();
            assert!(engine.cloud_ui().ranking.is_none());
        }
    }
}
