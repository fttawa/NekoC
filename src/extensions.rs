//! Explicit, versioned host extensions. Projects never load executable code.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, rc::Rc, time::Duration};

pub const API_VERSION: u32 = 2;
pub const SUPPORTED_API_VERSIONS: [u32; 2] = [2, 1];

/// Select the highest common version; never silently downgrade a v2 schema.
pub fn negotiate_version(versions: &[u32]) -> Result<u32> {
    SUPPORTED_API_VERSIONS
        .into_iter()
        .find(|version| versions.contains(version))
        .context("no common extension API version")
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    #[default]
    Command,
    Reporter,
    Boolean,
    Hat,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BlockMetadata {
    pub name: String,
    pub category: String,
}

/// Fail-fast remains available for v1 hosts. Report stops only the calling task;
/// DefaultValue reports the error and continues with a typed neutral result.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ErrorPolicy {
    #[default]
    Propagate,
    Report,
    DefaultValue,
}

#[derive(Clone, Copy, Debug)]
pub struct CallPolicy {
    pub timeout: Duration,
    pub errors: ErrorPolicy,
}

impl Default for CallPolicy {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(1),
            errors: ErrorPolicy::Propagate,
        }
    }
}

impl CallPolicy {
    pub fn validate(self) -> Result<()> {
        ensure!(
            self.timeout >= Duration::from_millis(1) && self.timeout <= Duration::from_secs(60),
            "extension timeout must be between 1 ms and 60 s"
        );
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValueType {
    Number,
    String,
    Boolean,
    List,
    Any,
}

impl ValueType {
    pub fn validate(self, value: &Value) -> Result<()> {
        validate_value(value, 0)?;
        ensure!(
            match self {
                Self::Number => value.is_number(),
                Self::String => value.is_string(),
                Self::Boolean => value.is_boolean(),
                Self::List => value.is_array(),
                Self::Any => true,
            },
            "extension expected {self:?}"
        );
        Ok(())
    }
}

fn validate_value(value: &Value, depth: usize) -> Result<()> {
    ensure!(depth <= 32, "extension value exceeds depth 32");
    ensure!(
        !value.is_object(),
        "extension object values are not supported"
    );
    if let Some(items) = value.as_array() {
        ensure!(items.len() <= 4096, "extension list exceeds 4096 items");
        for item in items {
            validate_value(item, depth + 1)?;
        }
    }
    ensure!(
        value.to_string().len() <= 65536,
        "extension value exceeds 64 KiB"
    );
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub name: String,
    pub value_type: ValueType,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BlockSchema {
    pub api_version: u32,
    /// Namespaced ID, for example `example.json.parse`.
    pub opcode: String,
    pub parameters: Vec<Parameter>,
    /// None means a command returning JSON null.
    pub returns: Option<ValueType>,
    pub blocking: bool,
    #[serde(default)]
    pub network: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<BlockKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BlockMetadata>,
}

impl BlockSchema {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            SUPPORTED_API_VERSIONS.contains(&self.api_version),
            "unsupported extension API version"
        );
        ensure!(
            self.api_version == 2 || (self.kind.is_none() && self.metadata.is_none()),
            "v2 extension fields require API version 2"
        );
        if let Some(metadata) = &self.metadata {
            ensure!(
                !metadata.name.is_empty()
                    && metadata.name.len() <= 128
                    && !metadata.category.is_empty()
                    && metadata.category.len() <= 128,
                "invalid extension block metadata"
            );
        }
        match self.block_kind() {
            BlockKind::Command => {}
            BlockKind::Reporter => ensure!(
                self.returns.is_some(),
                "extension reporter needs a return type"
            ),
            BlockKind::Boolean => ensure!(
                self.returns == Some(ValueType::Boolean),
                "extension boolean must return boolean"
            ),
            BlockKind::Hat => ensure!(
                self.returns.is_none() && !self.blocking && self.parameters.is_empty(),
                "extension hat cannot have parameters, return values or blocking calls"
            ),
        }
        ensure!(
            self.opcode.len() <= 128 && self.opcode.contains('.'),
            "extension opcode needs a namespace"
        );
        ensure!(
            self.opcode
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)),
            "invalid extension opcode"
        );
        ensure!(self.parameters.len() <= 32, "too many extension parameters");
        let mut names = std::collections::BTreeSet::new();
        for p in &self.parameters {
            ensure!(
                !p.name.is_empty() && p.name.len() <= 64 && names.insert(&p.name),
                "invalid or duplicate extension parameter"
            );
        }
        Ok(())
    }

    pub fn block_kind(&self) -> BlockKind {
        self.kind.unwrap_or_default()
    }

    pub fn default_result(&self) -> Value {
        match self.returns {
            Some(ValueType::Number) => Value::from(0),
            Some(ValueType::String) => Value::String(String::new()),
            Some(ValueType::Boolean) => Value::Bool(false),
            Some(ValueType::List) => Value::Array(Vec::new()),
            Some(ValueType::Any) | None => Value::Null,
        }
    }

    pub fn validate_arguments(&self, arguments: &[Value]) -> Result<()> {
        ensure!(
            arguments.len() == self.parameters.len(),
            "extension argument count mismatch"
        );
        for (p, value) in self.parameters.iter().zip(arguments) {
            p.value_type
                .validate(value)
                .with_context(|| format!("{} parameter {}", self.opcode, p.name))?;
        }
        Ok(())
    }

    pub fn validate_result(&self, value: &Value) -> Result<()> {
        if let Some(kind) = self.returns {
            kind.validate(value)
        } else {
            ensure!(value.is_null(), "extension command must return null");
            Ok(())
        }
    }
}

