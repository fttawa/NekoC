use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn text(value: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":value}})
}
fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}
fn program(blocks: Vec<Value>) -> Program {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    let body = blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":body}
    ]);
    Program::compile(&p).unwrap()
}
fn tick(vm: &mut Engine) -> Vec<String> {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
        .unwrap()
        .logs
}
fn ticks(vm: &mut Engine) -> Vec<String> {
    (0..10).flat_map(|_| tick(vm)).collect()
}
fn put(value: &str) -> Value {
    json!({"type":"_object_set","inputs":{"obj":{"type":"variables_get","fields":{"variable":"obj"}},"key":text("calls"),"value":text(value)}})
}
fn get() -> Value {
    json!({"type":"_object_get","inputs":{"obj":{"type":"variables_get","fields":{"variable":"obj"}},"key":text("calls")}})
}

#[test]
fn kn_translation_is_explicit_offline_failure_not_k4_echo_and_evaluates_inputs() {
    for jit in [false, true] {
        let mut vm = Engine::new(program(vec![
            log(
                json!({"type":"translate_result","inputs":{"text":put("text"),"language":put("language")}}),
            ),
            log(get()),
            json!({"type":"translate","inputs":{"text":put("command-text"),"language":put("command-language")}}),
            log(get()),
        ]));
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        assert_eq!(ticks(&mut vm), ["", "language", "command-language"]);
    }
}

#[test]
fn local_unpublished_rankings_return_numeric_nan_and_preserve_order_side_effect() {
    let mut vm = Engine::new(program(vec![
        log(json!({"type":"user_ranking_info","fields":{"ranking":"missing","type":"rank"}})),
        log(
            json!({"type":"user_info_of_th","fields":{"ranking":"missing","type":"username"},"inputs":{"order":put("order")}}),
        ),
        log(get()),
        json!({"type":"show_hide_ranking","fields":{"ranking":"missing","show_hide":"show"}}),
        json!({"type":"update_ranking","fields":{"ranking":"missing","variable":"missing-variable"}}),
        log(text("continued")),
    ]));
    vm.start();
    assert_eq!(ticks(&mut vm), ["NaN", "NaN", "order", "continued"]);
}

#[test]
fn capture_alpha_is_shared_typed_and_close_and_logged_out_voice_continue_later() {
    let mut vm = Engine::new(program(vec![
        json!({"type":"set_camera_alpha","inputs":{"camera_alpha":{"type":"math_number","fields":{"NUM":37.5}}}}),
        json!({"type":"set_webcam_alpha","inputs":{"camera_alpha":put("not-a-number")}}),
        json!({"type":"open_hide_camera","fields":{"camera_status":"turn_off"}}),
        json!({"type":"open_close_webcam","fields":{"camera_status":"turn_off"}}),
        json!({"type":"voice_recognition","fields":{"type":"zh"}}),
        log(json!({"type":"get_voice_answer"})),
        log(get()),
    ]));
    vm.start();
    assert!(tick(&mut vm).is_empty());
    assert_eq!(vm.kn_camera_alpha(), 0.375);
    assert_eq!(ticks(&mut vm), ["", "not-a-number"]);
    assert_eq!(vm.kn_camera_alpha(), 0.375);
    assert_eq!(
        vm.take_kn_panel_notices(),
        [
            nekoc::engine::PanelNotice::IgnoredCameraAlpha,
            nekoc::engine::PanelNotice::RecognitionLoginRequired
        ]
    );
}

#[test]
fn camera_open_remains_unsupported_but_microphone_has_explicit_unavailable_fallback() {
    {
        let block = json!({"type":"open_hide_camera","fields":{"camera_status":"turn_on"}});
        let mut p = Document::blank().value().clone();
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":block}
        ]);
        assert!(Program::compile(&p).is_err());
    }
    let mut vm = Engine::new(program(vec![log(json!({"type":"get_voice_volume"}))]));
    vm.start();
    assert!(ticks(&mut vm).is_empty(), "default permission is pending");
    vm.set_kn_voice_volume(None).unwrap();
    assert_eq!(ticks(&mut vm), ["NaN"]);
}

