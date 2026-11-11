//! Media/device spellings remain native and opaque until VM lowering.
//! Evidence and host-service boundaries: docs/kitten4-third-media.md.
use super::*;

pub(super) fn lower_media_devices(block: &mut Value) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE);
    if !matches!(
        kind,
        "display_recognition_result"
            | "get_recognition_result"
            | "get_voice_answer"
            | "midi_get"
            | "midi_play_note"
            | "midi_play_num_note"
            | "midi_wait"
            | "on_mobile_click_btn"
            | "on_mobile_shake"
            | "on_mobile_slide"
            | "on_mobile_slope"
            | "on_shake"
            | "on_tilt"
            | "play_ask_record"
            | "self_ask_listen"
            | "self_ask_record"
            | "set_speaking_language"
            | "shock_duration"
            | "shock_for_n_times"
            | "translate"
            | "translate_result"
            | "turn_on_the_camera"
            | "turn_on_the_qrcode_camera"
            | "voice_recognition"
    ) {
        return false;
    }
    let lowered = format!("kitten4_media_{kind}");
    if kind == "on_mobile_click_btn"
        && (block["statements"]["DO"].is_object() || block["next"].is_object())
    {
        // Tn6a/Wt installs this domain with restart_when_finished, not as a
        // Dynamic responder. Reuse the existing single-flight K4 when loop.
        let id = block["id"].as_str().unwrap_or_default().to_owned();
        let condition = json!({"id":format!("{id}-condition"),"type":lowered,
            "fields":block["fields"],"inputs":block["inputs"],"is_output":true});
        let body = block["statements"]
            .get("DO")
            .filter(|v| v.is_object())
            .cloned()
            .or_else(|| block.get("next").cloned())
            .unwrap_or(Value::Null);
        *block = json!({"id":id,"type":"on_running_group_activated","next":{
            "id":format!("{id}-loop"),"type":"repeat_forever","statements":{"DO":{
                "id":format!("{id}-wait"),"type":"wait_until","inputs":{"condition":condition},"next":body}}}});
        return true;
    }
    if matches!(
        kind,
        "midi_get"
            | "get_voice_answer"
            | "get_recognition_result"
            | "translate_result"
            | "on_mobile_click_btn"
    ) {
        block["is_output"] = json!(true);
    }
    block["type"] = json!(lowered);
    true
}
