//! Original native projects paired with KN 0.27.4, plus local code-API lowering.
use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

const ACTOR: &str = "nekoc-default-actor";
fn fixture(kind: &str) -> Value {
    serde_json::from_str(match kind {
        "talk" => include_str!("fixtures/kn-semantics/partial2-appearance-talk.bcmkn"),
        _ => include_str!("fixtures/kn-semantics/partial2-appearance-think.bcmkn"),
    })
    .unwrap()
}
fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kn-partial2-appearance-official.json")).unwrap()
}
fn engine(project: &Value, jit: bool) -> Engine {
    let mut e = Engine::new(Program::compile(project).unwrap());
    e.use_virtual_clock();
    if !jit {
        e.disable_jit();
    }
    e.start();
    e
}
fn step(e: &mut Engine) -> nekoc::engine::Frame {
    e.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
        .unwrap()
}
fn assert_variables(e: &Engine, expected: &Value, label: &str) {
    for (id, expected) in expected.as_object().unwrap() {
        let actual = match e.variable_value(id) {
            Cell::Number(n) if n.is_nan() => json!({"$number":"NaN"}),
            Cell::Undefined => json!({"$undefined":true}),
            v => serde_json::to_value(v).unwrap(),
        };
        if expected.is_number() {
            assert_eq!(actual.as_f64(), expected.as_f64(), "{label}: {id}");
        } else {
            assert_eq!(actual, *expected, "{label}: {id}");
        }
    }
}
fn alias_reporters(value: &mut Value) {
    if let Some(o) = value.as_object_mut() {
        let kind = o
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let attribute = match kind.as_str() {
            "coordinate_of_sprite" => o["fields"]["coordinate"].as_str().map(str::to_owned),
            "appearance_of_sprite" => o["fields"]["appearance"].as_str().map(str::to_owned),
            "style_of_sprite" => Some("style_index".into()),
            "distance_to" => Some("distance".into()),
            "effect_of_sprite" => {
                let i = o["fields"]["effect"]
                    .as_str()
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                Some(
                    [
                        "color",
                        "opacity",
                        "brightness",
                        "pixelate",
                        "ripple",
                        "distortion",
                        "grayscale",
                    ][i]
                        .into(),
                )
            }
            _ => None,
        };
        if let Some(attribute) = attribute {
            let sprite = o["fields"]["sprite"].clone();
            o.insert("type".into(), json!("get_sprite_property"));
            o.insert(
                "fields".into(),
                json!({"sprite":sprite,"attribute":attribute}),
            );
        }
        for v in o.values_mut() {
            alias_reporters(v);
        }
    } else if let Some(a) = value.as_array_mut() {
        for v in a {
            alias_reporters(v);
        }
    }
}

#[test]
fn native_appearance_and_infinite_dialog_match_official_with_jit_off_and_on() {
    let report = evidence();
    for kind in ["talk", "think"] {
        for jit in [false, true] {
            let mut e = engine(&fixture(kind), jit);
            let frame = step(&mut e);
            // No wait for close: both following assignments execute immediately.
            assert!(matches!(e.variable_value("done"), Cell::Number(1.0)));
            assert_variables(
                &e,
                &report["cases"][kind]["variables"],
                &format!("{kind} jit={jit}"),
            );
            let dialog = frame
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .as_ref()
                .unwrap();
            assert_eq!(
                dialog.text,
                report["cases"][kind]["inspection"]["dialog"]["text"]
                    .as_str()
                    .unwrap()
            );
            assert_eq!(dialog.think, kind == "think");
            for _ in 0..240 {
                let frame = step(&mut e);
                // Frame sprites are deltas: no entry means no visual change.
                assert!(
                    frame
                        .sprites
                        .iter()
                        .all(|s| s.id != ACTOR || s.dialog.is_some())
                );
            }
        }
    }
}

#[test]
fn local_code_api_aliases_match_official_converted_native_project() {
    let report = evidence();
    for kind in ["talk", "think"] {
        let mut p = fixture(kind);
        alias_reporters(&mut p);
        for jit in [false, true] {
            let mut e = engine(&p, jit);
            step(&mut e);
            assert_variables(
                &e,
                &report["cases"][kind]["variables"],
                &format!("alias {kind} jit={jit}"),
            );
        }
    }
}

#[test]
fn invalid_self_distance_matches_separate_official_domain_observation() {
    let report = evidence();
    assert_eq!(
        report["cases"]["talk"]["inspection"]["invalidSelfDistance"],
        json!({"$number":"NaN"})
    );
    for kind in ["distance_to", "get_sprite_property"] {
        let mut p = fixture("talk");
        p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([{
            "type":"on_running_group_activated", "next":{
                "type":"variables_set", "fields":{"variable":"done"}, "inputs":{"value":{
                    "type":kind, "fields":{"sprite":"--self","attribute":"distance"}
                }}
            }
        }]);
        for jit in [false, true] {
            let mut e = engine(&p, jit);
            step(&mut e);
            assert!(
                matches!(e.variable_value("done"), Cell::Number(n) if n.is_nan()),
                "{kind} jit={jit}"
            );
        }
    }
}

#[test]
fn common_typed_dialog_values_match_separate_official_domain_observations() {
    let report = evidence();
    for call in report["cases"]["talk"]["inspection"]["dialogCalls"]
        .as_array()
        .unwrap()
    {
        let mut p = fixture("talk");
        p["variables"]["variablesDict"]["dialog_input"] = json!({
            "id":"dialog_input", "name":"dialog_input", "value":call["input"],
            "type":"any", "isGlobal":true, "currentEntityId":ACTOR
        });
        p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([{
            "type":"on_running_group_activated", "next":{
                "type":"self_dialog_wait", "fields":{"type":"talk"}, "inputs":{"text":{
                    "type":"variables_get", "fields":{"variable":"dialog_input"}
                }}, "next":{"type":"variables_set", "fields":{"variable":"done"},
                    "inputs":{"value":{"type":"math_number","fields":{"NUM":"1"}}}}
            }
        }]);
        for jit in [false, true] {
            let mut e = engine(&p, jit);
            let frame = step(&mut e);
            assert!(matches!(e.variable_value("done"), Cell::Number(1.0)));
            let d = frame
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .as_ref()
                .unwrap();
            assert_eq!(
                d.text,
                call["dialog"]["text"].as_str().unwrap(),
                "{} jit={jit}",
                call["label"]
            );
            assert!(!d.think);
        }
    }
}
