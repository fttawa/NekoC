//! Original cross-frame official offline evidence; not online backend certification.
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
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/k4cloud-evidence.json")).unwrap();
    let native = nekoc::json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/k4cloud-{case}.bcm")).unwrap(),
    )
    .unwrap();
    let project = kitten4::to_neko(&native).unwrap();
    for disabled_jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        if disabled_jit {
            vm.disable_jit();
        }
        vm.start();
        for (index, expected) in evidence["cases"][case]["frames"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let frame = vm
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                .unwrap();
            assert!(!frame.budget_yield);
            let actual = vm.oracle_snapshot((index + 1) as u32);
            for (id, value) in expected["variables"].as_object().unwrap() {
                assert_eq!(
                    normalize(&actual["variables"][id]),
                    normalize(value),
                    "{case} frame={} disabled_jit={disabled_jit} variable={id}",
                    index + 1
                );
            }
            if case == "monitors" {
                let mut ids: Vec<_> = frame.monitors.iter().map(|m| m.id.as_str()).collect();
                let mut wanted: Vec<_> = expected["stageWidgets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|w| w["visible"] == true)
                    .map(|w| w["id"].as_str().unwrap())
                    .collect();
                ids.sort();
                wanted.sort();
                assert_eq!(
                    ids,
                    wanted,
                    "monitors frame={} disabled_jit={disabled_jit}",
                    index + 1
                );
                for monitor in &frame.monitors {
                    let value = &expected["variables"][&monitor.id];
                    let text = |v: &Value| match v {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.as_f64().unwrap().to_string(),
                        _ => v.to_string(),
                    };
                    let expected_text = if monitor.list {
                        value
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(text)
                            .collect::<Vec<_>>()
                            .join("\n")
                    } else {
                        text(value)
                    };
                    assert_eq!(monitor.name, format!("NekoC {}", monitor.id));
                    assert_eq!(monitor.list, monitor.id == "items");
                    assert_eq!(
                        monitor.value,
                        expected_text,
                        "monitor={} frame={} disabled_jit={disabled_jit}",
                        monitor.id,
                        index + 1
                    );
                }
            }
            if case == "ranking" {
                let wanted = expected["ranking"]
                    .get("var_id")
                    .cloned()
                    .unwrap_or(Value::Null);
                assert_eq!(
                    vm.debug_snapshot()["ranking_variable"],
                    wanted,
                    "ranking frame={} disabled_jit={disabled_jit}",
                    index + 1
                );
            }
        }
    }
}

#[test]
fn public_scalar_frames_match_official_offline() {
    compare("scalar-shared");
}
#[test]
fn private_scalar_frames_match_official_offline() {
    compare("scalar-personal");
}
#[test]
fn all_cloud_list_operations_match_official_offline() {
    compare("list");
}
#[test]
fn cloud_monitor_stage_visibility_matches_official_offline() {
    compare("monitors");
}
#[test]
fn cloud_ranking_show_hide_matches_official_offline() {
    compare("ranking");
}