#[test]
fn ai_rejection_requires_opt_in_and_keeps_text_and_optional_index_effects() {
    let blocks = vec![
        json!({"type":"ai_chat_ask","inputs":{"text":put("ask")}}),
        log(get()),
        json!({"type":"set_system_preset","inputs":{"text":put("preset")}}),
        log(get()),
        json!({"type":"new_conversation"}),
        json!({"type":"ai_text_actor","fields":{"sprite":"missing-actor"}}),
        json!({"type":"ai_text_photo"}),
        json!({"type":"enable_face_detect_by_actor","fields":{"sprite":"missing-actor"}}),
        json!({"type":"enable_face_detect_by_photo"}),
        json!({"type":"enable_object_detect_by_actor","fields":{"sprite":"missing-actor"}}),
        json!({"type":"enable_object_detect_by_photo"}),
        json!({"type":"evaluate_actor_style","fields":{"sprite":"missing-actor","model_id":"?"}}),
        json!({"type":"evaluate_camera","fields":{"model_id":"?"}}),
        json!({"type":"evaluate_photo","fields":{"model_id":"not-a-real-model"}}),
        log(
            json!({"type":"get_evaluate_class_name","fields":{"model_id":"?"},"inputs":{"index":put("index")}}),
        ),
        log(get()),
        log(json!({"type":"get_evaluate_class_accuracy","fields":{"model_id":"?"}})),
        log(json!({"type":"ai_chat_answer"})),
        log(json!({"type":"ai_text_result"})),
    ];
    let mut not_enabled = Engine::new(program(blocks.clone()));
    not_enabled.start();
    assert!(
        not_enabled
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
            .is_err()
    );
    for jit in [false, true] {
        let mut vm = Engine::new(program(blocks.clone()));
        if !jit {
            vm.disable_jit();
        }
        vm.set_kn_offline_anonymous(true);
        vm.start();
        let logs: Vec<_> = (0..30).flat_map(|_| tick(&mut vm)).collect();
        assert_eq!(logs, ["ask", "preset", "NaN", "index", "NaN", "", "NaN"]);
        assert_eq!(
            vm.take_kn_panel_notices(),
            [
                nekoc::engine::PanelNotice::AiOffline,
                nekoc::engine::PanelNotice::AiLoginRequired,
                nekoc::engine::PanelNotice::AiMissingModel
            ]
        );
    }
}

#[test]
fn classifier_index_is_evaluated_per_read_in_hot_loop_and_keeps_number_nan_type() {
    let classifier = json!({"type":"get_evaluate_class_name","fields":{"model_id":"?"},"inputs":{"index":put("per-read")}});
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{"type":"repeat_n_times","inputs":{"times":{"type":"math_number","fields":{"NUM":100}}},"statements":{"DO":
            {"type":"console_log","inputs":{"console_log":{"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":classifier,"B":{"type":"math_number","fields":{"NUM":1}}}}},"next":log(get())}
        }}}
    ]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.set_kn_offline_anonymous(true);
        vm.start();
        let logs: Vec<_> = (0..120).flat_map(|_| tick(&mut vm)).collect();
        assert_eq!(logs, ["NaN", "per-read"].repeat(100));
    }
}

#[test]
fn editor_default_ai_and_camera_shadows_compile_on_the_panel_path() {
    let mut vm = Engine::new(program(vec![
        json!({"type":"ai_chat_ask","inputs":{"text":{"type":"limit_length_text","fields":{"TEXT":"你好"}}}}),
        json!({"type":"set_system_preset","inputs":{"text":{"type":"multiline_text","fields":{"TEXT":"提示词\n第二行"}}}}),
        json!({"type":"set_camera_alpha","inputs":{"camera_alpha":{"type":"camera_alpha_slider","fields":{"NUM":60}}}}),
        log(text("continued")),
    ]));
    vm.set_kn_offline_anonymous(true);
    vm.start();
    assert_eq!(ticks(&mut vm), ["continued"]);
    assert_eq!(vm.kn_camera_alpha(), 0.6);
}

#[test]
fn global_animation_waits_for_host_ack_and_stale_ids_do_not_resume_new_runs() {
    let mut vm = Engine::new(program(vec![
        json!({"type":"global_animation","fields":{"animation":"animation_salvo"}}),
        log(text("finished")),
    ]));
    vm.start();
    assert!(tick(&mut vm).is_empty());
    let first = vm.pending_kn_global_animations();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].animation, "animation_salvo");
    assert!(tick(&mut vm).is_empty());
    vm.start();
    assert!(tick(&mut vm).is_empty());
    let second = vm.pending_kn_global_animations();
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].id, second[0].id);
    vm.finish_kn_global_animation(first[0].id);
    assert!(tick(&mut vm).is_empty());
    vm.finish_kn_global_animation(second[0].id);
    assert_eq!(tick(&mut vm), ["finished"]);
    vm.finish_kn_global_animation(second[0].id);
    assert!(vm.pending_kn_global_animations().is_empty());
}
