use nekoc::{engine::Engine, engine::Frame, engine::Program, kitten4};
use serde_json::Value;
use std::time::Duration;

const A: &str = "20000000-0000-4000-8000-000000000001";
const B: &str = "20000000-0000-4000-8000-000000000003";

fn load(name: &str, interpreted: bool) -> Engine {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/layer-dialog-{name}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    if interpreted {
        engine.disable_jit();
    }
    engine.start();
    engine
}

fn tick(engine: &mut Engine) -> Frame {
    engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap()
}

fn ids(names: &[&str]) -> Vec<String> {
    names
        .iter()
        .map(|name| match *name {
            "a" => A.to_owned(),
            "b" => B.to_owned(),
            n => format!("{A}#{n}"),
        })
        .collect()
}

// Official clone_actor / set_theatre_layer; owned probes recorded in
// docs/kitten4-layer-dialog-evidence.json. frame.order is back to front.
#[test]
fn clone_insertion_chain_and_original_moves_match_official() {
    for interpreted in [true, false] {
        for (name, expected) in [
            ("chain", vec!["a", "1", "2", "3", "b"]),
            ("legacy", vec!["a", "b", "1", "2", "3"]),
            ("front", vec!["1", "2", "b", "a", "3"]),
            ("forward", vec!["1", "a", "3", "2", "b"]),
            // No-op moves do not detach the insertion chain.
            ("backward", vec!["a", "1", "2", "3", "b"]),
            ("back", vec!["a", "1", "2", "3", "b"]),
            ("middle-bottom", vec!["a", "3", "b", "1", "2"]),
            ("middle-next_level", vec!["a", "3", "b", "1", "2"]),
            ("split", vec!["a", "1", "2", "b"]),
        ] {
            let mut engine = load(name, interpreted);
            assert_eq!(tick(&mut engine).order.unwrap(), ids(&expected), "{name}");
        }
    }
}

#[test]
fn coverage_reports_a_waiting_dialog_instead_of_running_its_tail() {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string("tests/fixtures/kitten4/layer-dialog-dialog.bcm").unwrap(),
    )
    .unwrap();
    let report = kitten4::coverage_with_seed(&native, 60, Some(1));
    assert_eq!(report["stage"], "ran", "{report}");
    assert_eq!(report["blocked"]["kind"], "stage_dialog");
    assert!(report["blocked"]["active_tasks"].as_u64().unwrap() > 0);
}

#[test]
fn crossing_the_pen_plane_moves_the_actor_not_just_the_pen() {
    for interpreted in [true, false] {
        let mut engine = load("pen-below", interpreted);
        let frame = tick(&mut engine);
        assert_eq!(frame.order.unwrap(), ids(&["b", "a"]));
        assert_eq!(frame.pen_layer, 1);
        let mut engine = load("pen-roundtrip", interpreted);
        let frame = tick(&mut engine);
        assert_eq!(frame.order.unwrap(), ids(&["a", "b"]));
        assert_eq!(frame.pen_layer, 0);
    }
}

#[test]
fn moved_clones_leave_the_insertion_chain() {
    for interpreted in [true, false] {
        for (name, initial, after) in [
            (
                "clone-peak",
                vec!["a", "b", "1", "2"],
                vec!["a", "3", "b", "1", "2"],
            ),
            (
                "clone-bottom",
                vec!["2", "1", "a", "b"],
                vec!["2", "1", "a", "3", "b"],
            ),
            (
                "clone-previous_level",
                vec!["a", "1", "2", "b"],
                vec!["a", "3", "1", "2", "b"],
            ),
            (
                "clone-next_level",
                vec!["1", "2", "a", "b"],
                vec!["1", "2", "a", "3", "b"],
            ),
        ] {
            let mut engine = load(name, interpreted);
            tick(&mut engine);
            assert_eq!(tick(&mut engine).order.unwrap(), ids(&initial), "{name}");
            engine.key_event("65", true);
            let frame = tick(&mut engine);
            assert_eq!(frame.order.unwrap(), ids(&after), "{name}");
            engine.key_event("65", false);
        }
    }
}

