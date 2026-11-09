//! Non-numeric values live beside numeric slots, keeping arithmetic unboxed.
use anyhow::{Result, bail};
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::{cell::RefCell, rc::Rc};

pub type List = Rc<RefCell<Vec<Cell>>>;
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
}
impl Cell {
    pub fn from_json(value: &Value) -> Result<Self> {
        Ok(match value {
            Value::Null => Self::Null,
            Value::Bool(v) => Self::Bool(*v),
            Value::Number(v) => Self::Number(v.as_f64().unwrap_or(f64::NAN)),
            Value::String(v) => Self::Text(v.as_str().into()),
            Value::Array(v) => Self::List(Rc::new(RefCell::new(
                v.iter().map(Self::from_json).collect::<Result<_>>()?,
            ))),
            Value::Object(_) => bail!("object values are not supported by fast VM"),
        })
    }
    pub fn number(&self) -> f64 {
        match self {
            Self::Number(n) => *n,
            Self::Bool(v) => u8::from(*v) as f64,
            Self::Null => 0.0,
            Self::Text(s) => {
                if s.trim().is_empty() {
                    0.0
                } else {
                    s.trim().parse().unwrap_or(f64::NAN)
                }
            }
            Self::List(_) | Self::Costume(_) => f64::NAN,
        }
    }
    pub fn text(&self) -> String {
        self.text_with_js_nonfinite(false)
    }
    /// KN spells nonfinite numbers like JavaScript; legacy callers stay intact.
    pub fn text_with_js_nonfinite(&self, js_nonfinite: bool) -> String {
        match self {
            Self::Number(n) => {
                if *n == 0.0 {
                    "0".into()
                } else if js_nonfinite && n.is_infinite() {
                    if n.is_sign_negative() {
                        "-Infinity"
                    } else {
                        "Infinity"
                    }
                    .into()
                } else {
                    n.to_string()
                }
            }
            Self::Bool(v) => v.to_string(),
            Self::Text(s) => s.to_string(),
            Self::Null => String::new(),
            Self::Costume(_) => "[object Object]".into(),
            Self::List(v) => v
                .borrow()
                .iter()
                .map(|v| v.text_with_js_nonfinite(js_nonfinite))
                .collect::<Vec<_>>()
                .join(","),
        }
    }
    /// Appends `text()` without an intermediate allocation for scalar values.
    pub fn append_text(&self, out: &mut String) {
        self.append_text_with_js_nonfinite(out, false);
    }
    pub fn append_text_with_js_nonfinite(&self, out: &mut String, js_nonfinite: bool) {
        use std::fmt::Write;
        match self {
            Self::Number(n) if *n == 0.0 => out.push('0'),
            Self::Number(n) if js_nonfinite && n.is_infinite() => {
                out.push_str(if n.is_sign_negative() {
                    "-Infinity"
                } else {
                    "Infinity"
                });
            }
            Self::Number(n) => {
                let _ = write!(out, "{n}");
            }
            Self::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Self::Text(s) => out.push_str(s),
            Self::Null => {}
            Self::Costume(_) => out.push_str("[object Object]"),
            Self::List(_) => out.push_str(&self.text_with_js_nonfinite(js_nonfinite)),
        }
    }
    pub fn truth(&self) -> bool {
        match self {
            Self::Number(n) => super::truth(*n),
            Self::Bool(b) => *b,
            Self::Text(s) => !s.is_empty(),
            Self::List(_) | Self::Costume(_) => true,
            Self::Null => false,
        }
    }
    pub fn deep_clone(&self) -> Self {
        match self {
            Self::List(v) => Self::List(Rc::new(RefCell::new(
                v.borrow().iter().map(Self::deep_clone).collect(),
            ))),
            _ => self.clone(),
        }
    }
    pub fn equals(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Number(a), Self::Number(b)) => a == b,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Text(a), Self::Text(b)) => a == b,
            (Self::Null, Self::Null) => true,
            (Self::List(a), Self::List(b)) => Rc::ptr_eq(a, b),
            (Self::Costume(a), Self::Costume(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
}
impl Serialize for Cell {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Number(v) => v.serialize(s),
            Self::Bool(v) => v.serialize(s),
            Self::Text(v) => v.as_ref().serialize(s),
            Self::List(v) => v.borrow().serialize(s),
            Self::Null => s.serialize_none(),
            Self::Costume(id) => {
                use serde::ser::SerializeMap;
                let mut map = s.serialize_map(Some(1))?;
                map.serialize_entry("style_id", id.as_ref())?;
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
    Number(super::Expr),
    /// Index into `Program::constants`.
    Constant(usize),
    Global(usize),
    Local(usize),
    List(ListRef),
    /// Entity target (MAX = self), private slot, optional clone ordinal.
    ActorVariable(usize, usize, Option<super::Expr>),
    Parameter(usize),
    Payload,
    Received(usize),
    Contains(usize, usize),
    Find(ListRef, usize, bool),
    Item(ListRef, Option<super::Expr>),
    Join(Span),
    Temporary(Span),
    Split(usize, usize),
    Select(usize, super::Expr, super::Expr),
    Convert(usize, bool),
    /// K4 conversion has a text fallback for nonnumeric input, unlike KN.
    Kitten4Convert(usize, u8),
    Compare(usize, usize, super::Binary),
    Logic(usize, usize, bool),
    /// logic_ternary: like the official runtime, both branches are evaluated.
    Ternary(usize, usize, usize),
    Not(usize),
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
    Answer,
    /// Last chosen option: index (true) or content.
    Choice(bool),
    /// Attribute (see `bump_attribute`) of the actor this collision script met.
    BumpProperty(u8),
}
