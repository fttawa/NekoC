use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Project {
    pub path: PathBuf,
    pub byte_len: usize,
    pub value: Value,
    pub project_name: Option<String>,
    pub version: Option<String>,
    pub tool_type: Option<String>,
}

pub fn load_project(path: impl AsRef<Path>) -> Result<Project> {
    let path = path.as_ref();
    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let text = std::str::from_utf8(&bytes)
        .with_context(|| format!("{} is not valid UTF-8", path.display()))?;
    let value: Value = serde_json::from_str(text)
        .with_context(|| format!("invalid JSON in {}", path.display()))?;

    let Some(root) = value.as_object() else {
        bail!("{} must contain a JSON object at the root", path.display());
    };

    Ok(Project {
        path: path.to_path_buf(),
        byte_len: bytes.len(),
        project_name: string_field(root.get("projectName")),
        version: string_field(root.get("version")),
        tool_type: string_field(root.get("toolType")),
        value,
    })
}

pub fn roundtrip_project(input: impl AsRef<Path>, output: impl AsRef<Path>) -> Result<()> {
    let project = load_project(input)?;
    let bytes = serde_json::to_vec(&project.value).context("failed to serialize project JSON")?;
    fs::write(output.as_ref(), bytes)
        .with_context(|| format!("failed to write {}", output.as_ref().display()))?;
    load_project(output)?;
    Ok(())
}

fn string_field(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn load_project_reads_metadata() {
        let dir = tempdir().unwrap();
        let input = dir.path().join("valid.bcmkn");
        fs::write(
            &input,
            r#"{"projectName":"demo","version":"0.27.1","toolType":"KN"}"#,
        )
        .unwrap();

        let project = load_project(&input).unwrap();

        assert_eq!(project.project_name.as_deref(), Some("demo"));
        assert_eq!(project.version.as_deref(), Some("0.27.1"));
        assert_eq!(project.tool_type.as_deref(), Some("KN"));
        assert_eq!(
            project.byte_len,
            fs::metadata(input).unwrap().len() as usize
        );
    }
}
