use nekoc::{
    engine::{Engine, Frame, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn fixture(name: &str) -> nekoc::json::Json {
    let source = match name {
        "idle" => include_str!("fixtures/kitten4/monitors-idle.bcm"),
        "dynamic" => include_str!("fixtures/kitten4/monitors-dynamic.bcm"),
        _ => panic!("unknown fixture {name}"),
    };
    nekoc::json::from_str(source).unwrap()
}

fn advance(vm: &mut Engine) -> Frame {
    vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap()
}

fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kitten4-monitor-evidence.json")).unwrap()
}

fn text(value: &Value, list: bool) -> String {
    if list {
        return value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| text(v, false))
            .collect::<Vec<_>>()
            .join("\n");
    }
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.as_f64().unwrap().to_string(),
        _ => value.to_string(),
    }
}

/// No show/hide blocks in idle: globals, actor/scene-private scalars and lists
/// must already exist. The dynamic case hides/re-shows the same declaration,
/// changes values and reveals a saved-hidden declaration. Check each official
/// update and repeat after start() to rule out stale visibility/private values.
#[test]
fn initial_and_script_monitor_frames_match_official_widgets() {
    let evidence = evidence();
    for name in ["idle", "dynamic"] {
        let native = fixture(name);
        let project = kitten4::to_neko(&native).unwrap();
        assert_eq!(kitten4::from_neko(&project).unwrap(), native);
        let case = &evidence["cases"][name];
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            vm.use_virtual_clock();
            if !jit {
                vm.disable_jit();
            }
            for restart in 0..2 {
                vm.start();
                for (i, widgets) in case["widgets"].as_array().unwrap().iter().enumerate() {
                    let frame = advance(&mut vm);
                    assert!(!frame.budget_yield);
                    let ids: Vec<_> = frame.monitors.iter().map(|m| m.id.as_str()).collect();
                    let expected: Vec<_> = widgets
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|widget| widget["visible"] == true)
                        .map(|widget| widget["id"].as_str().unwrap())
                        .collect();
                    assert_eq!(
                        ids, expected,
                        "{name} jit={jit} restart={restart} frame={i}"
                    );
                    for monitor in &frame.monitors {
                        let var = &native["variables"][&monitor.id];
                        let list = var["type"] == "list";
                        assert_eq!(monitor.list, list);
                        assert_eq!(monitor.name, var["name"].as_str().unwrap());
                        assert_eq!(
                            monitor.value,
                            text(&case["variables"][i][&monitor.id], list),
                            "{name} {} frame={i}",
                            monitor.id
                        );
                    }
                    // The public serialized Frame remains the existing protocol.
                    let wire = serde_json::to_value(&frame).unwrap();
                    assert_eq!(wire["monitors"].as_array().unwrap().len(), expected.len());
                    for monitor in wire["monitors"].as_array().unwrap() {
                        assert_eq!(monitor.as_object().unwrap().len(), 4);
                    }
                }
            }
        }
    }
}

/// Canonical edits remain authoritative; metadata provenance is not a frozen
/// runtime copy. Removing K4 provenance must not enable this K4-only behavior.
#[test]
fn canonical_visibility_edits_apply_but_kn_behavior_stays_unchanged() {
    let mut project = kitten4::to_neko(&fixture("idle")).unwrap();
    project["variables"]["variablesDict"]["z-score"]["visible"] = json!(false);
    project["variables"]["variablesDict"]["hidden"]["visible"] = json!(true);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.use_virtual_clock();
    vm.start();
    let frame = advance(&mut vm);
    assert!(frame.monitors.iter().any(|m| m.id == "hidden"));
    assert!(!frame.monitors.iter().any(|m| m.id == "z-score"));

    project.as_object_mut().unwrap().remove("_nekocKitten4");
    let mut kn = Engine::new(Program::compile(&project).unwrap());
    kn.use_virtual_clock();
    kn.start();
    assert!(advance(&mut kn).monitors.is_empty());
}

/// Private list monitors share the existing global list output cap, rather
/// than reporting the private Cell's comma-joined Array.toString form.
#[test]
fn private_and_global_list_monitors_use_the_same_cap() {
    let mut native = fixture("idle");
    let values = (0..102).map(Value::from).collect::<Vec<_>>();
    for id in ["m-items", "private-items"] {
        native["variables"][id]["value"] = json!(values);
    }
    let project = kitten4::to_neko(&native).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.use_virtual_clock();
    vm.start();
    let frame = advance(&mut vm);
    let expected = (0..100)
        .map(|i| i.to_string())
        .chain(["…".into()])
        .collect::<Vec<_>>()
        .join("\n");
    for id in ["m-items", "private-items"] {
        assert_eq!(
            frame.monitors.iter().find(|m| m.id == id).unwrap().value,
            expected
        );
    }
}

/// Lowering cloud declarations must not discard the saved visible bit when it
/// deliberately replaces anonymous/offline initial values with 0 / []. This is
/// a structural regression, not a claim of live authenticated-cloud parity.
#[test]
fn cloud_lowering_preserves_initial_visibility() {
    let mut native = fixture("idle");
    native["variables"] = json!({});
    native["cloud_variables"] = json!({
        "cloud-scalar": {"id":"cloud-scalar","name":"Cloud scalar","type":"public_variable","visible":true},
        "cloud-list": {"id":"cloud-list","name":"Cloud list","type":"public_list","visible":true},
        "cloud-hidden": {"id":"cloud-hidden","name":"Hidden cloud","type":"private","visible":false}
    });
    let project = kitten4::to_neko(&native).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.use_virtual_clock();
    vm.start();
    let frame = advance(&mut vm);
    let ids: Vec<_> = frame.monitors.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["cloud-scalar", "cloud-list"]);
    assert_eq!(frame.monitors[0].value, "0");
    assert!(frame.monitors[1].list);
    assert_eq!(frame.monitors[1].value, "");
}
