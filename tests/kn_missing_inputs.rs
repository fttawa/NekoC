use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

#[test]
fn kn_arithmetic_missing_slots_match_official_nan_and_continue() {
    // Official editor/runtime 0.27.4: docs/kn-missing-inputs-official.json.
    for operator in ["add", "minus", "multiply", "divide", "power"] {
        for present in [None, Some("A"), Some("B")] {
            for depth in [0, 40] {
                let mut project: Value = serde_json::from_str(include_str!(
                    "../tests/fixtures/kn-semantics/scheduling.bcmkn"
                ))
                .unwrap();
                let mut expr = json!({"type":"math_arithmetic","fields":{"type":operator}});
                if let Some(key) = present {
                    expr["inputs"] = json!({key:{"type":"math_number","fields":{"NUM":7}}});
                }
                for _ in 0..depth {
                    expr = json!({"type":"math_arithmetic","fields":{"type":"add"},
                        "inputs":{"A":expr,"B":{"type":"math_number","fields":{"NUM":1}}}});
                }
                let actor = project["actors"]["actorsDict"]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                    .next()
                    .unwrap();
                actor["nekoBlockJsonList"] = json!([{"type":"on_running_group_activated",
                    "next":{"type":"variables_set","fields":{"variable":"trace"},"inputs":{"value":expr},
                    "next":{"type":"variables_set","fields":{"variable":"done"},
                    "inputs":{"value":{"type":"math_number","fields":{"NUM":1}}}}}}]);
                for jit in [false, true] {
                    let (imported, report) = nekoc::bcmkn::import(project.clone()).unwrap();
                    assert_eq!(*imported, project);
                    assert_eq!(report["fast_runtime_ready"], true);
                    let mut vm = Engine::new(Program::compile(&project).unwrap());
                    if !jit {
                        vm.disable_jit();
                    }
                    vm.start();
                    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                        .unwrap();
                    assert!(
                        matches!(vm.variable_value("trace"), Cell::Number(n) if n.is_nan()),
                        "{operator} {present:?} depth={depth} jit={jit}"
                    );
                    assert!(matches!(vm.variable_value("done"), Cell::Number(1.0)));
                }
            }
        }
    }
}

#[test]
fn all_six_original_eisei_missing_slot_projects_compile_unchanged() {
    for name in [
        "eisei_pen",
        "eisei_pen_128",
        "eisei_pen_128_compact",
        "eisei_pen_128_full_rebuilt",
        "eisei_pen_128_import_probe",
        "eisei_pen_128_lite",
    ] {
        let bytes = std::fs::read(format!("projects/eisei/{name}.bcmkn")).unwrap();
        let project: Value = serde_json::from_slice(&bytes).unwrap();
        let (imported, report) = nekoc::bcmkn::import(project.clone()).unwrap();
        assert_eq!(*imported, project, "{name}");
        assert_eq!(report["fast_runtime_ready"], true, "{name}: {report}");
        Program::compile_exact(&project).unwrap();
    }
}
