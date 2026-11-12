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
    /// Optional frame-scoped exclusive view. Hosts hold it from refresh through
    /// commit, so read/modify/write blocks cannot lose concurrent process writes.
    /// Adapters without this facility use last-commit-wins frame snapshots.
    fn lock_frame(&self) -> Result<Option<std::sync::Arc<dyn CloudBackend>>> {
        Ok(None)
    }
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

/// Local-machine shared state. An OS lock on a stable sidecar file serializes
/// readers/writers across processes, including replacement of the data file.
/// The sidecar must not be removed while any player uses this profile.
pub struct FileCloudBackend {
    path: PathBuf,
}
impl FileCloudBackend {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
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
    fn write(&self, key: &CloudKey, value: &Value) -> Result<()> {
        use std::io::Write;
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

struct LockedFileCloudBackend {
    backend: FileCloudBackend,
    // Closing the handle releases the lock, including on early VM errors.
    _lock: std::fs::File,
}
impl CloudBackend for LockedFileCloudBackend {
    fn load(&self, key: &CloudKey) -> Result<Option<Value>> {
        Ok(self
            .backend
            .read()?
            .values
            .remove(&serde_json::to_string(key)?))
    }
    fn store(&self, key: &CloudKey, value: &Value) -> Result<()> {
        self.backend.write(key, value)
    }
}
impl CloudBackend for FileCloudBackend {
    fn load(&self, key: &CloudKey) -> Result<Option<Value>> {
        self.lock_frame()?.unwrap().load(key)
    }
    fn store(&self, key: &CloudKey, value: &Value) -> Result<()> {
        self.lock_frame()?.unwrap().store(key, value)
    }
    fn lock_frame(&self) -> Result<Option<std::sync::Arc<dyn CloudBackend>>> {
        let mut path = self.path.as_os_str().to_os_string();
        path.push(".lock");
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(PathBuf::from(path))
            .context("opening local cloud lock")?;
        lock.lock().context("locking local cloud profile")?;
        Ok(Some(std::sync::Arc::new(LockedFileCloudBackend {
            backend: Self::new(self.path.clone()),
            _lock: lock,
        })))
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
