//! Official KN 0.27.4 main.8ccf2442.js byte 1633578.
//! See docs/kn-conversion.md: lodash.toNumber with String fallback, NOT the
//! numeric VM's coercion of lists. Warning UI is deliberately not reproduced.
use super::Cell;

pub(super) fn convert(value: Cell, number: bool) -> Cell {
    // JS String(null) differs from the VM's legacy empty-text display of null.
    let text = if matches!(value, Cell::Null) {
        "null".to_owned()
    } else {
        value.text()
    };
    if !number || matches!(value, Cell::Bool(_)) {
        return Cell::Text(text.into());
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
        Cell::Text(text.into())
    } else {
        Cell::Number(n)
    }
}
