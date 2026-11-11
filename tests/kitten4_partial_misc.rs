use nekoc::{engine::Engine, engine::Program, kitten4};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

const A: &str = "20000000-0000-4000-8000-000000000001";

fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kitten4-partial-misc-evidence.json")).unwrap()
}

fn load(name: &str, interpreted: bool) -> Engine {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-misc-{name}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&project).unwrap(), native);
    let mut engine = Engine::new(Program::compile(&project).unwrap());
    if interpreted {
        engine.disable_jit();
    }
    // Headless VM does not decode the owned opaque 80x40 inline SVG.
    engine.set_costume(
        "costume-a",
        nekoc::engine::Costume {
            width: 80.0,
            height: 40.0,
            ..Default::default()
        },
    );
    engine.start();
    engine
}

fn same(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|v| same(value, v)))
        }
        _ => actual == expected,
    }
}

#[test]
fn camp_switches_clone_independence_and_stage_dimensions_match_official() {
    let evidence = evidence();
    for name in [
        "camp-cycle",
        "camp-clone",
        "stage-landscape",
        "stage-portrait",
        "stage-classic",
    ] {
        for interpreted in [false, true] {
            let mut engine = load(name, interpreted);
            for (i, expected) in evidence["cases"][name]["variables"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                let frame = engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap();
                assert!(!frame.budget_yield);
                let actual = &engine.oracle_snapshot(i as u32 + 1)["variables"];
                assert!(
                    same(actual, expected),
                    "{name} frame {} interpreted={interpreted}: {actual} != {expected}",
                    i + 1
                );
            }
        }
    }
}

#[test]
fn draggable_flags_and_clone_inheritance_match_official_and_gate_drag() {
    let evidence = evidence();
    for name in ["draggable-cycle", "draggable-clone", "draggable-initial"] {
        for interpreted in [false, true] {
            let mut engine = load(name, interpreted);
            let mut flags = BTreeMap::new();
            for observation in evidence["cases"][name]["observations"].as_array().unwrap() {
                let frame = engine
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap();
                for sprite in frame.sprites {
                    flags.insert(sprite.id, sprite.draggable);
                }
                for expected in observation["actors"].as_array().unwrap() {
                    let id = expected["id"].as_str().unwrap();
                    let enabled = expected["draggable"].as_bool().unwrap();
                    assert_eq!(flags.get(id), Some(&enabled), "{name}: {observation}");
                    let before = engine.oracle_snapshot(0)["actors"][id].clone();
                    engine.drag(id, 11.0, 22.0);
                    let after = engine.oracle_snapshot(0)["actors"][id].clone();
                    if enabled {
                        assert_eq!(after["x"], 11.0);
                        assert_eq!(after["y"], 22.0);
                    } else {
                        assert_eq!(after, before, "disabled actor moved: {id}");
                    }
                    // Restore the original pose without requiring a drag release.
                    if enabled {
                        engine.drag(
                            id,
                            before["x"].as_f64().unwrap(),
                            before["y"].as_f64().unwrap(),
                        );
                    }
                }
            }
            // A second Start restores serialized initial draggability, then runs
            // exactly the same script (native regions can remain hot).
            engine.start();
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            engine.drag(A, 31.0, 32.0);
            let enabled = name != "draggable-clone";
            assert_eq!(
                engine.oracle_snapshot(0)["actors"][A]["x"],
                if enabled { 31.0 } else { 0.0 }
            );
        }
    }
}

#[test]
fn actor_only_setters_report_scene_domain_error_without_executing_tail() {
    let evidence = evidence();
    for kind in ["self_set_role_camp", "self_set_draggable"] {
        let name = format!("scene-{kind}");
        let case = &evidence["cases"][&name];
        assert!(case["errors"].as_array().unwrap().iter().any(|error| {
            error
                .as_str()
                .unwrap()
                .contains("use_actor_blocks_in_scene")
        }));
        assert_eq!(case["observations"][0]["errorVariables"][0]["before"], 1);
        assert_eq!(case["observations"][0]["errorVariables"][0]["after"], -1);
        for interpreted in [false, true] {
            let mut engine = load(&name, interpreted);
            let error = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap_err();
            assert!(
                error.to_string().contains("use_actor_blocks_in_scene"),
                "{error}"
            );
            assert!(error.to_string().contains("scene-setter"), "{error}");
            assert_eq!(engine.variable_text("before"), "1");
            assert_eq!(engine.variable_text("after"), "-1");
        }
    }
}

#[test]
fn non_editor_camp_strings_are_explicitly_rejected_not_mapped_to_another_camp() {
    let evidence = evidence();
    for name in ["camp_green", "camp_custom"] {
        let case = &evidence["cases"][name];
        // Official stores arbitrary strings; it does not treat camp_green as
        // the editor's green/camp_yellow. Our compact camp VM declines these.
        assert_eq!(case["observations"][0]["actors"][0]["group"], name);
        for value in case["variables"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .as_object()
            .unwrap()
            .values()
        {
            assert_eq!(value, 0);
        }
        let native: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-misc-{name}.bcm"))
                .unwrap(),
        )
        .unwrap();
        let project = kitten4::to_neko(&native).unwrap();
        let error = match Program::compile(&project) {
            Err(error) => error,
            Ok(_) => panic!("custom camp must not silently alias"),
        };
        assert!(format!("{error:#}").contains(name), "{error:#}");
    }
}
