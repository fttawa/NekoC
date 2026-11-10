use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn step(vm: &mut Engine, dt: f64) -> nekoc::engine::Frame {
    vm.advance(dt, 100_000, Duration::from_secs(2)).unwrap()
}
fn chain(nodes: Vec<Value>) -> Value {
    nodes.into_iter().rev().fold(Value::Null, |next, mut node| {
        if !next.is_null() {
            node["next"] = next;
        }
        node
    })
}
fn audio(kind: &str, target: Value) -> Value {
    json!({"type":kind,"inputs":{"audio_id":target}})
}
fn text(value: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":value}})
}
fn number(value: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":value}})
}
fn log() -> Value {
    json!({"type":"console_log","inputs":{"console_log":text("done")}})
}
fn property(rate: bool, change: bool, value: f64) -> Value {
    json!({"type":if change {"change_volume_or_rate_2"} else {"set_volume_or_rate_2"},
        "fields":{"audio_key":if rate {"rate"} else {"volume"}},
        "inputs":{"audio":text("s"),"audio_value":number(value)}})
}
fn project(body: Value) -> Value {
    let mut p = Document::blank().value().clone();
    p["audios"] = json!({"audiosDict":{"s":{"id":"s","name":"tone","duration":0.1,"playback_rate":2}},"sortList":["s"]});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":body}
    ]);
    p
}

#[test]
fn headless_audio_waits_use_duration_rate_and_simulation_time() {
    for target in [text("s"), text("tone"), number(1.49)] {
        for interpreter in [false, true] {
            let p = project(chain(vec![
                audio("play_audio_and_wait", target.clone()),
                log(),
            ]));
            let mut vm = Engine::new(Program::compile(&p).unwrap());
            if interpreter {
                vm.disable_jit();
            }
            vm.start();
            let first = step(&mut vm, 0.02);
            assert!(first.logs.is_empty());
            assert_eq!(first.audio_commands.len(), 1);
            assert!(step(&mut vm, 0.0).logs.is_empty());
            assert!(step(&mut vm, 0.02).logs.is_empty());
            assert!(step(&mut vm, 0.02).logs.is_empty());
            assert_eq!(step(&mut vm, 0.01).logs, ["done"]);
        }
    }
}

