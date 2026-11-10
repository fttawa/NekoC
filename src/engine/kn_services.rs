//! Explicit KN desktop/offline capability profile, not a service implementation.
//!
//! Official 0.27.4 source and live-call evidence: docs/kn-async-services.md.
//! Only use this profile while no account, microphone recognition or body
//! detector backend is installed. Do not route AI/network commands through it.

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum OfflineValue {
    Number(f64),
    Boolean(bool),
    Text(&'static str),
}

/// Reporters whose unavailable-backend branch has official source + live-call
/// evidence. `None` means unsupported, NOT an implicit zero/empty/false value.
/// All supported reporters have fields only, so no value socket is discarded.
pub(super) fn reporter(block_type: &str) -> Option<OfflineValue> {
    use OfflineValue::*;
    Some(match block_type {
        "get_orientation" => Number(0.0),
        "username_get" => Text("未登录用户"),
        // Despite its declared Number output, official runtime returns a string.
        "user_id_get" => Text("0"),
        "get_voice_answer" => Text(""),
        "recognize_body_part"
        | "recognize_gesture"
        | "bump_into_body_part"
        | "check_tilt_direction_of_face" => Boolean(false),
        "get_position_of_body_part" | "get_appearance_of_part" | "get_tilt_angle_of_face" => {
            Number(f64::NAN)
        }
        _ => return None,
    })
}

/// These two motion operations explicitly return without modifying the actor
/// when the detector has no central point. They do not open the camera.
pub(super) fn no_detection_command(block_type: &str) -> bool {
    matches!(block_type, "move_to_body_part" | "face_to_body_part")
}
