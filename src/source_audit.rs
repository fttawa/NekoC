//! Reproducible inventory of locally extracted Kitten N distribution modules.
//! Literal references are evidence of investigation, NOT semantic conformance.
use anyhow::{Context, Result, ensure};
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

pub fn audit(directory: &Path, schema_path: Option<&Path>) -> Result<Value> {
    let manifest: Value = serde_json::from_slice(&fs::read(directory.join("manifest.json"))?)?;
    let entries = manifest.as_array().context("manifest must be an array")?;
    let mut bundles = Vec::new();
    for entry in entries {
        let name = entry["name"].as_str().context("bundle name missing")?;
        ensure!(
            Path::new(name).components().count() == 1 && !name.contains(['/', '\\']),
            "invalid bundle filename"
        );
        let bytes = fs::read(directory.join(name)).with_context(|| format!("read {name}"))?;
        bundles.push(
            json!({"name": name, "url": entry["url"], "bytes": bytes.len(),
            "manifest_size_matches": entry["bytes"].as_u64() == Some(bytes.len() as u64),
            "sha256": format!("{:x}", Sha256::digest(&bytes))}),
        );
    }
    let signals = [
        ("project_model", "BcmInstance"),
        ("block_editor", "BlinkInstance"),
        ("scheduler", "step_code"),
        ("optimized_interpreter", "step_iteration_yield"),
        ("stage", "get_brush"),
        ("audio", "AudioContext"),
        ("cloud_variables", "cloudVariable"),
        ("hardware", "microbit"),
        ("camera", "getCameraDomainFunctions"),
        ("ai", "getAiChatDomainFunctions"),
    ];
    let domains = Regex::new(r"get[A-Z][A-Za-z]+DomainFunctions")?;
    let mut evidence = Vec::new();
    let mut domain_names = BTreeSet::new();
    let mut paths = fs::read_dir(directory)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.sort();
    for path in paths {
        let name = path.file_name().unwrap().to_string_lossy();
        // Prefer formatted extracts; raw bundle matches would only point to line 1.
        if path.extension().is_none_or(|e| e != "js")
            || !["pretty-", "core-", "assets-", "audio-", "load-"]
                .iter()
                .any(|p| name.starts_with(p))
        {
            continue;
        }
        let source = fs::read_to_string(&path)?;
        for capture in domains.find_iter(&source) {
            domain_names.insert(capture.as_str().to_owned());
        }
        for (subsystem, needle) in signals {
            if let Some((line, _)) = source
                .lines()
                .enumerate()
                .find(|(_, text)| text.contains(needle))
            {
                evidence.push(json!({"subsystem": subsystem, "file": name, "line": line + 1, "symbol": needle}));
            }
        }
    }
    let mut categories: BTreeMap<String, usize> = BTreeMap::new();
    let mut blocks = Vec::new();
    let mut schema_fingerprint = Value::Null;
    if let Some(path) = schema_path {
        let bytes = fs::read(path)?;
        let schema: Value = serde_json::from_slice(&bytes)?;
        schema_fingerprint = json!({"version": schema["version"], "sha256": format!("{:x}", Sha256::digest(&bytes))});
        let schemas = schema["schemas"]
            .as_object()
            .context("expected schemas object")?;
        let exec = include_str!("runtime/exec.rs");
        let eval = include_str!("runtime/eval.rs");
        for (name, schema) in schemas {
            let category = schema["category"].as_str().unwrap_or("uncategorized");
            *categories.entry(category.into()).or_default() += 1;
            let literal = format!("\"{name}\"");
            blocks.push(json!({"type": name, "category": category,
                "rust_exec_literal_reference": exec.contains(&literal),
                "rust_eval_literal_reference": eval.contains(&literal),
                "semantics_verified": false}));
        }
    }
    Ok(
        json!({"format": "nekoc.source-audit.v1", "bundles": bundles,
        "domain_functions": domain_names, "evidence": evidence,
        "schema": schema_fingerprint, "schema_block_count": blocks.len(),
        "categories": categories, "blocks": blocks,
        "coverage_note": "Literal references are not implemented/verified coverage. Includes no-op handlers and may omit generic handlers."}),
    )
}
