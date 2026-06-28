use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub fn build_report(value: &Value) -> Result<Value> {
    if !value.is_object() {
        bail!("project root must be a JSON object");
    }

    let mut issues = Vec::new();
    collect_owner_issues(value, &["scenes", "scenesDict"], "scene", &mut issues);
    collect_owner_issues(value, &["actors", "actorsDict"], "actor", &mut issues);

    Ok(json!({
        "ok": issues.is_empty(),
        "issues": issues,
    }))
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
