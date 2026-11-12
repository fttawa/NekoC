//! Local old-algorithm equivalence checks, not official-runtime evidence.
use crate::engine::*;

fn engine() -> Engine {
    let project = crate::studio::document::Document::blank().value().clone();
    let mut e = Engine::new(Program::compile(&project).unwrap());
    e.disable_jit();
    let sprite = e.sprites[1].clone();
    e.sprites = vec![sprite.clone(), sprite];
    e.program.costume_turn = 0.0;
    for (i, sprite) in e.sprites.iter_mut().enumerate() {
        sprite.style = Some(format!("collision-{i}"));
        sprite.text = None;
        sprite.x = 0.0;
        sprite.y = 0.0;
        sprite.direction = 0.0;
        sprite.rotation_type = 0;
        sprite.scale = 100.0;
        sprite.size_x = 100.0;
        sprite.size_y = 100.0;
        sprite.flip_x = false;
        sprite.flip_y = false;
        e.program.costumes.insert(
            format!("collision-{i}"),
            Costume {
                width: 12.0,
                height: 8.0,
                ..Costume::default()
            },
        );
    }
    e
}

// Freeze the pre-refactor contains and overlap bodies, including bounds fallback,
// half-open UV limits, the sample cap and short-circuit order. In particular this
// must not call the new CostumeGeometry::contains helper.
fn old_contains(e: &Engine, i: usize, x: f64, y: f64) -> bool {
    let Some(geometry) = e.geometry(i) else {
        return false;
    };
    let Some((u, v)) = geometry.uv(x, y) else {
        return false;
    };
    if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
        return false;
    }
    match &geometry.costume.mask {
        None => true,
        Some((mw, mh, bits)) => {
            let (px, py) = ((u * *mw as f64) as usize, (v * *mh as f64) as usize);
            let bit = py * mw + px;
            bits.get(bit / 8)
                .is_some_and(|byte| byte >> (bit % 8) & 1 == 1)
        }
    }
}

fn old_overlap(e: &Engine, a: usize, b: usize) -> bool {
    let (al, ar, ab, at) = e.bounds(a);
    let (bl, br, bb, bt) = e.bounds(b);
    let (l, r, bottom, t) = (al.max(bl), ar.min(br), ab.max(bb), at.min(bt));
    if l > r || bottom > t {
        return false;
    }
    let nx = ((r - l).ceil() as usize).clamp(1, 64);
    let ny = ((t - bottom).ceil() as usize).clamp(1, 64);
    for iy in 0..ny {
        let y = bottom + (iy as f64 + 0.5) * (t - bottom) / ny as f64;
        for ix in 0..nx {
            let x = l + (ix as f64 + 0.5) * (r - l) / nx as f64;
            if old_contains(e, a, x, y) && old_contains(e, b, x, y) {
                return true;
            }
        }
    }
    false
}

fn check(e: &Engine, label: &str) {
    // Test both orders rather than assuming that a sampled overlap is symmetric.
    for (a, b) in [(0, 1), (1, 0), (0, 0), (1, 1)] {
        assert_eq!(e.overlap(a, b), old_overlap(e, a, b), "{label}: {a}/{b}");
        for (x, y) in [
            (0.0, 0.0),
            (-6.0, 4.0),
            (6.0, -4.0),
            (1.125, -2.75),
            (f64::NAN, 0.0),
            (0.0, f64::INFINITY),
        ] {
            assert_eq!(
                e.contains(a, x, y),
                old_contains(e, a, x, y),
                "{label}: contains {a} at {x}/{y}"
            );
        }
    }
}

