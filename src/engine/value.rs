//! Non-numeric values live beside numeric slots, keeping arithmetic unboxed.
use anyhow::Result;
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::{cell::RefCell, rc::Rc};

pub type List = Rc<RefCell<Vec<Cell>>>;
pub type Object = Rc<RefCell<Vec<(String, Cell)>>>;
// repr(u8): native code tests the tag byte of `Option<Cell>`; see jit::none_tag.
#[derive(Clone, Debug)]
#[repr(u8)]
pub enum Cell {
    Number(f64),
    Bool(bool),
    Text(Rc<str>),
    List(List),
    Null,
    /// Official K4 costume dropdown value: a fresh {style_id: string} object.
    Costume(Rc<str>),
    /// KN object properties preserve insertion order and reference identity.
    Object(Object),
    /// Missing JS object property; distinct from JSON null and numeric NaN.
    Undefined,
    /// K4 midi_get returns a fresh {id: value}, not a numeric piano key.
    Midi(Rc<Cell>),
}
impl Cell {
    /// Strict equality search, with the needle tag dispatched once rather than
    /// once per item. Lists/costumes retain reference identity, NaN never matches.
    #[inline]
    pub fn index_in(&self, items: &[Cell]) -> Option<usize> {
        match self {
            Self::Number(needle) => {
                // Batch the negative-search common case without changing the
                // first-match result or coercing mixed-type list elements.
                let equal = |v: &Cell| matches!(v, Self::Number(n) if n == needle);
                let mut chunks = items.chunks_exact(4);
                for (i, chunk) in chunks.by_ref().enumerate() {
                    let hits = [
                        equal(&chunk[0]),
                        equal(&chunk[1]),
                        equal(&chunk[2]),
                        equal(&chunk[3]),
                    ];
                    if hits.iter().any(|&v| v) {
                        return Some(i * 4 + hits.iter().position(|&v| v).unwrap());
                    }
                }
                let rest = chunks.remainder();
                rest.iter()
                    .position(equal)
                    .map(|i| items.len() - rest.len() + i)
            }
            _ => items.iter().position(|v| v.equals(self)),
        }
    }
    /// Reserve the complete size for the common text+text case. No scalar
    /// temporary strings and no geometric growth/copy of a long left operand.
    pub fn concat(a: &Self, b: &Self) -> Self {
        let capacity = match (a, b) {
            (Self::Text(a), Self::Text(b)) => a.len().saturating_add(b.len()),
            (Self::Text(s), _) | (_, Self::Text(s)) => s.len().saturating_add(24),
            _ => 48,
        };
        let mut out = String::with_capacity(capacity);
        a.append_text(&mut out);
        b.append_text(&mut out);
        Self::Text(out.into())
    }
    pub fn from_json(value: &Value) -> Result<Self> {
        Ok(match value {
            Value::Null => Self::Null,
            Value::Bool(v) => Self::Bool(*v),
            Value::Number(v) => Self::Number(v.as_f64().unwrap_or(f64::NAN)),
            Value::String(v) => Self::Text(v.as_str().into()),
            Value::Array(v) => Self::List(Rc::new(RefCell::new(
                v.iter().map(Self::from_json).collect::<Result<_>>()?,
            ))),
            Value::Object(v) => Self::Object(Rc::new(RefCell::new(
                v.iter()
                    .map(|(k, v)| Ok((k.clone(), Self::from_json(v)?)))
                    .collect::<Result<_>>()?,
            ))),
        })
    }
    pub fn number(&self) -> f64 {
        match self {
            Self::Number(n) => *n,
            Self::Bool(v) => u8::from(*v) as f64,
            Self::Null => 0.0,
            Self::Text(s) => crate::js_number::parse(s),
            Self::List(_)
            | Self::Costume(_)
            | Self::Object(_)
            | Self::Undefined
            | Self::Midi(_) => f64::NAN,
        }
    }
    pub fn text(&self) -> String {
        self.text_with_js_nonfinite(false)
    }
    /// Both official products use JS String(number), including exponent notation.
    pub fn text_with_js_nonfinite(&self, _js_nonfinite: bool) -> String {
        self.text_guarded(&mut Vec::new())
    }
    fn text_guarded(&self, active: &mut Vec<usize>) -> String {
        match self {
            Self::Number(n) => crate::js_number::text(*n),
            Self::Bool(v) => v.to_string(),
            Self::Text(s) => s.to_string(),
            Self::Null => String::new(),
            Self::Costume(_) | Self::Object(_) | Self::Midi(_) => "[object Object]".into(),
            Self::Undefined => "undefined".into(),
            Self::List(v) => {
                let pointer = Rc::as_ptr(v) as usize;
                if active.contains(&pointer) || active.len() >= 128 {
                    return String::new();
                }
                active.push(pointer);
                let text = v
                    .borrow()
                    .iter()
                    .map(|v| {
                        if matches!(v, Self::Undefined | Self::Null) {
                            String::new()
                        } else {
                            v.text_guarded(active)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                active.pop();
                text
            }
        }
    }
    /// Appends `text()` without an intermediate allocation for scalar values.
    pub fn append_text(&self, out: &mut String) {
        self.append_text_with_js_nonfinite(out, false);
    }
    pub fn append_text_with_js_nonfinite(&self, out: &mut String, js_nonfinite: bool) {
        match self {
            Self::Number(n) => out.push_str(ryu_js::Buffer::new().format(*n)),
            Self::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Self::Text(s) => out.push_str(s),
            Self::Null => {}
            Self::Costume(_) | Self::Object(_) | Self::Midi(_) => out.push_str("[object Object]"),
            Self::Undefined => out.push_str("undefined"),
            Self::List(_) => out.push_str(&self.text_with_js_nonfinite(js_nonfinite)),
        }
    }
    pub fn truth(&self) -> bool {
        match self {
            Self::Number(n) => super::truth(*n),
            Self::Bool(b) => *b,
            Self::Text(s) => !s.is_empty(),
            Self::List(_) | Self::Costume(_) | Self::Object(_) | Self::Midi(_) => true,
            Self::Null | Self::Undefined => false,
        }
    }
    pub fn deep_clone(&self) -> Self {
        fn copy(value: &Cell, seen: &mut std::collections::BTreeMap<(bool, usize), Cell>) -> Cell {
            let key = match value {
                Cell::List(v) => (false, Rc::as_ptr(v) as usize),
                Cell::Object(v) => (true, Rc::as_ptr(v) as usize),
                Cell::Midi(id) => return Cell::Midi(Rc::new(copy(id, seen))),
                _ => return value.clone(),
            };
            if let Some(value) = seen.get(&key) {
                return value.clone();
            }
            match value {
                Cell::List(v) => {
                    let out = Rc::new(RefCell::new(Vec::new()));
                    let cell = Cell::List(out.clone());
                    seen.insert(key, cell.clone());
                    *out.borrow_mut() = v.borrow().iter().map(|v| copy(v, seen)).collect();
                    cell
                }
                Cell::Object(v) => {
                    let out = Rc::new(RefCell::new(Vec::new()));
                    let cell = Cell::Object(out.clone());
                    seen.insert(key, cell.clone());
                    *out.borrow_mut() = v
                        .borrow()
                        .iter()
                        .map(|(k, v)| (k.clone(), copy(v, seen)))
                        .collect();
                    cell
                }
                _ => unreachable!(),
            }
        }
        copy(self, &mut Default::default())
    }
    pub fn equals(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Number(a), Self::Number(b)) => a == b,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Text(a), Self::Text(b)) => a == b,
            (Self::Null, Self::Null) => true,
            (Self::Undefined, Self::Undefined) => true,
            (Self::List(a), Self::List(b)) => Rc::ptr_eq(a, b),
            (Self::Costume(a), Self::Costume(b)) => Rc::ptr_eq(a, b),
            (Self::Object(a), Self::Object(b)) => Rc::ptr_eq(a, b),
            (Self::Midi(a), Self::Midi(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
    /// K4 oiyH/logic_compare calls lodash isEqual (Y+p1), not JS ===.
    /// List search still uses `equals`/`index_in` and reference identity.
    pub fn k4_equals(&self, other: &Self) -> bool {
        // Explicit work stack avoids recursive comparison overflow. Track only
        // the active path, as lodash does, so shared lists need not alias alike.
        let mut work = vec![Some((self.clone(), other.clone()))];
        let mut active = Vec::new();
        while let Some(pair) = work.pop() {
            let Some((a, b)) = pair else {
                active.pop();
                continue;
            };
            let equal = match (&a, &b) {
                (Self::Number(a), Self::Number(b)) => a == b || (a.is_nan() && b.is_nan()),
                (Self::List(a), Self::List(b)) => {
                    if Rc::ptr_eq(a, b) {
                        continue;
                    }
                    let pointers = (Rc::as_ptr(a) as usize, Rc::as_ptr(b) as usize);
                    if let Some(previous) = active
                        .iter()
                        .find(|&&(a, b)| a == pointers.0 || b == pointers.1)
                    {
                        if *previous != pointers {
                            return false;
                        }
                        continue;
                    }
                    let (a, b) = (a.borrow(), b.borrow());
                    if a.len() != b.len() {
                        return false;
                    }
                    active.push(pointers);
                    work.push(None);
                    work.extend(
                        a.iter()
                            .zip(b.iter())
                            .map(|(a, b)| Some((a.clone(), b.clone()))),
                    );
                    true
                }
                (Self::Costume(a), Self::Costume(b)) => a == b,
                (Self::Object(a), Self::Object(b)) => {
                    if Rc::ptr_eq(a, b) {
                        continue;
                    }
                    let pointers = (Rc::as_ptr(a) as usize, Rc::as_ptr(b) as usize);
                    if let Some(previous) = active
                        .iter()
                        .find(|&&(a, b)| a == pointers.0 || b == pointers.1)
                    {
                        if *previous != pointers {
                            return false;
                        }
                        continue;
                    }
                    let (a, b) = (a.borrow(), b.borrow());
                    if a.len() != b.len() {
                        return false;
                    }
                    active.push(pointers);
                    work.push(None);
                    for (key, value) in a.iter() {
                        let Some((_, other)) = b.iter().find(|(k, _)| k == key) else {
                            return false;
                        };
                        work.push(Some((value.clone(), other.clone())));
                    }
                    true
                }
                (Self::Midi(a), Self::Midi(b)) => {
                    work.push(Some(((**a).clone(), (**b).clone())));
                    true
                }
                _ => a.equals(&b),
            };
            if !equal {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod equality_tests {
    use super::*;

    #[test]
    fn k4_structural_equality_does_not_change_strict_search() {
        let a = Cell::from_json(&serde_json::json!([[1, 2], true, "x"])).unwrap();
        let b = Cell::from_json(&serde_json::json!([[1, 2], true, "x"])).unwrap();
        assert!(a.k4_equals(&b));
        assert!(!a.equals(&b));
        assert_eq!(a.index_in(std::slice::from_ref(&b)), None);
        assert_eq!(a.index_in(std::slice::from_ref(&a)), Some(0));
        assert!(!a.k4_equals(&Cell::from_json(&serde_json::json!([[1, 3], true, "x"])).unwrap()));
        assert!(Cell::Number(f64::NAN).k4_equals(&Cell::Number(f64::NAN)));
        assert!(!Cell::Number(1.0).k4_equals(&Cell::Text("1".into())));
        assert!(Cell::Costume("id".into()).k4_equals(&Cell::Costume("id".into())));
    }

    #[test]
    fn k4_cyclic_lists_compare_without_recursion() {
        let a = Rc::new(RefCell::new(vec![]));
        let b = Rc::new(RefCell::new(vec![]));
        a.borrow_mut().push(Cell::List(a.clone()));
        b.borrow_mut().push(Cell::List(b.clone()));
        assert!(Cell::List(a.clone()).k4_equals(&Cell::List(b.clone())));
        b.borrow_mut().push(Cell::Null);
        assert!(!Cell::List(a.clone()).k4_equals(&Cell::List(b.clone())));
        a.borrow_mut().clear();
        b.borrow_mut().clear();
    }
}
impl Serialize for Cell {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        thread_local! {
            static ACTIVE: RefCell<Vec<(bool, usize)>> = const { RefCell::new(Vec::new()) };
        }
        struct Guard;
        impl Drop for Guard {
            fn drop(&mut self) {
                ACTIVE.with(|a| {
                    a.borrow_mut().pop();
                });
            }
        }
        let key = match self {
            Self::List(v) => Some((false, Rc::as_ptr(v) as usize)),
            Self::Object(v) => Some((true, Rc::as_ptr(v) as usize)),
            _ => None,
        };
        let _guard = if let Some(key) = key {
            let entered = ACTIVE.with(|a| {
                let mut a = a.borrow_mut();
                if a.contains(&key) || a.len() >= 128 {
                    false
                } else {
                    a.push(key);
                    true
                }
            });
            if !entered {
                return Err(serde::ser::Error::custom(
                    "cyclic or excessively deep Cell value",
                ));
            }
            Some(Guard)
        } else {
            None
        };
        match self {
            Self::Number(v) => v.serialize(s),
            Self::Bool(v) => v.serialize(s),
            Self::Text(v) => v.as_ref().serialize(s),
            Self::List(v) => v.borrow().serialize(s),
            Self::Null => s.serialize_none(),
            Self::Undefined => s.serialize_none(),
            Self::Object(v) => {
                use serde::ser::SerializeMap;
                let v = v.borrow();
                let mut map = s.serialize_map(Some(v.len()))?;
                for (key, value) in v.iter() {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Self::Costume(id) => {
                use serde::ser::SerializeMap;
                let mut map = s.serialize_map(Some(1))?;
                map.serialize_entry("style_id", id.as_ref())?;
                map.end()
            }
            Self::Midi(id) => {
                use serde::ser::SerializeMap;
                let mut map = s.serialize_map(Some(1))?;
                map.serialize_entry("id", id.as_ref())?;
                map.end()
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) enum ListRef {
    Global(u32),
    Local(u32),
    Variable(u32),
    Expression(u32),
}
#[derive(Clone, Copy, Debug)]
pub(super) enum Target {
    Global(usize),
    Local(usize),
}
/// Range into `Program::value_args`; keeps `ValueExpr` `Copy` so evaluation never
/// clones or drops heap data just to dispatch on an expression node.
#[derive(Clone, Copy, Debug)]
pub(super) struct Span {
    pub start: u32,
    pub len: u32,
}
#[derive(Clone, Copy, Debug)]
pub(super) enum ValueExpr {
    K4Frames,
    K4DomainError(usize),
    K4LegacyChoice,
    K4Media(super::k4_media::Reporter),
    /// Evaluate the query, then return the official absent-OCR-cache result.
    OfflineOcrCheck(usize),
    /// Five evaluated sockets, then official disconnected-microbit NaN.
    OfflineMicrobitMap([usize; 5]),
    Kitten4Add(usize, usize),
    Ranking(bool),
    Calculate(usize),
    Whole(usize),
    Number(super::Expr),
    /// Index into `Program::constants`.
    Constant(usize),
    Global(usize),
    Local(usize),
    List(ListRef),
    Parameter(usize),
    Payload,
    Received(usize),
    Contains(usize, usize),
    /// K4 String.indexOf/lastIndexOf, with 1-based UTF-16 positions.
    TextIndex(usize, usize, bool),
    Find(ListRef, usize, bool),
    Item(ListRef, Option<super::Expr>),
    CloudItem(ListRef, Option<super::Expr>),
    Join(Span),
    Temporary(Span),
    Split(usize, usize),
    Select(usize, super::Expr, super::Expr),
    Convert(usize, bool),
    /// K4 additionally supports Boolean conversion and list-to-number coercion.
    Kitten4Convert(usize, u8),
    Compare(usize, usize, super::Binary),
    Logic(usize, usize, bool),
    /// logic_ternary: like the official runtime, both branches are evaluated.
    Ternary(usize, usize, usize),
    Not(usize),
    Boolean(usize),
    Encode64(usize),
    Decode64(usize),
    ParseFloat(usize),
    ParseInt(usize, usize),
    IsNumber(usize, bool),
    /// Local weekday name (get_time week).
    WeekText,
    SceneId,
    K4Screen(usize, bool),
    CostumeName(usize),
    CostumeLiteral(usize),
    /// Reporter procedure call: (procedure entry index, call argument list).
    CallReturn(usize, usize),
    /// (original actor, clone index including 0 for original, native attribute)
    CloneProperty(usize, super::Expr, u8),
    K4Property(super::k4_properties::Property),
    Answer,
    /// Last chosen option: index (true) or content.
    Choice(bool),
    /// Attribute (see `bump_attribute`) of the actor this collision script met.
    BumpProperty(u8),
    /// Entity target (MAX = self), private slot, optional clone ordinal.
    ActorVariable(usize, usize, Option<super::Expr>),
    ObjectLiteral(Span),
    ObjectGet(usize, usize),
    ObjectSet(usize, usize, usize),
    ObjectKeys(usize),
    JsonParse(usize),
    JsonStringify(usize),
}

#[cfg(test)]
mod performance_regressions {
    use super::*;

    #[test]
    fn specialized_search_keeps_strict_types_nan_zero_and_identity() {
        let list = Cell::from_json(&serde_json::json!([1, 2])).unwrap();
        let costume = Cell::Costume("a".into());
        let items = vec![
            Cell::Text("1".into()),
            Cell::Bool(true),
            Cell::Number(f64::NAN),
            Cell::Number(-0.0),
            Cell::Number(1.0),
            list.clone(),
            costume.clone(),
            Cell::Null,
        ];
        for needle in items.iter().chain(
            [
                Cell::Number(0.0),
                Cell::Number(9.0),
                Cell::from_json(&serde_json::json!([1, 2])).unwrap(),
                Cell::Costume("a".into()),
            ]
            .iter(),
        ) {
            assert_eq!(
                needle.index_in(&items),
                items.iter().position(|v| v.equals(needle))
            );
        }
        for length in 0..33 {
            for at in 0..=length {
                let mut items = vec![Cell::Number(0.0); length];
                if at < length {
                    items[at] = Cell::Number(1.0);
                }
                assert_eq!(
                    Cell::Number(1.0).index_in(&items),
                    (at < length).then_some(at)
                );
            }
        }
    }

    #[test]
    fn concatenation_matches_scalar_and_nested_list_stringification() {
        let values = [
            Cell::Text("猫abc".repeat(4096).into()),
            Cell::Text("".into()),
            Cell::Number(f64::NAN),
            Cell::Number(f64::INFINITY),
            Cell::Number(-0.0),
            Cell::Number(1e21),
            Cell::Bool(false),
            Cell::Null,
            Cell::Costume("x".into()),
            Cell::from_json(&serde_json::json!([1, ["猫", null], true])).unwrap(),
        ];
        for a in &values {
            for b in &values {
                assert_eq!(
                    Cell::concat(a, b).text(),
                    format!("{}{}", a.text(), b.text())
                );
            }
        }
    }
}
