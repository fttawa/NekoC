//! Extension compiler/execution boundary, isolated from built-in scheduling.
use super::*;
use crate::extensions::{BlockKind, BlockSchema, CallResult, ErrorPolicy, ExtensionRequest};
use std::time::Instant;

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
    started: Instant,
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
    fn extension_schema(&self, block: &Value) -> Result<BlockSchema> {
        let opcode = field(block, "opcode");
        Ok(self
            .program
            .extensions
            .entries
            .get(opcode)
            .with_context(|| format!("unregistered extension {opcode}"))?
            .schema
            .clone())
    }

    pub(super) fn extension_hat(&self, block: &Value) -> Result<ScriptEvent> {
        let schema = self.extension_schema(block)?;
        ensure!(
            schema.block_kind() == BlockKind::Hat,
            "expected extension hat schema"
        );
        ensure!(
            block["inputs"]
                .as_object()
                .is_none_or(|inputs| inputs.is_empty()),
            "extension hat has no inputs"
        );
        Ok(ScriptEvent::Extension(schema.opcode))
    }

    /// Lower a reporter into one call and a task-local result. In particular a
    /// remote Promise never retries the surrounding expression or its siblings.
    pub(super) fn extension_reporter(&mut self, block: &Value) -> Result<usize> {
        let schema = self.extension_schema(block)?;
        let expected = if block["type"] == "nekoc_extension_boolean" {
            BlockKind::Boolean
        } else {
            BlockKind::Reporter
        };
        ensure!(
            schema.block_kind() == expected,
            "extension reporter kind mismatch"
        );
        ensure!(
            field(block, "result").is_empty(),
            "reporter result target is implicit"
        );
        let slot = self.program.local_count;
        self.program.local_count += 1;
        let call = self.compile_extension(block, &schema, Some(Target::Local(slot)))?;
        self.emit(Op::Extension(call), block);
        self.program.values.push(ValueExpr::Local(slot));
        Ok(self.program.values.len() - 1)
    }

    fn compile_extension(
        &mut self,
        block: &Value,
        schema: &BlockSchema,
        target: Option<Target>,
    ) -> Result<usize> {
        let inputs = block["inputs"].as_object();
        ensure!(
            inputs.map_or(0, |v| v.len()) == schema.parameters.len(),
            "extension input count mismatch for {}",
            schema.opcode
        );
        let mut arguments = Vec::new();
        for parameter in &schema.parameters {
            let child = input(block, &parameter.name)?;
            let value = self.value(child)?;
            // v2 expressions may suspend while compiling a later operand.
            // Freeze each operand at its original position. v1 keeps its
            // original instruction shape and command-only contract.
            arguments.push(if schema.api_version == 2 {
                self.save_await_value(value, child)
            } else {
                value
            });
        }
        let call = self.program.extension_calls.len();
        self.program.extension_calls.push(Call {
            opcode: schema.opcode.clone(),
            arguments,
            target,
        });
        Ok(call)
    }

    pub(super) fn extension_call(&mut self, block: &Value) -> Result<Op> {
        let schema = self.extension_schema(block)?;
        ensure!(
            schema.block_kind() == BlockKind::Command,
            "expected extension command schema"
        );
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
        let call = self.compile_extension(block, &schema, target)?;
        Ok(Op::Extension(call))
    }
}

impl Engine {
    /// Trigger a registered host event. No project can invent an opcode or load
    /// a handler. Each receiver gets a detached JSON payload, also for clones.
    /// Tasks are queued for the next scheduler pass, never run inside this call.
    pub fn emit_extension_event(&mut self, opcode: &str, payload: Value) -> Result<usize> {
        let entry = self
            .program
            .extensions
            .entries
            .get(opcode)
            .with_context(|| format!("unregistered extension {opcode}"))?;
        ensure!(
            entry.schema.block_kind() == BlockKind::Hat,
            "expected extension hat"
        );
        crate::extensions::ValueType::Any.validate(&payload)?;
        if self.stopped {
            return Ok(0);
        }
        let mut receivers = Vec::new();
        for script in 0..self.program.scripts.len() {
            if matches!(&self.program.scripts[script].event, ScriptEvent::Extension(name) if name == opcode)
                && self.in_active_scene(self.program.scripts[script].actor)
            {
                receivers.extend(
                    self.instances(self.program.scripts[script].actor)
                        .into_iter()
                        .map(|actor| (script, actor)),
                );
            }
        }
        ensure!(
            self.tasks.len().saturating_add(receivers.len()) <= 4096,
            "extension event task limit exceeded"
        );
        let count = receivers.len();
        for (script, actor) in receivers {
            if let Some(index) = self.spawn(script, actor) {
                self.tasks[index].payload = Cell::from_json(&payload)?;
            }
        }
        Ok(count)
    }

    fn extension_failure(
        &mut self,
        index: usize,
        spec: &Call,
        schema: &BlockSchema,
        message: String,
    ) -> Result<bool> {
        match self.program.extensions.policy.errors {
            ErrorPolicy::Propagate => bail!(message),
            ErrorPolicy::Report => {
                if self.logs.len() < 1024 {
                    self.logs.push(message);
                }
                self.finish_task(index);
                Ok(false)
            }
            ErrorPolicy::DefaultValue => {
                if self.logs.len() < 1024 {
                    self.logs.push(message);
                }
                if let Some(target) = spec.target {
                    self.extension_assign(
                        index,
                        target,
                        Cell::from_json(&schema.default_result())?,
                    );
                }
                Ok(!schema.blocking)
            }
        }
    }

