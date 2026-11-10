//! KN's published main.8ccf2442.js domain factory, not JavaScript eval.
//! _object_literal:2962498, _object_get:2960709, _object_set:2960812.
use super::*;

impl Compiler {
    pub(super) fn object_literal(&mut self, block: &Value) -> Result<ValueExpr> {
        ensure!(
            self.program.semantics == RuntimeSemantics::KnCurrent,
            "object blocks require KN semantics"
        );
        let mut pairs = BTreeMap::new();
        for (name, value) in block["inputs"].as_object().into_iter().flatten() {
            let (key, suffix) = if let Some(suffix) = name.strip_prefix("key") {
                (true, suffix)
            } else if let Some(suffix) = name.strip_prefix("value") {
                (false, suffix)
            } else {
                bail!(
                    "unsupported object literal socket {name} at {}",
                    block["id"]
                );
            };
            let index = suffix
                .parse::<usize>()
                .context("invalid object literal socket")?;
            ensure!(
                index < 100_000 && index.to_string() == suffix,
                "invalid object literal socket"
            );
            let pair = pairs.entry(index).or_insert([None, None]);
            pair[usize::from(!key)] = Some(self.value(value)?);
        }
        let count = pairs.last_key_value().map_or(0, |(&n, _)| n + 1);
        let missing = self.push_constant(Cell::Undefined);
        let mut args = Vec::with_capacity(count * 2);
        for i in 0..count {
            let pair = pairs.get(&i).copied().unwrap_or([None, None]);
            args.extend(pair.map(|v| v.unwrap_or(missing)));
        }
        let span = Span {
            start: self.program.value_args.len() as u32,
            len: args.len() as u32,
        };
        self.program.value_args.extend(args);
        Ok(ValueExpr::ObjectLiteral(span))
    }

    pub(super) fn object_access(&mut self, block: &Value, set: bool) -> Result<ValueExpr> {
        ensure!(
            self.program.semantics == RuntimeSemantics::KnCurrent,
            "object blocks require KN semantics"
        );
        // Published runtime prefers a non-null CONSTRUCTOR to obj. These three
        // registered block types expose obj; reject a synthetic ambiguous shape.
        ensure!(
            block["inputs"].get("CONSTRUCTOR").is_none(),
            "object access expects official obj socket"
        );
        let object = self.value(input(block, "obj")?)?;
        let key = self.value(input(block, "key")?)?;
        Ok(if set {
            ValueExpr::ObjectSet(object, key, self.value(input(block, "value")?)?)
        } else {
            ValueExpr::ObjectGet(object, key)
        })
    }
}

fn property_key(key: &Cell) -> String {
    match key {
        Cell::Null => "null".into(),
        _ => key.text(),
    }
}

impl Engine {
    pub(super) fn eval_object_keys(&mut self, object: Cell) -> Cell {
        let mut keys = match object {
            Cell::Object(props) => props
                .borrow()
                .iter()
                .map(|(k, _)| k.clone())
                .collect::<Vec<_>>(),
            Cell::List(items) => (0..items.borrow().len()).map(|i| i.to_string()).collect(),
            _ => Vec::new(),
        };
        keys.sort_by_key(|k| js_index(k).map_or((1, 0), |i| (0, i)));
        Cell::List(Rc::new(RefCell::new(
            keys.into_iter().map(|k| Cell::Text(k.into())).collect(),
        )))
    }

