//! Keys a project listens to, for clients without a keyboard. The manifest lives in
//! a regular block comment, so it survives the official editor and can be edited there.
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

const HEADER: &str = "NekoC 按键配置（可修改 label 和 visible）";
const COMMENT_ID: &str = "nekoc-key-buttons";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyButton {
    pub key: String,
    pub label: String,
    pub visible: bool,
}

fn default_label(key: &str) -> String {
    match key.parse::<u32>() {
        Ok(13) => "回车".into(),
        Ok(32) => "空格".into(),
        Ok(37) => "←".into(),
        Ok(38) => "↑".into(),
        Ok(39) => "→".into(),
        Ok(40) => "↓".into(),
        Ok(code @ (48..=57 | 65..=90)) => char::from_u32(code).unwrap_or('?').to_string(),
        _ => format!("键 {key}"),
    }
}

fn parse_buttons(value: &Value) -> Vec<KeyButton> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let key = match &entry["key"] {
                Value::String(key) => key.clone(),
                Value::Number(key) => key.to_string(),
                _ => return None,
            };
            Some(KeyButton {
                label: entry["label"]
                    .as_str()
                    .map_or_else(|| default_label(&key), str::to_owned),
                visible: entry["visible"].as_bool().unwrap_or(true),
                key,
            })
        })
        .collect()
}

fn collect_keys(value: &Value, keys: &mut BTreeMap<u32, String>) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(items) => pending.extend(items),
            Value::Object(object) => {
                if matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("on_keydown" | "check_key")
                ) && let Some(key) = object["fields"]["key"].as_str()
                    && let Ok(code) = key.parse()
                {
                    keys.insert(code, key.to_owned());
                }
                pending.extend(object.values());
            }
            _ => {}
        }
    }
}

/// Key codes used by any block, in ascending order.
pub fn scan_keys(project: &Value) -> Vec<String> {
    let mut keys = BTreeMap::new();
    // Variables can hold millions of list items and never contain blocks.
    for section in ["actors", "scenes", "procedures"] {
        if let Some(value) = project.get(section) {
            collect_keys(value, &mut keys);
        }
    }
    keys.into_values().collect()
}

fn owners(project: &Value) -> impl Iterator<Item = &Value> {
    [("actors", "actorsDict"), ("scenes", "scenesDict")]
        .into_iter()
        .filter_map(|(section, dict)| project.get(section)?.get(dict)?.as_object())
        .flat_map(Map::values)
}

fn stored_buttons(project: &Value) -> Vec<KeyButton> {
    owners(project)
        .filter_map(|owner| owner.get("comments")?.as_object())
        .flat_map(Map::values)
        .filter_map(|comment| comment["text"].as_str()?.strip_prefix(HEADER))
        .find_map(|json| serde_json::from_str::<Value>(json.trim()).ok())
        .map_or_else(Vec::new, |value| parse_buttons(&value))
}

/// Every used key, with the stored and then the declared label and visibility applied.
/// Declared keys stay listed even when no block uses them.
pub fn manifest(project: &Value, declared: Option<&Value>) -> Vec<KeyButton> {
    let mut buttons: BTreeMap<u32, KeyButton> = BTreeMap::new();
    for key in scan_keys(project) {
        let button = KeyButton {
            label: default_label(&key),
            visible: true,
            key,
        };
        buttons.insert(button.key.parse().unwrap_or(u32::MAX), button);
    }
    let stored = stored_buttons(project);
    let declared = declared.map(parse_buttons).unwrap_or_default();
    for button in stored.into_iter().chain(declared) {
        if let Ok(code) = button.key.parse() {
            buttons.insert(code, button);
        }
    }
    buttons.into_values().collect()
}

pub fn to_json(buttons: &[KeyButton]) -> Value {
    Value::Array(
        buttons
            .iter()
            .map(|b| json!({"key": b.key, "label": b.label, "visible": b.visible}))
            .collect(),
    )
}

