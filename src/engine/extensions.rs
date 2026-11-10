//! Extension compiler/execution boundary, isolated from built-in scheduling.
use super::*;
use crate::extensions::{CallResult, ExtensionRequest};

#[derive(Clone, Debug)]
pub(super) struct Call {
    opcode: String,
    arguments: Vec<usize>,
    target: Option<Target>,
}

#[derive(Debug)]
struct Pending {
    request: ExtensionRequest,
    task: u64,
    call: usize,
    remote: bool,
}

#[derive(Default)]
pub(super) struct State {
    serial: u64,
    pending: BTreeMap<u64, Pending>,
}

impl State {
    pub fn clear(&mut self) {
        // Keep monotonic IDs across restarts so stale replies cannot resume new tasks.
        self.pending.clear();
    }
}

impl Compiler {
    pub(super) fn extension_call(&mut self, block: &Value) -> Result<Op> {
        let opcode = field(block, "opcode");
        let schema = self
            .program
            .extensions
            .entries
            .get(opcode)
            .with_context(|| format!("unregistered extension {opcode}"))?
            .schema
            .clone();
        let inputs = block["inputs"].as_object();
        ensure!(
            inputs.map_or(0, |v| v.len()) == schema.parameters.len(),
            "extension input count mismatch for {opcode}"
        );
        let arguments = schema
            .parameters
            .iter()
            .map(|p| self.value(input(block, &p.name)?))
            .collect::<Result<Vec<_>>>()?;
        let name = field(block, "result");
        ensure!(
            name.is_empty() || schema.returns.is_some(),
            "extension command has no result"
        );
        // Explicit global IDs only in v1; do not silently alias private variables.
        ensure!(
            name.is_empty() || self.extension_globals.contains(name),
            "extension result must be a declared global variable"
        );
        let target = (!name.is_empty()).then(|| Target::Global(self.slots[name]));
        let call = self.program.extension_calls.len();
        self.program.extension_calls.push(Call {
            opcode: opcode.into(),
            arguments,
            target,
        });
        Ok(Op::Extension(call))
    }
}

impl Engine {
    pub(super) fn exec_extension(
        &mut self,
        index: usize,
        actor: usize,
        call: usize,
    ) -> Result<bool> {
        self.prune_extensions();
        ensure!(
            self.reporter_depth == 0,
            "extension commands cannot execute inside reporter procedures"
        );
        let spec = self.program.extension_calls[call].clone();
        let entry = self.program.extensions.entries[&spec.opcode].clone();
        let mut remaining = 65536;
        let arguments = spec
            .arguments
            .iter()
            .map(|&v| {
                let value = self.eval_value(v, actor);
                // Reject nonfinite numbers/cyclic lists before serde can erase types or recurse.
                cell_json(&value, 0, &mut remaining)
            })
            .collect::<Result<Vec<_>>>()?;
        if let Some(error) = self.value_error.take() {
            bail!(error);
        }
        entry.schema.validate_arguments(&arguments)?;
        self.extensions.serial = self
            .extensions
            .serial
            .checked_add(1)
            .context("extension request IDs exhausted")?;
        let request = ExtensionRequest {
            id: self.extensions.serial,
            opcode: spec.opcode.clone(),
            arguments,
            actor: self.sprites[actor].id.clone(),
        };
        let result = if let Some(handler) = &entry.handler {
            handler
                .call(&request)
                .with_context(|| format!("extension {}", spec.opcode))?
        } else {
            CallResult::Pending
        };
        match result {
            CallResult::Ready(value) => {
                entry.schema.validate_result(&value)?;
                if let Some(target) = spec.target {
                    self.assign(target, Cell::from_json(&value)?);
                }
                // A declared blocking call yields even when ready immediately.
                Ok(!entry.schema.blocking)
            }
            CallResult::Pending => {
                ensure!(
                    entry.schema.blocking,
                    "nonblocking extension returned Pending"
                );
                ensure!(
                    self.extensions.pending.len() < 256,
                    "too many pending extension calls"
                );
                self.tasks[index].pending += 1;
                self.extensions.pending.insert(
                    request.id,
                    Pending {
                        request,
                        task: self.tasks[index].id,
                        call,
                        remote: entry.handler.is_none(),
                    },
                );
                Ok(false)
            }
        }
    }

