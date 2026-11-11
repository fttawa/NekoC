use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

#[test]
fn scheduling_matches_recorded_offline_kernel_in_interpreter_and_jit() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-scheduling-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        for interpreter in [false, true] {
            let path = format!("tests/fixtures/kitten4/scheduling-{name}.bcm");
            let source = nekoc::json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            let project = kitten4::to_neko(&source).unwrap();
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            if interpreter {
                engine.disable_jit();
            }
            engine.start();
            for (i, expected) in case["log"].as_array().unwrap().iter().enumerate() {
                let frame = engine
                    .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert!(!frame.budget_yield);
                assert_eq!(
                    engine.oracle_snapshot(i as u32 + 1)["variables"]["log"],
                    *expected,
                    "{name}, frame {}, interpreter={interpreter}",
                    i + 1
                );
            }
        }
    }
}

#[test]
fn trace_preserves_hat_ids() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/scheduling-order.bcm")).unwrap();
    let mut engine = Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
    engine.trace_blocks();
    engine.start();
    engine
        .advance(1.0 / 60.0, 10000, Duration::from_secs(5))
        .unwrap();
    let events = engine.take_oracle_events();
    let hats: Vec<_> = events
        .iter()
        .filter(|e| e["event"] == "resume")
        .map(|e| e["hat"].as_str().unwrap())
        .collect();
    assert_eq!(hats, ["z-first", "a-second"]);
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "block" && e["block"] == "first")
    );
    assert!(engine.take_oracle_events().is_empty());
}

#[test]
fn fractional_repeat_remains_identical_after_native_warmup() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/scheduling-fractional.bcm")).unwrap();
    let project = kitten4::to_neko(&source).unwrap();
    let mut native = Engine::new(Program::compile(&project).unwrap());
    let mut interpreted = Engine::new(Program::compile(&project).unwrap());
    interpreted.disable_jit();
    // start() resets runtime state but retains compiled regions and hot counters.
    // Re-enter Repeat itself, not just its body, beyond HOT_THRESHOLD (500).
    for run in 0..650 {
        for engine in [&mut native, &mut interpreted] {
            engine.start();
        }
        for frame in 1..=4 {
            for engine in [&mut native, &mut interpreted] {
                let result = engine
                    .advance(1.0 / 60.0, 10000, Duration::from_secs(5))
                    .unwrap();
                assert!(!result.budget_yield);
            }
            assert_eq!(
                native.oracle_snapshot(frame),
                interpreted.oracle_snapshot(frame),
                "run {run}, frame {frame}"
            );
        }
        assert_eq!(native.oracle_snapshot(4)["variables"]["log"], "AAC");
    }
}

#[test]
fn zero_wait_tracks_updates_not_a_hardcoded_sixty_hz_delay() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/scheduling-wait.bcm")).unwrap();
    let project = kitten4::to_neko(&source).unwrap();
    for dt in [0.0, 0.001, 0.1] {
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        engine.start();
        for expected in ["AB", "AB", "ABC"] {
            engine.advance(dt, 10000, Duration::from_secs(5)).unwrap();
            assert_eq!(engine.oracle_snapshot(1)["variables"]["log"], expected);
        }
    }
}

#[test]
fn kitten_n_owner_order_is_unchanged_by_ordered_json_support() {
    use serde_json::json;
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"]["order"] = json!({"id":"order","name":"order","value":0});
    let actor = project["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    project["actors"]["actorsDict"] = json!({});
    project["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"] = json!(["a", "z"]);
    // Deliberately reverse insertion order. KN must still execute a then z.
    for (id, n) in [("z", 2), ("a", 1)] {
        let mut actor = actor.clone();
        actor["id"] = json!(id);
        actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated",
            "next":{"type":"variables_set","fields":{"variable":"order"},
            "inputs":{"value":{"type":"math_number","fields":{"NUM":n}}}}}]);
        project["actors"]["actorsDict"][id] = actor;
    }
    let reference = nekoc::runtime::run_project(&project, 1).unwrap();
    assert!(matches!(
        reference.variables["order"],
        nekoc::runtime::RuntimeValue::Number(2.0)
    ));
    for interpreter in [false, true] {
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        if interpreter {
            engine.disable_jit();
        }
        engine.start();
        engine
            .advance(1.0 / 60.0, 10000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(engine.oracle_snapshot(1)["variables"]["order"], 2.0);
    }
}

#[test]
fn block_trace_keeps_list_bounds_errors_and_partial_events() {
    use serde_json::json;
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/scheduling-order.bcm")).unwrap();
    let mut project = kitten4::to_neko(&source).unwrap();
    let actors = project["actors"]["actorsDict"].as_object_mut().unwrap();
    let actor = actors.values_mut().next().unwrap();
    actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated","id":"hat",
        "next":{"type":"variables_set","id":"bad-read","fields":{"variable":"log"},
        "inputs":{"value":{"type":"list_item","fields":{"item":"any"},
            "inputs":{"list":{"type":"temporary_list","inputs":{}},
                "list_index":{"type":"math_number","fields":{"NUM":1}}}}}}}]);
    let mut engine = Engine::new(Program::compile(&project).unwrap());
    engine.trace_blocks();
    engine.start();
    let error = engine
        .advance(1.0 / 60.0, 10000, Duration::from_secs(5))
        .unwrap_err();
    assert!(error.to_string().contains("lists_get_value_bad_index"));
    assert!(error.to_string().contains("bad-read"));
    assert!(engine.take_oracle_events().iter().any(|event| {
        event["event"] == "block" && event["hat"] == "hat" && event["block"] == "bad-read"
    }));
}
