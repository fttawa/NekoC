//! TypeScript compilation through the canonical Kitten N representation to Kitten 4.

use crate::{bcmkn_compiler, kitten4, project};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;

/// Compile TypeScript to a native Kitten 4 `.bcm` project.
///
/// With no template, use the bundled Kitten N starter project's scene and actor
/// on a native Kitten 4 1280x720 landscape stage.
/// A supplied template must be a native Kitten 4 project; it is converted to the
/// canonical Kitten N representation before reusing the existing TS compiler.
/// Unsupported Kitten 4 conversions are returned as errors before writing output.
pub fn compile_ts_kitten4(
    input: impl AsRef<Path>,
    template: Option<&Path>,
    output: impl AsRef<Path>,
) -> Result<()> {
    let input = input.as_ref();
    let output = output.as_ref();

    // The existing compiler creates a workspace sidecar next to its output.
    // Keep every intermediate in a unique RAII directory, including on errors.
    let scratch = tempfile::Builder::new()
        .prefix("nekoc-kitten4-")
        .tempdir()
        .context("failed to create Kitten 4 compiler temporary directory")?;
    let canonical_template = scratch.path().join("template.bcmkn");
    let canonical_output = scratch.path().join("compiled.bcmkn");

    let mut native_template = None;
    let template_bytes = if let Some(template) = template {
        let native = project::load_project(template)?.value;
        ensure!(
            kitten4::is_kitten4(&native),
            "Kitten 4 template {} must be a native Kitten 4 .bcm project",
            template.display()
        );
        let canonical = kitten4::to_neko(&native).with_context(|| {
            format!("failed to convert Kitten 4 template {}", template.display())
        })?;
        native_template = Some(native);
        serde_json::to_vec(&canonical)?
    } else {
        // Embed the small starter so compilation also works outside the repo cwd.
        let mut starter: Value =
            serde_json::from_slice(include_bytes!("../samples/kitten-n-0.27.4.bcmkn"))?;
        // K4 selects fixed native stage sizes by aspect ratio. The KN starter's
        // 900x562 ratio is not recognized, so choose K4 landscape before compiling.
        starter["stageSize"] = json!({"width": 1280, "height": 720});
        serde_json::to_vec(&starter)?
    };
    std::fs::write(&canonical_template, template_bytes)
        .context("failed to write canonical Kitten 4 compiler template")?;

    bcmkn_compiler::compile_ts_bcmkn(input, &canonical_template, &canonical_output)
        .with_context(|| format!("failed to compile TypeScript {}", input.display()))?;
    let canonical = project::load_project(&canonical_output)?.value;
    let mut native = kitten4::from_neko(&canonical)
        .context("compiled TypeScript cannot be represented as a native Kitten 4 project")?;
    ensure!(
        kitten4::is_kitten4(&native),
        "Kitten 4 conversion did not produce a native project"
    );
    if let Some(template) = native_template
        && (owner_ids(&template, "actors") != owner_ids(&native, "actors")
            || owner_ids(&template, "scenes") != owner_ids(&native, "scenes"))
    {
        reconcile_replaced_owners(&mut native);
    }

    let bytes = serde_json::to_vec(&native).context("failed to serialize Kitten 4 project")?;
    std::fs::write(output, bytes)
        .with_context(|| format!("failed to write Kitten 4 output {}", output.display()))?;
    Ok(())
}

fn owner_ids(value: &Value, kind: &str) -> BTreeSet<String> {
    value["theatre"][kind]
        .as_object()
        .into_iter()
        .flat_map(|owners| owners.keys().cloned())
        .collect()
}

// Declared TS sprites/screens replace template owners. The adapter deliberately
// retains native-only UI metadata; repair references affected by this replacement
// here while retaining the surviving groups' order and extension fields.
fn reconcile_replaced_owners(value: &mut Value) {
    let actors = owner_ids(value, "actors");
    let scenes = owner_ids(value, "scenes");
    let theatre = &mut value["theatre"];
    if !theatre["current_entity"]
        .as_str()
        .is_some_and(|id| actors.contains(id) || scenes.contains(id))
    {
        theatre["current_entity"] = theatre["current_scene"].clone();
    }

    if let Some(groups) = theatre["groups"].as_object_mut() {
        groups.retain(|_, group| {
            if group["scene"]
                .as_str()
                .is_some_and(|id| !scenes.contains(id))
            {
                return false;
            }
            if let Some(members) = group["actors"].as_array_mut() {
                let had_members = !members.is_empty();
                members.retain(|id| id.as_str().is_some_and(|id| actors.contains(id)));
                if had_members && members.is_empty() {
                    return false;
                }
            }
            true
        });
    }
    let groups = theatre["groups"].as_object().cloned().unwrap_or_default();
    if let Some(scenes) = theatre["scenes"].as_object_mut() {
        for (scene_id, scene) in scenes {
            let mut order = scene["group_order"].as_array().cloned().unwrap_or_default();
            order.retain(|id| {
                id.as_str()
                    .and_then(|id| groups.get(id))
                    .is_some_and(|group| group["scene"].as_str().is_none_or(|id| id == scene_id))
            });
            for (id, group) in &groups {
                if group["scene"].as_str() == Some(scene_id.as_str())
                    && !order
                        .iter()
                        .any(|entry| entry.as_str() == Some(id.as_str()))
                {
                    order.push(json!(id));
                }
            }
            scene["group_order"] = Value::Array(order);
        }
    }
}
