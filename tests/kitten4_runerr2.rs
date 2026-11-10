use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| same_value(a, b)))
        }
        _ => actual == expected,
    }
}

#[test]
fn official_equality_trig_and_virtual_clock_probes() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-runerr2-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source = nekoc::json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/runerr2-{name}.bcm")).unwrap(),
        )
        .unwrap();
        let project = kitten4::to_neko(&source).unwrap();
        let mut previous = None;
        for interpreter in [false, true] {
            for budget in [Duration::ZERO, Duration::from_secs(5)] {
                let mut vm = Engine::new(Program::compile(&project).unwrap());
                vm.use_virtual_clock();
                vm.set_random_seed(1);
                if interpreter {
                    vm.disable_jit();
                }
                vm.start();
                let mut snapshots = vec![];
                for (i, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                    // A real delay and even a zero wall budget cannot change virtual execution.
                    std::thread::sleep(Duration::from_millis(2));
                    let frame = vm.advance(1.0 / 60.0, 2_000_000, budget).unwrap();
                    assert!(!frame.budget_yield, "{name}");
                    let snapshot = vm.oracle_snapshot(i as u32 + 1);
                    // JSON number representation (1 vs 1.0) is not a semantic difference.
                    assert!(
                        same_value(&snapshot["variables"], expected),
                        "{name} frame {}: {} != {expected}",
                        i + 1,
                        snapshot["variables"]
                    );
                    snapshots.push(snapshot);
                }
                if let Some(previous) = &previous {
                    assert_eq!(&snapshots, previous, "{name}");
                }
                previous = Some(snapshots);
            }
        }
        let report = kitten4::coverage_with_seed(&source, 4, Some(1));
        assert_eq!(report["stage"], "ran");
        assert_eq!(report["budget_frames"], 0);
    }
}

#[test]
fn virtual_clock_keeps_instruction_safety_limit() {
    let source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/runerr-warp-10002.bcm")).unwrap();
    let mut vm = Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
    vm.use_virtual_clock();
    vm.start();
    let frame = vm.advance(1.0 / 60.0, 10, Duration::ZERO).unwrap();
    assert!(frame.budget_yield);
    assert_eq!(frame.instructions, 10);
}

#[test]
fn virtual_timer_uses_dt_not_real_delays() {
    let mut source =
        nekoc::json::from_str(include_str!("fixtures/kitten4/runerr2-clock.bcm")).unwrap();
    // Substitute only the two marker reporters in our own workspace.
    fn timers(value: &mut Value) {
        if value["type"] == "math_number"
            && ["1", "2"].contains(&value["fields"]["NUM"].as_str().unwrap_or(""))
        {
            value["type"] = Value::String("get_timer".into());
            value["fields"] = serde_json::json!({});
        } else {
            match value {
                Value::Object(values) => values.values_mut().for_each(timers),
                Value::Array(values) => values.iter_mut().for_each(timers),
                _ => {}
            }
        }
    }
    for actor in source["theatre"]["actors"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        timers(&mut actor["block_data_json"]);
    }
    let mut vm = Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
    vm.use_virtual_clock();
    vm.start();
    for frame in 1..=3 {
        std::thread::sleep(Duration::from_millis(3));
        vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
        let result = vm.oracle_snapshot(frame)["variables"]["result"].clone();
        assert_eq!(result[2], 1.0 / 60.0);
        if frame == 3 {
            assert_eq!(result[3], 3.0 / 60.0);
        }
    }
}