    pub(super) fn eval_json_parse(&mut self, value: Cell) -> Cell {
        let text = match value {
            Cell::Null => "null".into(),
            _ => value.text(),
        };
        serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| Cell::from_json(&v).ok())
            .unwrap_or(Cell::Null)
    }

    pub(super) fn eval_json_stringify(&mut self, value: Cell) -> Cell {
        if matches!(value, Cell::Undefined) {
            return Cell::Undefined;
        }
        match stringify(&value, &mut Vec::new()) {
            Ok(text) => Cell::Text(text.into()),
            Err(()) => Cell::Text("".into()),
        }
    }
    pub(super) fn eval_object_literal(&mut self, span: Span, actor: usize) -> Cell {
        // Parameter evaluation precedes the domain call, including entries after
        // an empty key. Do not short-circuit reporters while collecting args.
        let args: Vec<_> = (span.start..span.start + span.len)
            .map(|i| self.eval_value(self.program.value_args[i as usize], actor))
            .collect();
        let object = Cell::Object(Default::default());
        for pair in args.chunks_exact(2) {
            if !pair[0].truth() {
                break;
            }
            if let Cell::Text(key) = &pair[0] {
                self.set_object_property(&object, key, pair[1].clone());
            }
        }
        object
    }

    pub(super) fn eval_object_get(&mut self, object: Cell, key: Cell) -> Cell {
        let key = property_key(&key);
        match object {
            Cell::Object(ref props) => {
                if let Some((_, value)) = props.borrow().iter().find(|(k, _)| k == &key) {
                    return value.clone();
                }
            }
            Cell::List(ref items) => {
                if key == "length" {
                    return Cell::Number(items.borrow().len() as f64);
                }
                if let Ok(i) = key.parse::<u32>()
                    && i != u32::MAX
                    && i.to_string() == key
                {
                    return items
                        .borrow()
                        .get(i as usize)
                        .cloned()
                        .unwrap_or(Cell::Undefined);
                }
            }
            _ => {}
        }
        if matches!(
            key.as_str(),
            "__proto__"
                | "constructor"
                | "toString"
                | "valueOf"
                | "hasOwnProperty"
                | "isPrototypeOf"
                | "propertyIsEnumerable"
                | "toLocaleString"
                | "__defineGetter__"
                | "__defineSetter__"
                | "__lookupGetter__"
                | "__lookupSetter__"
        ) {
            self.value_error
                .get_or_insert_with(|| format!("unsupported KN inherited object property {key}"));
        }
        Cell::Undefined
    }

    fn set_object_property(&mut self, object: &Cell, key: &str, value: Cell) {
        if key == "__proto__" {
            self.value_error
                .get_or_insert_with(|| "unsupported KN object prototype mutation".into());
            return;
        }
        if let Cell::Object(props) = object {
            let mut props = props.borrow_mut();
            if let Some((_, previous)) = props.iter_mut().find(|(k, _)| k == key) {
                *previous = value;
            } else {
                props.push((key.into(), value));
            }
        }
    }

    pub(super) fn eval_object_set(&mut self, object: Cell, key: Cell, value: Cell) -> Cell {
        // f(value) accepts arrays and objects, otherwise creates a fresh {}.
        let object = match object {
            object @ (Cell::Object(_) | Cell::List(_)) => object,
            _ => Cell::Object(Default::default()),
        };
        let key = property_key(&key);
        if let Cell::List(items) = &object {
            // Sparse arrays / non-index expando properties need a separate JS
            // array model. Never silently drop them or allocate enormous holes.
            let index = key.parse::<usize>().ok().filter(|i| i.to_string() == key);
            if let Some(i) = index.filter(|&i| i <= items.borrow().len()) {
                let mut items = items.borrow_mut();
                if i == items.len() {
                    items.push(value);
                } else {
                    items[i] = value;
                }
            } else {
                self.value_error.get_or_insert_with(|| {
                    "unsupported KN array property assignment (sparse, length, or expando)".into()
                });
            }
        } else {
            self.set_object_property(&object, &key, value);
        }
        object
    }
}

fn js_index(key: &str) -> Option<u32> {
    key.parse::<u32>()
        .ok()
        .filter(|&i| i != u32::MAX && i.to_string() == key)
}

// The official wrapper returns "" when JSON.stringify throws (e.g. a cycle).
// JSON numbers use JS formatting and nonfinite/undefined array elements are null;
// undefined object members are omitted. Do not use generic Cell serialization.
fn stringify(value: &Cell, active: &mut Vec<(bool, usize)>) -> std::result::Result<String, ()> {
    let key = match value {
        Cell::Object(v) => Some((true, Rc::as_ptr(v) as usize)),
        Cell::List(v) => Some((false, Rc::as_ptr(v) as usize)),
        _ => None,
    };
    if let Some(key) = key {
        if active.len() >= 128 || active.contains(&key) {
            return Err(());
        }
        active.push(key);
    }
    let output = match value {
        Cell::Number(n) => {
            if n.is_finite() {
                crate::js_number::text(*n)
            } else {
                "null".into()
            }
        }
        Cell::Null | Cell::Undefined => "null".into(),
        Cell::Bool(b) => b.to_string(),
        Cell::Text(text) => serde_json::to_string(text.as_ref()).map_err(|_| ())?,
        Cell::Costume(id) => format!(
            "{{\"style_id\":{}}}",
            serde_json::to_string(id.as_ref()).map_err(|_| ())?
        ),
        Cell::List(items) => {
            let mut out = String::from("[");
            for (i, item) in items.borrow().iter().enumerate() {
                if i != 0 {
                    out.push(',');
                }
                out.push_str(&stringify(item, active)?);
            }
            out.push(']');
            out
        }
        Cell::Object(props) => {
            let props = props.borrow();
            let mut ordered: Vec<_> = props
                .iter()
                .filter(|(_, v)| !matches!(v, Cell::Undefined))
                .collect();
            ordered.sort_by_key(|(k, _)| js_index(k).map_or((1, 0), |i| (0, i)));
            let mut out = String::from("{");
            for (i, (name, value)) in ordered.into_iter().enumerate() {
                if i != 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(name).map_err(|_| ())?);
                out.push(':');
                out.push_str(&stringify(value, active)?);
            }
            out.push('}');
            out
        }
    };
    if key.is_some() {
        active.pop();
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kn_objects_json_nonfinite_undefined_cycle_and_numeric_keys() {
        let props = Rc::new(RefCell::new(vec![
            ("z".into(), Cell::Undefined),
            ("2".into(), Cell::Number(f64::INFINITY)),
            ("1".into(), Cell::Number(-0.0)),
            (
                "a".into(),
                Cell::List(Rc::new(RefCell::new(vec![
                    Cell::Undefined,
                    Cell::Number(f64::NAN),
                ]))),
            ),
        ]));
        let object = Cell::Object(props.clone());
        assert_eq!(
            stringify(&object, &mut Vec::new()).unwrap(),
            "{\"1\":0,\"2\":null,\"a\":[null,null]}"
        );
        props.borrow_mut().push(("self".into(), object.clone()));
        assert!(stringify(&object, &mut Vec::new()).is_err());
        props.borrow_mut().clear();
    }
}
