use nekoc::{
    cloud::{CloudBackend, CloudKey, FileCloudBackend, MemoryCloudBackend},
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

fn engine(case: &str) -> Engine {
    let source = nekoc::json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/cloud-{case}.bcm")).unwrap(),
    )
    .unwrap();
    Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap())
}
fn tick(engine: &mut Engine) -> anyhow::Result<()> {
    engine.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))?;
    Ok(())
}
fn key(variable: &str, project: &str, user: Option<&str>) -> CloudKey {
    CloudKey {
        project: project.into(),
        variable: format!("local-{variable}"),
        user: user.map(str::to_owned),
    }
}
fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect())
        }
        _ => value.clone(),
    }
}

#[test]
fn offline_matches_official_cloud_evidence_in_both_execution_modes() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-cloud-evidence.json")).unwrap();
    for (case, expected) in evidence["cases"].as_object().unwrap() {
        for interpreter in [false, true] {
            let mut vm = engine(case);
            if interpreter {
                vm.disable_jit();
            }
            vm.start();
            for expected in expected["variables"].as_array().unwrap() {
                tick(&mut vm).unwrap();
                assert_eq!(
                    normalize(&vm.oracle_snapshot(1)["variables"]),
                    normalize(expected),
                    "{case} interpreter={interpreter}"
                );
            }
        }
    }
}

#[test]
fn cloud_branches_survive_deep_statement_continuations() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-cloud-evidence.json")).unwrap();
    for (case, expected) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/cloud-{case}.bcm")).unwrap(),
        )
        .unwrap();
        let mut project = kitten4::to_neko(&source).unwrap();
        for section in ["scenes", "actors"] {
            for owner in project[section][format!("{section}Dict")]
                .as_object_mut()
                .unwrap()
                .values_mut()
            {
                for root in owner["nekoBlockJsonList"].as_array_mut().unwrap() {
                    if let Some(body) = root.get_mut("next") {
                        let mut value = body.take();
                        for _ in 0..9900 {
                            let mut parent = json!({"type":"warp","statements":{}});
                            parent["statements"]["DO"] = value;
                            value = parent;
                        }
                        *body = value;
                    }
                }
            }
        }
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            for expected in expected["variables"].as_array().unwrap() {
                tick(&mut vm).unwrap();
                assert_eq!(
                    normalize(&vm.oracle_snapshot(1)["variables"]),
                    normalize(expected),
                    "{case}, jit={jit}"
                );
            }
        }
    }
}

#[test]
fn cloud_item_and_ranking_reporters_follow_deep_value_edges() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/cloud-defaults.bcm")).unwrap();
    for ranking in [false, true] {
        let mut project = kitten4::to_neko(&source).unwrap();
        let mut value = if ranking {
            json!({"type":"kitten4::is_ranking_show_hide","fields":{"VAL":"hide"}})
        } else {
            json!({"type":"kitten4::cloud_lists_get_value","fields":{"VAR":"items","TYPE":"nth"},"inputs":{"INDEX":{"type":"math_number","fields":{"NUM":1}}}})
        };
        for _ in 0..9998 {
            let mut parent = json!({"type":"convert_type","fields":{"type":"string"},"inputs":{}});
            parent["inputs"]["text"] = value;
            value = parent;
        }
        let actor = project["actors"]["actorsDict"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap();
        nekoc::json::discard(actor["nekoBlockJsonList"].take());
        let mut hat = json!({"id":"deep-cloud","type":"on_running_group_activated","next":{"type":"variables_set","fields":{"variable":"public"},"inputs":{}}});
        hat["next"]["inputs"]["value"] = value;
        actor["nekoBlockJsonList"] = Value::Array(vec![hat]);
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            tick(&mut vm).unwrap();
            assert_eq!(
                vm.variable_text("public"),
                if ranking { "true" } else { "" }
            );
        }
    }
}

#[test]
fn explicit_memory_profile_persists_only_cloud_and_separates_private_identities() {
    let backend = Arc::new(MemoryCloudBackend::default());
    let mut writer = engine("writes");
    writer
        .set_cloud_backend(backend.clone(), "one".into(), "alice".into())
        .unwrap();
    writer.start();
    tick(&mut writer).unwrap();
    assert_eq!(
        backend
            .load(&key("personal", "one", Some("alice")))
            .unwrap()
            .unwrap()
            .as_f64(),
        Some(7.0)
    );
    let mut reader = engine("defaults");
    reader
        .set_cloud_backend(backend.clone(), "one".into(), "bob".into())
        .unwrap();
    reader.start();
    tick(&mut reader).unwrap();
    let values = &reader.oracle_snapshot(1)["variables"];
    assert_eq!(values["public"], "room/message");
    assert_eq!(values["private"].as_f64(), Some(0.0));
    assert_eq!(values["length"].as_f64(), Some(4.0));
    let mut isolated = engine("defaults");
    isolated
        .set_cloud_backend(backend, "two".into(), "alice".into())
        .unwrap();
    isolated.start();
    tick(&mut isolated).unwrap();
    assert_eq!(isolated.variable_text("public"), "0");
}

