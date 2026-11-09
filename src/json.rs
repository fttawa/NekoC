//! Resource-bounded project JSON, including stack-safe ownership operations.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::{Deref, DerefMut};

// 64 MiB matches the web import limit. 4096 containers accommodates a 2000-block
// next chain plus project/socket wrappers, without accepting arbitrary depth.
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_DEPTH: usize = 4096;
// Flat workspace graphs can describe paths deeper than their JSON document.
// Bound those independently before materializing a nested Value.
pub const MAX_BLOCK_PATH: usize = 4000;
// A comma/colon starts another element/member. Counting them conservatively
// bounds wide trees too (64 MiB of tiny numbers can otherwise allocate GBs).
// Largest regression corpus work uses 1,566,138 tokens; allow its canonical
// browser echo (which also retains the native source), with headroom.
pub const MAX_TOKENS: usize = 4_000_000;

/// Unlike bare Value, dropping this owner never recurses through a project tree.
#[derive(Debug, Default, Serialize)]
#[serde(transparent)]
pub struct Json(Value);

impl Json {
    pub fn new(value: Value) -> Self {
        Self(value)
    }
    /// Transfer ownership to a legacy API. The caller must use `discard` (or
    /// rewrap in Json) instead of recursively dropping a deeply nested Value.
    pub fn into_value(mut self) -> Value {
        self.0.take()
    }
}
impl From<Value> for Json {
    fn from(value: Value) -> Self {
        Self::new(value)
    }
}
impl PartialEq<Json> for Value {
    fn eq(&self, other: &Json) -> bool {
        equal(self, other)
    }
}
impl Deref for Json {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.0
    }
}
impl DerefMut for Json {
    fn deref_mut(&mut self) -> &mut Value {
        &mut self.0
    }
}
impl Clone for Json {
    fn clone(&self) -> Self {
        Self(clone_value(self))
    }
}
impl PartialEq<Value> for Json {
    fn eq(&self, other: &Value) -> bool {
        equal(self, other)
    }
}
impl PartialEq for Json {
    fn eq(&self, other: &Self) -> bool {
        equal(self, other)
    }
}
impl Drop for Json {
    fn drop(&mut self) {
        discard(self.0.take());
    }
}

pub fn discard(value: Value) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(items) => pending.extend(items),
            Value::Object(object) => pending.extend(object.into_values()),
            _ => {}
        }
    }
}

// A bounded fallback for serde's error cleanup and legacy Value operations.
// These run on a temporary stack, never by changing the caller/test thread size.
// 64 MiB provides 16 KiB/container at the 4096-container input limit. Besides
// cleanup it covers recursive Clone/Drop in existing json! conversions. Avoid
// repeated reservations when one protected operation calls another.
pub(crate) fn expanded<T>(f: impl FnOnce() -> T) -> T {
    thread_local! { static ACTIVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            ACTIVE.set(false);
        }
    }
    if ACTIVE.get() {
        return f();
    }
    stacker::grow(64 * 1024 * 1024, || {
        ACTIVE.set(true);
        let _reset = Reset;
        f()
    })
}

pub fn clone_value(value: &Value) -> Value {
    enum Work<'a> {
        Enter(&'a Value),
        Array(usize),
        Object(Vec<String>),
    }
    let mut work = vec![Work::Enter(value)];
    let mut output = Vec::new();
    while let Some(item) = work.pop() {
        match item {
            Work::Enter(Value::Array(items)) => {
                work.push(Work::Array(items.len()));
                work.extend(items.iter().rev().map(Work::Enter));
            }
            Work::Enter(Value::Object(object)) => {
                work.push(Work::Object(object.keys().cloned().collect()));
                work.extend(object.values().rev().map(Work::Enter));
            }
            Work::Enter(other) => output.push(other.clone()),
            Work::Array(len) => {
                let start = output.len() - len;
                let items = output.drain(start..).collect();
                output.push(Value::Array(items));
            }
            Work::Object(keys) => {
                let start = output.len() - keys.len();
                let object = keys.into_iter().zip(output.drain(start..)).collect();
                output.push(Value::Object(object));
            }
        }
    }
    output.pop().unwrap()
}

