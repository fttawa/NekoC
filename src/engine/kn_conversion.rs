//! Official KN 0.27.4 main.8ccf2442.js byte 1633578.
//! See docs/kn-conversion.md: lodash.toNumber with String fallback, NOT the
//! numeric VM's coercion of lists. Warning UI is deliberately not reproduced.
use super::{Cell, Engine};
use std::{collections::HashSet, rc::Rc};

impl Engine {
    pub(super) fn eval_kn_conversion(&mut self, value: Cell, number: bool) -> Cell {
        match convert(value, number) {
            Ok(value) => value,
            Err(error) => {
                self.value_error.get_or_insert_with(|| error.into());
                Cell::Undefined
            }
        }
    }
}

fn convert(value: Cell, number: bool) -> Result<Cell, &'static str> {
    let text = js_string(&value)?;
    if !number || matches!(value, Cell::Bool(_)) {
        return Ok(Cell::Text(text.into()));
    }
    let n = match &value {
        Cell::List(_) => crate::js_number::parse(&text),
        _ => value.number(),
    };
    // Only literal text "NaN" or numeric NaN bypasses the failure fallback;
    // a list containing "NaN" must still become the text "NaN".
    if n.is_nan()
        && !matches!(&value, Cell::Number(n) if n.is_nan())
        && !matches!(&value, Cell::Text(s) if s.as_ref() == "NaN")
    {
        Ok(Cell::Text(text.into()))
    } else {
        Ok(Cell::Number(n))
    }
}

// Array#join suppresses only arrays on the active path, not shared siblings.
// Keep traversal on the heap: the generic display's 128-level safety cutoff
// silently turned a perfectly ordinary deeply nested [7] into "" / number 0.
// This is KN conversion only; do not alter K4 or generic Cell display semantics.
fn js_string(value: &Cell) -> Result<String, &'static str> {
    enum Work {
        Value(Cell, bool),
        Comma,
        Exit(usize),
    }
    let mut work = vec![Work::Value(value.clone(), false)];
    let mut active = HashSet::new();
    let mut out = String::new();
    while let Some(item) = work.pop() {
        match item {
            Work::Comma => out.push(','),
            Work::Exit(pointer) => {
                active.remove(&pointer);
            }
            Work::Value(value, element) => match value {
                Cell::Null if !element => out.push_str("null"),
                Cell::Null | Cell::Undefined if element => {}
                Cell::List(items) => {
                    let pointer = Rc::as_ptr(&items) as usize;
                    if !active.insert(pointer) {
                        continue;
                    }
                    work.push(Work::Exit(pointer));
                    let items = items.borrow();
                    for (i, item) in items.iter().enumerate().rev() {
                        work.push(Work::Value(item.clone(), true));
                        if i != 0 {
                            work.push(Work::Comma);
                        }
                    }
                }
                Cell::Object(properties) => {
                    // Cell objects contain data, not callable JS functions. An
                    // own toString shadows Object.prototype.toString; inherited
                    // valueOf then returns the object, so no primitive exists.
                    // Official unchanged convert_type throws for this shape.
                    if properties.borrow().iter().any(|(key, _)| key == "toString") {
                        return Err(
                            "KN convert_type: TypeError: Cannot convert object to primitive value",
                        );
                    }
                    out.push_str("[object Object]");
                }
                value => value.append_text(&mut out),
            },
        }
    }
    Ok(out)
}