/// Trusted host code. Never called concurrently; must return promptly. The host
/// catches unwinding panics and rejects over-budget results, but cannot preempt
/// a synchronous handler. Blocking I/O belongs in a Pending host job.
/// Pending is completed using Engine::complete_extension with the supplied ID.
pub trait Extension: std::fmt::Debug {
    fn call(&self, request: &ExtensionRequest) -> Result<CallResult>;
}

#[derive(Debug)]
pub enum CallResult {
    Ready(Value),
    Pending,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExtensionRequest {
    pub id: u64,
    pub opcode: String,
    pub arguments: Vec<Value>,
    pub actor: String,
}

#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub schema: BlockSchema,
    pub handler: Option<Rc<dyn Extension>>,
}

/// Host-owned allowlist, immutable once copied into a compiled program.
#[derive(Clone, Debug, Default)]
pub struct ExtensionRegistry {
    pub(crate) entries: BTreeMap<String, Entry>,
    allow_network: bool,
    pub(crate) policy: CallPolicy,
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Capability policy, not an OS sandbox for trusted Rust/JS code.
    pub fn set_allow_network(&mut self, allow: bool) {
        self.allow_network = allow;
    }

    pub fn set_call_policy(&mut self, policy: CallPolicy) -> Result<()> {
        policy.validate()?;
        self.policy = policy;
        Ok(())
    }

    /// Detached metadata for editor/palette generation, including v1 entries.
    pub fn schemas(&self) -> Vec<BlockSchema> {
        self.entries
            .values()
            .map(|entry| entry.schema.clone())
            .collect()
    }

    pub fn register_hat(&mut self, schema: BlockSchema) -> Result<()> {
        ensure!(
            schema.block_kind() == BlockKind::Hat,
            "expected extension hat"
        );
        self.insert(schema, None)
    }

    pub fn register(&mut self, schema: BlockSchema, handler: Rc<dyn Extension>) -> Result<()> {
        ensure!(
            schema.block_kind() != BlockKind::Hat,
            "extension hats use register_hat"
        );
        self.insert(schema, Some(handler))
    }

    /// Browser-backed blocks always cross a frame boundary and must be blocking.
    pub fn register_remote(&mut self, schema: BlockSchema) -> Result<()> {
        ensure!(
            schema.blocking || schema.block_kind() == BlockKind::Hat,
            "remote extensions must be blocking"
        );
        self.insert(schema, None)
    }

    fn insert(&mut self, schema: BlockSchema, handler: Option<Rc<dyn Extension>>) -> Result<()> {
        schema.validate()?;
        ensure!(
            !schema.network || self.allow_network,
            "extension network capability is disabled"
        );
        ensure!(
            !self.entries.contains_key(&schema.opcode),
            "duplicate extension opcode {}",
            schema.opcode
        );
        ensure!(self.entries.len() < 256, "too many extension blocks");
        self.entries
            .insert(schema.opcode.clone(), Entry { schema, handler });
        Ok(())
    }
}

/// Offline example: JSON scalars/arrays only; objects are intentionally rejected.
#[derive(Debug)]
pub struct JsonParse;

impl JsonParse {
    pub fn schema(blocking: bool) -> BlockSchema {
        BlockSchema {
            api_version: 1,
            opcode: "example.json.parse".into(),
            parameters: vec![Parameter {
                name: "text".into(),
                value_type: ValueType::String,
            }],
            returns: Some(ValueType::Any),
            blocking,
            network: false,
            kind: None,
            metadata: None,
        }
    }
}

impl Extension for JsonParse {
    fn call(&self, request: &ExtensionRequest) -> Result<CallResult> {
        let text = request
            .arguments
            .first()
            .and_then(Value::as_str)
            .context("JSON parse expects text")?;
        if text.len() > 65536 {
            bail!("JSON input exceeds 64 KiB");
        }
        let value: Value = serde_json::from_str(text).context("invalid extension JSON")?;
        ValueType::Any.validate(&value)?;
        Ok(CallResult::Ready(value))
    }
}
