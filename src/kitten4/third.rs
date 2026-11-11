//! Legacy K4 domains. Source locations and failure boundaries: kitten4-third-round.md.
use super::*;

pub(super) fn lower_third(block: &mut Value, targets: &Targets) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE)
        .to_owned();
    let renamed = match kind.as_str() {
        "get_choice" => {
            // Tn6a legacy wrapper calls its delegate WITHOUT returning it.
            // Commands discard the undefined value; expressions must fail.
            "kitten4_legacy_choice"
        }
        "get_choice_index" => "kitten4_legacy_choice",
        "get_cur_frames" => "kitten4_frames",
        "reset_timer" => "reset_timer",
        "destruct" => "kitten4_dispose",
        // Tn6a explicitly throws; the three enum-only events reach the missing
        // domain handler in inF4. Do not execute their bodies or silently noop.
        "incompatible_block"
        | "incompatible_output_block"
        | "block_on_break"
        | "mouse_on_emit"
        | "player_position_on_change" => {
            put_field(block, "error_type", &kind);
            "kitten4_domain_error"
        }
        "controls_if_dropdown" => {
            let fields = block["fields"].as_object().cloned().unwrap_or_default();
            for (name, domain) in fields {
                if name.starts_with("IF")
                    && let Some(domain) = domain.as_str()
                {
                    // inF4/eval_cond dispatches the named domain, not the truth
                    // value of its spelling. Resolve only audited native types.
                    let mut condition = block.clone();
                    condition.as_object_mut().unwrap().remove("next");
                    condition.as_object_mut().unwrap().remove("statements");
                    condition["type"] = json!(domain);
                    if condition["fields"].is_object() {
                        condition["fields"]
                            .as_object_mut()
                            .unwrap()
                            .retain(|key, _| !key.starts_with("IF"));
                    }
                    if domain == "controls_if_dropdown" {
                        condition["type"] = json!("kitten4_domain_error");
                        put_field(
                            &mut condition,
                            "error_type",
                            "missing_domain_function: controls_if_dropdown",
                        );
                    } else if !translate(&mut condition, false).unwrap_or(false) {
                        condition["type"] = json!(format!("{OPAQUE}{domain}"));
                        lower_block(&mut condition, targets);
                    }
                    if !block["inputs"].is_object() {
                        block["inputs"] = json!({});
                    }
                    block["inputs"][&name] = condition;
                }
            }
            "controls_if"
        }
        "procedures_defnoreturn" => "procedures_2_defnoreturn",
        "procedures_callnoreturn" => "procedures_2_callnoreturn",
        "procedures_callreturn" => "procedures_2_callreturn",
        "procedures_parameter" => "procedures_2_parameter",
        "procedures_return_value" => "procedures_2_return_value",
        _ => return false,
    };
    block["type"] = json!(renamed);
    true
}

/// DmFr's old call protocol keys arguments by mutation name rather than id.
pub(super) fn normalize_procedure(block: &mut Value) {
    let kind = block["type"].as_str().unwrap_or_default().to_owned();
    match kind.as_str() {
        "procedures_callreturn" | "procedures_callnoreturn" => {
            let names = mutation_names(block);
            if let Some(name) = names.first() {
                put_field(block, "NAME", name);
            }
            for (index, name) in names.iter().skip(1).enumerate() {
                if let Some(value) = block["inputs"]
                    .as_object_mut()
                    .and_then(|v| v.remove(&format!("ARG{index}")))
                {
                    block["inputs"][name] = value;
                }
            }
        }
        "procedures_return_value" if block["inputs"].get("VALUE").is_none() => {
            block["inputs"]["VALUE"] = json!({"type":"text","fields":{"TEXT":""}});
        }
        _ => {}
    }
    let modern = match kind.as_str() {
        "procedures_defnoreturn" => "procedures_2_defnoreturn",
        "procedures_callnoreturn" => "procedures_2_callnoreturn",
        "procedures_callreturn" => "procedures_2_callreturn",
        "procedures_parameter" => "procedures_2_parameter",
        "procedures_return_value" => "procedures_2_return_value",
        _ => return,
    };
    block["type"] = json!(modern);
}

pub(super) fn mutation_names(block: &Value) -> Vec<String> {
    let mutation = block["mutation"].as_str().unwrap_or_default();
    mutation
        .split(" name=\"")
        .skip(1)
        .filter_map(|part| part.split('"').next())
        .map(|name| {
            name.replace("&quot;", "\"")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
        })
        .collect()
}