/// Validate canonical executable trees before entering recursive translators.
/// Metadata is deliberately not executable. `next` does not consume nesting.
pub fn check_blocks(project: &Value, limit: usize) -> Result<()> {
    let mut pending = Vec::new();
    for path in [
        "/scenes/scenesDict",
        "/actors/actorsDict",
        "/procedures/proceduresDict",
    ] {
        for owner in project
            .pointer(path)
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|o| o.values())
        {
            for root in owner["nekoBlockJsonList"].as_array().into_iter().flatten() {
                pending.push((root, 0, 0));
            }
        }
    }
    while let Some((block, depth, path_depth)) = pending.pop() {
        ensure!(
            depth <= limit,
            "block nesting exceeds {limit} at block {} ({})",
            block["id"],
            block["type"]
        );
        ensure!(
            path_depth <= MAX_BLOCK_PATH,
            "block path exceeds {MAX_BLOCK_PATH} at block {} ({})",
            block["id"],
            block["type"]
        );
        if let Some(next) = block.get("next") {
            pending.push((next, depth, path_depth + 1));
        }
        for key in ["inputs", "statements"] {
            for child in block
                .get(key)
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|c| c.values())
            {
                pending.push((child, depth + 1, path_depth + 1));
            }
        }
    }
    Ok(())
}

pub fn equal(left: &Value, right: &Value) -> bool {
    let mut pending = vec![(left, right)];
    while let Some((left, right)) = pending.pop() {
        match (left, right) {
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                pending.extend(a.iter().zip(b));
            }
            (Value::Object(a), Value::Object(b)) if a.len() == b.len() => {
                for (key, value) in a {
                    let Some(other) = b.get(key) else {
                        return false;
                    };
                    pending.push((value, other));
                }
            }
            (Value::Array(_) | Value::Object(_), _) => return false,
            _ if left != right => return false,
            _ => {}
        }
    }
    true
}

pub fn from_str(text: &str) -> Result<Json> {
    from_slice(text.as_bytes())
}

pub fn from_slice(bytes: &[u8]) -> Result<Json> {
    ensure!(bytes.len() <= MAX_BYTES, "project JSON exceeds 64 MiB");
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    // Scan before deserializing: bound even malformed JSON, and ignore brackets
    // in strings (including escaped quotes). Syntax is still checked by serde.
    let (mut depth, mut quoted, mut escaped) = (0usize, false, false);
    let mut tokens = 0;
    for (offset, &byte) in bytes.iter().enumerate() {
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
        } else {
            if matches!(byte, b'[' | b'{' | b',' | b':') {
                tokens += 1;
                ensure!(
                    tokens <= MAX_TOKENS,
                    "project JSON structural token limit {MAX_TOKENS} exceeded at byte {offset}"
                );
            }
            match byte {
                b'"' => quoted = true,
                b'[' | b'{' => {
                    depth += 1;
                    ensure!(
                        depth <= MAX_DEPTH,
                        "project JSON nesting exceeds {MAX_DEPTH} at byte {offset}"
                    );
                }
                b']' | b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
    }
    expanded(|| {
        let mut de = serde_json::Deserializer::from_slice(bytes);
        de.disable_recursion_limit();
        let value = Json::new(Value::deserialize(serde_stacker::Deserializer::new(
            &mut de,
        ))?);
        de.end()?;
        Ok(value)
    })
}

pub fn to_vec(value: &impl Serialize) -> Result<Vec<u8>> {
    expanded(|| {
        let mut bytes = Vec::new();
        let mut ser = serde_json::Serializer::new(&mut bytes);
        value.serialize(serde_stacker::Serializer::new(&mut ser))?;
        Ok(bytes)
    })
}

pub fn to_vec_pretty(value: &impl Serialize) -> Result<Vec<u8>> {
    expanded(|| {
        let mut bytes = Vec::new();
        let mut ser = serde_json::Serializer::pretty(&mut bytes);
        value.serialize(serde_stacker::Serializer::new(&mut ser))?;
        Ok(bytes)
    })
}
