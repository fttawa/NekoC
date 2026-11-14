//! `nekoc check`: type and compatibility checks without writing a project.
//!
//! For TS/JS sources this runs the frontend's check mode (type check against
//! `ts/nekoc.d.ts` plus the full Kitten N compile), then assembles the project
//! in memory and runs the structural checks the official runtime depends on.
//! For `.bcmkn` / `.bcm` / `.json` inputs only the project checks run.
use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct Diagnostic {
    /// `error` or `warning`.
    pub severity: String,
    /// `syntax`, `types`, `compat` (unsupported by Kitten N) or `project`.
    pub source: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u64>,
}

impl Diagnostic {
    fn from_frontend(value: &Value) -> Self {
        let text = |key: &str| value[key].as_str().unwrap_or_default().to_owned();
        Self {
            severity: text("severity"),
            source: text("source"),
            code: text("code"),
            message: text("message"),
            file: value["file"].as_str().map(str::to_owned),
            line: value["line"].as_u64(),
            column: value["column"].as_u64(),
        }
    }
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(file) = &self.file {
            write!(f, "{file}")?;
            if let (Some(line), Some(column)) = (self.line, self.column) {
                write!(f, ":{line}:{column}")?;
            }
            write!(f, ": ")?;
        }
        write!(f, "{} {}: {}", self.severity, self.code, self.message)
    }
}

#[derive(Debug, Serialize)]
pub struct CheckReport {
    pub ok: bool,
    pub diagnostics: Vec<Diagnostic>,
}

pub struct CheckOptions<'a> {
    /// Type check TS sources against nekoc.d.ts.
    pub types: bool,
    /// Template project for TS sources; the bundled empty work when `None`.
    pub template: Option<&'a Path>,
}

impl Default for CheckOptions<'_> {
    fn default() -> Self {
        Self {
            types: true,
            template: None,
        }
    }
}

fn is_project_file(input: &Path) -> bool {
    matches!(
        input.extension().and_then(|ext| ext.to_str()),
        Some("bcmkn" | "bcm" | "json")
    )
}

pub fn check_file(input: &Path, options: &CheckOptions) -> Result<CheckReport> {
    let mut diagnostics = Vec::new();
    let project = if is_project_file(input) {
        Some(crate::project::load_project(input)?.value)
    } else {
        let frontend = crate::ts_frontend::check_ts(input, options.types)?;
        diagnostics.extend(frontend.diagnostics.iter().map(Diagnostic::from_frontend));
        match frontend.report {
            Some(report) => {
                let template = match options.template {
                    Some(path) => crate::project::load_project(path)?.value,
                    None => crate::bcmkn_compiler::default_template(),
                };
                Some(crate::bcmkn_compiler::assemble_workspace_bcmkn(
                    &report,
                    &crate::bcmkn_compiler::project_name(input),
                    template,
                )?)
            }
            None => None,
        }
    };
    if let Some(project) = project {
        project_diagnostics(&project, input, &mut diagnostics)?;
    }
    Ok(CheckReport {
        ok: !diagnostics.iter().any(|d| d.severity == "error"),
        diagnostics,
    })
}

fn project_diagnostics(project: &Value, input: &Path, out: &mut Vec<Diagnostic>) -> Result<()> {
    let report = crate::validate::build_report(project)?;
    for issue in report["issues"].as_array().into_iter().flatten() {
        let kind = issue["kind"].as_str().unwrap_or("project_issue");
        let mut details = issue.clone();
        if let Some(map) = details.as_object_mut() {
            map.remove("kind");
        }
        out.push(Diagnostic {
            severity: "error".into(),
            source: "project".into(),
            code: kind.into(),
            message: issue["message"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| details.to_string()),
            file: Some(input.display().to_string()),
            line: None,
            column: None,
        });
    }
    Ok(())
}
