//! Original local multiplayer probes; no official online service is involved.
use nekoc::{
    cloud::FileCloudBackend,
    engine::{Engine, Program},
};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Duration};

fn player(path: &Path, user: &str, writer: bool) -> Engine {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/cloud-defaults.bcm")).unwrap();
    let mut project = nekoc::kitten4::to_neko(&source).unwrap();
    let actor = project["actors"]["actorsDict"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap();
    actor["nekoBlockJsonList"] = if writer {
        json!([{"type":"on_running_group_activated","next":{
            "type":"kitten4_change_cloud_variable", "fields":{"valname":"shared","method":"increase"},
            "inputs":{"n":{"type":"math_number","fields":{"NUM":1}}},"next":{
                "type":"kitten4_cloud_lists_append","fields":{"VAR":"items","POS":"last"},
                "inputs":{"VALUE":{"type":"text","fields":{"TEXT":user}}},"next":{
                    "type":"kitten4_change_cloud_variable","fields":{"valname":"personal","method":"increase"},
                    "inputs":{"n":{"type":"math_number","fields":{"NUM":1}}}
                }
            }
        }}])
    } else {
        json!([])
    };
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.set_cloud_backend(
        Arc::new(FileCloudBackend::new(path.into())),
        "multiplayer".into(),
        user.into(),
    )
    .unwrap();
    vm
}

fn tick(vm: &mut Engine) {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
        .unwrap();
}

#[test]
fn shared_cloud_worker() {
    let Some(path) = std::env::var_os("NEKOC_SHARED_CLOUD_TEST") else {
        return;
    };
    let user = std::env::var("NEKOC_SHARED_CLOUD_USER").unwrap();
    let mut vm = player(Path::new(&path), &user, true);
    for _ in 0..20 {
        vm.start();
        tick(&mut vm);
    }
}

#[test]
fn two_processes_share_atomic_changes_and_refresh_already_running_readers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared.json");
    let mut reader = player(&path, "alice", false);
    let mut other_identity = player(&path, "bob", false);
    reader.start();
    other_identity.start();
    tick(&mut reader);
    assert_eq!(reader.variable_text("shared"), "0");
    let mut children = ["alice", "bob"].map(|user| {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "shared_cloud_worker", "--nocapture"])
            .env("NEKOC_SHARED_CLOUD_TEST", &path)
            .env("NEKOC_SHARED_CLOUD_USER", user)
            .spawn()
            .unwrap()
    });
    for child in &mut children {
        assert!(child.wait().unwrap().success());
    }
    tick(&mut reader);
    tick(&mut other_identity);
    for vm in [&reader, &other_identity] {
        assert_eq!(vm.variable_text("shared"), "40");
        assert_eq!(vm.variable_text("personal"), "20");
        let snapshot = vm.oracle_snapshot(1);
        let list = snapshot["variables"]["items"].as_array().unwrap();
        assert_eq!(list.len(), 40);
        assert_eq!(
            list.iter()
                .filter(|v| **v == Value::String("alice".into()))
                .count(),
            20
        );
    }
}

#[test]
fn failed_frame_releases_lock_without_publishing_partial_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("failure.json");
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/cloud-defaults.bcm")).unwrap();
    let mut project = nekoc::kitten4::to_neko(&source).unwrap();
    let actor = project["actors"]["actorsDict"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap();
    actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated","next":{
        "type":"kitten4_cloud_variables_set","fields":{"VAR":"shared"},
        "inputs":{"VALUE":{"type":"math_number","fields":{"NUM":99}}},"next":{
            "type":"variables_set","fields":{"variable":"public"},"inputs":{"value":{
                "type":"list_item","fields":{"item":"any"},"inputs":{
                    "list":{"type":"pure_list_get","fields":{"list":"items"}},
                    "list_index":{"type":"math_number","fields":{"NUM":2}}
                }
            }}
        }
    }}]);
    let mut writer = Engine::new(Program::compile(&project).unwrap());
    writer
        .set_cloud_backend(
            Arc::new(FileCloudBackend::new(path.clone())),
            "multiplayer".into(),
            "alice".into(),
        )
        .unwrap();
    writer.start();
    assert!(
        writer
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
            .is_err()
    );
    let mut reader = player(&path, "alice", false);
    reader.start();
    tick(&mut reader);
    assert_eq!(reader.variable_text("shared"), "0");
    assert!(!path.exists());
}
