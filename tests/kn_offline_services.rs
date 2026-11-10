//! Offline profile contract plus native engine integration.
#[path = "../src/engine/kn_services.rs"]
mod kn_services;
use kn_services::{OfflineValue, no_detection_command, reporter};

#[test]
fn unavailable_profile_preserves_typed_account_and_device_results() {
    assert_eq!(
        reporter("username_get"),
        Some(OfflineValue::Text("未登录用户"))
    );
    assert_eq!(reporter("user_id_get"), Some(OfflineValue::Text("0")));
    assert_eq!(reporter("get_voice_answer"), Some(OfflineValue::Text("")));
    assert_eq!(reporter("get_orientation"), Some(OfflineValue::Number(0.0)));
    for name in [
        "recognize_body_part",
        "recognize_gesture",
        "bump_into_body_part",
        "check_tilt_direction_of_face",
    ] {
        assert_eq!(reporter(name), Some(OfflineValue::Boolean(false)), "{name}");
    }
    for name in [
        "get_position_of_body_part",
        "get_appearance_of_part",
        "get_tilt_angle_of_face",
    ] {
        assert!(
            matches!(reporter(name), Some(OfflineValue::Number(n)) if n.is_nan()),
            "{name}"
        );
    }
    assert!(no_detection_command("move_to_body_part"));
    assert!(no_detection_command("face_to_body_part"));
}

#[test]
fn network_ai_permission_and_unknown_blocks_are_not_blanket_stubs() {
    for name in [
        "get_voice_volume",
        "voice_recognition",
        "ai_chat_ask",
        "ai_chat_answer",
        "new_conversation",
        "ai_text_result",
        "ai_text_result_check",
        "get_face_detection_result",
        "check_gender",
        "translate_result",
        "evaluate_camera",
        "user_ranking_info",
        "setTimeout",
        "unknown",
    ] {
        assert_eq!(reporter(name), None, "{name}");
        assert!(!no_detection_command(name), "{name}");
    }
}

#[test]
fn native_reporters_keep_types_inside_comparisons_numeric_inputs_and_commands() {
    use nekoc::{
        engine::{Engine, Program},
        studio::document::Document,
    };
    use serde_json::{Value, json};
    use std::time::Duration;
    fn log(value: Value) -> Value {
        json!({"type":"console_log","inputs":{"console_log":value}})
    }
    let reporter = |name: &str| json!({"type":name});
    let number = |n: f64| json!({"type":"math_number","fields":{"NUM":n}});
    let mut blocks = vec![];
    for name in [
        "username_get",
        "user_id_get",
        "get_voice_answer",
        "recognize_body_part",
        "recognize_gesture",
        "bump_into_body_part",
        "check_tilt_direction_of_face",
        "get_position_of_body_part",
        "get_appearance_of_part",
        "get_tilt_angle_of_face",
    ] {
        blocks.push(log(reporter(name)));
    }
    blocks.extend([
        log(json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":reporter("user_id_get"),"B":number(0.0)}})),
        log(json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":reporter("get_position_of_body_part"),"B":number(1.0)}})),
        json!({"type":"move_to_body_part"}), json!({"type":"face_to_body_part"}),
        log(json!({"type":"text","fields":{"TEXT":"continued"}})),
    ]);
    let chain = blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap();
    let mut p = Document::blank().value().clone();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"id":"offline-start","type":"on_running_group_activated","next":chain}
    ]);
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        let f = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(
            f.logs,
            [
                "未登录用户",
                "0",
                "",
                "false",
                "false",
                "false",
                "false",
                "NaN",
                "NaN",
                "NaN",
                "false",
                "NaN",
                "continued"
            ]
        );
    }
}

#[test]
fn unsupported_backends_are_still_diagnosed_in_executable_code() {
    use nekoc::{engine::Program, studio::document::Document};
    use serde_json::json;
    for name in [
        "get_voice_volume",
        "ai_chat_ask",
        "voice_recognition",
        "update_ranking",
        "microbit_temperature",
    ] {
        let mut p = Document::blank().value().clone();
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":{"type":"console_log","inputs":{"console_log":{"type":name}}}}
        ]);
        assert!(Program::compile(&p).is_err(), "{name}");
    }
}
