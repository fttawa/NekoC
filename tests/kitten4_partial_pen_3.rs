//! Original probes replayed against the frozen official Canvas observations.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kitten4-partial-pen-3-evidence.json")).unwrap()
}

fn load(name: &str, interpreted: bool) -> Engine {
    let native: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-pen-3-{name}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let mut engine = Engine::new(Program::compile(&kitten4::to_neko(&native).unwrap()).unwrap());
    if interpreted {
        engine.disable_jit();
    }
    engine.start();
    engine
}

#[test]
fn pen_line_deltas_match_official_origin_disks_including_repeated_down_on_axes() {
    let evidence = evidence();
    for name in [
        "opaque-endpoints",
        "alpha-endpoints",
        "alpha-corner",
        "same-position",
        "repeated-down-zero",
        "repeated-down-nonzero",
        "fractional-width",
    ] {
        let calls = evidence["cases"][name]["observations"][0]["calls"]
            .as_array()
            .unwrap();
        let arcs: Vec<_> = calls.iter().filter(|c| c["method"] == "arc").collect();
        assert!(!arcs.is_empty());
        for interpreted in [false, true] {
            let mut engine = load(name, interpreted);
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(frame.lines.len() / 9, arcs.len(), "{name}");
            for (line, arc) in frame.lines.chunks_exact(9).zip(&arcs) {
                assert!(
                    (f64::from(line[0]) - (arc["args"][0].as_f64().unwrap() - 480.0)).abs() < 1e-5,
                    "{name}"
                );
                assert!(
                    (f64::from(line[1]) - (360.0 - arc["args"][1].as_f64().unwrap())).abs() < 1e-5,
                    "{name}"
                );
                assert_eq!(f64::from(line[4]), arc["width"].as_f64().unwrap(), "{name}");
                assert_eq!(f64::from(line[8]), arc["alpha"].as_f64().unwrap(), "{name}");
            }
        }
    }
}

#[test]
fn fill_restarts_and_pen_up_paths_match_official_canvas_polygon() {
    let evidence = evidence();
    for name in ["fill-pen-up", "fill-restart", "fill-self-intersection"] {
        let calls = evidence["cases"][name]["observations"][0]["calls"]
            .as_array()
            .unwrap();
        let points: Vec<_> = calls
            .iter()
            .filter(|c| c["method"] == "moveTo" || c["method"] == "lineTo")
            .map(|c| {
                [
                    c["args"][0].as_f64().unwrap() - 480.0,
                    360.0 - c["args"][1].as_f64().unwrap(),
                ]
            })
            .collect();
        let color = calls.last().unwrap()["color"].as_str().unwrap();
        let rgb: Vec<_> = (1..7)
            .step_by(2)
            .map(|at| u8::from_str_radix(&color[at..at + 2], 16).unwrap())
            .collect();
        for interpreted in [false, true] {
            let mut engine = load(name, interpreted);
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(frame.pen_fills.len(), 1, "{name}");
            assert_eq!(frame.pen_fills[0].points, points, "{name}");
            assert_eq!(frame.pen_fills[0].color[3], 1.0);
            for (actual, expected) in frame.pen_fills[0].color[..3].iter().zip(rgb.iter()) {
                assert!(
                    (f64::from(*actual) * 255.0 - f64::from(*expected)).abs() < 1e-5,
                    "{name}"
                );
            }
        }
    }
}

#[test]
fn mixed_lines_stamps_and_fill_keep_their_positions() {
    for interpreted in [false, true] {
        let mut engine = load("mixed-stamps", interpreted);
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(frame.lines.len() / 9, 4);
        assert_eq!(frame.text_stamps.len(), 1);
        assert_eq!(frame.image_stamps.len(), 1);
        assert_eq!(frame.pen_fills.len(), 1);
        assert_eq!(frame.text_stamps[0].before_line, 2);
        assert_eq!(frame.image_stamps[0].before_line, 3);
        assert_eq!(frame.pen_fills[0].before_line, 4);
        assert_eq!(frame.pen_fills[0].before_text, 1);
        assert_eq!(frame.pen_fills[0].before_image, 1);
    }
}
