//! K4 legacy ID selection, isolated from the name/index semantics of Op::Style.
//! Independent probes: docs/kitten4-partial-costume-4.md (no vendor code).
use super::*;

impl Compiler {
    pub(super) fn legacy_costume(&mut self, b: &Value) -> Result<Op> {
        ensure!(
            self.program.semantics == RuntimeSemantics::Kitten4,
            "legacy costume ID requires Kitten 4 semantics"
        );
        // The official workspace compiler gives a field priority over a socket.
        // Do not turn an absent parameter into an empty string: for scenes these
        // have observably different outcomes.
        let value = if let Some(value) = b["fields"].get("style_id") {
            self.push_constant(Cell::from_json(value)?)
        } else if let Some(value) = b["inputs"].get("style_id") {
            self.value(value)?
        } else {
            self.push_constant(Cell::Undefined)
        };
        Ok(Op::LegacyCostume(value))
    }
}

// Same unanchored ASCII-alphanumeric UUID shape verified by the K4 property
// probes. This is a string predicate, not a canonical/hex UUID parser. Preserve
// the original value's type: RegExp converts arrays for this check, whereas the
// player's "?" sentinel is a strict string comparison.
fn uuid_like(text: &str) -> bool {
    text.as_bytes().windows(36).any(|part| {
        part.iter().enumerate().all(|(i, byte)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_alphanumeric()
            }
        })
    })
}

fn property_key(value: &Cell) -> String {
    // Cell's list conversion already implements JS Array#toString/join,
    // including nested arrays, nullish items and cyclic-array protection.
    // Scalar null differs from the VM's general-purpose display conversion.
    if matches!(value, Cell::Null) {
        "null".into()
    } else {
        value.text()
    }
}

impl Engine {
    pub(super) fn set_legacy_costume(
        &mut self,
        actor: usize,
        value: usize,
        pc: usize,
    ) -> Result<()> {
        let value = self.eval_value(value, actor);
        // The common step epilogue owns reporter errors and their block source.
        // A failed reporter must not change the selected texture first.
        if self.value_error.is_some() || matches!(value, Cell::Undefined) {
            return Ok(());
        }
        let key = property_key(&value);
        let stage = self.sprites[actor].stage;
        let known_texture =
            self.program.costumes.contains_key(&key) || self.program.style_names.contains_key(&key);
        let selected = if stage {
            // Background ID selection uses the global texture table, unlike an
            // actor which can only select a style registered on that instance.
            known_texture
        } else {
            self.sprites[actor].styles.iter().any(|id| id == &key)
        };
        if selected {
            self.leave_text(actor);
            self.sprites[actor].style = Some(key);
            self.dirty[actor] = true;
        } else if stage {
            // Offline scene lookup fails before the actor invalid-ID ignore
            // policy. Keep the stage and its next block untouched on failure.
            bail!(
                "K4 HEART.SYSTEM set_costume_by_id: invalid background texture at block {}",
                self.program.sources[pc]
            );
        } else if uuid_like(&key) && !matches!(&value, Cell::Text(text) if text.as_ref() == "?") {
            bail!(
                "K4 HEART.CLIENT domain error: set_costume at block {}",
                self.program.sources[pc]
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_keys_preserve_array_conversion_and_uuid_substrings() {
        let id = "40000000-0000-4000-8000-000000000002";
        let single = Cell::List(Rc::new(RefCell::new(vec![Cell::Text(id.into())])));
        let pair = Cell::List(Rc::new(RefCell::new(vec![
            Cell::Text(id.into()),
            Cell::Text("x".into()),
        ])));
        assert_eq!(property_key(&single), id);
        assert_eq!(property_key(&pair), format!("{id},x"));
        assert!(uuid_like(&property_key(&pair)));
        assert!(uuid_like(&format!(" {id} ")));
        assert!(!uuid_like("Second"));
        assert_eq!(property_key(&Cell::Null), "null");
        assert_eq!(property_key(&Cell::Undefined), "undefined");
        assert_eq!(property_key(&Cell::Number(2.0)), "2");
        assert_eq!(property_key(&Cell::Bool(true)), "true");
        assert_eq!(property_key(&Cell::Costume(id.into())), "[object Object]");
    }
}
