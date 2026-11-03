//! Non-numeric values live beside numeric slots, keeping arithmetic unboxed.
use anyhow::{Result, bail};
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::{cell::RefCell, rc::Rc};

pub type List = Rc<RefCell<Vec<Cell>>>;
#[derive(Clone, Debug)]
pub enum Cell {
    Number(f64),
    Bool(bool),
    Text(Rc<str>),
    List(List),
    Null,
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
            Self::List(_) => f64::NAN,
        }
    }
    pub fn text(&self) -> String {
        match self {
            Self::Number(n) => {
                if *n == 0.0 {
                    "0".into()
                } else {
                    n.to_string()
                }
            }
            Self::Bool(v) => v.to_string(),
            Self::Text(s) => s.to_string(),
            Self::Null => String::new(),
            Self::List(v) => v
                .borrow()
                .iter()
                .map(Self::text)
                .collect::<Vec<_>>()
                .join(","),
        }
    }
    pub fn truth(&self) -> bool {
        match self {
            Self::Number(n) => super::truth(*n),
            Self::Bool(b) => *b,
            Self::Text(s) => !s.is_empty(),
            Self::List(_) => true,
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
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) enum ListRef {
    Global(usize),
    Local(usize),
    Variable(usize),
    Expression(usize),
}
#[derive(Clone, Copy, Debug)]
pub(super) enum Target {
    Global(usize),
    Local(usize),
}
#[derive(Clone, Debug)]
pub(super) enum ValueExpr {
    Number(super::Expr),
    Constant(Cell),
    Global(usize),
    Local(usize),
    List(ListRef),
    Parameter(usize),
    Payload,
    Received(usize),
    Contains(usize, usize),
    Find(ListRef, usize, bool),
    Item(ListRef, Option<super::Expr>),
    Join(Vec<usize>),
    Temporary(Vec<usize>),
    Split(usize, usize),
    Select(usize, super::Expr, super::Expr),
    Convert(usize, bool),
    Compare(usize, usize, super::Binary),
    Logic(usize, usize, bool),
    Not(usize),
}
