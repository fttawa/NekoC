use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

#[test]
fn requested_disposal_matches_official_presence_and_following_code() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-lifecycle-7-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let source: Value = serde_json::from_str(
            &std::fs::read_to_string(format!(
                "tests/fixtures/kitten4/partial-lifecycle-7-{name}.bcm"
            ))
            .unwrap(),
        )
        .unwrap();
        for interpreted in [false, true] {
            let mut vm =
                Engine::new(Program::compile(&kitten4::to_neko(&source).unwrap()).unwrap());
            if interpreted {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            // Starting again must not retain a queued disposal of a reused slot.
            for _ in 0..2 {
                vm.start();
                for expected in case["frames"].as_array().unwrap() {
                    let frame = expected["frame"].as_u64().unwrap() as u32;
                    vm.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                        .unwrap();
                    let actual = vm.oracle_snapshot(frame);
                    assert_eq!(
                        actual["actors"].as_object().unwrap().len(),
                        expected["actors"].as_array().unwrap().len(),
                        "{name}/{frame}/{interpreted}"
                    );
                    for (id, value) in expected["variables"].as_object().unwrap() {
                        assert_eq!(
                            actual["variables"][id].as_f64(),
                            value.as_f64(),
                            "{name}/{frame}/{interpreted}/{id}"
                        );
                    }
                }
            }
        }
    }
}
