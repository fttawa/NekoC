use assert_cmd::Command;
use serde_json::{Value, json};
use std::{fs, path::Path};

fn input() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/kitten4/audio-wait-restart.bcm")
}

fn trace(metadata: Option<&Path>, render: bool, interpreter: bool) -> Value {
    let mut command = Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"));
    command.arg(input()).args(["--frames", "60"]);
    if render {
        command.arg("--render");
    } else {
        command.arg("--blocks");
    }
    if interpreter {
        command.arg("--interpreter");
    }
    if let Some(metadata) = metadata {
        command.arg("--audios").arg(metadata);
    }
    let output = command.assert().success().get_output().stdout.clone();
    serde_json::from_slice(&output).unwrap()
}

#[test]
fn decoded_duration_prevents_spurious_restarts_without_changing_input() {
    let original = fs::read(input()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let metadata = dir.path().join("audios.json");
    fs::write(
        &metadata,
        json!([{"id":"audio-wait-tone","duration":2.0}]).to_string(),
    )
    .unwrap();
    for interpreter in [false, true] {
        let fallback = trace(None, false, interpreter);
        assert_eq!(
            fallback["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["event"] == "block" && e["block"] == "audio-wait-restart")
                .count(),
            30
        );
        let measured = trace(Some(&metadata), false, interpreter);
        assert!(!measured["traceTruncated"].as_bool().unwrap());
        assert!(
            measured["events"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["block"] != "audio-wait-restart")
        );
        for (i, frame) in measured["frames"].as_array().unwrap().iter().enumerate() {
            let actors = frame["actors"].as_object().unwrap();
            assert_eq!(actors.len(), 1);
            let actor = actors.values().next().unwrap();
            assert_eq!(
                actor["current_style_id"],
                if i < 6 { "audio-before" } else { "audio-after" },
                "frame {}",
                i + 1
            );
        }
        let rendered = trace(Some(&metadata), true, interpreter);
        assert_eq!(
            rendered["project"]["audios"]["audiosDict"]["audio-wait-tone"]["duration"],
            2.0
        );
        // Provenance is untouched even though the effective canonical metadata
        // is included in render output for reproducibility.
        assert!(
            rendered["project"]["_nekocKitten4"]["source"]["audio"]["audio-wait-tone"]
                .get("duration")
                .is_none()
        );
    }
    assert_eq!(fs::read(input()).unwrap(), original);
}

#[test]
fn audio_metadata_validation_rejects_unusable_or_mistargeted_measurements() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = dir.path().join("audios.json");
    for value in [
        json!({}),
        json!([{}]),
        json!([{"id":"","duration":2}]),
        json!([{"id":"audio-wait-tone"}]),
        json!([{"id":"audio-wait-tone","duration":null}]),
        json!([{"id":"audio-wait-tone","duration":0}]),
        json!([{"id":"audio-wait-tone","duration":-1}]),
        json!([{"id":"audio-wait-tone","duration":"2"}]),
        json!([{"id":"missing","duration":2}]),
        json!([{"id":"audio-wait-tone","duration":2},{"id":"audio-wait-tone","duration":3}]),
    ] {
        fs::write(&metadata, value.to_string()).unwrap();
        Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
            .arg(input())
            .args(["--frames", "1", "--audios"])
            .arg(&metadata)
            .assert()
            .failure();
    }
    fs::write(&metadata, "[]").unwrap();
    assert_eq!(
        trace(Some(&metadata), false, false),
        trace(None, false, false)
    );
}

#[test]
fn measured_seconds_still_use_resource_playback_rate_and_eventually_finish() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = dir.path().join("audios.json");
    // The fixture rate is .1: .01 decoded seconds take .1 simulation seconds.
    // The play starts at update 1; six subsequent ticks finish it at update 7.
    fs::write(
        &metadata,
        json!([{"id":"audio-wait-tone","duration":0.01}]).to_string(),
    )
    .unwrap();
    let measured = trace(Some(&metadata), false, false);
    let restart = measured["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["event"] == "block" && e["block"] == "audio-wait-restart")
        .unwrap();
    assert_eq!(restart["frame"], 7);
}

#[test]
fn audio_metadata_applies_to_lowered_diagnostics_before_compile() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = dir.path().join("audios.json");
    fs::write(
        &metadata,
        json!([{"id":"audio-wait-tone","duration":2.0}]).to_string(),
    )
    .unwrap();
    let output = Command::new(assert_cmd::cargo::cargo_bin!("k4-trace"))
        .arg(input())
        .args(["--lowered", "--audios"])
        .arg(&metadata)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let lowered: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(
        lowered["audios"]["audiosDict"]["audio-wait-tone"]["duration"],
        2.0
    );
}
