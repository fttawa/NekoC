use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

/// JSON number spelling (1 vs 1.0) and NaN (recorded as null) are not differences.
fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            (a - b).abs() < 1e-9
        }
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

fn evidence() -> Value {
    serde_json::from_str(include_str!("../docs/kitten4-fix-evidence.json")).unwrap()
}

fn fixture(name: &str) -> nekoc::json::Json {
    nekoc::json::from_str(
        &std::fs::read_to_string(format!("tests/fixtures/kitten4/k4fix-{name}.bcm")).unwrap(),
    )
    .unwrap()
}

/// Every recorded official frame must match with JIT enabled or disabled (these
/// short probes do not claim to reach the native hot threshold). The virtual
/// clock must make real delays and the wall budget irrelevant.
#[test]
fn official_probe_variables_match_every_frame() {
    for (name, case) in evidence()["cases"].as_object().unwrap() {
        let project = kitten4::to_neko(&fixture(name)).unwrap();
        for interpreter in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            vm.use_virtual_clock();
            vm.set_random_seed(1);
            if interpreter {
                vm.disable_jit();
            }
            vm.start();
            for (i, expected) in case["variables"].as_array().unwrap().iter().enumerate() {
                std::thread::sleep(Duration::from_millis(1));
                let frame = vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
                assert!(!frame.budget_yield, "{name}");
                let snapshot = vm.oracle_snapshot(i as u32 + 1);
                assert!(
                    same_value(&snapshot["variables"], expected),
                    "{name} frame {} (interpreter {interpreter}): {} != {expected}",
                    i + 1,
                    snapshot["variables"]
                );
                for (id, scale) in case["scales"][i].as_object().unwrap() {
                    assert!(
                        same_value(&snapshot["actors"][id]["scale"], scale),
                        "{name}/{id}"
                    );
                }
            }
        }
    }
}

/// Before the first pointer event the sprite under the stage centre is not
/// touching the mouse; the same loop sees it once a pointer position arrives.
#[test]
fn mouse_is_absent_until_the_first_pointer_event() {
    let project = kitten4::to_neko(&fixture("mouse")).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.use_virtual_clock();
    for id in ["costume-a", "costume-b"] {
        vm.set_costume(
            id,
            nekoc::engine::Costume {
                width: 40.0,
                height: 40.0,
                center_point: [0.0; 2],
                mask: None,
                rgb: None,
            },
        );
    }
    vm.start();
    for frame in 1..=3 {
        vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
        let variables = &vm.oracle_snapshot(frame)["variables"];
        assert_eq!(variables["log"], 0.0);
        assert_eq!(variables["result"], serde_json::json!([null, null]));
    }
    vm.set_mouse(0.0, 0.0);
    vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
    assert_eq!(vm.oracle_snapshot(4)["variables"]["log"], 1.0);
    assert!(
        vm.oracle_snapshot(4)["actors"]
            .as_object()
            .unwrap()
            .values()
            .any(|a| a["scale"] == 120.0)
    );
    vm.start();
    vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
    assert_eq!(
        vm.oracle_snapshot(1)["variables"]["result"],
        serde_json::json!([null, null])
    );
}

fn timer_values(name: &str, frames: usize) -> Vec<Value> {
    let project = kitten4::to_neko(&fixture(name)).unwrap();
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.use_virtual_clock();
    vm.start();
    for _ in 0..frames {
        vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
    }
    vm.oracle_snapshot(frames as u32)["variables"]["result"]
        .as_array()
        .unwrap()
        .clone()
}

/// Since 4.1.1 the reporter reads the stage timer widget: 0 until a timer block
/// starts it, then two decimals. Stopping freezes it; resetting restarts it.
#[test]
fn widget_timer_is_idle_until_started_and_rounds_to_two_decimals() {
    let values = timer_values("timer-new", 12);
    assert_eq!(values[..4], [0.0, 0.0, 0.0, 0.0].map(Value::from));
    assert_eq!(values[4..], [0.03, 0.07, 0.1].map(Value::from));
}

/// Before 4.1.1 the reporter is the time since the run began in whole
/// milliseconds, regardless of stop/reset.
#[test]
fn legacy_timer_ignores_timer_blocks_and_truncates_milliseconds() {
    let values = timer_values("timer-legacy", 12);
    assert_eq!(
        values,
        [0.0, 0.033, 0.066, 0.066, 0.1, 0.133, 0.166].map(Value::from)
    );
}
