//! Standalone policy contract: no shared Cargo build is required to run this.
//! Native VM lowering remains the parent session's explicit integration step.
#[path = "../src/engine/kn_ai.rs"]
mod kn_ai;
use kn_ai::{CacheEffect, Profile, Rejection, classifier_reporter, command};

const PROFILE: Profile = Profile::OfflineAnonymous;

#[test]
fn chat_rejections_preserve_input_evaluation_contract_and_different_cache_effects() {
    let ask = command(PROFILE, "ai_chat_ask", "").unwrap();
    assert_eq!(ask.value_socket, Some("text"));
    assert_eq!(ask.reason, Rejection::Offline);
    assert_eq!(ask.cache, CacheEffect::ClearChatAnswer);
    let preset = command(PROFILE, "set_system_preset", "").unwrap();
    assert_eq!(preset.value_socket, Some("text"));
    assert_eq!(preset.cache, CacheEffect::Preserve);
    let new_chat = command(PROFILE, "new_conversation", "").unwrap();
    assert_eq!(new_chat.value_socket, None);
    assert_eq!(new_chat.cache, CacheEffect::Preserve);
}

#[test]
fn ocr_rejects_before_sprite_and_camera_access_and_invalidates_the_result() {
    for name in ["ai_text_actor", "ai_text_photo"] {
        let c = command(PROFILE, name, "").unwrap();
        assert_eq!(c.value_socket, None);
        assert_eq!(c.reason, Rejection::Offline);
        assert_eq!(c.cache, CacheEffect::InvalidateTextResult);
    }
}

#[test]
fn cognitive_blocks_require_login_even_when_the_browser_is_offline() {
    for name in [
        "enable_face_detect_by_actor",
        "enable_face_detect_by_photo",
        "enable_object_detect_by_actor",
        "enable_object_detect_by_photo",
    ] {
        let c = command(PROFILE, name, "").unwrap();
        assert_eq!(c.value_socket, None);
        assert_eq!(c.reason, Rejection::LoginRequired);
        assert_eq!(c.cache, CacheEffect::Preserve);
    }
}

#[test]
fn classifier_missing_model_precedes_offline_and_name_keeps_numeric_nan() {
    for name in ["evaluate_actor_style", "evaluate_camera", "evaluate_photo"] {
        assert_eq!(
            command(PROFILE, name, "?").unwrap().reason,
            Rejection::MissingModel
        );
        assert_eq!(
            command(PROFILE, name, "authored-model").unwrap().reason,
            Rejection::Offline
        );
    }
    for name in ["get_evaluate_class_name", "get_evaluate_class_accuracy"] {
        assert!(classifier_reporter(PROFILE, name).unwrap().is_nan());
        assert_eq!(command(PROFILE, name, "?"), None);
    }
}

#[test]
fn unrelated_network_camera_and_result_blocks_are_not_silently_claimed() {
    for name in [
        "translate_result",
        "open_close_webcam",
        "ai_chat_answer",
        "ai_text_result",
        "get_face_detection_result",
        "get_object_detection_result",
        "voice_recognition",
        "unknown",
    ] {
        assert_eq!(command(PROFILE, name, "?"), None, "{name}");
        assert_eq!(classifier_reporter(PROFILE, name), None, "{name}");
    }
}
