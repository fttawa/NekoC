//! KN 0.27.4 native statements, not a JS callback/closure implementation.
use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

fn fixture(name: &str) -> Value {
    serde_json::from_str(match name {
        "main" => include_str!("fixtures/kn-semantics/partial2-timers-main.bcmkn"),
        "clear" => include_str!("fixtures/kn-semantics/partial2-timers-clear.bcmkn"),
        _ => panic!("unknown timer fixture"),
    })
    .unwrap()
}

#[test]
fn native_timer_projects_match_official_with_jit_enabled_and_disabled() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kn-partial2-timers-official.json")).unwrap();
    assert_eq!(evidence["ok"], true);
    for name in ["main", "clear"] {
        let project = fixture(name);
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.start();
            for _ in 0..180 {
                let frame = vm
                    .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                    .unwrap();
                assert!(!frame.budget_yield, "{name}, jit={jit}");
            }
            for (id, expected) in evidence["cases"][name]["variables"].as_object().unwrap() {
                let actual = vm.variable_value(id);
                let same = match expected {
                    Value::Number(n) => matches!(actual, Cell::Number(v) if Some(v) == n.as_f64()),
                    Value::String(s) => matches!(&actual, Cell::Text(v) if v.as_ref() == s),
                    other => panic!("unexpected timer evidence {other}"),
                };
                assert!(same, "{name}/{id}, jit={jit}: {actual:?} != {expected}");
            }
            assert!(matches!(vm.variable_value("done"), Cell::Number(1.0)));
            assert!(matches!(
                vm.variable_value("callback_hits"),
                Cell::Number(0.0)
            ));
            // Long after every timeout deadline, only the empty intervals remain.
            assert_eq!(vm.active_tasks(), if name == "main" { 4 } else { 1 });
        }
    }
}

#[test]
fn valid_handle_clear_matrix_matches_domain_cancellation_not_browser_id_numbers() {
    // Native timer blocks are statements with no output. This test intentionally
    // uses the VM's first allocated ID; it does NOT equate it with a browser ID.
    for timer in ["setTimeout", "setInterval"] {
        for clear in ["clearTimeout", "clearInterval"] {
            for string_id in [false, true] {
                let mut project = fixture("main");
                let actor = project["actors"]["actorsDict"]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                    .next()
                    .unwrap();
                let id = if string_id {
                    json!({"type":"text","fields":{"TEXT":"1"}})
                } else {
                    json!({"type":"math_number","fields":{"NUM":"1"}})
                };
                let socket = if clear == "clearTimeout" {
                    "timeoutId"
                } else {
                    "intervalId"
                };
                actor["nekoBlockJsonList"] = json!([{
                    "type":"on_running_group_activated","next":{
                        "type":timer,"inputs":{"delay":{"type":"math_number","fields":{"NUM":"1000"}}},
                        "next":{"type":clear,"inputs":{socket:id},"next":{
                            "type":"variables_set","fields":{"variable":"done"},
                            "inputs":{"value":{"type":"math_number","fields":{"NUM":"1"}}}
                        }}
                    }
                }]);
                for jit in [false, true] {
                    let mut vm = Engine::new(Program::compile(&project).unwrap());
                    if !jit {
                        vm.disable_jit();
                    }
                    vm.use_virtual_clock();
                    vm.start();
                    vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))
                        .unwrap();
                    assert_eq!(
                        vm.active_tasks(),
                        0,
                        "{timer}/{clear}, string={string_id}, jit={jit}"
                    );
                    assert!(matches!(vm.variable_value("done"), Cell::Number(1.0)));
                }
            }
        }
    }
}
