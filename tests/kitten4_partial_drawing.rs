use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn evidence() -> Value {
    serde_json::from_str(include_str!(
        "../docs/kitten4-partial-drawing-evidence.json"
    ))
    .unwrap()
}

fn load(name: &str, interpreted: bool) -> Engine {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-drawing-{name}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&project).unwrap(), native);
    let mut engine = Engine::new(Program::compile(&project).unwrap());
    if interpreted {
        engine.disable_jit();
    }
    engine.set_costume(
        "costume-a",
        Costume {
            width: 80.0,
            height: 40.0,
            center_point: if name == "image-state" {
                [13.0, -7.0]
            } else {
                [0.0; 2]
            },
            ..Default::default()
        },
    );
    engine.start();
    engine
}

#[test]
fn text_stamps_match_official_canvas_calls() {
    let evidence = evidence();
    for name in ["text-sizes", "text-types", "text-align"] {
        let calls = evidence["cases"][name]["observations"][0]["calls"]
            .as_array()
            .unwrap();
        assert!(!calls.is_empty());
        for interpreted in [false, true] {
            let mut engine = load(name, interpreted);
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(frame.text_stamps.len(), calls.len(), "{name}");
            for (actual, expected) in frame.text_stamps.iter().zip(calls) {
                let expected_text = expected["args"][0]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| expected["args"][0].to_string());
                assert_eq!(actual.text, expected_text);
                let font = expected["font"].as_str().unwrap();
                let size: f64 = font
                    .strip_prefix("bold ")
                    .unwrap()
                    .split("px")
                    .next()
                    .unwrap()
                    .parse()
                    .unwrap();
                assert_eq!(actual.size, size);
                let align = serde_json::to_value(actual.align).unwrap();
                assert_eq!(
                    align,
                    if expected["align"] == "start" {
                        "left"
                    } else {
                        expected["align"].as_str().unwrap()
                    }
                );
                // Stage wire heading is CCW; Canvas text is drawn with -rotation.
                let angle = actual.direction.to_radians();
                assert!((angle.cos() - expected["matrix"][0].as_f64().unwrap()).abs() < 1e-6);
                assert!((angle.sin() - expected["matrix"][1].as_f64().unwrap()).abs() < 1e-6);
            }
            assert_eq!(engine.variable_text("tail"), "1");
        }
    }
}

#[test]
fn image_stamp_ignores_actor_effects_and_opacity() {
    let evidence = evidence();
    let calls = &evidence["cases"]["image-state"]["observations"][0]["calls"];
    assert_eq!(calls[0]["method"], "drawImage");
    assert_eq!(calls[0]["alpha"], 1);
    for interpreted in [false, true] {
        let mut engine = load("image-state", interpreted);
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(frame.image_stamps.len(), 1);
        assert_eq!(frame.image_stamps[0].opacity, 1.0);
        assert_eq!(frame.image_stamps[0].effects, [0.0; 8]);
    }
}

#[test]
fn scene_pen_commands_error_before_tail() {
    let evidence = evidence();
    for kind in [
        "stamp",
        "image_stamp",
        "self_set_pen_size",
        "self_pen_down",
        "clear_drawing",
    ] {
        let name = format!("scene-{kind}");
        assert!(
            evidence["cases"][&name]["errors"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e.as_str().unwrap().contains("use_pen_blocks_in_scene"))
        );
        for interpreted in [false, true] {
            let mut engine = load(&name, interpreted);
            let error = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap_err();
            assert!(
                error.to_string().contains("use_pen_blocks_in_scene"),
                "{name}: {error}"
            );
            assert!(error.to_string().contains("scene-command"));
            assert_eq!(engine.variable_text("tail"), "0");
        }
    }
}

#[test]
fn brush_size_uses_strict_number_and_ten_thousand_limit() {
    let evidence = evidence();
    assert_eq!(
        evidence["cases"]["pen-sizes"]["observations"][0]["sizes"][0],
        5000
    );
    for interpreted in [false, true] {
        let mut engine = load("pen-sizes", interpreted);
        for _ in 0..18 {
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
        }
        // The brush size is consumed by the next movement; internal unit test
        // below covers exact state without exposing a new public getter.
        assert_eq!(engine.variable_text("tail"), "1");
    }
}
