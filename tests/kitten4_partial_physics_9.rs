//! Lifecycle regression only: soft deformation remains explicitly unsupported.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::{fs, time::Duration};

#[test]
fn soft_texture_repeat_and_scale_rebuild_lifecycle_in_both_vms() {
    let source: Value = serde_json::from_slice(
        &fs::read("tests/fixtures/kitten4/partial-physics-9-rebuild.bcm").unwrap(),
    )
    .unwrap();
    let canonical = kitten4::to_neko(&source).unwrap();
    for interpreted in [false, true] {
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.set_costume(
            "probe-style",
            Costume {
                width: 160.0,
                height: 120.0,
                ..Default::default()
            },
        );
        if interpreted {
            engine.disable_jit();
        }
        engine.use_virtual_clock();
        engine.start();
        let mut after_rebuild_x = None;
        for frame in 1..=90 {
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                .unwrap();
            let state = engine.physics_soft_snapshot(1).unwrap();
            let (elastic, generation) = match frame {
                1..=30 => (true, 1),
                31..=40 => (true, 2),
                41..=50 => (false, 2),
                _ => (true, 3),
            };
            assert_eq!(
                state["elastic"], elastic,
                "frame {frame} interpreted={interpreted}"
            );
            assert_eq!(
                state["generation"], generation,
                "frame {frame} interpreted={interpreted}"
            );
            assert_eq!(state["deformationImplemented"], false);
            if frame == 31 || frame == 40 {
                let snapshot = engine.oracle_snapshot(frame);
                let x = snapshot["actors"]["20000000-0000-4000-8000-000000000001"]["x"]
                    .as_f64()
                    .unwrap();
                if frame == 31 {
                    after_rebuild_x = Some(x);
                    assert!((x - 290.0 / 3.0).abs() < 1e-7);
                } else {
                    assert!((x - after_rebuild_x.unwrap()).abs() < 1e-7);
                }
            }
        }
    }
}
