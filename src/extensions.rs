//! Explicit, versioned host extensions. Projects never load executable code.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, rc::Rc};

pub const API_VERSION: u32 = 1;

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
}

impl BlockSchema {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.api_version == API_VERSION,
            "unsupported extension API version"
        );
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

/// Trusted host code. Never called concurrently; must return promptly.
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
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Capability policy, not an OS sandbox for trusted Rust/JS code.
    pub fn set_allow_network(&mut self, allow: bool) {
        self.allow_network = allow;
    }

    pub fn register(&mut self, schema: BlockSchema, handler: Rc<dyn Extension>) -> Result<()> {
        self.insert(schema, Some(handler))
    }

    /// Browser-backed blocks always cross a frame boundary and must be blocking.
    pub fn register_remote(&mut self, schema: BlockSchema) -> Result<()> {
        ensure!(schema.blocking, "remote extensions must be blocking");
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
            api_version: API_VERSION,
            opcode: "example.json.parse".into(),
            parameters: vec![Parameter {
                name: "text".into(),
                value_type: ValueType::String,
            }],
            returns: Some(ValueType::Any),
            blocking,
            network: false,
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
