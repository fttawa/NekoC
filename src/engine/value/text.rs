//! Immutable concatenation trees. Sharing a text never exposes mutable bytes.
//!
//! Keep concatenation O(1), including when an old value is held by a variable or
//! list. Consumers needing contiguous UTF-8 use a per-node, immutable flat cache.
//! Traversal and destruction use O(depth) work stacks, not the Rust call stack.
//! Observing many already-linked prefixes can retain multiple flat caches; this
//! representation does not promise bounded memory for that access pattern.
use std::{cell::OnceCell, fmt, ops::Deref, rc::Rc};

#[derive(Clone)]
pub struct Text(Rc<Node>);

struct Node {
    len: usize,
    invalid_number: bool,
    flat: OnceCell<Rc<str>>,
    children: Option<(Text, Text)>,
}

impl Text {
    pub fn concat(a: &Self, b: &Self) -> Self {
        if a.is_empty() {
            return b.clone();
        }
        if b.is_empty() {
            return a.clone();
        }
        Self(Rc::new(Node {
            len: a.len().checked_add(b.len()).expect("text length overflow"),
            invalid_number: a.0.invalid_number || b.0.invalid_number,
            flat: OnceCell::new(),
            children: Some((a.for_concat(), b.for_concat())),
        }))
    }

    fn for_concat(&self) -> Self {
        // A previously observed prefix must not keep every earlier tree/cache
        // alive as it grows across frames. Reuse its flat bytes as a new leaf.
        if self.0.children.is_some()
            && let Some(flat) = self.0.flat.get()
        {
            Self(Rc::new(Node {
                len: self.len(),
                invalid_number: self.0.invalid_number,
                flat: OnceCell::from(flat.clone()),
                children: None,
            }))
        } else {
            self.clone()
        }
    }

    /// Byte length, without forcing a tree into contiguous storage.
    pub fn len(&self) -> usize {
        self.0.len
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn number(&self) -> f64 {
        // Assignment maintains a numeric mirror even for text. Do not flatten
        // every growing prefix just to reject an impossible Number spelling.
        // This alphabet is a conservative superset of decimal, radix, Infinity
        // and JS whitespace. Non-ASCII always takes the original parser path.
        if self.0.invalid_number {
            f64::NAN
        } else {
            crate::js_number::parse(self)
        }
    }

    /// Iterative traversal also handles deeply left- or right-associated joins.
    pub fn append_to(&self, out: &mut String) {
        let mut pending = Vec::new();
        let mut current = self;
        loop {
            if let Some(flat) = current.0.flat.get() {
                out.push_str(flat);
            } else if let Some((left, right)) = &current.0.children {
                pending.push(right);
                current = left;
                continue;
            }
            match pending.pop() {
                Some(next) => current = next,
                None => break,
            }
        }
    }
}

impl Deref for Text {
    type Target = str;

    fn deref(&self) -> &str {
        self.0.flat.get_or_init(|| {
            let mut flat = String::with_capacity(self.len());
            self.append_to(&mut flat);
            flat.into()
        })
    }
}

impl AsRef<str> for Text {
    fn as_ref(&self) -> &str {
        self
    }
}

impl From<String> for Text {
    fn from(flat: String) -> Self {
        Self(Rc::new(Node {
            len: flat.len(),
            invalid_number: invalid_number(&flat),
            flat: OnceCell::from(Rc::<str>::from(flat)),
            children: None,
        }))
    }
}

impl From<&str> for Text {
    fn from(flat: &str) -> Self {
        Self(Rc::new(Node {
            len: flat.len(),
            invalid_number: invalid_number(flat),
            flat: OnceCell::from(Rc::<str>::from(flat)),
            children: None,
        }))
    }
}

fn invalid_number(flat: &str) -> bool {
    flat.bytes().any(|b| {
        b.is_ascii()
            && !matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F'
                | b'x' | b'X' | b'o' | b'O' | b'I' | b'n' | b'i' | b't' | b'y'
                | b'+' | b'-' | b'.' | b' ' | b'\t'..=b'\r')
    })
}

impl fmt::Display for Text {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self.as_ref(), f)
    }
}

impl fmt::Debug for Text {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self.as_ref(), f)
    }
}

impl PartialEq for Text {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
            || (self.len() == other.len() && self.as_ref() == other.as_ref())
    }
}
impl Eq for Text {}

