//! Additional K4 domains. Native spellings remain opaque until VM lowering.
use super::*;

pub(super) fn lower_common(block: &mut Value) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE);
    let renamed = match kind {
        "self_shake" => "kitten4_shake",
        // oiyH@2414: JS indexOf/lastIndexOf + 1, UTF-16 code-unit positions.
        "text_indexOf" => {
            if !matches!(field(block, "END"), "FIRST" | "LAST") {
                return false;
            }
            "kitten4_text_index"
        }
        // oiyH@2668 differs from default_value for the empty string.
        "text_implicit" => {
            if field(block, "TEXT").is_empty() {
                "text"
            } else {
                "kitten4_default_value"
            }
        }
        // oiyH@2546: JS +, not unconditional string concatenation. The existing
        // K4 arithmetic path retains number+number versus string coercion.
        "text_append" => {
            let variable = field(block, "VAR").to_owned();
            let text = block["inputs"]["TEXT"].clone();
            if text.is_null() {
                return false;
            }
            block["inputs"] = json!({"value":{"type":"math_arithmetic",
                "fields":{"type":"add"},"inputs":{
                    "A":{"type":"variables_get","fields":{"variable":variable}},
                    "B":text}}});
            put_field(block, "variable", &variable);
            "variables_set"
        }
        "days_after_2000" => "kitten4_days_after_2000", // oiyH@4181: UTC epoch, floor.
        // ojop/start_on_click recognizes both names. finish_roots records the
        // global-start marker before this VM-only rename.
        "start_on_click_2" => {
            if let Some(body) = block["statements"]
                .as_object_mut()
                .and_then(|s| s.remove("DO"))
            {
                block["next"] = body;
            }
            "on_running_group_activated"
        }
        // Tn6a@33009 forwards unchanged to create_stage_dialog.
        "show_stage_dialog" => "create_stage_dialog",
        // Qeyy/IF_BLOCKS and inF4/eval_cond share ordinary conditional handling.
        "controls_if_no_else" => "controls_if",
        // Tn6a@77993 binds the current entity rather than an actor dropdown.
        "self_on_tap" => {
            put_field(block, "sprite", "--self");
            "sprite_on_tap"
        }
        // Tn6a@42128: no orientation info on a desktop => 0, not sprite heading.
        "get_orientation" => {
            put_field(block, "NUM", "0");
            "math_number"
        }
        // Gt uses zero axes when no paired mobile answers. Unknown axes have
        // JS undefined semantics and deliberately remain unsupported.
        "get_mobile_slope_value" | "get_mobile_rocker_value" => {
            let axis = field(block, "coordinate");
            if !(matches!(axis, "x" | "y") || kind == "get_mobile_slope_value" && axis == "z") {
                return false;
            }
            put_field(block, "NUM", "0");
            "math_number"
        }
        // Tn6a@58566 emits only through the optional paired-device transport.
        "mobile_vibrate" => "kitten4_noop",
        // Tn6a@63918: '?' is special even without motion samples.
        "get_camera_data" => {
            let value = if field(block, "target") == "?" {
                "NaN"
            } else {
                "0"
            };
            put_field(block, "NUM", value);
            "math_number"
        }
        // Tn6a@63714: optional camera component absent in the local VM.
        "set_camera_opcity" => "kitten4_noop",
        _ => return false,
    };
    block["type"] = json!(renamed);
    true
}
