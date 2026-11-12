use assert_cmd::Command;
use nekoc::studio::document::Document;
use predicates::prelude::*;
use serde_json::{Value, json};
use std::{fs, path::Path};
use tempfile::tempdir;

fn command(input: &Path) -> Command {
    let mut command = Command::cargo_bin("nekoc").unwrap();
    command.arg("run").arg(input);
    command
}

fn report(input: &Path, args: &[&str]) -> Value {
    let result = command(input).args(args).assert().success();
    serde_json::from_slice(&result.get_output().stdout).unwrap()
}

fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}

fn text(value: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":value}})
}

fn project(roots: Value) -> Value {
    let mut project = Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = roots;
    project
}

fn write(path: &Path, value: &Value) {
    fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
}

#[test]
fn kn_defaults_to_engine_and_collects_logs_across_frames_including_idle_frames() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("logs.json");
    let mut first = log(text("first"));
    first["next"] = json!({"type":"wait","inputs":{"time":{"type":"math_number","fields":{"NUM":0.05}}},
        "next":log(text("last"))});
    write(
        &input,
        &project(json!([{"type":"on_running_group_activated","next":first}])),
    );
    let result = report(&input, &["--frames", "12"]);
    assert_eq!(result["schema"], "nekoc-engine-run-v1");
    assert_eq!(result["logs"], json!(["first", "last"]));
    assert_eq!(result["ticks"], 12);
    assert_eq!(result["sequence"], 12);
    assert!((result["time"].as_f64().unwrap() - 0.2).abs() < 1e-12);
    assert_eq!(result["active_threads"], 0);
    assert_eq!(report(&input, &["--ticks", "0"])["logs"], json!([]));
}

#[test]
fn engine_events_accept_key_aliases_pointer_coordinates_and_drag() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("events.json");
    let mut p = project(json!([
        {"type":"on_keydown","fields":{"key":"32","type":"down"},"next":log(text("space"))},
        {"type":"sprite_on_tap","fields":{"sprite":"--screen","type":"mouse_click"},
            "next":log(json!({"type":"get_mouse_info","fields":{"type":"x"}}))}
    ]));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["draggable"] = json!(true);
    write(&input, &p);
    let result = report(
        &input,
        &["--event", "key-down:space", "--event", "click:15,-20"],
    );
    assert!(result["logs"].as_array().unwrap().contains(&json!("space")));
    assert!(result["logs"].as_array().unwrap().contains(&json!("15")));
    let dragged = report(&input, &["--event", "drag:nekoc-default-actor,25,-30"]);
    assert_eq!(dragged["actors"]["nekoc-default-actor"]["x"], 25.0);
    assert_eq!(dragged["actors"]["nekoc-default-actor"]["y"], -30.0);
}

#[test]
fn native_k4_runs_engine_and_local_cloud_is_explicit() {
    let input = Path::new("tests/fixtures/kitten4/cloud-writes.bcm");
    let offline = report(input, &["--ticks", "3"]);
    assert_eq!(offline["schema"], "nekoc-engine-run-v1");
    assert_eq!(offline["variables"]["public"], "room/message");
    assert_eq!(
        offline["lists"]["items"],
        json!(["head", "tail", "inserted", "replacement"])
    );
    let dir = tempdir().unwrap();
    let cloud = dir.path().join("cloud.json");
    command(input)
        .arg("--cloud-file")
        .arg(&cloud)
        .args(["--cloud-namespace", "cli-test"])
        .assert()
        .success();
    let data: Value = serde_json::from_slice(&fs::read(cloud).unwrap()).unwrap();
    assert!(!data["values"].as_object().unwrap().is_empty());
}

#[test]
fn output_expectation_and_exit_codes_are_preserved() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("project.json");
    let output = dir.path().join("snapshot.json");
    write(&input, &project(json!([])));
    command(&input)
        .arg("--out")
        .arg(&output)
        .assert()
        .success()
        .stdout("");
    let expected = fs::read(&output).unwrap();
    command(&input)
        .arg("--expect")
        .arg(&output)
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Runtime snapshot matches expectation",
        ));
    write(&output, &json!({"wrong":true}));
    command(&input)
        .arg("--expect")
        .arg(&output)
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "runtime expectation differences found",
        ));
    assert!(!expected.is_empty());
    command(&input).args(["--ticks", "bad"]).assert().code(2);
    command(&input)
        .args(["--legacy-runtime", "--seed", "1"])
        .assert()
        .code(2);
    command(&input)
        .args([
            "--legacy-runtime",
            "--cloud-memory",
            "--cloud-namespace",
            "test",
        ])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("does not support local cloud"));
    fs::write(&input, "not json").unwrap();
    command(&input)
        .assert()
        .code(1)
        .stdout("")
        .stderr(predicate::str::contains("invalid JSON"));
}

#[test]
fn compile_and_execution_errors_do_not_silently_fall_back() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("unsupported.json");
    write(
        &input,
        &project(
            json!([{"type":"on_running_group_activated","next":{"type":"not_supported_cli_block"}}]),
        ),
    );
    command(&input)
        .assert()
        .code(1)
        .stdout("")
        .stderr(predicate::str::contains("not_supported_cli_block"));
    write(
        &input,
        &project(json!([{"type":"on_running_group_activated","next":{
            "type":"warp","statements":{"DO":{"type":"repeat_n_times",
                "inputs":{"times":{"type":"math_number","fields":{"NUM":4097}}},
                "statements":{"DO":{"type":"setInterval","inputs":{"delay":{"type":"math_number","fields":{"NUM":0}}}}}}}
        }}])),
    );
    command(&input)
        .assert()
        .code(1)
        .stdout("")
        .stderr(predicate::str::contains("engine update 1 failed"))
        .stderr(predicate::str::contains("KN timer limit exceeded"));
}

#[test]
fn seed_is_repeatable_and_legacy_mode_keeps_its_original_schema() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("random.json");
    write(
        &input,
        &project(json!([{"type":"on_running_group_activated","next":{
        "type":"repeat_n_times","inputs":{"times":{"type":"math_number","fields":{"NUM":20}}},
        "statements":{"DO":log(
        json!({"type":"random_num","inputs":{"A":{"type":"math_number","fields":{"NUM":1}},
            "B":{"type":"math_number","fields":{"NUM":1000000}}}}))}}}])),
    );
    let first = report(&input, &["--seed", "42", "--ticks", "30"]);
    assert_eq!(first, report(&input, &["--seed", "42", "--ticks", "30"]));
    assert_ne!(
        first["logs"],
        report(&input, &["--seed", "6", "--ticks", "30"])["logs"]
    );
    let legacy = report(&input, &["--legacy-runtime"]);
    assert!(legacy.get("schema").is_none());
    assert!(legacy["trace"].is_array());
}
