//! Resource-bounded project JSON, including stack-safe ownership operations.
use anyhow::{Context, Result, ensure};
use serde::Serialize;
use serde_json::Value;
use std::ops::{Deref, DerefMut};

// A block socket uses two JSON containers. Leave room for 10,000 sockets and
// project wrappers, while keeping byte/token/path resource budgets independent.
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_DEPTH: usize = 32_768;
pub const MAX_BLOCK_DEPTH: usize = 10_000;
// Flat workspace graphs can describe paths deeper than their JSON document.
// Bound those independently before materializing a nested Value.
pub const MAX_BLOCK_PATH: usize = 20_000;
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
// Retained for legacy diagnostic/json! conversions. Parsing and ownership of
// deep project trees use explicit stacks; this is not their depth mechanism.
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
    clone_bounded(value, 0)
}

fn clone_bounded(value: &Value, depth: usize) -> Value {
    // Avoid traversal allocations for ordinary shallow objects, but never let
    // this fast path grow with the depth of a project or a next-block chain.
    if depth >= 16 {
        return clone_iterative(value);
    }
    match value {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|value| clone_bounded(value, depth + 1))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), clone_bounded(value, depth + 1)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn clone_iterative(value: &Value) -> Value {
    fn scalar(value: &Value) -> bool {
        !matches!(value, Value::Array(_) | Value::Object(_))
    }
    enum Work<'a> {
        Enter(&'a Value),
        Array(usize),
        Object(&'a serde_json::Map<String, Value>),
    }
    let mut work = vec![Work::Enter(value)];
    let mut output = Vec::new();
    while let Some(item) = work.pop() {
        match item {
            // Fields/params and numeric arrays are common beside deep block
            // chains. Their clone is bounded to one container, so avoid a work
            // item and output-stack round trip for every scalar member.
            Work::Enter(Value::Array(items)) if items.iter().all(scalar) => {
                output.push(Value::Array(items.clone()));
            }
            Work::Enter(Value::Object(object)) if object.values().all(scalar) => {
                output.push(Value::Object(object.clone()));
            }
            Work::Enter(Value::Array(items)) => {
                work.push(Work::Array(items.len()));
                work.extend(items.iter().rev().map(Work::Enter));
            }
            Work::Enter(Value::Object(object)) => {
                work.push(Work::Object(object));
                work.extend(object.values().rev().map(Work::Enter));
            }
            Work::Enter(other) => output.push(other.clone()),
            Work::Array(len) => {
                let start = output.len() - len;
                let items = output.drain(start..).collect();
                output.push(Value::Array(items));
            }
            Work::Object(source) => {
                let start = output.len() - source.len();
                let object = source.keys().cloned().zip(output.drain(start..)).collect();
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

/// K4 object insertion order is executable state (script/typeclass order).
/// Keep ordinary document equality order-insensitive, but never reuse a native
/// import cache across two differently ordered source objects.
pub(crate) fn ordered_equal(left: &Value, right: &Value) -> bool {
    let mut pending = vec![(left, right)];
    while let Some((left, right)) = pending.pop() {
        match (left, right) {
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                pending.extend(a.iter().zip(b))
            }
            (Value::Object(a), Value::Object(b)) if a.len() == b.len() => {
                for ((ka, va), (kb, vb)) in a.iter().zip(b) {
                    if ka != kb {
                        return false;
                    }
                    pending.push((va, vb));
                }
            }
            (Value::Array(_) | Value::Object(_), _) => return false,
            _ if left != right => return false,
            _ => {}
        }
    }
    true
}

/// Restore KN's historical key order without recursing through deep blocks.
/// K4 retains insertion order and must never pass through this normalization.
pub(crate) fn sort_objects(value: &mut Value) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(object) => {
                object.sort_keys();
                pending.extend(object.values_mut());
            }
            Value::Array(items) => pending.extend(items),
            _ => {}
        }
    }
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
    let mut deepest = 0;
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
                    deepest = deepest.max(depth);
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
    // Ordinary documents keep serde's optimized container path. Its bounded
    // recursion is safe here; only deep documents need the explicit heap stack.
    if deepest <= 64 {
        Ok(Json::new(serde_json::from_slice(bytes)?))
    } else {
        parse_iterative(bytes)
    }
}

// Serde still validates scalar spelling/UTF-8/numbers. Container syntax and
// ownership live on this heap stack, including cleanup of malformed input.
fn parse_iterative(bytes: &[u8]) -> Result<Json> {
    enum Frame {
        Array(Vec<Value>, bool),
        Object(serde_json::Map<String, Value>, Option<String>, bool),
    }
    impl Drop for Frame {
        fn drop(&mut self) {
            match self {
                Self::Array(items, _) => discard(Value::Array(std::mem::take(items))),
                Self::Object(items, _, _) => discard(Value::Object(std::mem::take(items))),
            }
        }
    }
    let mut stack: Vec<Frame> = Vec::new();
    let mut root = Json::default();
    let mut complete = false;
    let mut at = 0;
    loop {
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            // JSON permits only these four whitespace bytes.
            ensure!(
                matches!(bytes[at], b' ' | b'\r' | b'\n' | b'\t'),
                "invalid JSON whitespace at byte {at}"
            );
            at += 1;
        }
        let byte = bytes.get(at).copied();
        let mut closed = None;
        match stack.last_mut() {
            Some(Frame::Array(items, after)) if *after => match byte {
                Some(b',') => {
                    *after = false;
                    at += 1;
                    continue;
                }
                Some(b']') => closed = Some(Value::Array(std::mem::take(items))),
                _ => anyhow::bail!("expected ',' or ']' at byte {at}"),
            },
            Some(Frame::Array(items, false)) if items.is_empty() && byte == Some(b']') => {
                closed = Some(Value::Array(Vec::new()));
            }
            Some(Frame::Object(items, key, after)) if key.is_none() => {
                if *after {
                    match byte {
                        Some(b',') => {
                            *after = false;
                            at += 1;
                            continue;
                        }
                        Some(b'}') => closed = Some(Value::Object(std::mem::take(items))),
                        _ => anyhow::bail!("expected ',' or '}}' at byte {at}"),
                    }
                } else if items.is_empty() && byte == Some(b'}') {
                    closed = Some(Value::Object(serde_json::Map::new()));
                } else {
                    ensure!(byte == Some(b'"'), "expected object key at byte {at}");
                    let mut stream =
                        serde_json::Deserializer::from_slice(&bytes[at..]).into_iter::<String>();
                    *key = Some(stream.next().context("missing object key")??);
                    at += stream.byte_offset();
                    while bytes
                        .get(at)
                        .is_some_and(|b| matches!(b, b' ' | b'\r' | b'\n' | b'\t'))
                    {
                        at += 1;
                    }
                    ensure!(bytes.get(at) == Some(&b':'), "expected ':' at byte {at}");
                    at += 1;
                    continue;
                }
            }
            None if complete => {
                ensure!(byte.is_none(), "trailing characters at byte {at}");
                return Ok(root);
            }
            _ => {}
        }
        let value = if let Some(value) = closed {
            stack.pop();
            at += 1;
            value
        } else {
            match byte {
                Some(b'[') => {
                    stack.push(Frame::Array(Vec::new(), false));
                    at += 1;
                    continue;
                }
                Some(b'{') => {
                    stack.push(Frame::Object(serde_json::Map::new(), None, false));
                    at += 1;
                    continue;
                }
                Some(b'"' | b'-' | b'0'..=b'9' | b't' | b'f' | b'n') => {
                    let mut stream =
                        serde_json::Deserializer::from_slice(&bytes[at..]).into_iter::<Value>();
                    let value = stream.next().context("missing JSON value")??;
                    at += stream.byte_offset();
                    value
                }
                _ => anyhow::bail!("expected JSON value at byte {at}"),
            }
        };
        match stack.last_mut() {
            Some(Frame::Array(items, after)) => {
                items.push(value);
                *after = true;
            }
            Some(Frame::Object(items, key, after)) => {
                if let Some(old) = items.insert(key.take().unwrap(), value) {
                    discard(old);
                }
                *after = true;
            }
            None => {
                root = Json::new(value);
                complete = true;
            }
        }
    }
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
