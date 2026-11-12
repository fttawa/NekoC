use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn normalize(v: &Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => a.iter().map(normalize).collect(),
        Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect(),
        _ => v.clone(),
    }
}

#[test]
fn shake_matches_every_official_frame_with_the_same_explicit_clock_origin() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-shake-9-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(case["fixture"].as_str().unwrap()).unwrap(),
        )
        .unwrap();
        for (origin, expected) in case["origins"].as_object().unwrap() {
            for interpreted in [false, true] {
                let mut vm =
                    Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
                if interpreted {
                    vm.disable_jit();
                }
                vm.use_virtual_clock();
                assert!(vm.set_k4_shake_clock_origin_ms(f64::NAN).is_err());
                assert!(vm.set_k4_shake_clock_origin_ms(f64::INFINITY).is_err());
                vm.set_k4_shake_clock_origin_ms(origin.parse().unwrap())
                    .unwrap();
                vm.start();
                for frame in 0..40 {
                    vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                        .unwrap();
                    let snapshot = vm.oracle_snapshot((frame + 1) as u32);
                    assert_eq!(
                        normalize(&snapshot["variables"]),
                        normalize(&expected["variables"][frame]),
                        "{name}/{origin}/{frame}/{interpreted}"
                    );
                    for (id, actor) in expected["actors"][frame].as_object().unwrap() {
                        for key in ["x", "y"] {
                            assert_eq!(
                                snapshot["actors"][id][key].as_f64(),
                                actor[key].as_f64(),
                                "{name}/{origin}/{frame}/{key}"
                            );
                        }
                    }
                }
                assert!(vm.set_k4_shake_clock_origin_ms(0.0).is_err());
                vm.start();
                for frame in 0..40 {
                    vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                        .unwrap();
                    assert_eq!(
                        normalize(&vm.oracle_snapshot(frame as u32 + 1)["variables"]),
                        normalize(&expected["variables"][frame])
                    );
                }
            }
        }
    }
}
