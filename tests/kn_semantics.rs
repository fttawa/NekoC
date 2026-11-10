use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

fn encoded(cell: &Cell) -> Value {
    match cell {
        Cell::Number(n) if !n.is_finite() => {
            json!({"$number": if n.is_nan() { "NaN" } else if *n > 0.0 { "Infinity" } else { "-Infinity" }})
        }
        Cell::List(items) => Value::Array(items.borrow().iter().map(encoded).collect()),
        _ => serde_json::to_value(cell).unwrap(),
    }
}

fn numeric_json(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.iter().map(numeric_json).collect()),
        _ => value.clone(),
    }
}

#[test]
fn native_kn_matches_archived_official_observations_with_and_without_jit() {
    let report: Value =
        serde_json::from_str(include_str!("../docs/kn-semantics-official.json")).unwrap();
    assert_eq!(report["ok"], true);
    for (name, case) in report["cases"].as_object().unwrap() {
        let source = std::fs::read_to_string(case["fixture"].as_str().unwrap()).unwrap();
        let project: Value = serde_json::from_str(&source).unwrap();
        let (imported, _) = nekoc::bcmkn::import(project.clone()).unwrap();
        assert_eq!(*imported, project, "native import must preserve {name}");
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&imported).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.start();
            for _ in 0..180 {
                let update = vm
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap();
                assert!(!update.budget_yield, "{name}");
            }
            for (id, expected) in case["variables"].as_object().unwrap() {
                assert_eq!(
                    encoded(&vm.variable_value(id)),
                    numeric_json(expected),
                    "{name}, {id}, jit={jit}"
                );
            }
        }
    }
}