#[test]
fn stage_dialog_blocks_only_its_thread_and_requires_acknowledgement() {
    for interpreted in [true, false] {
        let mut engine = load("dialog", interpreted);
        let frame = tick(&mut engine);
        assert!(frame.ask.is_none());
        let dialog = frame.stage_dialog.unwrap();
        assert_eq!(dialog.target, A);
        assert_eq!(dialog.text, "Hello NekoC");
        assert!(dialog.printing);
        assert_eq!(engine.variable_text("after"), "0");
        assert_eq!(engine.variable_text("other"), "1");
        engine.stage_dialog_click(dialog.id + 99);
        assert!(engine.pending_stage_dialog().unwrap().printing);
        engine.stage_dialog_click(dialog.id);
        assert!(!engine.pending_stage_dialog().unwrap().printing);
        tick(&mut engine);
        assert_eq!(engine.variable_text("after"), "0");
        engine.stage_dialog_click(dialog.id);
        tick(&mut engine);
        assert!(engine.pending_stage_dialog().is_none());
        assert_eq!(engine.variable_text("after"), "1");
        engine.start();
        tick(&mut engine);
        engine.stage_dialog_click(dialog.id);
        assert!(engine.pending_stage_dialog().unwrap().printing);
        // No input: completing the typewriter is not permission to continue.
        for _ in 0..600 {
            tick(&mut engine);
        }
        assert!(!engine.pending_stage_dialog().unwrap().printing);
        assert_eq!(engine.variable_text("after"), "0");
        assert!(engine.active_tasks() > 0);
    }
}

#[test]
fn stage_dialog_pages_and_fifo_do_not_unlock_early() {
    for interpreted in [true, false] {
        let mut engine = load("pages", interpreted);
        tick(&mut engine);
        let id = engine.pending_stage_dialog().unwrap().id;
        assert!(engine.pending_stage_dialog().unwrap().more);
        for _ in 0..2 {
            engine.stage_dialog_click(id); // finish printing
            engine.stage_dialog_click(id); // next page
            tick(&mut engine);
            assert_eq!(engine.variable_text("after"), "0");
        }
        assert!(!engine.pending_stage_dialog().unwrap().more);
        engine.stage_dialog_click(id);
        engine.stage_dialog_click(id);
        tick(&mut engine);
        assert_eq!(engine.variable_text("after"), "1");

        let mut engine = load("queue", interpreted);
        tick(&mut engine);
        let first = engine.pending_stage_dialog().unwrap().id;
        engine.stage_dialog_click(first + 1); // cannot dismiss a queued dialog
        assert_eq!(engine.variable_text("other"), "0");
        engine.stage_dialog_click(first);
        engine.stage_dialog_click(first);
        tick(&mut engine);
        assert_eq!(engine.variable_text("after"), "1");
        assert_eq!(engine.variable_text("other"), "0");
        let second = engine.pending_stage_dialog().unwrap().id;
        assert_ne!(first, second);
        assert_eq!(engine.pending_stage_dialog().unwrap().text, "Second");
        engine.stage_dialog_click(second);
        engine.stage_dialog_click(second);
        tick(&mut engine);
        assert_eq!(engine.variable_text("other"), "1");
        assert!(engine.pending_stage_dialog().is_none());

        let mut engine = load("ask-first", interpreted);
        tick(&mut engine);
        assert!(engine.pending_stage_dialog().is_none());
        let ask = engine.pending_ask().unwrap().id;
        engine.stage_dialog_click(ask + 1);
        engine.answer(ask, "reply", None);
        tick(&mut engine);
        assert_eq!(engine.variable_text("after"), "1");
        assert_eq!(engine.variable_text("other"), "0");
        assert!(engine.pending_ask().is_none());
        assert_eq!(engine.pending_stage_dialog().unwrap().text, "Second");
    }
}
