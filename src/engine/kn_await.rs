//! KN 0.27.4's already-fulfilled device Promises still block until next update.
//! Evidence: docs/kn-remaining-official.md (including two nested reporters).
//! Lower only expressions containing these precise asynchronous leaves. Each
//! preceding child is saved in a task-local slot, never evaluated again on resume.
use super::*;

fn asynchronous(kind: &str) -> bool {
    matches!(
        kind,
        "microbit_accelerometer"
            | "microbit_compass_heading"
            | "microbit_light_level"
            | "microbit_magnetometer"
            | "microbit_rotation"
            | "microbit_sound_level"
            | "microbit_temperature"
            | "get_voice_volume"
    )
}

fn contains(block: &Value) -> bool {
    let mut pending = vec![block];
    while let Some(node) = pending.pop() {
        if asynchronous(node["type"].as_str().unwrap_or("")) {
            return true;
        }
        pending.extend(
            node["inputs"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.values()),
        );
    }
    false
}

impl Compiler {
    pub(super) fn kn_await_value(&mut self, block: &Value) -> Result<Option<usize>> {
        if self.program.semantics != RuntimeSemantics::KnCurrent || !contains(block) {
            return Ok(None);
        }
        self.kn_await_tree(block, 0).map(Some)
    }

    fn kn_await_tree(&mut self, block: &Value, depth: usize) -> Result<usize> {
        ensure!(depth < 256, "KN asynchronous expression exceeds 256 levels");
        let kind = block["type"].as_str().unwrap_or("");
        if asynchronous(kind) {
            let result = if kind == "get_voice_volume" {
                self.emit(Op::KnAwaitVoice, block);
                // Read only after the pending device/permission state resolves.
                self.program.expressions.push(ExprOp::KnVoiceVolume);
                self.program.values.push(ValueExpr::Number(Expr {
                    end: self.program.expressions.len() as u32,
                }));
                self.program.values.len() - 1
            } else {
                self.push_constant(Cell::Number(f64::NAN))
            };
            let slot = self.save_await_value(result, block);
            self.emit(Op::Yield, block);
            return Ok(slot);
        }
        // Non-async subtrees still get evaluated at their original point, before
        // later siblings can suspend or mutate referenced variables.
        if !contains(block) {
            return self.value(block);
        }
        let mut shallow = block.clone();
        let keys = self.kn_await_input_order(block)?;
        for key in keys {
            let child = input(block, &key)?;
            let value = self.kn_await_tree(child, depth + 1)?;
            let local = self.save_await_value(value, child);
            shallow["inputs"][&key] = json_proxy(local);
        }
        // Proxies refer only to task locals; no Promise remains in this tree.
        let previous = self.compile_work;
        self.compile_work = true;
        let result = self.value(&shallow);
        self.compile_work = previous;
        result
    }

    fn save_await_value(&mut self, value: usize, block: &Value) -> usize {
        // Compiler-only temporary: cannot alias author script-variable names.
        let slot = self.program.local_count;
        self.program.local_count += 1;
        self.emit(Op::SetValue(Target::Local(slot), value), block);
        self.program.values.push(ValueExpr::Local(slot));
        self.program.values.len() - 1
    }

    fn kn_await_input_order(&self, b: &Value) -> Result<Vec<String>> {
        let kind = b["type"].as_str().unwrap_or("");
        let mut keys: Vec<_> = b["inputs"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.keys().cloned())
            .collect();
        let order: &[&str] = match kind {
            "math_arithmetic" | "logic_compare" | "logic_operation" => &["A", "B"],
            "logic_ternary" => &["condition", "ifTrue", "ifFalse"],
            "_object_get" => &["obj", "key"],
            "_object_set" => &["obj", "key", "value"],
            _ => self.expression_inputs(b),
        };
        keys.sort_by_key(|key| {
            (
                order.iter().position(|k| *k == key).unwrap_or(usize::MAX),
                key.trim_start_matches("ADD")
                    .trim_start_matches("items")
                    .parse::<usize>()
                    .unwrap_or(usize::MAX),
                key.clone(),
            )
        });
        Ok(keys)
    }
}
