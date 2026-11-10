// 独立 helper 门禁，不依赖主会话接入 engine.rs，也不运行全量 Cargo。
#[path = "../src/engine/kn_capture.rs"]
mod kn_capture;
use kn_capture::*;

#[test]
fn six_types_have_precise_shared_operations_and_unknown_stays_unsupported() {
    for name in ["open_close_webcam", "open_hide_camera"] {
        assert_eq!(block(name), Some(Block::CameraStatus));
    }
    for name in ["set_camera_alpha", "set_webcam_alpha"] {
        assert_eq!(block(name), Some(Block::CameraAlpha));
    }
    assert_eq!(block("get_voice_volume"), Some(Block::VoiceVolume));
    assert_eq!(block("voice_recognition"), Some(Block::VoiceRecognition));
    assert_eq!(block("get_voice_answer"), None);
    assert_eq!(block("evaluate_camera"), None);
}

#[test]
fn official_field_values_are_not_k4_language_or_hide_aliases() {
    assert_eq!(CameraSwitch::parse("turn_on"), Some(CameraSwitch::On));
    assert_eq!(CameraSwitch::parse("turn_off"), Some(CameraSwitch::Off));
    assert_eq!(CameraSwitch::parse("hide"), None);
    assert_eq!(Language::parse("zh"), Some(Language::Chinese));
    assert_eq!(Language::parse("en"), Some(Language::English));
    assert_eq!(Language::parse("zh-hans"), None);
}

#[test]
fn alpha_uses_number_only_and_preserves_state_on_invalid_values() {
    let mut capture = OfflineCapture::default();
    assert_eq!(capture.camera_alpha(), 0.6);
    assert_eq!(capture.set_alpha(Some(37.5)).notice, None);
    assert_eq!(capture.camera_alpha(), 0.375);
    for value in [None, Some(f64::NAN)] {
        assert_eq!(capture.set_alpha(value).notice, Some(Notice::IgnoredAlpha));
        assert_eq!(capture.camera_alpha(), 0.375);
    }
}

#[test]
fn alpha_clamps_infinities_instead_of_rejecting_all_nonfinite_numbers() {
    let mut capture = OfflineCapture::default();
    for (input, expected) in [
        (-10.0, 0.0),
        (0.0, 0.0),
        (100.0, 1.0),
        (150.0, 1.0),
        (f64::INFINITY, 1.0),
        (f64::NEG_INFINITY, 0.0),
    ] {
        capture.set_alpha(Some(input));
        assert_eq!(capture.camera_alpha(), expected);
    }
}

#[test]
fn already_closed_does_not_reset_alpha_and_open_is_never_claimed_successful() {
    let mut capture = OfflineCapture::default();
    capture.set_alpha(Some(37.5));
    assert_eq!(
        capture.set_camera(CameraSwitch::Off),
        Ok(Deferred {
            value: (),
            notice: None
        })
    );
    assert_eq!(capture.camera_alpha(), 0.375);
    assert_eq!(
        capture.set_camera(CameraSwitch::On),
        Err(Unsupported::Camera)
    );
    assert_eq!(capture.camera_alpha(), 0.375);
}

#[test]
fn default_profile_does_not_forge_volume_zero_or_nan_from_absent_permissions() {
    let capture = OfflineCapture::default();
    assert_eq!(
        capture.voice_volume(Profile::default()),
        Err(Unsupported::Microphone)
    );
    let busy = capture
        .voice_volume(Profile {
            record_enabled: false,
            authenticated: false,
        })
        .unwrap();
    assert!(busy.value.is_nan());
    assert_eq!(busy.notice, Some(Notice::RecordBusy));
}

#[test]
fn recognition_selects_busy_before_login_and_never_synthesizes_recognized_text() {
    let capture = OfflineCapture::default();
    for language in [Language::Chinese, Language::English] {
        assert_eq!(
            capture
                .recognize(Profile::default(), language)
                .unwrap()
                .notice,
            Some(Notice::LoginRequired)
        );
        assert_eq!(
            capture
                .recognize(
                    Profile {
                        record_enabled: false,
                        authenticated: true
                    },
                    language
                )
                .unwrap()
                .notice,
            Some(Notice::RecordBusy)
        );
        assert_eq!(
            capture.recognize(
                Profile {
                    record_enabled: true,
                    authenticated: true
                },
                language
            ),
            Err(Unsupported::Recognition)
        );
    }
}
