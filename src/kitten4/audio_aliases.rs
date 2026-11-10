// xQfl legacy audio corrections; the ordinary static aliases already live in
// lower_block. Keep the original spelling/payload opaque until VM lowering.
use super::*;

pub(super) fn lower_audio_alias(block: &mut Value, _targets: &Targets) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE);
    let dynamic_audio = block["inputs"].get("audio").is_some();
    let renamed = match kind {
        "play_audio" | "play_audio_and_wait" if dynamic_audio => {
            let wait = kind == "play_audio_and_wait";
            inputs(block, &[("audio", "audio_id")], false);
            if wait {
                "play_audio_and_wait"
            } else {
                "play_audio"
            }
        }
        "set_volume_or_rate" if dynamic_audio => "set_volume_or_rate_2",
        "change_volume_or_rate" => {
            // xQfl factory UTF-16 32400: the old entry never reads increase.
            // Its signed audio_value is added as-is, unlike the _2 entry.
            if !dynamic_audio {
                let audio = field(block, "audio").to_owned();
                if !block["inputs"].is_object() {
                    block["inputs"] = json!({});
                }
                block["inputs"]["audio"] = json!({"type":"text","fields":{"TEXT":audio}});
            }
            put_field(block, "increase", "increase");
            "change_volume_or_rate_2"
        }
        // Static play/set and stop_all_audios use the existing lower_block arms.
        _ => return false,
    };
    block["type"] = json!(renamed);
    true
}
