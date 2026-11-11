use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

const A: &str = "10000000-0000-4000-8000-000000000001";
const B: &str = "10000000-0000-4000-8000-000000000002";
const ACTOR: &str = "20000000-0000-4000-8000-000000000001";

fn load(name: &str) -> (Value, Engine) {
    let source = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/scenes/{name}.bcm")).unwrap(),
    )
    .unwrap();
    let canonical = kitten4::to_neko(&source).unwrap();
    // Execution selection must not rewrite the saved editor selection.
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    (source, engine)
}

fn advance(engine: &mut Engine, frames: u32) {
    for _ in 0..frames {
        engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
    }
}

#[test]
fn player_starts_at_first_ordered_scene_not_saved_selection_or_dictionary_order() {
    for (name, expected) in [("initial", A), ("reordered", B)] {
        let (source, mut engine) = load(name);
        assert_ne!(source["theatre"]["current_scene"], expected);
        advance(&mut engine, 1);
        assert_eq!(engine.oracle_snapshot(1)["current_scene_id"], expected);
        engine.start();
        assert_eq!(engine.oracle_snapshot(0)["current_scene_id"], expected);
    }
}

// Official observations: docs/kitten4-scenes.md. Deliberately assert milestones,
// not exact cross-runtime dispatch frames (the scheduling task owns that work).
#[test]
fn switching_preserves_clones_and_properties_suspends_listeners_and_restarts_activation() {
    let (_, mut engine) = load("lifecycle");
    advance(&mut engine, 40);
    let away = engine.oracle_snapshot(40);
    assert_eq!(away["current_scene_id"], B);
    assert_eq!(away["actors"].as_object().unwrap().len(), 3);
    assert_eq!(engine.variable_text("listenerEnter"), "1");
    assert_eq!(engine.variable_text("listenerTail"), "0");
    assert_eq!(engine.variable_text("activationTail"), "0");
    advance(&mut engine, 140);
    let returned = engine.oracle_snapshot(180);
    assert_eq!(returned["current_scene_id"], A);
    assert_eq!(returned["actors"], away["actors"]);
    let actor = &returned["actors"][ACTOR];
    for (field, expected) in [
        ("x", 73.0),
        ("y", -29.0),
        ("rotation", 37.0),
        ("scale", 135.0),
        ("scale_y", 135.0),
    ] {
        assert_eq!(actor[field], expected, "{field}");
    }
    assert_eq!(actor["current_style_id"], "costume-b");
    for (id, expected) in [
        ("globalA", "1"),
        ("globalB", "1"),
        ("activationA", "2"),
        ("activationB", "1"),
        ("activationTail", "1"),
        ("listenerEnter", "1"),
        ("listenerTail", "1"),
        ("afterSwitch", "1"),
        ("cloneStarted", "1"),
        ("done", "1"),
    ] {
        assert_eq!(engine.variable_text(id), expected, "{id}");
    }
    engine.start();
    let reset = engine.oracle_snapshot(0);
    assert_eq!(reset["current_scene_id"], A);
    assert_eq!(reset["actors"].as_object().unwrap().len(), 2);
    assert_eq!(reset["actors"][ACTOR]["x"], 0.0);
    assert_eq!(engine.variable_text("activationA"), "0");
}

#[test]
fn scene_activation_switch_stops_its_own_tail() {
    let (_, mut engine) = load("activationSwitch");
    advance(&mut engine, 10);
    assert_eq!(engine.oracle_snapshot(10)["current_scene_id"], B);
    assert_eq!(engine.variable_text("afterSwitch"), "0");
}

#[test]
fn switching_to_current_scene_does_not_restart_activation_or_stop_its_tail() {
    let (_, mut engine) = load("sameScene");
    advance(&mut engine, 10);
    assert_eq!(engine.oracle_snapshot(10)["current_scene_id"], A);
    assert_eq!(engine.variable_text("activationA"), "1");
    assert_eq!(engine.variable_text("afterSwitch"), "1");
}

#[test]
fn kn_still_starts_at_saved_scene() {
    let (source, _) = load("initial");
    let mut canonical = kitten4::to_neko(&source).unwrap();
    canonical.as_object_mut().unwrap().remove("_nekocKitten4");
    let engine = Engine::new(Program::compile(&canonical).unwrap());
    assert_eq!(engine.oracle_snapshot(0)["current_scene_id"], B);
}

#[test]
fn invalid_k4_first_scene_is_not_silently_replaced_by_saved_selection() {
    let (mut source, _) = load("initial");
    for order in [serde_json::json!([]), serde_json::json!(["missing", A, B])] {
        source["theatre"]["scenes_order"] = order;
        let canonical = kitten4::to_neko(&source).unwrap();
        assert!(Program::compile(&canonical).is_err());
    }
}
