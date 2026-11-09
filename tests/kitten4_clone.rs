use nekoc::{engine::Engine, engine::Program, kitten4};
use serde_json::Value;
use std::time::Duration;

fn load(file: &str, interpreted: bool) -> Engine {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/{file}.bcm")).unwrap(),
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

fn advance(engine: &mut Engine, frames: usize) {
    for _ in 0..frames {
        engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
    }
}

fn expect(engine: &Engine, values: &[(&str, &str)]) {
    for &(id, value) in values {
        assert_eq!(engine.variable_text(id), value, "{id}");
    }
}

// Oracle: official 4.11.20, clone-official.json and split-semantics-official.json.
// Wall-clock trigger counts differ; assert repetition and single flight instead.
#[test]
fn split_conditions_and_held_keys_are_repeated_single_flight_per_instance() {
    for interpreted in [true, false] {
        let mut engine = load("semantics-when-split", interpreted);
        advance(&mut engine, 150);
        for prefix in ["original", "clone"] {
            let n = engine
                .variable_text(&format!("{prefix}Enter"))
                .parse::<usize>()
                .unwrap();
            assert!(n > 2);
            assert_eq!(
                engine.variable_text(&format!("{prefix}Exit")),
                n.to_string()
            );
        }
        let mut engine = load("semantics-keys-split", interpreted);
        advance(&mut engine, 30);
        expect(&engine, &[("cloneStarted", "0")]);
        engine.key_event("65", true);
        advance(&mut engine, 42);
        for prefix in ["original", "clone"] {
            let entered = engine
                .variable_text(&format!("{prefix}Enter"))
                .parse::<usize>()
                .unwrap();
            let exited = engine
                .variable_text(&format!("{prefix}Exit"))
                .parse::<usize>()
                .unwrap();
            assert!(entered > 1);
            assert!(entered == exited || entered == exited + 1);
        }
        engine.key_event("65", false);
        advance(&mut engine, 18);
        for prefix in ["original", "clone"] {
            assert_eq!(
                engine.variable_text(&format!("{prefix}Enter")),
                engine.variable_text(&format!("{prefix}Exit"))
            );
        }
    }
}

#[test]
fn split_start_broadcast_and_mirror_use_distinct_code_policies() {
    for interpreted in [true, false] {
        let mut engine = load("clone-events", interpreted);
        advance(&mut engine, 65);
        expect(
            &engine,
            &[
                ("started", "2"),
                ("cloneStarted", "0"),
                ("count", "1"),
                ("broadcasts", "2"),
            ],
        );
        assert!(engine.variable_text("conditions").parse::<usize>().unwrap() > 2);
        engine.pointer_event(
            "20000000-0000-4000-8000-000000000001#1",
            "mouse_click",
            100.0,
            0.0,
        );
        advance(&mut engine, 2);
        expect(&engine, &[("clicked", "1")]);
        let mut engine = load("clone-mixed", interpreted);
        advance(&mut engine, 65);
        expect(
            &engine,
            &[
                ("started", "2"),
                ("cloneStarted", "1"),
                ("count", "2"),
                ("firstX", "0"),
                ("secondX", "100"),
                ("broadcasts", "2"),
            ],
        );
    }
}

#[test]
fn split_copies_appearance_and_entity_variables_but_not_brush() {
    for interpreted in [true, false] {
        let mut engine = load("clone-state", interpreted);
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        let clone = frame.sprites.iter().find(|s| s.id.ends_with("#1")).unwrap();
        assert_eq!((clone.x, clone.y, clone.scale), (100.0, -80.0, 150.0));
        assert_eq!(clone.style.as_deref(), Some("costume-b"));
        advance(&mut engine, 60);
        expect(
            &engine,
            &[
                ("shared", "12"),
                ("x", "100"),
                ("y", "-80"),
                ("costume", "2"),
            ],
        );
        engine.key_event("66", true);
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        engine.key_event("66", false);
        // First movement is pen-up. Second is black, width 1 (not source's 7).
        assert_eq!(frame.lines.len(), 18); // pen-down dot, then the stroke
        assert_eq!(&frame.lines[0..5], &[110.0, -80.0, 110.0, -80.0, 1.0]);
        assert_eq!(&frame.lines[9..14], &[110.0, -80.0, 120.0, -80.0, 1.0]);
        assert_eq!(&frame.lines[14..18], &[0.0, 0.0, 0.0, 1.0]);
        let mut engine = load("clone-variables", interpreted);
        advance(&mut engine, 65);
        expect(
            &engine,
            &[
                ("inheritedPrivate", "12"),
                ("originalPrivate", "12"),
                ("clonePrivate", "13"),
                ("sharedAfter", "21"),
            ],
        );
    }
}

#[test]
fn split_can_target_original_again_and_dispose_does_not_kill_siblings() {
    for interpreted in [true, false] {
        let mut engine = load("clone-recurse", interpreted);
        advance(&mut engine, 65);
        expect(&engine, &[("started", "3")]);
        let mut engine = load("clone-dispose", interpreted);
        advance(&mut engine, 65);
        expect(
            &engine,
            &[
                ("count", "1"),
                ("remainingX", "200"),
                ("newX", "300"),
                ("afterOriginal", "0"),
                ("afterClone", "0"),
            ],
        );
        engine.key_event("65", true);
        advance(&mut engine, 10);
        engine.key_event("65", false);
        expect(&engine, &[("keys", "20")]);
        engine.start();
        advance(&mut engine, 65);
        expect(&engine, &[("count", "1"), ("newX", "300")]);
    }
}

#[test]
fn split_limit_is_not_a_300_live_sprite_cap() {
    for interpreted in [true, false] {
        let mut engine = load("clone-limit", interpreted);
        let mut order = Vec::new();
        let mut removed = 0;
        for _ in 0..800 {
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            removed += frame.removed.len();
            if let Some(ids) = frame.order {
                order = ids;
            }
        }
        expect(&engine, &[("count", "350"), ("laterCount", "512")]);
        assert_eq!(removed, 188);
        for i in [1, 188] {
            assert!(!order.iter().any(|id| id.ends_with(&format!("#{i}"))));
        }
        for i in [189, 700] {
            assert!(order.iter().any(|id| id.ends_with(&format!("#{i}"))));
        }
        let mut engine = load("clone-burst", interpreted);
        advance(&mut engine, 65);
        expect(&engine, &[("count", "301"), ("laterCount", "302")]);
    }
}

#[test]
fn split_collision_condition_remains_active_and_hot_keys_fall_back_safely() {
    for interpreted in [true, false] {
        let mut engine = load("clone-collision", interpreted);
        // Match the official decoded self-authored 20x20 SVG (headless VM has
        // no browser to decode asset dimensions).
        engine.set_costume(
            "costume-a",
            nekoc::engine::Costume {
                width: 20.0,
                height: 20.0,
                ..Default::default()
            },
        );
        advance(&mut engine, 65);
        assert!(engine.variable_text("collisions").parse::<usize>().unwrap() > 2);
        let mut engine = load("clone-events", interpreted);
        advance(&mut engine, 65);
        engine.key_event("65", true);
        advance(&mut engine, 650);
        engine.key_event("65", false);
        expect(&engine, &[("keys", "1300")]);
    }
}

#[test]
fn kitten4_clone_cannot_copy_itself_as_a_mirror() {
    for interpreted in [true, false] {
        let mut engine = load("clone-mirrorSelf", interpreted);
        let error = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap_err();
        assert!(error.to_string().contains("clone body cannot clone itself"));
    }
}
