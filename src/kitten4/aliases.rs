// Legacy names registered by official player_v2 webpack module Tn6a/F, lt,
// and oiyH. Keep them opaque for export; normalize only at the VM boundary.
use super::*;

pub(super) fn lower_legacy_alias(block: &mut Value, targets: &Targets) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE);
    let renamed = match kind {
        "self_change_x" | "self_change_y" | "self_glide_x" | "self_glide_y" => {
            let axis = if kind.ends_with('x') { "x" } else { "y" };
            let glide = kind.starts_with("self_glide");
            put_field(block, "coordinary", axis);
            put_field(block, "increase", "increase");
            if glide {
                "self_glide_coordinate"
            } else {
                "self_change_coordinate"
            }
        }
        "self_set_x" | "self_set_y" => {
            let axis = if kind.ends_with('x') { "x" } else { "y" };
            inputs(block, &[(axis, "value")], false);
            put_field(block, "coordinary", axis);
            "self_set_position"
        }
        "self_change_position" => "self_set_position",
        "self_glide_position" => {
            put_field(block, "increase", "increase");
            "self_glide_coordinate"
        }
        "self_gradually_appear" | "self_gradually_disappear" => {
            let show = kind == "self_gradually_appear";
            put_field(block, "is_show", if show { "show" } else { "hide" });
            "self_gradually_show_hide"
        }
        "self_change_scale"
        | "add_width_height_scale"
        | "self_change_effect"
        | "self_change_effect_2" => {
            let renamed = match kind {
                "self_change_scale" => "self_change_scale_2",
                "add_width_height_scale" => "add_width_height_scale_2",
                _ => "self_change_effect_3",
            };
            put_field(block, "increase", "increase");
            renamed
        }
        "self_set_effect" => "self_set_effect_2",
        "set_top" => {
            put_field(block, "layer", "peak");
            "set_theatre_layer"
        }
        "self_next_style" => {
            put_field(block, "prev_or_next", "next");
            "self_prev_next_style"
        }
        "set_costume_by_index" => "set_costume",
        "set_costume_by_id" => {
            // Preserve the typed dynamic input and field priority. The legacy
            // ID command has different actor/scene rules from name/index style.
            block["type"] = json!("kitten4_legacy_costume");
            return true;
        }
        "get" => "get_3",
        "multiline_text" => "text",
        // Do not alias get_choice: official lt deliberately drops the result.
        _ => return false,
    };
    block["type"] = json!(renamed);
    // translate handles coordinate sockets; other aliases use opaque lowering.
    if !translate(block, false).unwrap_or(false) {
        block["type"] = json!(format!("{OPAQUE}{renamed}"));
        lower_block(block, targets);
    }
    true
}
