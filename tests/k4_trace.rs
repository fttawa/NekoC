use assert_cmd::Command;
use serde_json::{Value, json};
use std::{fs, path::Path};

#[test]
fn trace_has_every_actor_and_typed_values_on_unchanged_frames() {
    let input = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/kitten4-demo.bcm");
    let output = Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .args([input.to_str().unwrap(), "--frames", "60", "--seed", "7"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let trace: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(trace["schema"], "nekoc-k4-trace-v1");
    assert_eq!(trace["frames"].as_array().unwrap().len(), 60);
    let first = &trace["frames"][0];
    assert_eq!(first["frame"], 1);
    assert_eq!(first["actors"]["nekoc-default-actor"]["rotation"], -90.0);
    assert_eq!(first["variables"]["kn-var-edge"], 80.0);
    let last = &trace["frames"][59];
    assert!(last["actors"]["nekoc-default-actor"].is_object());
    assert_eq!(last["variables"]["kn-var-ready"], 1.0);
}

#[test]
fn trace_forces_compiled_path_and_rejects_missing_ast() {
    let input = Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/kitten4-demo.bcm");
    Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .args([input.to_str().unwrap(), "--compiled"])
        .assert()
        .failure();
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.bcm");
    fs::write(
        &input,
        json!({"work_type":"KITTEN","theatre":{}}).to_string(),
    )
    .unwrap();
    Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .arg(input)
        .assert()
        .failure();
}
