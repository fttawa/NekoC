use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Directories searched for the frontend scripts, in order: `NEKOC_FRONTEND`,
/// `frontend/` beside the executable (prebuilt packages), then the source
/// tree's `ts/` (cargo builds).
fn frontend_dirs(override_dir: Option<PathBuf>, executable: Option<PathBuf>) -> Vec<PathBuf> {
    override_dir
        .into_iter()
        .chain(
            executable
                .as_deref()
                .and_then(Path::parent)
                .map(|dir| dir.join("frontend")),
        )
        .chain([PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ts")])
        .collect()
}

fn frontend_script(name: &str) -> Result<PathBuf> {
    let dirs = frontend_dirs(
        std::env::var_os("NEKOC_FRONTEND").map(PathBuf::from),
        std::env::current_exe().ok(),
    );
    if let Some(script) = dirs.iter().map(|dir| dir.join(name)).find(|p| p.is_file()) {
        return Ok(script);
    }
    bail!(
        "TypeScript frontend {name} not found; keep frontend/ beside the nekoc executable or set NEKOC_FRONTEND to its directory (searched {})",
        dirs.iter()
            .map(|dir| dir.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn node_error(script: &Path) -> String {
    format!(
        "failed to run {} with node; install Node.js 18 or newer and put node on PATH",
        script.display()
    )
}

pub fn compile_ts(input: impl AsRef<Path>, output: impl AsRef<Path>) -> Result<()> {
    compile_ts_with_sidecars(input, output, None::<&Path>, None::<&Path>)
}

pub fn compile_ts_with_ir(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
    emit_ir: Option<impl AsRef<Path>>,
) -> Result<()> {
    compile_ts_with_sidecars(input, output, emit_ir, None::<&Path>)
}

pub fn compile_ts_with_sidecars(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
    emit_ir: Option<impl AsRef<Path>>,
    emit_analysis: Option<impl AsRef<Path>>,
) -> Result<()> {
    let input = input.as_ref();
    let output = output.as_ref();
    let script = frontend_script("compile-ts.mjs")?;

    let status = Command::new("node")
        .arg(&script)
        .arg(input)
        .arg(output)
        .status()
        .with_context(|| node_error(&script))?;

    if !status.success() {
        bail!("TypeScript frontend failed with status {status}");
    }

    let compiled = std::fs::read_to_string(output)
        .with_context(|| format!("failed to read compiled output {}", output.display()))?;
    let workspace_report = crate::json::from_str(&compiled).with_context(|| {
        format!(
            "TypeScript frontend wrote invalid JSON to {}",
            output.display()
        )
    })?;

    if emit_ir.is_some() || emit_analysis.is_some() {
        let ir_report = crate::ir::build_report(&workspace_report);

        if let Some(emit_ir) = emit_ir {
            let emit_ir = emit_ir.as_ref();
            let bytes = serde_json::to_vec_pretty(&ir_report)?;
            std::fs::write(emit_ir, bytes)
                .with_context(|| format!("failed to write IR output {}", emit_ir.display()))?;
        }

        if let Some(emit_analysis) = emit_analysis {
            let emit_analysis = emit_analysis.as_ref();
            let analysis_report = crate::analysis::build_report(&ir_report);
            let bytes = serde_json::to_vec_pretty(&analysis_report)?;
            std::fs::write(emit_analysis, bytes).with_context(|| {
                format!(
                    "failed to write analysis output {}",
                    emit_analysis.display()
                )
            })?;
        }
    }

    Ok(())
}

/// Result of the frontend's check mode: `{ok, diagnostics}` plus the workspace
/// report when the source compiled.
pub struct FrontendCheck {
    pub diagnostics: Vec<serde_json::Value>,
    pub report: Option<serde_json::Value>,
}

/// Runs `compile-ts.mjs --check --json`: type check against nekoc.d.ts plus the
/// Kitten N compile, without producing a project.
pub fn check_ts(input: impl AsRef<Path>, types: bool) -> Result<FrontendCheck> {
    let input = input.as_ref();
    let script = frontend_script("compile-ts.mjs")?;
    let report_file = tempfile::Builder::new()
        .prefix("nekoc-check-")
        .suffix(".json")
        .tempfile()?;
    let mut command = Command::new("node");
    command.arg(&script).arg("--check").arg("--json");
    if !types {
        command.arg("--no-types");
    }
    command.arg(format!("--report-out={}", report_file.path().display()));
    let output = command
        .arg(input)
        .output()
        .with_context(|| node_error(&script))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: serde_json::Value = serde_json::from_str(stdout.trim()).with_context(|| {
        format!(
            "TypeScript frontend check failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
    })?;
    let diagnostics = result["diagnostics"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let report_text = std::fs::read_to_string(report_file.path())?;
    let report = if report_text.trim().is_empty() {
        None
    } else {
        Some(serde_json::from_str(&report_text)?)
    };
    Ok(FrontendCheck {
        diagnostics,
        report,
    })
}

pub fn test_ts(input: impl AsRef<Path>) -> Result<()> {
    let input = input.as_ref();
    let script = frontend_script("test-ts.mjs")?;

    let status = Command::new("node")
        .arg(&script)
        .arg(input)
        .status()
        .with_context(|| node_error(&script))?;

    if !status.success() {
        bail!("TypeScript tests failed with status {status}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_search_order() {
        let dirs = frontend_dirs(
            Some(PathBuf::from("custom")),
            Some(PathBuf::from("bundle").join("nekoc")),
        );
        assert_eq!(dirs[0], PathBuf::from("custom"));
        assert_eq!(dirs[1], PathBuf::from("bundle").join("frontend"));
        assert_eq!(
            dirs[2],
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ts")
        );
        assert_eq!(frontend_dirs(None, None).len(), 1);
    }
}
