//! Web import boundary for JSON Kitten N .bcmkn projects.
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Validate the format without relabelling versions, rewriting mutations, or
/// removing unknown extension fields. Runtime compatibility is a separate report.
pub fn import(value: impl Into<crate::json::Json>) -> Result<(crate::json::Json, Value)> {
    let value = value.into();
    crate::json::expanded(|| import_inner(value))
}
fn import_inner(value: crate::json::Json) -> Result<(crate::json::Json, Value)> {
    ensure!(value.is_object(), ".bcmkn 顶层必须是 JSON 对象");
    ensure!(
        value["toolType"].as_str().is_none_or(|t| t == "KN"),
        "不是 Kitten N 项目（toolType 应为 KN）"
    );
    for path in ["/scenes/scenesDict", "/actors/actorsDict"] {
        ensure!(
            value.pointer(path).is_some_and(Value::is_object),
            ".bcmkn 缺少对象 {path}"
        );
    }
    let inspection = crate::inspect::build_report(&value, crate::json::to_vec(&value)?.len())?;
    let validation = crate::validate::build_report(&value)?;
    let mut types = BTreeMap::new();
    for path in [
        "/scenes/scenesDict",
        "/actors/actorsDict",
        "/procedures/proceduresDict",
    ] {
        if let Some(owners) = value.pointer(path).and_then(Value::as_object) {
            for owner in owners.values() {
                for block in owner["nekoBlockJsonList"].as_array().into_iter().flatten() {
                    collect(block, &mut types);
                }
            }
        }
    }
    let mut diagnostics = vec![];
    let mut diagnostic_indices = BTreeMap::<(String, String), usize>::new();
    let mut probe = value.clone();
    for (container, dict) in [("scenes", "scenesDict"), ("actors", "actorsDict")] {
        if let Some(owners) = probe[container][dict].as_object_mut() {
            for owner in owners.values_mut() {
                owner["nekoBlockJsonList"] = json!([]);
            }
        }
    }
    // Diagnose each root independently, including inactive scenes, to expose
    // more than the first unsupported script without mutating imported data.
    if let Some(scenes) = value
        .pointer("/scenes/scenesDict")
        .and_then(Value::as_object)
    {
        for (scene_id, scene) in scenes {
            let owners = std::iter::once((scene_id.as_str(), scene, "scenesDict")).chain(
                scene["actorIds"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter_map(|id| {
                        value["actors"]["actorsDict"]
                            .get(id)
                            .map(|a| (id, a, "actorsDict"))
                    }),
            );
            for (owner_id, owner, kind) in owners {
                for block in owner["nekoBlockJsonList"].as_array().into_iter().flatten() {
                    probe["scenes"]["currentSceneId"] = json!(scene_id);
                    let container = if kind == "scenesDict" {
                        "scenes"
                    } else {
                        "actors"
                    };
                    probe[container][kind][owner_id]["nekoBlockJsonList"] = json!([block]);
                    if let Err(error) = crate::engine::Program::compile(&probe) {
                        let message = format!("{error:#}");
                        let key = (owner_id.to_owned(), error.root_cause().to_string());
                        if let Some(index) = diagnostic_indices.get(&key) {
                            let item: &mut Value = &mut diagnostics[*index];
                            item["affected_scripts"] =
                                json!(item["affected_scripts"].as_u64().unwrap_or(1) + 1);
                        } else {
                            diagnostic_indices.insert(key, diagnostics.len());
                            diagnostics.push(json!({"scene":scene_id,"owner":owner_id,"block":block["id"],"message":message,"affected_scripts":1}));
                        }
                    }
                    probe[container][kind][owner_id]["nekoBlockJsonList"] = json!([]);
                }
            }
        }
    }
    let current = crate::engine::Program::compile(&value);
    let stats = current.as_ref().ok().map(|p| p.stats());
    let report = json!({"format":"bcmkn-json","inspection":inspection,"validation":validation,"stats":stats,
        "block_types":types,"fast_runtime_ready":current.is_ok(),"runtime_error":current.err().map(|e|format!("{e:#}")),
        "script_diagnostics":diagnostics,"preserves_unknown_fields":true});
    Ok((value, report))
}
fn collect(block: &Value, types: &mut BTreeMap<String, usize>) {
    let mut pending = vec![block];
    while let Some(block) = pending.pop() {
        if let Some(kind) = block["type"].as_str() {
            *types.entry(kind.into()).or_default() += 1;
        }
        if let Some(next) = block.get("next") {
            pending.push(next);
        }
        for key in ["inputs", "statements"] {
            if let Some(children) = block[key].as_object() {
                for child in children.values() {
                    pending.push(child);
                }
            }
        }
    }
}
