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
fn shake_matches_zero_origin_official_variables_and_positions_every_update() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kitten4-shake-8-evidence.json")).unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/shake-8-{name}.bcm")).unwrap(),
        )
        .unwrap();
        let expected = &case["origins"]["0"];
        for interpreted in [false, true] {
            let mut vm =
                Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
            if interpreted {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.start();
            for frame in 0..evidence["frames"].as_u64().unwrap() as usize {
                vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                let snapshot = vm.oracle_snapshot((frame + 1) as u32);
                assert_eq!(
                    normalize(&snapshot["variables"]),
                    normalize(&expected["variables"][frame]),
                    "{name}/{}/{interpreted}/variables",
                    frame + 1
                );
                for (id, actor) in expected["actors"][frame].as_object().unwrap() {
                    for key in ["x", "y"] {
                        assert_eq!(
                            snapshot["actors"][id][key].as_f64(),
                            actor[key].as_f64(),
                            "{name}/{}/{interpreted}/{key}",
                            frame + 1
                        );
                    }
                }
            }
            // A new start must reset the shake-only clock and task state too.
            vm.start();
            vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                .unwrap();
            assert_eq!(
                normalize(&vm.oracle_snapshot(1)["variables"]),
                normalize(&expected["variables"][0])
            );
        }
    }
}
