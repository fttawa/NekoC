use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn build_report(value: &Value) -> Result<Value> {
    if !value.is_object() {
        bail!("project root must be a JSON object");
    }

    let mut issues = Vec::new();
    collect_owner_issues(value, &["scenes", "scenesDict"], "scene", &mut issues);
    collect_owner_issues(value, &["actors", "actorsDict"], "actor", &mut issues);
    validate_scenes(value, &mut issues);
    validate_screen_references(value, &mut issues);

    Ok(json!({
        "ok": issues.is_empty(),
        "issues": issues,
    }))
}

fn validate_scenes(value: &Value, issues: &mut Vec<Value>) {
    let Some(scenes) = get_path(value, &["scenes", "scenesDict"]).and_then(Value::as_object) else {
        return;
    };
    let actor_ids = get_path(value, &["actors", "actorsDict"])
        .and_then(Value::as_object)
        .map(|actors| actors.keys().cloned().collect::<BTreeSet<_>>())
        .unwrap_or_default();
    let scene_ids = scenes.keys().cloned().collect::<BTreeSet<_>>();
    let sort_list = get_path(value, &["scenes", "sortList"])
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();

    for scene_id in scene_ids.difference(&sort_list) {
        issues.push(json!({
            "kind": "scene_missing_from_sort_list",
            "scene_id": scene_id,
        }));
    }
    for scene_id in sort_list.difference(&scene_ids) {
        issues.push(json!({
            "kind": "sort_list_references_missing_scene",
            "scene_id": scene_id,
        }));
    }

    let mut actor_owners: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (scene_id, scene) in scenes {
        let Some(scene_actor_ids) = scene.get("actorIds").and_then(Value::as_array) else {
            continue;
        };
        for actor_id in scene_actor_ids.iter().filter_map(Value::as_str) {
            if !actor_ids.contains(actor_id) {
                issues.push(json!({
                    "kind": "dangling_scene_actor",
                    "scene_id": scene_id,
                    "actor_id": actor_id,
                }));
            }
            actor_owners
                .entry(actor_id.to_owned())
                .or_default()
                .push(scene_id.clone());
        }
    }

    for (actor_id, scene_ids) in actor_owners {
        if scene_ids.len() > 1 {
            issues.push(json!({
                "kind": "actor_in_multiple_scenes",
                "actor_id": actor_id,
                "scene_ids": scene_ids,
            }));
        }
    }
}

fn validate_screen_references(value: &Value, issues: &mut Vec<Value>) {
    let scene_ids = get_path(value, &["scenes", "scenesDict"])
        .and_then(Value::as_object)
        .map(|scenes| scenes.keys().cloned().collect::<BTreeSet<_>>())
        .unwrap_or_default();
    collect_screen_reference_issues(value, "$", &scene_ids, issues);
}

fn collect_screen_reference_issues(
    value: &Value,
    path: &str,
    scene_ids: &BTreeSet<String>,
    issues: &mut Vec<Value>,
) {
    match value {
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("get_screens")
                && let Some(screen_id) = object
                    .get("fields")
                    .and_then(|fields| fields.get("screen_id"))
                    .and_then(Value::as_str)
                && !scene_ids.contains(screen_id)
            {
                issues.push(json!({
                    "kind": "dangling_screen_reference",
                    "path": path,
                    "screen_id": screen_id,
                }));
            }
            for (key, child) in object {
                collect_screen_reference_issues(child, &format!("{path}.{key}"), scene_ids, issues);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                collect_screen_reference_issues(
                    child,
                    &format!("{path}[{index}]"),
                    scene_ids,
                    issues,
                );
            }
        }
        _ => {}
    }
}

