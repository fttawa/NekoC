//! Archived offline-player observations, not inferred expected values.
use nekoc::{
    engine::{Costume, Engine, Program},
    input::{InputReplay, InputScript},
    kitten4,
};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};

#[test]
fn visibility_matches_official_frames_except_documented_clone_disposal_gap() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../docs/kitten4-partial-visibility-5-evidence.json"
    ))
    .unwrap();
    for (name, case) in evidence["cases"].as_object().unwrap() {
        let file = format!("tests/fixtures/kitten4/partial-visibility-5-{name}.bcm");
        let source: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let canonical = kitten4::to_neko(&source).unwrap();
        let input_file = file.replace(".bcm", "-input.json");
        let script: Option<InputScript> = std::fs::read_to_string(input_file)
            .ok()
            .map(|text| serde_json::from_str(&text).unwrap());
        for interpreted in [true, false] {
            let mut vm = Engine::new(Program::compile(&canonical).unwrap());
            if interpreted {
                vm.disable_jit();
            }
            vm.use_virtual_clock();
            vm.set_costume(
                "costume-a",
                Costume {
                    width: 40.0,
                    height: 40.0,
                    center_point: [0.0, 0.0],
                    mask: Some((40, 40, vec![255; 200])),
                    rgb: None,
                },
            );
            vm.start();
            let mut replay = InputReplay::default();
            let mut sprites = BTreeMap::new();
            for expected in case["frames"].as_array().unwrap() {
                let frame = expected["frame"].as_u64().unwrap() as u32;
                if let Some(script) = &script {
                    replay.before_frame(&mut vm, script, frame);
                }
                let result = vm
                    .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
                    .unwrap();
                assert!(!result.budget_yield, "{name}/{frame}");
                for id in result.removed {
                    sprites.remove(&id);
                }
                for sprite in result.sprites {
                    sprites.insert(sprite.id.clone(), (sprite.visible, sprite.opacity));
                }
                let context = format!("{name}/{frame}/interpreted={interpreted}");
                let actual = vm.oracle_snapshot(frame);
                let known_removed_early = name.starts_with("delete-") && frame == 8;
                assert_eq!(
                    actual["actors"].as_object().unwrap().len(),
                    expected["sprites"].as_object().unwrap().len()
                        - usize::from(known_removed_early),
                    "{context}/actor-count"
                );
                for (id, value) in expected["variables"].as_object().unwrap() {
                    assert_eq!(
                        actual["variables"][id].as_f64(),
                        value.as_f64(),
                        "{context}/{id}"
                    );
                }
                for (id, expected) in expected["sprites"].as_object().unwrap() {
                    let matched = if id.ends_with("#clone") {
                        let origin = id.trim_end_matches("#clone");
                        sprites
                            .iter()
                            .find(|(key, _)| key.starts_with(origin) && key.as_str() != origin)
                            .map(|(_, state)| *state)
                    } else {
                        sprites.get(id).copied()
                    };
                    // Shared clone disposal is immediate; the offline player
                    // defers removal one update. Explicitly pin this known gap.
                    if name.starts_with("delete-") && frame == 8 && id.ends_with("#clone") {
                        assert!(matched.is_none(), "known boundary changed: {context}/{id}");
                        continue;
                    }
                    let (visible, opacity) =
                        matched.unwrap_or_else(|| panic!("missing {context}/{id}: {sprites:?}"));
                    assert_eq!(
                        visible,
                        expected["visible"].as_bool().unwrap(),
                        "{context}/{id}"
                    );
                    let wanted = expected["opacity"].as_f64().unwrap();
                    assert!(
                        (opacity - wanted).abs() < 1e-6,
                        "{context}/{id}: {opacity} != {wanted}"
                    );
                }
            }
        }
    }
}
