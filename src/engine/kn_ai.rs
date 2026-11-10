//! Official KN 0.27.4 AI rejection branches, NOT an AI backend.
//!
//! Evidence: docs/kn-panel-ai.md and kn-panel-ai-evidence.json. This module
//! intentionally has no default profile: the caller must opt into anonymous,
//! browser-offline execution and retain the rejection reason. Online requests,
//! authenticated recognition and prediction must never use this shortcut.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Profile {
    OfflineAnonymous,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Rejection {
    Offline,
    LoginRequired,
    MissingModel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CacheEffect {
    /// ai_chat_ask clears _ai_chat_answer_ even when the offline guard rejects.
    ClearChatAnswer,
    /// OCR writes Number(NaN), not an empty string, before returning.
    InvalidateTextResult,
    /// In particular, new_conversation does NOT clear the answer in this branch.
    Preserve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct RejectedCommand {
    /// Evaluate this value socket exactly once BEFORE applying the rejection.
    /// Dynamic dropdowns (sprite/model_id) are fields, not value sockets.
    pub value_socket: Option<&'static str>,
    pub reason: Rejection,
    pub cache: CacheEffect,
}

/// The command's official Promise resolves to undefined, but the rejection
/// (toast/login/error) is observable. A caller must not call this "successful AI".
/// `model_id` is only used by classifier blocks. Unknown block types return None.
pub(super) fn command(
    profile: Profile,
    block_type: &str,
    model_id: &str,
) -> Option<RejectedCommand> {
    let Profile::OfflineAnonymous = profile;
    use CacheEffect::*;
    use Rejection::*;
    let (value_socket, reason, cache) = match block_type {
        "ai_chat_ask" => (Some("text"), Offline, ClearChatAnswer),
        "set_system_preset" => (Some("text"), Offline, Preserve),
        "new_conversation" => (None, Offline, Preserve),
        "ai_text_actor" | "ai_text_photo" => (None, Offline, InvalidateTextResult),
        "enable_face_detect_by_actor"
        | "enable_face_detect_by_photo"
        | "enable_object_detect_by_actor"
        | "enable_object_detect_by_photo" => (None, LoginRequired, Preserve),
        "evaluate_actor_style" | "evaluate_camera" | "evaluate_photo" => (
            None,
            if model_id == "?" {
                MissingModel
            } else {
                Offline
            },
            Preserve,
        ),
        _ => return None,
    };
    Some(RejectedCommand {
        value_socket,
        reason,
        cache,
    })
}

/// Both classifier reporters return NUMBER NaN in the explicit offline profile,
/// including get_evaluate_class_name (declared String). `index` is an optional
/// value socket controlled by mutation items=1. It must still be evaluated by
/// the caller; absence has official default 1. There is no implicit backend or
/// model load in this function. Source checks device/model/index before offline.
pub(super) fn classifier_reporter(profile: Profile, block_type: &str) -> Option<f64> {
    let Profile::OfflineAnonymous = profile;
    match block_type {
        "get_evaluate_class_name" | "get_evaluate_class_accuracy" => Some(f64::NAN),
        _ => None,
    }
}
