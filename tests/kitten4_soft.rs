//! Original fixture: actual deformation/mesh transport, not official equality.
use nekoc::{
    engine::{Costume, Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::{fs, time::Duration};

#[test]
fn particle_mesh_and_diagnostics_are_identical_in_both_vms() {
    let source: Value = serde_json::from_slice(
        &fs::read("tests/fixtures/kitten4/partial-physics-9-impact-90.bcm").unwrap(),
    )
    .unwrap();
    let canonical = kitten4::to_neko(&source).unwrap();
    let run = |interpreted| {
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.set_costume(
            "probe-style",
            Costume {
                width: 160.0,
                height: 120.0,
                mask: Some((16, 12, vec![255; 24])),
                ..Default::default()
            },
        );
        if interpreted {
            engine.disable_jit();
        }
        engine.use_virtual_clock();
        engine.start();
        let mut snapshots = Vec::new();
        let mut deformed = false;
        let mut rest_distance = None;
        for _ in 0..120 {
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                .unwrap();
            let state = engine.physics_soft_snapshot(1).unwrap();
            assert_eq!(state["model"], "particle-approximation");
            assert_eq!(state["certification"], "partial");
            let mesh = engine.physics_soft_mesh(1).unwrap();
            assert!(!mesh.triangles.is_empty());
            assert!(mesh.vertices.iter().flatten().all(|n| n.is_finite()));
            assert!(
                mesh.vertices
                    .iter()
                    .all(|p| p[2] >= 0.0 && p[2] <= 1.0 && p[3] >= 0.0 && p[3] <= 1.0)
            );
            assert!(mesh.vertices.iter().all(|p| p[1] >= -370.000001));
            let a = mesh.vertices[0];
            let b = mesh.vertices[mesh.vertices.len() - 1];
            let distance = (a[0] - b[0]).hypot(a[1] - b[1]);
            let rest = *rest_distance.get_or_insert(distance);
            deformed |= (distance - rest).abs() > 0.1;
            if let Some(sprite) = frame
                .sprites
                .iter()
                .find(|s| s.id == "20000000-0000-4000-8000-000000000001")
            {
                assert!(sprite.soft_mesh.is_some());
            }
            snapshots.push(state);
        }
        assert!(deformed, "impact must change particle-pair distances");
        snapshots
    };
    assert_eq!(run(false), run(true));
}