#[test]
fn switching_local_profiles_does_not_leak_missing_values() {
    let backend = Arc::new(MemoryCloudBackend::default());
    let mut vm = engine("writes");
    vm.set_cloud_backend(backend.clone(), "one".into(), "alice".into())
        .unwrap();
    vm.start();
    tick(&mut vm).unwrap();
    vm.set_cloud_backend(backend, "two".into(), "bob".into())
        .unwrap();
    assert_eq!(vm.variable_text("shared"), "0");
    assert_eq!(vm.variable_text("personal"), "0");
}

#[test]
fn absent_cloud_value_split_keeps_normal_list_bounds_error() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/cloud-defaults.bcm")).unwrap();
    let mut project = kitten4::to_neko(&source).unwrap();
    let actor = project["actors"]["actorsDict"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap();
    actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated", "next":{
    "id":"read-second", "type":"variables_set","fields":{"variable":"public"},
    "inputs":{"value":{"type":"list_item","fields":{"item":"any"}, "inputs":{
        "list":{"type":"text_split","inputs":{
            "TEXT_TO_SPLIT":{"type":"kitten4::cloud_variables_get","fields":{"VAR":"personal"}},
            "SPLIT_TEXT":{"type":"text","fields":{"TEXT":"/"}}
        }}, "list_index":{"type":"math_number","fields":{"NUM":2}}
    }}}}}]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let error = tick(&mut vm).unwrap_err();
    assert!(format!("{error:#}").contains("lists_get_value_bad_index"));
}

#[test]
fn file_backend_reopens_and_rejects_corruption_without_overwriting_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cloud.json");
    let key = key("shared", "one", None);
    let backend = FileCloudBackend::new(path.clone());
    assert_eq!(backend.load(&key).unwrap(), None);
    backend.store(&key, &json!("real local value")).unwrap();
    let reopened = FileCloudBackend::new(path.clone());
    assert_eq!(
        reopened.load(&key).unwrap(),
        Some(json!("real local value"))
    );
    std::fs::write(&path, "broken").unwrap();
    assert!(reopened.load(&key).is_err());
    assert!(reopened.store(&key, &json!(0)).is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), "broken");
}

#[test]
fn backend_failure_is_visible_and_default_mode_never_creates_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing").join("cloud.json");
    let mut vm = engine("writes");
    assert!(
        vm.set_cloud_backend(
            Arc::new(FileCloudBackend::new(path)),
            "one".into(),
            "alice".into(),
        )
        .is_err()
    );
    let mut default = engine("defaults");
    default.start();
    tick(&mut default).unwrap();
    assert_eq!(default.variable_text("public"), "0");
}

#[test]
fn malformed_persisted_shapes_fail_before_execution_and_null_is_nan() {
    let backend = Arc::new(MemoryCloudBackend::default());
    backend
        .store(&key("items", "one", None), &json!("not a list"))
        .unwrap();
    assert!(
        engine("defaults")
            .set_cloud_backend(backend.clone(), "one".into(), "alice".into())
            .is_err()
    );
    backend
        .store(&key("items", "one", None), &json!([null]))
        .unwrap();
    backend
        .store(&key("personal", "one", Some("alice")), &Value::Null)
        .unwrap();
    let mut vm = engine("defaults");
    vm.set_cloud_backend(backend, "one".into(), "alice".into())
        .unwrap();
    vm.start();
    tick(&mut vm).unwrap();
    assert_eq!(vm.variable_text("private"), "NaN");
}

#[test]
fn file_profile_survives_new_vm_and_restart_without_polluting_project() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cloud.json");
    let mut writer = engine("writes");
    writer
        .set_cloud_backend(
            Arc::new(FileCloudBackend::new(path.clone())),
            "one".into(),
            "alice".into(),
        )
        .unwrap();
    writer.start();
    tick(&mut writer).unwrap();
    drop(writer);
    let mut reader = engine("defaults");
    reader
        .set_cloud_backend(
            Arc::new(FileCloudBackend::new(path)),
            "one".into(),
            "alice".into(),
        )
        .unwrap();
    for _ in 0..2 {
        reader.start();
        tick(&mut reader).unwrap();
        assert_eq!(reader.variable_text("public"), "room/message");
        assert_eq!(reader.variable_text("private"), "7");
    }
}

#[test]
fn trace_cli_requires_explicit_namespace_and_can_reopen_file_profile() {
    use assert_cmd::Command;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cloud.json");
    Command::cargo_bin("k4-trace")
        .unwrap()
        .args(["tests/fixtures/kitten4/cloud-writes.bcm", "--cloud-file"])
        .arg(&path)
        .assert()
        .failure();
    Command::cargo_bin("k4-trace")
        .unwrap()
        .args([
            "tests/fixtures/kitten4/cloud-writes.bcm",
            "--frames",
            "1",
            "--cloud-file",
        ])
        .arg(&path)
        .args(["--cloud-namespace", "cli"])
        .assert()
        .success();
    let output = Command::cargo_bin("k4-trace")
        .unwrap()
        .args([
            "tests/fixtures/kitten4/cloud-defaults.bcm",
            "--frames",
            "1",
            "--cloud-file",
        ])
        .arg(&path)
        .args(["--cloud-namespace", "cli"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let trace: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(trace["frames"][0]["variables"]["public"], "room/message");
}
