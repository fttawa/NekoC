use serde_json::{Value, json};

use crate::runtime::{RuntimeSnapshot, RuntimeValue};

pub fn snapshot_to_json(snapshot: &RuntimeSnapshot) -> Value {
    json!(snapshot)
}

pub fn keyboard_code(key: &str) -> String {
    let lower = key.to_ascii_lowercase();
    let code = match lower.as_str() {
        "space" | " " => "32",
        "enter" => "13",
        "escape" | "esc" => "27",
        "arrowleft" | "left" => "37",
        "arrowup" | "up" => "38",
        "arrowright" | "right" => "39",
        "arrowdown" | "down" => "40",
        _ => {
            if key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic() {
                return key.as_bytes()[0].to_ascii_uppercase().to_string();
            }
            return key.to_owned();
        }
    };
    code.to_owned()
}

pub fn pen_rgb_to_hsv(color: &str) -> [f64; 3] {
    let rgb = u32::from_str_radix(color.trim_start_matches('#'), 16).unwrap_or(0);
    let r = ((rgb >> 16) & 255) as f64 / 255.0;
    let g = ((rgb >> 8) & 255) as f64 / 255.0;
    let b = (rgb & 255) as f64 / 255.0;
    let max = r.max(g).max(b);
    let delta = max - r.min(g).min(b);
    let hue = if delta == 0.0 {
        0.0
    } else if max == r {
        (60.0 * (g - b) / delta).rem_euclid(360.0)
    } else if max == g {
        120.0 + 60.0 * (b - r) / delta
    } else {
        240.0 + 60.0 * (r - g) / delta
    };
    [
        hue,
        if max == 0.0 { 0.0 } else { delta / max * 100.0 },
        max * 100.0,
    ]
}

pub fn set_pen_property(pen: &mut crate::runtime::PenState, scope: &str, value: f64, change: bool) {
    let index = match scope {
        "hue" => 0,
        "saturation" => 1,
        "brightness" => 2,
        _ => return,
    };
    let value = if change {
        pen.hsv[index] + value
    } else {
        value
    };
    pen.hsv[index] = if index == 0 {
        value.rem_euclid(360.0)
    } else {
        value.clamp(0.0, 100.0)
    };
    let [h, s, v] = pen.hsv;
    let c = v / 100.0 * s / 100.0;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v / 100.0 - c;
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    pen.color = format!(
        "#{:02x}{:02x}{:02x}",
        ((r + m) * 255.0).round() as u8,
        ((g + m) * 255.0).round() as u8,
        ((b + m) * 255.0).round() as u8
    );
}

pub fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}

pub fn block_type(block: &Value) -> Option<&str> {
    block.get("type").and_then(Value::as_str)
}

pub fn input<'a>(block: &'a Value, name: &str) -> Option<&'a Value> {
    block
        .get("inputs")
        .and_then(Value::as_object)
        .and_then(|inputs| inputs.get(name))
}

pub fn choice_input(block: &Value, index: usize) -> Option<&Value> {
    input(block, &format!("CHOICE{index}"))
}

pub fn statement<'a>(block: &'a Value, name: &str) -> Option<&'a Value> {
    block
        .get("statements")
        .and_then(Value::as_object)
        .and_then(|statements| statements.get(name))
}

pub fn variable_field(block: &Value) -> Option<&str> {
    block
        .get("fields")
        .and_then(|fields| fields.get("variable"))
        .and_then(Value::as_str)
}

pub fn field_string<'a>(block: &'a Value, name: &str) -> Option<&'a str> {
    block
        .get("fields")
        .and_then(|fields| fields.get(name))
        .and_then(Value::as_str)
}

pub fn traverse_param_name(block: &Value) -> Option<&str> {
    if block_type(block) != Some("traverse_number_param") {
        return None;
    }
    field_string(block, "TEXT")
}

pub fn script_variable_names(block: &Value) -> Vec<&str> {
    let Some(inputs) = block.get("inputs").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut names = inputs
        .iter()
        .filter_map(|(key, value)| {
            let index = key.strip_prefix("PARAMS")?.parse::<usize>().ok()?;
            if block_type(value) != Some("script_variables_param") {
                return None;
            }
            Some((index, field_string(value, "TEXT")?))
        })
        .collect::<Vec<_>>();
    names.sort_by_key(|(index, _)| *index);
    names.into_iter().map(|(_, name)| name).collect()
}

pub fn procedure_def_id(block: &Value) -> Option<&str> {
    attr_value(block.get("mutation")?.as_str()?, "def_id")
}

