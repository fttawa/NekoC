use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

fn evidence() -> Value {
    serde_json::from_str(include_str!(
        "../docs/kitten4-partial-costume-4-evidence.json"
    ))
    .unwrap()
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| same(a, b)))
        }
        _ => a == b,
    }
}

fn load(name: &str, interpreted: bool) -> (Engine, BTreeMap<String, Option<String>>) {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!(
            "tests/fixtures/kitten4/partial-costume-4-{name}.bcm"
        ))
        .unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&project).unwrap(), native);
    let program = Program::compile(&project).unwrap();
    // Frame.sprites contains deltas, including the current scene's stage sprite.
    // Seed the unchanged entries without needing an extra VM update.
    let initial = program
        .sprites
        .iter()
        .map(|s| (s.id.clone(), s.style.clone()))
        .collect();
    let mut engine = Engine::new(program);
    if interpreted {
        engine.disable_jit();
    }
    (engine, initial)
}

#[test]
fn all_completed_official_frames_match_in_both_vms_and_after_restart() {
    let evidence = evidence();
    let mut completed = 0;
    for (name, case) in evidence["cases"].as_object().unwrap() {
        if case["status"] != "completed" {
            continue;
        }
        completed += 1;
        for interpreted in [false, true] {
            let (mut engine, initial) = load(name, interpreted);
            for restart in 0..2 {
                let mut styles = initial.clone();
                engine.start();
                for (i, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                    let frame = engine
                        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                        .unwrap();
                    assert!(!frame.budget_yield, "{name} frame {}", i + 1);
                    for sprite in frame.sprites {
                        styles.insert(sprite.id, sprite.style);
                    }
                    assert!(
                        same(&engine.oracle_snapshot(i as u32 + 1)["variables"], expected),
                        "{name} frame {} interpreted={interpreted} restart={restart}",
                        i + 1
                    );
                    let observation = &case["observations"][i];
                    for actor in observation["actors"].as_array().unwrap() {
                        let id = actor["id"].as_str().unwrap();
                        assert_eq!(
                            styles[id].as_deref(),
                            actor["style"]["style_id"].as_str(),
                            "{name} frame {} actor={id} interpreted={interpreted}",
                            i + 1
                        );
                    }
                    // Inactive scenes do not emit deltas; their initial texture
                    // must remain unchanged. The active stage emits changes.
                    for scene in observation["scenes"].as_array().unwrap() {
                        let id = scene["id"].as_str().unwrap();
                        assert_eq!(
                            styles[id].as_deref(),
                            scene["texture"].as_str(),
                            "{name} frame {} scene={id} interpreted={interpreted}",
                            i + 1
                        );
                    }
                }
            }
        }
    }
    assert_eq!(completed, 16);
}

#[test]
fn all_official_errors_abort_at_the_original_block_and_preserve_partial_state() {
    let evidence = evidence();
    let mut failed = 0;
    for (name, case) in evidence["cases"].as_object().unwrap() {
        if case["status"] != "runtime-error" {
            continue;
        }
        failed += 1;
        assert!(case["variables"].as_array().unwrap().is_empty());
        let official: Value = serde_json::from_str(case["errors"][0].as_str().unwrap()).unwrap();
        assert_eq!(official["annotation"]["block_type"], "set_costume_by_id");
        let category = official["category"]["unique_code"].as_str().unwrap();
        let block = official["annotation"]["block_id"].as_str().unwrap();
        let observed = &case["observations"][0];
        let partial = &observed["errorVariables"][0];
        for interpreted in [false, true] {
            let (mut engine, _) = load(name, interpreted);
            for restart in 0..2 {
                engine.start();
                let error = engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap_err();
                let message = format!("{error:#}");
                assert!(message.contains(category), "{name}: {message}");
                assert!(message.contains(block), "{name}: {message}");
                assert!(message.contains("set_costume"), "{name}: {message}");
                let snapshot = engine.oracle_snapshot(0);
                assert!(
                    same(&snapshot["variables"]["before"], &partial["before"]),
                    "{name} interpreted={interpreted} restart={restart}: {snapshot}"
                );
                assert!(same(&snapshot["variables"]["after"], &partial["after"]));
                for actor in observed["actors"].as_array().unwrap() {
                    let id = actor["id"].as_str().unwrap();
                    assert_eq!(
                        snapshot["actors"][id]["current_style_id"], actor["style"]["style_id"],
                        "{name}: failed setter changed actor style"
                    );
                }
                // Do not advance after the error to manufacture a complete
                // frame: the official run completed zero frames as well.
            }
        }
    }
    assert_eq!(failed, 9);
}
