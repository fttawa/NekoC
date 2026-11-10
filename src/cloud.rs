//! Explicit local simulation, not a connection to Codemao's cloud service.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloudKey {
    pub project: String,
    pub variable: String,
    /// Only private variables use an identity. This is a local profile, not login.
    pub user: Option<String>,
}

/// A missing value keeps the official offline default (0 / []). Errors propagate.
/// An optional HTTP adapter can implement this boundary; no HTTP client, credentials,
/// invented rankings or implicit network access are supplied by NekoC.
pub trait CloudBackend: Send + Sync {
    fn load(&self, key: &CloudKey) -> Result<Option<Value>>;
    fn store(&self, key: &CloudKey, value: &Value) -> Result<()>;
}

#[derive(Default)]
pub struct MemoryCloudBackend {
    values: Mutex<BTreeMap<String, Value>>,
}
impl CloudBackend for MemoryCloudBackend {
    fn load(&self, key: &CloudKey) -> Result<Option<Value>> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(&serde_json::to_string(key)?)
            .cloned())
    }
    fn store(&self, key: &CloudKey, value: &Value) -> Result<()> {
        self.values
            .lock()
            .unwrap()
            .insert(serde_json::to_string(key)?, value.clone());
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileData {
    version: u32,
    values: BTreeMap<String, Value>,
}

/// Share one instance between local sessions. Serializes threads in this process;
/// multiple processes writing the same file are deliberately unsupported.
pub struct FileCloudBackend {
    path: PathBuf,
    lock: Mutex<()>,
}
impl FileCloudBackend {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }
    fn read(&self) -> Result<FileData> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                let data: FileData =
                    serde_json::from_slice(&bytes).context("invalid local cloud file")?;
                ensure!(data.version == 1, "unsupported local cloud file version");
                Ok(data)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileData {
                version: 1,
                values: BTreeMap::new(),
            }),
            Err(e) => Err(e).context("reading local cloud file"),
        }
    }
}
impl CloudBackend for FileCloudBackend {
    fn load(&self, key: &CloudKey) -> Result<Option<Value>> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.read()?.values.remove(&serde_json::to_string(key)?))
    }
    fn store(&self, key: &CloudKey, value: &Value) -> Result<()> {
        use std::io::Write;
        let _guard = self.lock.lock().unwrap();
        let mut data = self.read()?;
        data.values
            .insert(serde_json::to_string(key)?, value.clone());
        let parent = self
            .path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(&mut file, &data)?;
        file.flush()?;
        file.as_file().sync_all()?;
        file.persist(&self.path)
            .context("persisting local cloud file")?;
        Ok(())
    }
}

/// Shared by the trace CLI and web host. File paths come only from host flags,
/// never from a project or a browser request.
#[derive(Clone, Debug, Default, clap::Args)]
pub struct CloudOptions {
    #[arg(long, requires = "cloud_namespace", conflicts_with = "cloud_memory")]
    pub cloud_file: Option<PathBuf>,
    #[arg(long, requires = "cloud_namespace")]
    pub cloud_memory: bool,
    #[arg(long)]
    pub cloud_namespace: Option<String>,
    #[arg(long, default_value = "anonymous")]
    pub cloud_user: String,
}
impl CloudOptions {
    pub fn backend(&self) -> Option<std::sync::Arc<dyn CloudBackend>> {
        if let Some(path) = &self.cloud_file {
            Some(std::sync::Arc::new(FileCloudBackend::new(path.clone())))
        } else if self.cloud_memory {
            Some(std::sync::Arc::new(MemoryCloudBackend::default()))
        } else {
            None
        }
    }
}