impl PartialOrd for Text {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Text {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        if Rc::ptr_eq(&self.0, &other.0) {
            std::cmp::Ordering::Equal
        } else {
            self.as_ref().cmp(other.as_ref())
        }
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        // Rc's default recursive destruction would overflow on a long chain.
        // Only unwrap uniquely owned nodes: aliases (including cached texts)
        // remain intact and will drain their own descendants when last dropped.
        let Some((left, right)) = self.children.take() else {
            return;
        };
        let mut pending = vec![left.0, right.0];
        while let Some(node) = pending.pop() {
            if let Ok(mut node) = Rc::try_unwrap(node)
                && let Some((left, right)) = node.children.take()
            {
                pending.push(left.0);
                pending.push(right.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_chains_flatten_and_drop_without_recursion() {
        for prepend in [false, true] {
            let unit = Text::from("猫ab");
            let mut text = Text::from("");
            for _ in 0..100_000 {
                text = if prepend {
                    Text::concat(&unit, &text)
                } else {
                    Text::concat(&text, &unit)
                };
            }
            assert_eq!(text.len(), 500_000);
            assert!(text.0.flat.get().is_none());
            assert_eq!(text.as_ref(), "猫ab".repeat(100_000));
            let pointer = text.as_ptr();
            assert_eq!(text.as_ptr(), pointer);
        }
    }

    #[test]
    fn shared_prefix_and_flat_cache_are_immutable() {
        let prefix = Text::concat(&"old".into(), &"猫".into());
        let suffix = Text::from("new");
        let joined = Text::concat(&prefix, &suffix);
        assert_eq!(prefix.as_ref(), "old猫");
        assert_eq!(joined.as_ref(), "old猫new");
        assert_eq!(Text::concat(&joined, &joined).as_ref(), "old猫newold猫new");
        assert_eq!(prefix.as_ref(), "old猫");
    }

    #[test]
    fn observed_prefix_detaches_from_old_tree_without_copying_bytes() {
        let prefix = Text::concat(&"a".into(), &"b".into());
        let pointer = prefix.as_ptr();
        let joined = Text::concat(&prefix, &"c".into());
        let (left, _) = joined.0.children.as_ref().unwrap();
        assert!(left.0.children.is_none());
        assert_eq!(left.as_ptr(), pointer);
        assert_eq!(joined.as_ref(), "abc");
    }

    #[test]
    fn unobserved_chain_and_shared_dag_drop_iteratively() {
        let unit = Text::from("x");
        let mut text = unit.clone();
        for _ in 0..100_000 {
            text = Text::concat(&text, &unit);
        }
        assert!(text.0.flat.get().is_none());
        let alias = text.clone();
        let dag = Text::concat(&text, &text);
        drop(text);
        drop(dag);
        assert_eq!(alias.len(), 100_001);
        drop(alias);
        assert_eq!(unit.as_ref(), "x");
    }

    #[test]
    fn diamond_dag_last_owner_drop_and_identity_comparison() {
        let mut text = Text::from("x");
        for _ in 0..(usize::BITS - 2).min(40) {
            text = Text::concat(&text, &text);
        }
        // A small DAG can represent a terabyte. Identity must not flatten it.
        assert!(text == text.clone());
        assert_eq!(text.cmp(&text), std::cmp::Ordering::Equal);
        assert!(text.0.flat.get().is_none());
        drop(text);
    }

    #[test]
    fn numeric_mirror_shortcut_only_rejects_impossible_spellings() {
        for value in [
            "",
            "12.5",
            "-0",
            "1e+21",
            "0xabcdef",
            "0B101",
            "0o77",
            "Infinity",
            "+Infinity",
            "-Infinity",
            "\u{feff}\u{2000}12\r",
            "NaN",
            "abcdefgh",
            "deadbeef",
            "猫",
            "😀",
            "inf",
            "1\u{0085}",
        ] {
            for at in value.char_indices().map(|(i, _)| i).chain([value.len()]) {
                let text = Text::concat(&value[..at].into(), &value[at..].into());
                let actual = text.number();
                let expected = crate::js_number::parse(value);
                assert!(
                    actual.to_bits() == expected.to_bits() || actual.is_nan() && expected.is_nan(),
                    "{value:?} at {at}"
                );
            }
        }
        let text = Text::concat(&"abc".into(), &"g".into());
        assert!(text.number().is_nan());
        assert!(text.0.flat.get().is_none());
        for byte in 0..=127u8 {
            for value in [format!("{}12", byte as char), format!("12{}", byte as char)] {
                let text = Text::concat(&value[..1].into(), &value[1..].into());
                let actual = text.number();
                let expected = crate::js_number::parse(&value);
                assert!(
                    actual.to_bits() == expected.to_bits() || actual.is_nan() && expected.is_nan(),
                    "ASCII {byte}: {value:?}"
                );
            }
        }
    }
}
