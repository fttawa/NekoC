use nekoc::{
    engine::{Costume, Engine, Program},
    input::{InputReplay, InputScript},
};
use serde_json::Value;
use std::time::Duration;

fn equivalent(actual: &Value, expected: &Value, context: &str) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => assert!(
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-6,
            "{context}: {a} != {b}"
        ),
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{context}");
            for (key, value) in a {
                equivalent(value, &b[key], &format!("{context}/{key}"));
            }
        }
        _ => assert_eq!(actual, expected, "{context}"),
    }
}

fn project(source: &str) -> nekoc::json::Json {
    let source = nekoc::json::from_str(source).unwrap();
    nekoc::kitten4::to_neko(&source).unwrap()
}

fn engine(interpreter: bool, source: &str) -> Engine {
    let mut vm = Engine::new(Program::compile(&project(source)).unwrap());
    vm.use_virtual_clock();
    if interpreter {
        vm.disable_jit();
    }
    // Same original SVG as the browser fixture: left half red, right half alpha 0.
    let mut bits = vec![0; (80_usize * 40).div_ceil(8)];
    for y in 0..40 {
        for x in 0..40 {
            let i = y * 80 + x;
            bits[i / 8] |= 1 << (i % 8);
        }
    }
    vm.set_costume(
        "costume-a",
        Costume {
            width: 80.0,
            height: 40.0,
            center_point: [0.0, 0.0],
            mask: Some((80, 40, bits)),
            rgb: None,
        },
    );
    vm.start();
    vm
}

#[test]
fn replay_matches_archived_official_dom_input_each_frame() {
    for (source, script, evidence, frames) in [
        (
            include_str!("fixtures/kitten4/input.bcm"),
            include_str!("fixtures/kitten4/input-script.json"),
            include_str!("../docs/input-evidence.json"),
            38,
        ),
        (
            include_str!("fixtures/kitten4/input-transform.bcm"),
            include_str!("fixtures/kitten4/input-transform-script.json"),
            include_str!("../docs/input-transform-evidence.json"),
            8,
        ),
        (
            include_str!("fixtures/kitten4/input-ghost.bcm"),
            include_str!("fixtures/kitten4/input-ghost-script.json"),
            include_str!("../docs/input-ghost-evidence.json"),
            4,
        ),
    ] {
        let evidence: Value = serde_json::from_str(evidence).unwrap();
        let script: InputScript = serde_json::from_str(script).unwrap();
        script.validate(frames).unwrap();
        for interpreter in [false, true] {
            let mut vm = engine(interpreter, source);
            let mut replay = InputReplay::default();
            for frame in 1..=frames {
                replay.before_frame(&mut vm, &script, frame);
                let result = vm
                    .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert!(!result.budget_yield);
                let actual = vm.oracle_snapshot(frame);
                let expected = &evidence["frames"][(frame - 1) as usize];
                equivalent(
                    &actual["variables"],
                    &expected["variables"],
                    &format!("frame {frame}, interpreter={interpreter}"),
                );
                equivalent(
                    &actual["actors"],
                    &expected["actors"],
                    &format!("frame {frame}, interpreter={interpreter}"),
                );
            }
        }
    }
}

