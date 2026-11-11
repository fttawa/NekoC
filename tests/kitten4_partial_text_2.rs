use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kitten4-partial-text-2-evidence.json")).unwrap()
}

fn vm(case: &str, disabled_jit: bool) -> Engine {
    let source = nekoc::json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-text-2-{case}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&source).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    if disabled_jit {
        vm.disable_jit();
    }
    vm.start();
    vm
}

fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => a.iter().map(normalize).collect(),
        Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect(),
        _ => value.clone(),
    }
}

fn compare(case: &str, final_only: bool) {
    let evidence = evidence();
    let expected = &evidence["cases"][case];
    assert_eq!(expected["errors"], json!([]));
    for disabled_jit in [false, true] {
        let mut vm = vm(case, disabled_jit);
        let frames = expected["variables"].as_array().unwrap();
        for (frame, expected) in frames.iter().enumerate() {
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                .unwrap();
            // Empty translate_result is still an official async reporter. This
            // test deliberately checks settled values, not async frame parity.
            if !final_only || frame == frames.len() - 1 {
                assert_eq!(
                    normalize(&vm.oracle_snapshot((frame + 1) as u32)["variables"]),
                    normalize(expected),
                    "case={case} frame={} disabled_jit={disabled_jit}",
                    frame + 1
                );
            }
        }
    }
}

#[test]
fn text_search_matches_official_utf16_and_find_conversion_in_both_modes() {
    compare("search", false);
}

#[test]
fn media_default_reporters_match_official_settled_values_in_both_modes() {
    compare("media-defaults", true);
}

#[test]
fn text_non_string_non_array_errors_preserve_partial_state_in_both_modes() {
    let evidence = evidence();
    for (case, expected) in evidence["cases"].as_object().unwrap() {
        if !case.starts_with("error-") {
            continue;
        }
        assert_eq!(expected["status"], "runtime-error");
        assert_eq!(expected["variables"], json!([]));
        let before = &expected["observations"][0][0];
        for disabled_jit in [false, true] {
            let mut vm = vm(case, disabled_jit);
            let error = vm
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                .unwrap_err();
            assert!(
                format!("{error:#}").contains("requires a string VALUE"),
                "{case}: {error:#}"
            );
            let variables = &vm.oracle_snapshot(1)["variables"];
            assert_eq!(
                normalize(variables),
                normalize(before),
                "case={case} disabled_jit={disabled_jit}"
            );
        }
    }
}

#[test]
fn text_array_value_matches_official_in_both_modes() {
    compare("array-value", false);
}
