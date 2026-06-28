use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn compile_ts(input: impl AsRef<Path>, output: impl AsRef<Path>) -> Result<()> {
    compile_ts_with_ir(input, output, None::<&Path>)
}

pub fn compile_ts_with_ir(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
    emit_ir: Option<impl AsRef<Path>>,
) -> Result<()> {
    let input = input.as_ref();
    let output = output.as_ref();
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("ts")
        .join("compile-ts.mjs");

    let status = Command::new("node")
        .arg(&script)
        .arg(input)
        .arg(output)
        .status()
        .with_context(|| format!("failed to run TypeScript frontend at {}", script.display()))?;

    if !status.success() {
        bail!("TypeScript frontend failed with status {status}");
    }

    let compiled = std::fs::read_to_string(output)
        .with_context(|| format!("failed to read compiled output {}", output.display()))?;
    let workspace_report =
        serde_json::from_str::<serde_json::Value>(&compiled).with_context(|| {
            format!(
                "TypeScript frontend wrote invalid JSON to {}",
                output.display()
            )
        })?;

    if let Some(emit_ir) = emit_ir {
        let emit_ir = emit_ir.as_ref();
        let ir_report = crate::ir::build_report(&workspace_report);
        let bytes = serde_json::to_vec_pretty(&ir_report)?;
        std::fs::write(emit_ir, bytes)
            .with_context(|| format!("failed to write IR output {}", emit_ir.display()))?;
    }

    Ok(())
}
