//! Saved K4 data widgets exist independently of show/hide blocks.
//! Official dr.load_variable / load_stage_from_state: docs/kitten4-visual-monitors.md.
use super::*;

// Existing Frame representation: one line per item, capped to 100 items. Private
// lists must use the same rendering contract as globals, not JS Array.toString.
pub(super) fn list_text(items: &[Cell]) -> String {
    let mut text = items
        .iter()
        .take(100)
        .map(Cell::text)
        .collect::<Vec<_>>()
        .join("\n");
    if items.len() > 100 {
        text.push_str("\n…");
    }
    text
}

impl Compiler {
    pub(super) fn k4_initial_monitors(&mut self, project: &Value) -> Result<()> {
        let Some(vars) = project
            .pointer("/variables/variablesDict")
            .and_then(Value::as_object)
        else {
            return Ok(());
        };
        // Register hidden declarations too: a later show/hide must reuse the
        // same target, not duplicate the initially visible widget. Preserve
        // declaration order rather than sorting by id or block discovery order.
        for (id, var) in vars {
            let list = var["type"] == "list";
            let target = if let Some(&slot) = self.actor_variables.get(id) {
                let owner = self
                    .program
                    .sprites
                    .iter()
                    .position(|s| s.variables.contains_key(&slot))
                    .with_context(|| format!("private monitor {id}: missing owner"))?;
                self.program
                    .actor_monitors
                    .insert(self.program.monitor_targets.len(), (owner, slot));
                slot
            } else if list {
                *self
                    .lists
                    .get(id)
                    .with_context(|| format!("unknown list monitor {id}"))?
            } else {
                *self
                    .slots
                    .get(id)
                    .with_context(|| format!("unknown variable monitor {id}"))?
            };
            self.program
                .monitor_targets
                .push((id.clone(), list, target));
            self.program.initial_monitors.push(var["visible"] == true);
        }
        Ok(())
    }
}