    fn extension_assign(&mut self, index: usize, target: Target, value: Cell) {
        let (numbers, values, slot) = match target {
            Target::Global(slot) => (&mut self.slots, &mut self.values, slot),
            Target::Local(slot) => {
                let task = &mut self.tasks[index];
                (&mut task.locals, &mut task.local_values, slot)
            }
        };
        numbers[slot] = value.number();
        values[slot] = (!matches!(&value, Cell::Number(_))).then_some(value);
    }

    pub(super) fn exec_extension(
        &mut self,
        index: usize,
        actor: usize,
        call: usize,
    ) -> Result<bool> {
        self.prune_extensions()?;
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
        if let Err(error) = entry.schema.validate_arguments(&arguments) {
            return self.extension_failure(
                index,
                &spec,
                &entry.schema,
                format!("extension {} arguments invalid: {error:#}", spec.opcode),
            );
        }
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
        let started = Instant::now();
        let result = if let Some(handler) = &entry.handler {
            let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                handler.call(&request)
            })) {
                Ok(result) => result,
                Err(_) => {
                    return self.extension_failure(
                        index,
                        &spec,
                        &entry.schema,
                        format!("extension {} panicked", spec.opcode),
                    );
                }
            };
            match result {
                Ok(result) => result,
                Err(error) => {
                    return self.extension_failure(
                        index,
                        &spec,
                        &entry.schema,
                        format!("extension {} failed: {error:#}", spec.opcode),
                    );
                }
            }
        } else {
            CallResult::Pending
        };
        // Rc handlers run on the VM thread. This rejects late results, but is
        // not preemption: a handler that never returns requires process isolation.
        if started.elapsed() >= self.program.extensions.policy.timeout {
            return self.extension_failure(
                index,
                &spec,
                &entry.schema,
                format!("extension {} timed out", spec.opcode),
            );
        }
        match result {
            CallResult::Ready(value) => {
                if let Err(error) = entry.schema.validate_result(&value) {
                    return self.extension_failure(
                        index,
                        &spec,
                        &entry.schema,
                        format!(
                            "extension {} returned invalid value: {error:#}",
                            spec.opcode
                        ),
                    );
                }
                if let Some(target) = spec.target {
                    self.extension_assign(index, target, Cell::from_json(&value)?);
                }
                // A declared blocking call yields even when ready immediately.
                Ok(!entry.schema.blocking)
            }
            CallResult::Pending => {
                if !entry.schema.blocking {
                    return self.extension_failure(
                        index,
                        &spec,
                        &entry.schema,
                        format!("nonblocking extension {} returned Pending", spec.opcode),
                    );
                }
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
                        started,
                    },
                );
                Ok(false)
            }
        }
    }

    /// Complete once; unknown/stale/cancelled IDs are harmless. Invalid results
    /// propagate as runtime errors and never release a task with an untyped value.
    pub fn complete_extension(&mut self, id: u64, result: Result<Value, String>) -> Result<bool> {
        self.prune_extensions()?;
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
        let call = self.program.extension_calls[pending.call].clone();
        let schema = self.program.extensions.entries[&call.opcode].schema.clone();
        let value = match result {
            Ok(value) => value,
            Err(error) => {
                self.extension_failure(
                    index,
                    &call,
                    &schema,
                    format!("extension {} failed: {}", call.opcode, error),
                )?;
                self.extensions.pending.remove(&id);
                self.tasks[index].pending = self.tasks[index].pending.saturating_sub(1);
                return Ok(true);
            }
        };
        if let Err(error) = schema.validate_result(&value) {
            self.extension_failure(
                index,
                &call,
                &schema,
                format!(
                    "extension {} returned invalid value: {error:#}",
                    call.opcode
                ),
            )?;
            self.extensions.pending.remove(&id);
            self.tasks[index].pending = self.tasks[index].pending.saturating_sub(1);
            return Ok(true);
        }
        let value = Cell::from_json(&value)?;
        if let Some(target) = call.target {
            self.extension_assign(index, target, value);
        }
        self.tasks[index].pending -= 1;
        self.extensions.pending.remove(&id);
        Ok(true)
    }

    pub(super) fn prune_extensions(&mut self) -> Result<()> {
        let now = Instant::now();
        let timeout = self.program.extensions.policy.timeout;
        let mut expired = Vec::new();
        self.extensions.pending.retain(|id, p| {
            let alive = self.tasks.iter().any(|t| t.id == p.task && !t.done);
            if alive && now.duration_since(p.started) >= timeout {
                expired.push((*id, p.task, p.call));
            }
            alive
        });
        for (id, task, call) in expired {
            self.extensions.pending.remove(&id);
            let Some(index) = self.tasks.iter().position(|t| t.id == task && !t.done) else {
                continue;
            };
            let spec = self.program.extension_calls[call].clone();
            let schema = self.program.extensions.entries[&spec.opcode].schema.clone();
            self.tasks[index].pending = self.tasks[index].pending.saturating_sub(1);
            let message = format!("extension {} timed out after {:?}", spec.opcode, timeout);
            self.extension_failure(index, &spec, &schema, message)?;
        }
        Ok(())
    }

    pub(super) fn extension_requests(&mut self) -> Vec<ExtensionRequest> {
        self.extensions
            .pending
            .retain(|_, pending| self.tasks.iter().any(|t| t.id == pending.task && !t.done));
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
        Cell::Costume(_) | Cell::Midi(_) => bail!("extension objects are not supported"),
        Cell::Object(_) | Cell::Undefined => {
            bail!("extension KN object/undefined arguments are not supported")
        }
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
    fn compiled_extension_call_keeps_jit_for_unrelated_instructions() {
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
        assert!(compiled.jit.is_some());
    }
}