#[test]
fn reused_geometry_matches_old_positions_transforms_and_masks() {
    let mut e = engine();
    let masks = [
        None,
        Some((4, 4, vec![0xff, 0xff])),
        Some((4, 4, vec![0x00, 0x00])),
        Some((4, 4, vec![0x96, 0x69])),
        Some((4, 4, vec![0x01])), // Truncated mask remains non-hittable outside it.
        Some((0, 0, vec![])),
    ];
    for (mi, mask) in masks.iter().enumerate() {
        e.program.costumes.get_mut("collision-0").unwrap().mask = mask.clone();
        e.program.costumes.get_mut("collision-1").unwrap().mask = Some((4, 4, vec![0x69, 0x96]));
        for (x, y) in [(0.0, 0.0), (2.125, -1.75), (12.0, 0.0), (40.0, -20.0)] {
            e.sprites[1].x = x;
            e.sprites[1].y = y;
            for (scale, size_x, size_y) in [
                (100.0, 100.0, 100.0),
                (25.0, 130.0, 70.0),
                (-80.0, 100.0, -60.0),
                (1500.0, 100.0, 100.0), // Exercises the 64-sample cap.
            ] {
                e.sprites[0].scale = scale;
                e.sprites[0].size_x = size_x;
                e.sprites[0].size_y = size_y;
                for (rotation_type, direction, flip_x, flip_y) in [
                    (0, 0.0, false, false),
                    (0, 37.0, true, false),
                    (0, -123.0, false, true),
                    (0, 450.0, true, true),
                    (1, -90.0, false, false),
                    (1, 90.0, true, true),
                    (2, 37.0, false, false),
                ] {
                    let a = &mut e.sprites[0];
                    a.rotation_type = rotation_type;
                    a.direction = direction;
                    a.flip_x = flip_x;
                    a.flip_y = flip_y;
                    check(
                        &e,
                        &format!(
                            "mask {mi}, {x}/{y}, scale {scale}, rotation {rotation_type}/{direction}, flips {flip_x}/{flip_y}"
                        ),
                    );
                }
            }
        }
    }
}

#[test]
fn reused_geometry_matches_old_missing_degenerate_and_nonfinite_cases() {
    let mut e = engine();
    assert!(e.overlap(0, 1));
    e.sprites[1].x = 12.0;
    assert!(!e.overlap(0, 1)); // Merely touching half-open rectangle edges.
    check(&e, "touching edges");
    let mut missing = engine();
    missing.sprites[0].style = None;
    missing.sprites[1].style = None;
    check(&missing, "both costumes missing");
    for side in 0..2 {
        for missing in [None, Some("absent-costume".to_owned())] {
            let mut e = engine();
            e.sprites[side].style = missing;
            check(&e, "missing costume");
            assert!(!e.overlap(0, 1));
        }
        for value in [0.0, -0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for field in 0..9 {
                let mut e = engine();
                let a = &mut e.sprites[side];
                match field {
                    0 => a.x = value,
                    1 => a.y = value,
                    2 => a.scale = value,
                    3 => a.size_x = value,
                    4 => a.size_y = value,
                    5 => a.direction = value,
                    6 => {
                        e.program
                            .costumes
                            .get_mut(&format!("collision-{side}"))
                            .unwrap()
                            .width = value;
                    }
                    7 => {
                        e.program
                            .costumes
                            .get_mut(&format!("collision-{side}"))
                            .unwrap()
                            .height = value;
                    }
                    _ => {
                        e.program
                            .costumes
                            .get_mut(&format!("collision-{side}"))
                            .unwrap()
                            .center_point = [value, value];
                    }
                }
                check(&e, &format!("side {side}, field {field}, value {value}"));
            }
            // Nonfinite direction is ignored by the no-rotation and left/right
            // modes. Do not introduce an eager finite-value rejection.
            for rotation_type in [1, 2] {
                let mut e = engine();
                e.sprites[side].direction = value;
                e.sprites[side].rotation_type = rotation_type;
                check(&e, "nonfinite direction without free rotation");
            }
            let mut e = engine();
            e.program.costume_turn = value;
            check(&e, "degenerate or nonfinite costume turn");
        }
    }
}

#[test]
fn reused_geometry_matches_old_pivots_costume_turn_and_text() {
    let mut e = engine();
    e.program.costume_turn = 90.0;
    e.program
        .costumes
        .get_mut("collision-0")
        .unwrap()
        .center_point = [3.0, -2.0];
    e.program
        .costumes
        .get_mut("collision-1")
        .unwrap()
        .center_point = [-1.5, 4.0];
    for direction in [-90.0, 0.0, 45.0, 180.0] {
        e.sprites[0].direction = direction;
        check(&e, "offset pivots and costume turn");
    }
    e.sprites[0].style = None;
    for size in [12.0, 0.0, f64::NAN, f64::INFINITY] {
        e.sprites[0].text = Some(SpriteText {
            text: "ab中\ntext".into(),
            size,
            color: "#ffffff".into(),
        });
        check(&e, "text replaces missing costume");
    }
}