fn collect_owner_issues(value: &Value, path: &[&str], kind: &str, issues: &mut Vec<Value>) {
    let Some(owners) = get_path(value, path).and_then(Value::as_object) else {
        return;
    };

    for (owner_id, owner) in owners {
        let owner_name = owner.get("name").and_then(Value::as_str).unwrap_or("");
        let block_ids = collect_block_ids(owner);
        validate_comments(kind, owner_id, owner_name, owner, &block_ids, issues);
        validate_block_parent_ids(kind, owner_id, owner_name, owner, &block_ids, issues);
    }
}

fn collect_block_ids(owner: &Value) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    if let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) {
        for block in blocks {
            collect_block_ids_in_value(block, &mut ids);
        }
    }
    ids
}

fn collect_block_ids_in_value(value: &Value, ids: &mut BTreeSet<String>) {
    if let Some(id) = value.get("id").and_then(Value::as_str) {
        ids.insert(id.to_owned());
    }
    if let Some(next) = value.get("next") {
        collect_block_ids_in_value(next, ids);
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get(container).and_then(Value::as_object) {
            for child in items.values() {
                collect_block_ids_in_value(child, ids);
            }
        }
    }
}

fn validate_comments(
    kind: &str,
    owner_id: &str,
    owner_name: &str,
    owner: &Value,
    block_ids: &BTreeSet<String>,
    issues: &mut Vec<Value>,
) {
    let Some(comments) = owner.get("comments").and_then(Value::as_object) else {
        return;
    };

    for (comment_id, comment) in comments {
        let Some(parent_id) = comment.get("parent_id").and_then(Value::as_str) else {
            continue;
        };
        if parent_id.is_empty() {
            continue;
        }
        if !block_ids.contains(parent_id) {
            issues.push(json!({
                "kind": "dangling_comment_parent",
                "owner_kind": kind,
                "owner_id": owner_id,
                "owner_name": owner_name,
                "comment_id": comment_id,
                "parent_id": parent_id,
            }));
        }
    }
}

fn validate_block_parent_ids(
    kind: &str,
    owner_id: &str,
    owner_name: &str,
    owner: &Value,
    block_ids: &BTreeSet<String>,
    issues: &mut Vec<Value>,
) {
    if let Some(blocks) = owner.get("nekoBlockJsonList").and_then(Value::as_array) {
        for block in blocks {
            validate_block_parent_ids_in_value(
                kind, owner_id, owner_name, block, None, block_ids, issues,
            );
        }
    }
}

fn validate_block_parent_ids_in_value(
    kind: &str,
    owner_id: &str,
    owner_name: &str,
    value: &Value,
    expected_parent: Option<&str>,
    block_ids: &BTreeSet<String>,
    issues: &mut Vec<Value>,
) {
    let block_id = value.get("id").and_then(Value::as_str).unwrap_or("");
    let parent_id = value.get("parent_id").and_then(Value::as_str);

    if let Some(parent_id) = parent_id
        && !parent_id.is_empty()
        && !block_ids.contains(parent_id)
    {
        issues.push(json!({
            "kind": "dangling_block_parent",
            "owner_kind": kind,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "block_id": block_id,
            "parent_id": parent_id,
        }));
    }

    if let Some(expected_parent) = expected_parent
        && parent_id != Some(expected_parent)
    {
        issues.push(json!({
            "kind": "unexpected_block_parent",
            "owner_kind": kind,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "block_id": block_id,
            "expected_parent_id": expected_parent,
            "parent_id": parent_id,
        }));
    }

    if let Some(next) = value.get("next") {
        validate_block_parent_ids_in_value(
            kind,
            owner_id,
            owner_name,
            next,
            Some(block_id),
            block_ids,
            issues,
        );
    }
    for container in ["inputs", "statements"] {
        if let Some(items) = value.get(container).and_then(Value::as_object) {
            for child in items.values() {
                validate_block_parent_ids_in_value(
                    kind,
                    owner_id,
                    owner_name,
                    child,
                    Some(block_id),
                    block_ids,
                    issues,
                );
            }
        }
    }
}

fn get_path<'a>(mut value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    for segment in path {
        value = value.get(*segment)?;
    }
    Some(value)
}