#[test]
fn browser_end_is_explicit_idempotent_and_old_callbacks_cannot_finish_a_restart() {
    let p = project(chain(vec![audio("play_audio_and_wait", text("s")), log()]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.use_browser_audio();
    vm.start();
    let id = step(&mut vm, 0.01).audio_commands[0].wait.unwrap();
    for _ in 0..10 {
        assert!(step(&mut vm, 0.25).logs.is_empty());
    }
    vm.audio_finished(id + 1);
    assert!(step(&mut vm, 0.01).logs.is_empty());
    vm.audio_finished(id);
    vm.audio_finished(id);
    assert_eq!(step(&mut vm, 0.01).logs, ["done"]);
    vm.start();
    let next = step(&mut vm, 0.01).audio_commands[0].wait.unwrap();
    assert_ne!(next, id);
    vm.audio_finished(id);
    assert!(step(&mut vm, 0.01).logs.is_empty());
    vm.audio_finished(next);
    assert_eq!(step(&mut vm, 0.01).logs, ["done"]);
}

#[test]
fn stop_all_releases_all_overlapping_waits_in_cli_and_browser() {
    for browser in [false, true] {
        let mut p = project(chain(vec![audio("play_audio_and_wait", text("s")), log()]));
        let roots = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
            .as_array_mut()
            .unwrap();
        roots.push(roots[0].clone());
        roots.push(
            json!({"type":"on_running_group_activated","next":audio("stop_audio",text("all_audio"))}),
        );
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if browser {
            vm.use_browser_audio();
        }
        vm.start();
        let first = step(&mut vm, 0.01);
        assert_eq!(first.audio_commands.len(), 3);
        assert_eq!(step(&mut vm, 0.0).logs, ["done", "done"]);
    }
}

#[test]
fn missing_headless_audio_is_finite_and_owned_inline_wave_has_real_duration() {
    let p = project(chain(vec![
        audio("play_audio_and_wait", text("missing")),
        log(),
    ]));
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    assert!(step(&mut vm, 0.0).logs[0].contains("时长未知"));
    assert_eq!(step(&mut vm, 0.0).logs, ["done"]);
    for (source, k4) in [
        (include_str!("fixtures/audio.bcmkn"), false),
        (include_str!("fixtures/kitten4/audio.bcm"), true),
    ] {
        let p: Value = serde_json::from_str(source).unwrap();
        let p = if k4 {
            nekoc::kitten4::to_neko(&p).unwrap().into_value()
        } else {
            p
        };
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        step(&mut vm, 0.0);
        let ticks = if k4 { 5 } else { 10 };
        for _ in 1..ticks {
            assert!(step(&mut vm, 0.01).logs.is_empty());
            if k4 {
                assert_eq!(vm.variable_text("audio-after"), "0");
            }
        }
        let last = step(&mut vm, 0.01);
        if k4 {
            assert_eq!(vm.variable_text("audio-after"), "1");
        } else {
            assert_eq!(last.logs, ["audio finished"]);
        }
    }
}

#[test]
fn speech_config_is_serialized_and_cli_does_not_invent_a_duration() {
    let p = project(chain(vec![
        json!({"type":"sound_color","fields":{"sound_color_per":"3"},"mutation":"<mutation sound_color_speed=\"7\" sound_color_pitch=\"12\" sound_color_volume=\"5\"/>"}),
        json!({"type":"play_word_audio_wait","inputs":{"text":text("Hello")}}),
        log(),
    ]));
    for browser in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if browser {
            vm.use_browser_audio();
        }
        vm.start();
        let f = step(&mut vm, 0.01);
        let speech = &f.speech_commands[0];
        assert_eq!(speech.config, [3.0, 7.0, 12.0, 5.0]);
        assert_eq!(speech.text, "Hello");
        if browser {
            assert!(f.logs.is_empty());
            vm.audio_finished(speech.wait.unwrap());
            assert_eq!(step(&mut vm, 0.01).logs, ["done"]);
        } else {
            assert!(speech.wait.is_none());
            assert_eq!(f.logs, ["done"]);
        }
    }
}

#[test]
fn headless_rate_changes_apply_mid_play_and_restart_restores_resource_defaults() {
    let mut p = project(chain(vec![audio("play_audio_and_wait", text("s")), log()]));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"].as_array_mut().unwrap().push(
        json!({"type":"on_keydown","fields":{"key":"65","type":"down"},"next":property(true,false,400.0)})
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.start();
    step(&mut vm, 0.0);
    assert!(step(&mut vm, 0.02).logs.is_empty()); // .04 seconds of source consumed
    vm.key("65");
    step(&mut vm, 0.0);
    assert!(step(&mut vm, 0.01).logs.is_empty()); // .04 more at rate 4
    assert_eq!(step(&mut vm, 0.005).logs, ["done"]);
    vm.start();
    step(&mut vm, 0.0);
    assert!(step(&mut vm, 0.025).logs.is_empty());
    assert_eq!(step(&mut vm, 0.025).logs, ["done"]); // initial rate 2 restored
}

#[test]
fn rate_clamps_in_vm_not_just_the_viewer_and_tiny_tick_coalescing_adds_no_time() {
    for (rate, ticks) in [(0.0, 200), (900.0, 3)] {
        let p = project(chain(vec![
            property(true, false, rate),
            audio("play_audio_and_wait", text("s")),
            log(),
        ]));
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        step(&mut vm, 0.0);
        for _ in 0..20 {
            assert!(
                vm.advance_with(0.0, 100_000, Duration::from_secs(2), 100)
                    .unwrap()
                    .logs
                    .is_empty()
            );
        }
        for _ in 1..ticks {
            assert!(step(&mut vm, 0.01).logs.is_empty());
        }
        assert_eq!(step(&mut vm, 0.01).logs, ["done"]);
    }
}

#[test]
fn cancelling_a_waiting_script_stops_its_resource_not_unrelated_audio() {
    let mut p = project(chain(vec![audio("play_audio_and_wait", text("s")), log()]));
    p["audios"]["audiosDict"]["other"] = json!({"id":"other","duration":1});
    p["audios"]["sortList"] = json!(["s", "other"]);
    let roots = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap();
    roots.push(
        json!({"type":"on_keydown","fields":{"key":"65","type":"down"},"next":
        {"type":"stop","fields":{"scope":"2"}}}),
    );
    roots.push(
        json!({"type":"on_running_group_activated","next":audio("play_audio",text("other"))}),
    );
    let mut vm = Engine::new(Program::compile(&p).unwrap());
    vm.use_browser_audio();
    vm.start();
    step(&mut vm, 0.0);
    vm.key("65");
    let frame = step(&mut vm, 0.0);
    assert_eq!(frame.audio_commands.len(), 1);
    assert!(!frame.audio_commands[0].play);
    assert_eq!(frame.audio_commands[0].audio.text(), "s");
    assert!(step(&mut vm, 0.2).logs.is_empty());
}