/// Writes the manifest as a comment on the first top-level block. Projects with no
/// keys, or no block to attach to, are left without one.
pub fn annotate(project: &mut Value, declared: Option<&Value>) {
    let buttons = manifest(project, declared);
    for section in [("actors", "actorsDict"), ("scenes", "scenesDict")] {
        if let Some(dict) = project
            .get_mut(section.0)
            .and_then(|s| s.get_mut(section.1))
            .and_then(Value::as_object_mut)
        {
            for owner in dict.values_mut() {
                if let Some(comments) = owner.get_mut("comments").and_then(Value::as_object_mut) {
                    comments.remove(COMMENT_ID);
                }
            }
        }
    }
    if buttons.is_empty() {
        return;
    }
    let body = serde_json::to_string_pretty(&to_json(&buttons)).unwrap_or_default();
    for section in [("actors", "actorsDict"), ("scenes", "scenesDict")] {
        let Some(dict) = project
            .get_mut(section.0)
            .and_then(|s| s.get_mut(section.1))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        for owner in dict.values_mut() {
            let Some(block) = owner["nekoBlockJsonList"]
                .get(0)
                .and_then(|b| b["id"].as_str())
                .map(str::to_owned)
            else {
                continue;
            };
            let Some(object) = owner.as_object_mut() else {
                continue;
            };
            let comments = object.entry("comments").or_insert_with(|| json!({}));
            if !comments.is_object() {
                *comments = json!({});
            }
            comments[COMMENT_ID] = json!({
                "id": COMMENT_ID,
                "parent_id": block,
                "text": format!("{HEADER}\n{body}"),
                "pinned": false,
                "size": [320, 240],
                "location": [320, 20],
                "auto_layout": true,
                "color_theme": "BLUE",
            });
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> Value {
        json!({
            "actors": {"actorsDict": {"a": {"comments": {}, "nekoBlockJsonList": [
                {"id": "hat", "type": "on_keydown", "fields": {"key": "87", "type": "down"},
                 "next": {"id": "n", "type": "check_key", "fields": {"key": "32", "type": "down"}}}
            ]}}},
            "procedures": {"proceduresDict": {"p": {"blocks": [
                {"id": "c", "type": "check_key", "fields": {"key": "13"}}
            ]}}},
            "variables": {"variablesDict": {"v": {"value": [
                {"type": "on_keydown", "fields": {"key": "65"}}
            ]}}},
        })
    }

    #[test]
    fn scans_nested_blocks_and_procedures_but_not_variables() {
        assert_eq!(scan_keys(&project()), ["13", "32", "87"]);
    }

    #[test]
    fn declared_buttons_override_defaults_and_can_hide() {
        let declared = json!([{"key": "87", "label": "前进", "visible": true},
                              {"key": "32", "label": "跳", "visible": false}]);
        let buttons = manifest(&project(), Some(&declared));
        let find = |key: &str| buttons.iter().find(|b| b.key == key).unwrap();
        assert_eq!(find("87").label, "前进");
        assert!(!find("32").visible);
        assert_eq!(find("13").label, "回车");
        assert!(find("13").visible);
    }

    #[test]
    fn edited_comment_survives_reannotation_and_new_keys_are_added() {
        let mut value = project();
        annotate(&mut value, None);
        let comment = &value["actors"]["actorsDict"]["a"]["comments"][COMMENT_ID];
        assert_eq!(comment["parent_id"], "hat");
        let edited = comment["text"]
            .as_str()
            .unwrap()
            .replace("\"W\"", "\"前进\"");
        value["actors"]["actorsDict"]["a"]["comments"][COMMENT_ID]["text"] = json!(edited);
        value["actors"]["actorsDict"]["a"]["nekoBlockJsonList"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": "h2", "type": "on_keydown", "fields": {"key": "65"}}));
        annotate(&mut value, None);
        let buttons = manifest(&value, None);
        assert_eq!(
            buttons.iter().find(|b| b.key == "87").unwrap().label,
            "前进"
        );
        assert_eq!(buttons.iter().find(|b| b.key == "65").unwrap().label, "A");
        let comments = value["actors"]["actorsDict"]["a"]["comments"].as_object();
        assert_eq!(comments.unwrap().len(), 1);
    }
}
