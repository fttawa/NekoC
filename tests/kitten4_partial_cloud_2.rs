use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => a.iter().map(normalize).collect(),
        Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect(),
        _ => value.clone(),
    }
}

fn compare(case: &str) {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-cloud-2-evidence.json"
    ))
    .unwrap();
    let expected = &evidence["cases"][case];
    assert_eq!(expected["errors"], json!([]), "oracle {case}");
    assert_eq!(expected["pageErrors"], json!([]), "oracle {case}");
    assert!(
        expected["externalRequests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["action"] == "blocked")
    );
    let source = nekoc::json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/partial-cloud-2-{case}.bcm"))
            .unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&source).unwrap();
    for disabled_jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        if disabled_jit {
            vm.disable_jit();
        }
        vm.start();
        for (frame, expected) in expected["variables"].as_array().unwrap().iter().enumerate() {
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                .unwrap();
            let actual = vm.oracle_snapshot((frame + 1) as u32);
            // Per-variable diagnostics keep large UTF-16 probes readable on failure.
            for (id, value) in expected.as_object().unwrap() {
                assert_eq!(
                    normalize(&actual["variables"][id]),
                    normalize(value),
                    "case={case} frame={} disabled_jit={disabled_jit} variable={id}",
                    frame + 1
                );
            }
            assert_eq!(
                actual["variables"].as_object().unwrap().len(),
                expected.as_object().unwrap().len(),
                "{case}: no hidden/unexpected variables"
            );
        }
    }
}

#[test]
fn change_matches_offline_oracle_in_both_modes() {
    compare("change");
}
#[test]
fn limits_match_offline_oracle_in_both_modes() {
    compare("limits");
}
#[test]
fn list_matches_offline_oracle_in_both_modes() {
    compare("list");
}
#[test]
fn frames_match_offline_oracle_in_both_modes() {
    compare("frames");
}

#[test]
fn list_get_matches_offline_oracle_in_both_modes() {
    compare("list-get");
}

#[test]
fn typed_indices_match_offline_oracle_in_both_modes() {
    compare("typed-index");
}

#[test]
fn invalid_list_values_match_offline_oracle_in_both_modes() {
    compare("invalid-list-value");
}
