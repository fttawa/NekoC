//! Preserve K4's strict number/method checks rather than KN numeric coercion.
use super::*;

pub(super) fn lower_effect(block: &mut Value) -> bool {
    match block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE)
    {
        "self_set_effect_2" => block["type"] = json!("kitten4_set_effect"),
        "self_change_effect_3" => block["type"] = json!("kitten4_change_effect"),
        _ => return false,
    }
    true
}
