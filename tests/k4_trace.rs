use assert_cmd::Command;
use serde_json::{Value, json};
use std::{fs, path::Path};

#[test]
fn render_trace_keeps_real_pen_deltas_and_validates_browser_masks() {
    let dir = tempfile::tempdir().unwrap();
    let costumes = dir.path().join("costumes.json");
    fs::write(&costumes, "[]").unwrap();
    let input = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/kitten4/visual-pen.bcm");
    let output = Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .arg(&input)
        .args(["--render", "--frames", "2", "--costumes"])
        .arg(&costumes)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let value: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(value["schema"], "nekoc-k4-render-v1");
    assert!(value["project"]["actors"]["actorsDict"].is_object());
    assert_eq!(value["frames"].as_array().unwrap().len(), 2);
    assert!(!value["frames"][0]["lines"].as_array().unwrap().is_empty());
    assert!(value["frames"][1]["lines"].as_array().unwrap().is_empty());
    assert_eq!(value["trace"]["frames"][1]["frame"], 2);
    fs::write(
        &costumes,
        json!([{"id":"c","width":80,"height":40,
        "mask_width":1,"mask_height":1,"mask_bytes":[256]}])
        .to_string(),
    )
    .unwrap();
    Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .arg(&input)
        .args(["--render", "--frames", "1", "--costumes"])
        .arg(&costumes)
        .assert()
        .failure();
}

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
    assert_eq!(trace["seed"], 7);
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
fn trace_and_coverage_fixed_seed_repeat_random_results() {
    let input =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/kitten4/runerr-random.bcm");
    let trace = || {
        let output = Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
            .arg(&input)
            .args(["--frames", "3", "--seed", "6"])
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        serde_json::from_slice::<Value>(&output).unwrap()
    };
    assert_eq!(trace(), trace());
    let coverage = || {
        let output = Command::new(assert_cmd::cargo::cargo_bin!("nekoc"))
            .arg("coverage")
            .arg(&input)
            .args(["--frames", "3", "--seed", "6"])
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        serde_json::from_slice::<Value>(&output).unwrap()
    };
    let report = coverage();
    assert_eq!(report["report"]["seed"], 6);
    assert_eq!(report["report"]["stage"], "ran");
    assert_eq!(report, coverage());
    Command::new(assert_cmd::cargo::cargo_bin!("nekoc"))
        .arg("coverage")
        .arg(input)
        .args(["--seed", "not-a-seed"])
        .assert()
        .failure();
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