pub fn attr_value<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = text.find(&needle)? + needle.len();
    let rest = &text[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

pub fn number_field(block: &Value, name: &str) -> Option<f64> {
    let value = block.get("fields")?.get(name)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

pub fn seconds_to_wait_ticks(seconds: f64) -> usize {
    ((seconds * super::DEFAULT_FPS).ceil().max(0.0) as usize).saturating_sub(1)
}

pub fn text_join_index(name: &str) -> Option<usize> {
    name.strip_prefix("ADD")?.parse().ok()
}

pub fn list_item_input_index(name: &str) -> Option<usize> {
    name.strip_prefix("ITEM")?.parse().ok()
}

pub fn range_contains(value: f64, end: f64, step: f64) -> bool {
    if step > 0.0 {
        value <= end
    } else {
        value >= end
    }
}

pub fn select_text_value(value: RuntimeValue, start: isize, end: isize) -> RuntimeValue {
    let start = start.max(1) as usize;
    let end = end.max(start as isize) as usize;
    match value {
        RuntimeValue::List(items) => {
            if start == end {
                return items.get(start - 1).cloned().unwrap_or(RuntimeValue::Null);
            }
            RuntimeValue::List(
                items
                    .into_iter()
                    .skip(start - 1)
                    .take(end - start + 1)
                    .collect(),
            )
        }
        value => {
            let text = value.as_string();
            RuntimeValue::String(text.chars().skip(start - 1).take(end - start + 1).collect())
        }
    }
}

pub fn broadcast_message(block: Option<&Value>) -> Option<String> {
    let block = block?;
    match block_type(block)? {
        "broadcast_input" => block
            .get("fields")
            .and_then(|fields| fields.get("message"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "text" => block
            .get("fields")
            .and_then(|fields| fields.get("TEXT"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        _ => None,
    }
}

pub fn listen_param_name(block: Option<&Value>) -> Option<String> {
    let block = block?;
    if block_type(block) != Some("self_listen_param") {
        return None;
    }
    block
        .get("fields")
        .and_then(|fields| fields.get("TEXT"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub fn compare_values(left: &RuntimeValue, right: &RuntimeValue, op: &str) -> bool {
    let left_number = comparable_number(left);
    let right_number = comparable_number(right);
    if let (Some(left), Some(right)) = (left_number, right_number) {
        return match op {
            "NEQ" => left != right,
            "GT" => left > right,
            "GTE" => left >= right,
            "LT" => left < right,
            "LTE" => left <= right,
            _ => left == right,
        };
    }

    let left = format_value(left);
    let right = format_value(right);
    match op {
        "NEQ" => left != right,
        "GT" => left > right,
        "GTE" => left >= right,
        "LT" => left < right,
        "LTE" => left <= right,
        _ => left == right,
    }
}

pub fn comparable_number(value: &RuntimeValue) -> Option<f64> {
    match value {
        RuntimeValue::Number(value) => Some(*value),
        RuntimeValue::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        RuntimeValue::String(value) => value.parse().ok(),
        RuntimeValue::List(value) => Some(value.len() as f64),
        RuntimeValue::Null => None,
    }
}

pub fn is_prime(value: f64) -> bool {
    if value.fract() != 0.0 || value < 2.0 {
        return false;
    }
    let value = value as u64;
    if value == 2 {
        return true;
    }
    if value.is_multiple_of(2) {
        return false;
    }
    let limit = (value as f64).sqrt() as u64;
    (3..=limit)
        .step_by(2)
        .all(|factor| !value.is_multiple_of(factor))
}

pub fn format_value(value: &RuntimeValue) -> String {
    match value {
        RuntimeValue::Number(value) => crate::js_number::text(*value),
        RuntimeValue::Bool(value) => value.to_string(),
        RuntimeValue::String(value) => value.clone(),
        RuntimeValue::List(value) => value.iter().map(format_value).collect::<Vec<_>>().join(","),
        RuntimeValue::Null => "null".to_owned(),
    }
}

pub fn signed_delta(block: &Value, value: f64) -> f64 {
    let method = block
        .get("fields")
        .and_then(|fields| fields.get("increase"))
        .and_then(Value::as_str)
        .unwrap_or("increase");
    if method == "decrease" { -value } else { value }
}

pub fn runtime_list(value: &RuntimeValue) -> Option<&Vec<RuntimeValue>> {
    match value {
        RuntimeValue::List(items) => Some(items),
        _ => None,
    }
}

pub fn ensure_runtime_list(value: &mut RuntimeValue) -> &mut Vec<RuntimeValue> {
    if !matches!(value, RuntimeValue::List(_)) {
        *value = RuntimeValue::List(Vec::new());
    }
    let RuntimeValue::List(items) = value else {
        unreachable!();
    };
    items
}

pub fn insertion_index(index: f64, len: usize) -> usize {
    let index = index.floor().max(1.0) as usize;
    index.saturating_sub(1).min(len)
}

pub fn list_index(mode: &str, index: f64, len: usize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    match mode {
        "first" => Some(0),
        "last" => Some(len - 1),
        _ => {
            let index = index.floor() as isize;
            if index < 1 || index as usize > len {
                None
            } else {
                Some(index as usize - 1)
            }
        }
    }
}

pub fn same_runtime_value(left: &RuntimeValue, right: &RuntimeValue) -> bool {
    left == right || left.as_string() == right.as_string()
}

pub fn json_to_runtime_value(value: &Value) -> RuntimeValue {
    match value {
        Value::Number(value) => RuntimeValue::Number(value.as_f64().unwrap_or(0.0)),
        Value::Bool(value) => RuntimeValue::Bool(*value),
        Value::String(value) => RuntimeValue::String(value.clone()),
        Value::Array(value) => {
            RuntimeValue::List(value.iter().map(json_to_runtime_value).collect())
        }
        _ => RuntimeValue::Null,
    }
}
