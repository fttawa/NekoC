use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn project() -> Value {
    let mut p: Value =
        serde_json::from_str(include_str!("fixtures/kitten4/visual-layers.bcm")).unwrap();
    p["theatre"]["videos"] = json!({"v":{"id":"v","url":"data:video/webm;base64,","x":17,"y":-9,"width":128,"height":96,"scale":2,"visible":false,"duration":0.1}});
    p
}
fn block(id: &str, kind: &str, fields: Value) -> Value {
    json!({"id":id,"type":kind,"fields":fields,"shadows":{},"mutation":""})
}
fn vm(steps: &[(&str, &str, Value)], jit: bool) -> Engine {
    let mut p = project();
    let ws = &mut p["theatre"]["actors"]["20000000-0000-4000-8000-000000000001"]["block_data_json"];
    ws["blocks"]["start"] = block("start", "start_on_click", json!({}));
    let mut previous = "start";
    for (id, kind, fields) in steps {
        ws["blocks"][id] = block(id, kind, fields.clone());
        ws["connections"][previous] = json!({(*id):{"type":"next"}});
        previous = id;
    }
    let canonical = kitten4::to_neko(&p).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), p);
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.use_virtual_clock();
    vm.start();
    vm
}
fn frame(vm: &mut Engine) -> nekoc::engine::Frame {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
        .unwrap()
}

#[test]
fn video_import_geometry_and_clock_are_deterministic_in_both_execution_modes() {
    for jit in [false, true] {
        let mut vm = vm(
            &[
                (
                    "show",
                    "show_hide_video",
                    json!({"video":"v","display":"show"}),
                ),
                ("play", "play_video", json!({"video":"v"})),
            ],
            jit,
        );
        let f = frame(&mut vm);
        let v = &f.videos[0];
        assert_eq!(
            (v.x, v.y, v.width, v.height, v.scale),
            (17.0, -9.0, 128.0, 96.0, 2.0)
        );
        assert!(v.visible && v.playing && v.played);
        assert_eq!(v.position, 0.0);
        for _ in 0..6 {
            frame(&mut vm);
        }
        let f = frame(&mut vm);
        assert!(f.videos[0].ended);
        assert!(!f.videos[0].playing);
        assert_eq!(f.videos[0].position, 0.1);
        let generation = f.videos[0].generation;
        vm.start();
        let f = frame(&mut vm);
        assert!(f.videos[0].generation > generation);
        assert_eq!(f.videos[0].position, 0.0);
    }
}

#[test]
fn video_wait_blocks_chain_until_end_and_missing_target_does_not_block() {
    for id in ["v", "missing"] {
        let mut vm = vm(
            &[
                ("play", "play_video_until_end", json!({"video":id})),
                (
                    "hide",
                    "show_hide_video",
                    json!({"video":"v","display":"show"}),
                ),
            ],
            true,
        );
        let f = frame(&mut vm);
        assert_eq!(f.videos[0].visible, id == "missing");
        for _ in 0..8 {
            frame(&mut vm);
        }
        assert!(frame(&mut vm).videos[0].visible);
    }
}

#[test]
fn continue_before_play_is_noop_and_pause_preserves_position() {
    let mut vm = vm(
        &[(
            "resume",
            "continue_pause_video",
            json!({"video":"v","option":"continue"}),
        )],
        true,
    );
    assert!(!frame(&mut vm).videos[0].playing);
    let mut vm = self::vm(
        &[
            ("play", "play_video", json!({"video":"v"})),
            (
                "pause",
                "continue_pause_video",
                json!({"video":"v","option":"pause"}),
            ),
        ],
        true,
    );
    for _ in 0..10 {
        let f = frame(&mut vm);
        assert_eq!(f.videos[0].position, 0.0);
        assert!(!f.videos[0].playing);
    }
}

#[test]
fn detached_pen_returns_below_video_after_crossing_and_scene_reattachment() {
    let mut initial = vm(&[], true);
    assert!(!frame(&mut initial).video_above_pen);
    let mut detached = vm(
        &[
            ("below", "set_layer_with_pen", json!({"position":"below"})),
            ("above", "set_layer_with_pen", json!({"position":"above"})),
        ],
        true,
    );
    let f = frame(&mut detached);
    assert_eq!(f.pen_layer, 0);
    assert!(f.video_above_pen);
}