    /// Complete once; unknown/stale/cancelled IDs are harmless. Invalid results
    /// propagate as runtime errors and never release a task with an untyped value.
    pub fn complete_extension(&mut self, id: u64, result: Result<Value, String>) -> Result<bool> {
        self.prune_extensions();
        let Some(pending) = self.extensions.pending.get(&id) else {
            return Ok(false);
        };
        let Some(index) = self
            .tasks
            .iter()
            .position(|t| t.id == pending.task && !t.done)
        else {
            return Ok(false);
        };
        let call = &self.program.extension_calls[pending.call];
        let value = result
            .map_err(|error| anyhow::anyhow!("extension {} failed: {}", call.opcode, error))?;
        self.program.extensions.entries[&call.opcode]
            .schema
            .validate_result(&value)?;
        let value = Cell::from_json(&value)?;
        if let Some(Target::Global(slot)) = call.target {
            self.slots[slot] = value.number();
            self.values[slot] = if matches!(value, Cell::Number(_)) {
                None
            } else {
                Some(value)
            };
        }
        self.tasks[index].pending -= 1;
        self.extensions.pending.remove(&id);
        Ok(true)
    }

    fn prune_extensions(&mut self) {
        self.extensions
            .pending
            .retain(|_, p| self.tasks.iter().any(|t| t.id == p.task && !t.done));
    }

    pub(super) fn extension_requests(&mut self) -> Vec<ExtensionRequest> {
        self.prune_extensions();
        self.extensions
            .pending
            .values()
            .filter(|p| p.remote)
            .map(|p| p.request.clone())
            .collect()
    }
}

fn cell_json(cell: &Cell, depth: usize, remaining: &mut usize) -> Result<Value> {
    ensure!(
        depth <= 32,
        "extension argument exceeds depth 32 (or cyclic list)"
    );
    let cost = match cell {
        Cell::Text(s) => s.len().saturating_add(2),
        _ => 8,
    };
    *remaining = remaining
        .checked_sub(cost)
        .context("extension arguments exceed 64 KiB budget")?;
    Ok(match cell {
        Cell::Number(n) => {
            ensure!(n.is_finite(), "extension numbers must be finite");
            Value::from(*n)
        }
        Cell::Bool(b) => Value::Bool(*b),
        Cell::Text(s) => {
            ensure!(s.len() <= 65536, "extension text exceeds 64 KiB");
            Value::String(s.to_string())
        }
        Cell::Null => Value::Null,
        Cell::Costume(_) => bail!("extension costume objects are not supported"),
        Cell::List(list) => {
            let list = list.borrow();
            ensure!(list.len() <= 4096, "extension list exceeds 4096 items");
            Value::Array(
                list.iter()
                    .map(|v| cell_json(v, depth + 1, remaining))
                    .collect::<Result<_>>()?,
            )
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        extensions::{ExtensionRegistry, JsonParse},
        studio::document::Document,
    };
    use serde_json::json;

    #[test]
    fn compiled_extension_call_disables_jit_and_unrelated_program_keeps_it() {
        let mut p = Document::blank().value().clone();
        let plain = Engine::new(Program::compile(&p).unwrap());
        assert!(plain.jit.is_some());
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
            "type":"on_running_group_activated","next":{
                "type":"nekoc_extension_call","fields":{"opcode":"example.json.parse"},
                "inputs":{"text":{"type":"text","fields":{"TEXT":"1"}}}
            }
        }]);
        let mut registry = ExtensionRegistry::new();
        registry
            .register(JsonParse::schema(false), Rc::new(JsonParse))
            .unwrap();
        let compiled = Engine::new(Program::compile_with_extensions(&p, &registry).unwrap());
        assert!(compiled.jit.is_none());
    }
}