#[test]
fn invalid_replays_are_rejected_before_execution() {
    for text in [
        r#"{"schema":"wrong","events":[]}"#,
        r#"{"schema":"nekoc-input-v1","events":[{"frame":0,"time_ms":0,"type":"keydown","key_code":65}]}"#,
        r#"{"schema":"nekoc-input-v1","events":[{"frame":31,"time_ms":0,"type":"keydown","key_code":65}]}"#,
        r#"{"schema":"nekoc-input-v1","events":[{"frame":2,"time_ms":10,"type":"keydown","key_code":65},{"frame":1,"time_ms":20,"type":"keyup","key_code":65}]}"#,
        r#"{"schema":"nekoc-input-v1","events":[{"frame":1,"time_ms":-1,"type":"keydown","key_code":65}]}"#,
    ] {
        let script: InputScript = serde_json::from_str(text).unwrap();
        assert!(script.validate(30).is_err(), "{text}");
    }
    assert!(serde_json::from_str::<InputScript>(r#"{"schema":"nekoc-input-v1","events":[{"frame":1,"time_ms":0,"type":"keydown","key_code":256}]}"#).is_err());
}

#[test]
fn device_input_script_replays_raw_samples_and_explicit_service_inputs() {
    let script: InputScript = serde_json::from_value(serde_json::json!({
        "schema":"nekoc-input-v1", "events":[
            {"frame":1,"time_ms":0,"type":"device_motion","x":1,"y":2,"z":9.8},
            {"frame":2,"time_ms":10,"type":"device_orientation","beta":30,"gamma":-10,"portrait":true},
            {"frame":2,"time_ms":10,"type":"device_event","action":"on_mobile_slide","device":"mobile_1","value":"up"},
            {"frame":3,"time_ms":20,"type":"mobile_button","device":"mobile_2","event":"keydown","button":"A"}
        ]
    })).unwrap();
    script.validate(3).unwrap();
    for interpreter in [false, true] {
        let mut vm = engine(interpreter, include_str!("fixtures/kitten4/input.bcm"));
        let mut replay = InputReplay::default();
        for frame in 1..=3 {
            replay.before_frame(&mut vm, &script, frame);
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
        }
        assert_eq!(vm.k4_device_motion_sample(), Some([1.0, 2.0, 9.8]));
        vm.start();
        assert_eq!(vm.k4_device_motion_sample(), None);
    }
}

#[test]
fn restart_clears_held_pointer_and_key_state() {
    let mut vm = engine(false, include_str!("fixtures/kitten4/input.bcm"));
    vm.pointer_event(
        "20000000-0000-4000-8000-000000000001",
        "mouse_down",
        -20.0,
        0.0,
    );
    vm.key("65");
    vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
        .unwrap();
    vm.start();
    vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
        .unwrap();
    let snapshot = vm.oracle_snapshot(1);
    assert!(
        snapshot["variables"]
            .as_object()
            .unwrap()
            .values()
            .all(|v| v.as_f64() == Some(0.0))
    );
}

#[test]
fn kn_official_held_key_and_pointer_are_single_flight_states() {
    // Official wall-clock evidence: docs/input-kn-evidence.json. Compare the
    // level/pulse rules, not browser Hz or exact wall-clock execution counts.
    let project: Value = serde_json::from_str(include_str!("fixtures/input-kn.bcmkn")).unwrap();
    for interpreter in [false, true] {
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        if interpreter {
            vm.disable_jit();
        }
        vm.start();
        let tick = |vm: &mut Engine| {
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
        };
        tick(&mut vm);
        vm.key_event("65", true);
        for _ in 0..10 {
            tick(&mut vm);
        }
        assert_eq!(vm.variable_text("a-down"), "10");
        assert_eq!(vm.variable_text("any-down"), "10");
        vm.key_event("65", false);
        for _ in 0..3 {
            tick(&mut vm);
        }
        assert_eq!(vm.variable_text("a-down"), "10");
        assert_eq!(vm.variable_text("a-up"), "1");
        assert_eq!(vm.variable_text("any-up"), "1");
        vm.pointer_event("nekoc-default-actor", "mouse_down", 0.0, 0.0);
        for _ in 0..4 {
            tick(&mut vm);
        }
        assert_eq!(vm.variable_text("sprite-down"), "4");
        vm.pointer_event("nekoc-default-actor", "mouse_up", 0.0, 0.0);
        vm.pointer_event("nekoc-default-actor", "mouse_click", 0.0, 0.0);
        for _ in 0..3 {
            tick(&mut vm);
        }
        assert_eq!(vm.variable_text("sprite-up"), "1");
        assert_eq!(vm.variable_text("sprite-click"), "1");
    }
}

#[test]
fn trace_cli_replays_the_same_script_and_measured_costume_without_render() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("costumes.json");
    let mut bits = vec![0_u8; 400];
    for y in 0..40 {
        for x in 0..40 {
            let i = y * 80 + x;
            bits[i / 8] |= 1 << (i % 8);
        }
    }
    let costumes = serde_json::json!([{"id":"costume-a","width":80,"height":40,"centerPoint":{"x":0,"y":0},"mask_width":80,"mask_height":40,"mask_bytes":bits}]);
    std::fs::write(&file, serde_json::to_vec(&costumes).unwrap()).unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_k4-trace"))
        .args([
            "tests/fixtures/kitten4/input.bcm",
            "--frames",
            "38",
            "--input-script",
            "tests/fixtures/kitten4/input-script.json",
            "--costumes",
        ])
        .arg(file)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let actual: Value = serde_json::from_slice(&output.stdout).unwrap();
    let expected: Value =
        serde_json::from_str(include_str!("../docs/input-evidence.json")).unwrap();
    for (a, b) in actual["frames"]
        .as_array()
        .unwrap()
        .iter()
        .zip(expected["frames"].as_array().unwrap())
    {
        equivalent(&a["variables"], &b["variables"], "CLI replay variables");
        equivalent(&a["actors"], &b["actors"], "CLI replay actors");
    }
}
