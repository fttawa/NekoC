use nekoc::{
    engine::{Engine, Program},
    runtime::{self, RuntimeValue},
};
use std::time::Duration;

// The reference interpreter does not implement bounce. This fixture keeps the
// actor strictly inside the stage, where the official snapshots prove it is a
// no-op; do not implement a new block as part of this numeric task.
fn reference_project(mut p: serde_json::Value) -> serde_json::Value {
    if let Some(metadata) = p.get("_nekocKitten4").cloned() {
        p = nekoc::kitten4::lower_for_vm(&p);
        p["_nekocKitten4"] = metadata;
    }
    fn visit(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(map) => {
                if map.get("type").and_then(serde_json::Value::as_str)
                    == Some("self_bounce_off_edge")
                {
                    map.insert("type".into(), serde_json::json!("wait"));
                    map.insert(
                        "inputs".into(),
                        serde_json::json!({"time":{"type":"math_number","fields":{"NUM":0}}}),
                    );
                }
                for child in map.values_mut() {
                    visit(child);
                }
            }
            serde_json::Value::Array(items) => items.iter_mut().for_each(visit),
            _ => {}
        }
    }
    visit(&mut p);
    p
}

#[test]
fn official_nonfinite_fixtures_match_all_interpreters() {
    for name in ["kn.bcmkn", "kn-list.bcmkn", "kitten4.bcm"] {
        let p = nekoc::project::load_project(format!("tests/fixtures/nonfinite/{name}"))
            .unwrap()
            .value;
        let p = if nekoc::kitten4::is_kitten4(&p) {
            nekoc::kitten4::to_neko(&p).unwrap()
        } else {
            p
        };
        let rp = reference_project(p.clone());
        let mut reference_vm = runtime::Runtime::from_project(&rp).unwrap();
        reference_vm.start();
        let mut reference_saw_nan_scale = false;
        let mut reference_saw_recovery = false;
        for _ in 0..1000 {
            reference_vm.run_ticks(1).unwrap();
            let snapshot = reference_vm.snapshot();
            let actor = snapshot.actors.values().next().unwrap();
            if matches!(
                snapshot.variables["phase"],
                RuntimeValue::Number(19.0 | 20.0)
            ) {
                if name.starts_with("kn") {
                    assert!(actor.scale.is_nan());
                    assert!(actor.visible, "logical visibility must be preserved");
                    reference_saw_nan_scale = true;
                } else {
                    assert_eq!(actor.scale, 80.0);
                }
            }
            if matches!(snapshot.variables["phase"], RuntimeValue::Number(21.0)) {
                assert_eq!(actor.scale, 80.0);
                reference_saw_recovery = true;
            }
        }
        assert!(reference_saw_recovery);
        assert_eq!(reference_saw_nan_scale, name.starts_with("kn"));
        let reference = reference_vm.snapshot();
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&p).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            let mut saw_nan_scale = false;
            let mut saw_recovery = false;
            for _ in 0..1000 {
                let frame = vm
                    .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
                    .unwrap();
                for sprite in frame.sprites.iter().filter(|s| {
                    s.id != "nekoc-scene-main" && s.id != "10000000-0000-4000-8000-000000000001"
                }) {
                    assert!(sprite.x.is_finite() && sprite.y.is_finite(), "{name}");
                    if matches!(vm.variable_text("phase").as_str(), "19" | "20") {
                        if name.starts_with("kn") {
                            assert!(sprite.scale.is_nan());
                            assert!(!sprite.visible, "invalid geometry must not be drawn");
                            saw_nan_scale = true;
                        } else {
                            assert_eq!(sprite.scale, 80.0);
                            assert!(sprite.visible);
                        }
                    }
                    if vm.variable_text("phase") == "21" {
                        assert_eq!(sprite.scale, 80.0);
                        assert!(sprite.visible, "finite scale restores drawing");
                        saw_recovery = true;
                    }
                }
            }
            assert!(saw_recovery, "{name} jit={jit}");
            assert_eq!(saw_nan_scale, name.starts_with("kn"));
            for (id, expected) in [
                ("nan", "NaN"),
                ("inf", "Infinity"),
                ("sqrt", "NaN"),
                ("log", "-Infinity"),
                ("modulo", "NaN"),
                ("huge", "1e+21"),
                ("tiny", "1e-7"),
                ("negativeZero", "0"),
                ("badNumber", "not-a-number"),
            ] {
                assert_eq!(
                    reference.variables[id],
                    RuntimeValue::String(expected.into()),
                    "{name} reference {id}"
                );
                assert_eq!(vm.variable_text(id), expected, "{name} jit={jit} {id}");
            }
            if name == "kn-list.bcmkn" {
                let slot = vm
                    .program
                    .variable_names
                    .iter()
                    .position(|n| n == "listRead")
                    .unwrap();
                assert!(vm.numeric_variables()[slot].is_nan());
                assert!(
                    matches!(reference.variables["listRead"],RuntimeValue::Number(n) if n.is_nan())
                );
            }
        }
        let actor = reference.actors.values().next().unwrap();
        let direction = if name.starts_with("kitten4") {
            55.0
        } else {
            35.0
        };
        assert_eq!(
            (actor.x, actor.y, actor.rotation, actor.scale),
            (100.0, 20.0, direction, 80.0)
        );
        assert_eq!(reference.variables["done"], RuntimeValue::Number(1.0));
    }
}

#[test]
fn kitten4_nonfinite_list_read_is_an_official_error_not_a_coordinate_error() {
    let p = nekoc::project::load_project("tests/fixtures/nonfinite/kitten4-list.bcm")
        .unwrap()
        .value;
    let p = nekoc::kitten4::to_neko(&p).unwrap();
    assert!(
        runtime::run_project(&reference_project(p.clone()), 1000)
            .unwrap_err()
            .to_string()
            .contains("non-finite list index")
    );
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        let mut error = None;
        for _ in 0..1000 {
            if let Err(e) = vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5)) {
                error = Some(e);
                break;
            }
        }
        assert!(error.unwrap().to_string().contains("non-finite list index"));
    }
}

#[test]
fn nan_reverse_text_slice_is_empty_instead_of_panicking() {
    // Safety regression, not an additional official-editor conformance claim.
    let mut p = nekoc::studio::document::Document::blank().value().clone();
    p["variables"]["variablesDict"]["slice"] =
        serde_json::json!({"id":"slice","name":"slice","value":"unreached"});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = serde_json::json!([{
        "type":"on_running_group_activated","next":{
            "type":"variables_set","fields":{"variable":"slice"},"inputs":{"value":{
                "type":"text_select","inputs":{
                    "text":{"type":"text","fields":{"TEXT":"abc"}},
                    "start_index":{"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{
                        "A":{"type":"math_number","fields":{"NUM":0}},
                        "B":{"type":"math_number","fields":{"NUM":0}}
                    }},
                    "end_index":{"type":"math_number","fields":{"NUM":3}}
                }
            }}
        }
    }]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(vm.variable_text("slice"), "");
    }
}
