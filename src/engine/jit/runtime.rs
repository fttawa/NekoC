//! Small native calling conventions, not generic instruction dispatch. These
//! Normal helpers may allocate Cell/call stacks. Reporter-bearing helpers may
//! also invalidate numeric pointers, and must only be called at a region tail.
use super::*;

/// Start an instruction with the same output-budget and preincremented pc as tick.
fn begin(c: &NativeContext, pc: usize) -> bool {
    let engine = unsafe { &mut *c.engine };
    if engine.output_limit_reached() {
        return false;
    }
    engine.tasks[c.index].pc = pc + 1;
    let reentrant = engine.jit_profile.is_some() && engine.jit_reentrant(engine.program.ops[pc]);
    if let Some(profile) = engine.jit_profile.as_mut() {
        *profile
            .helper_reasons
            .entry(format!("native/{}", variant(engine.program.ops[pc])))
            .or_default() += 1;
        if reentrant {
            *profile
                .helper_reasons
                .entry(format!(
                    "native/reentrant-{}",
                    variant(engine.program.ops[pc])
                ))
                .or_default() += 1;
        }
    }
    true
}

fn finish(c: &NativeContext, pc: usize) -> u64 {
    let failed = unsafe {
        h_error(
            c as *const NativeContext as *mut NativeContext,
            pc as u64,
            (&(*c.engine).tasks)[c.index].pc as u64,
        )
    };
    if failed != 0 {
        u64::MAX - 1
    } else {
        unsafe { (&(*c.engine).tasks)[c.index].pc as u64 }
    }
}

/// Reentrant gateway. Branch directly evaluates its expression; other variants
/// really execute exec and are deliberately counted as delegated work. The
/// caller MUST immediately return, even when exec reports continuation.
pub(super) unsafe extern "C" fn h_reentrant(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &*c };
    let pc = pc as usize;
    let _timing = timing::instruction(c, "helper/reentrant", pc);
    if !begin(c, pc) {
        return u64::MAX;
    }
    let engine = unsafe { &mut *c.engine };
    let op = engine.program.ops[pc];
    // Branch has no dirty flags or other exec pre/post behavior. Keep its full
    // evaluator (including reporter side effects), but avoid generic dispatch.
    if let Op::Branch(expression, target) = op {
        if !super::super::truth(engine.eval(expression, c.actor)) {
            engine.tasks[c.index].pc = target;
        }
        return finish(c, pc);
    }
    if let Some(profile) = engine.jit_profile.as_mut() {
        profile.delegated_ops += 1;
        *profile
            .helper_reasons
            .entry(format!("op/{}", variant(op)))
            .or_default() += 1;
    }
    match engine.exec(c.index, pc, op, c.actor) {
        Ok(continuing) => {
            if !continuing {
                engine.jit_yield = true;
            }
            engine.tasks[c.index].pc as u64
        }
        Err(error) => {
            engine.jit_error = Some(error);
            u64::MAX - 1
        }
    }
}

pub(super) unsafe extern "C" fn h_call(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &mut *c };
    let pc = pc as usize;
    let _timing = timing::instruction(c, "helper/call", pc);
    if !begin(c, pc) {
        return u64::MAX;
    }
    let engine = unsafe { &mut *c.engine };
    let Op::Call(procedure, args) = engine.program.ops[pc] else {
        unreachable!()
    };
    let count = engine.program.call_arguments[args].len();
    let mut parameters = engine.take_parameters(count);
    for k in 0..count {
        let value = engine.program.call_arguments[args][k];
        parameters.push(engine.eval_value(value, c.actor));
    }
    let task = &mut engine.tasks[c.index];
    if task.calls.len() >= 10_000 {
        engine.jit_error = Some(anyhow!(
            "procedure stack limit at {}",
            engine.program.sources[pc]
        ));
        return u64::MAX - 1;
    }
    task.calls.push(super::super::CallFrame {
        pc: task.pc,
        parameters: std::mem::replace(&mut task.parameters, parameters),
        loops: task.loops.len(),
        ranges: task.ranges.len(),
    });
    task.pc = engine.program.procedure_entries[procedure];
    parameters::refresh(c);
    finish(c, pc)
}

pub(super) unsafe extern "C" fn h_return(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &mut *c };
    let pc = pc as usize;
    let _timing = timing::instruction(c, "helper/return", pc);
    if !begin(c, pc) {
        return u64::MAX;
    }
    let engine = unsafe { &mut *c.engine };
    if let Op::ReturnValue(value) = engine.program.ops[pc] {
        let value = engine.eval_value(value, c.actor);
        engine.tasks[c.index].returned = Some(value);
    }
    let parameters = {
        let task = &mut engine.tasks[c.index];
        let Some(call) = task.calls.pop() else {
            engine.jit_error = Some(anyhow!("invalid procedure return"));
            return u64::MAX - 1;
        };
        task.pc = call.pc;
        task.loops.truncate(call.loops);
        task.ranges.truncate(call.ranges);
        std::mem::replace(&mut task.parameters, call.parameters)
    };
    engine.recycle_parameters(parameters);
    parameters::refresh(c);
    finish(c, pc)
}

/// Preserve the actual Cell (including nested-list identity), evaluate the value
/// before resolving the destination, and check cycles before borrowing mutably.
pub(super) unsafe extern "C" fn h_append_cell(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &*c };
    let pc = pc as usize;
    let _timing = timing::instruction(c, "helper/append-cell", pc);
    if !begin(c, pc) {
        return u64::MAX;
    }
    let engine = unsafe { &mut *c.engine };
    let Op::AppendList(list, value) = engine.program.ops[pc] else {
        unreachable!()
    };
    let value = engine.eval_value(value, c.actor);
    if let Some(list) = engine.resolve_list(list) {
        if contains_list(&value, &list) {
            engine.jit_error = Some(anyhow!("cyclic list at {}", engine.program.sources[pc]));
            return u64::MAX - 1;
        }
        list.borrow_mut().push(value);
    }
    finish(c, pc)
}

/// Execute a scheduling boundary exactly once. KN and K4 use the same gateway
/// but separate policies in warp_iteration_yields. MAX-2 means executed and yielded;
/// the generated region must refund later instructions and immediately return.
pub(super) unsafe extern "C" fn h_boundary(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &*c };
    let pc = pc as usize;
    let _timing = timing::span(c.timing.as_ref(), "helper/boundary", pc);
    if !begin(c, pc) {
        return u64::MAX;
    }
    let engine = unsafe { &mut *c.engine };
    let yielding = match engine.program.ops[pc] {
        Op::WarpIteration => engine.warp_iteration_yields(),
        Op::Next(target, yielding) => {
            let task = &mut engine.tasks[c.index];
            let Some(left) = task.loops.last_mut() else {
                engine.jit_error = Some(anyhow!("invalid repeat stack"));
                return u64::MAX - 1;
            };
            *left -= 1;
            if *left > 0 {
                task.pc = target;
            } else {
                task.loops.pop();
            }
            yielding || engine.warp_iteration_yields()
        }
        Op::RangeNext(target, yielding) => {
            let task = &mut engine.tasks[c.index];
            let Some(range) = task.ranges.last_mut() else {
                engine.jit_error = Some(anyhow!("invalid range stack"));
                return u64::MAX - 1;
            };
            let next = range.value + range.step;
            let kn = engine.program.semantics == RuntimeSemantics::KnCurrent;
            if next == range.value && !(kn && range.step == 0.0) {
                engine.jit_error = Some(anyhow!(
                    "range step makes no progress at {}",
                    engine.program.sources[pc]
                ));
                return u64::MAX - 1;
            }
            range.value = next;
            let again = (range.step > 0.0 && next <= range.end)
                || (range.step < 0.0 && next >= range.end)
                || (kn && range.step == 0.0);
            if again {
                task.pc = target;
            } else {
                task.ranges.pop();
            }
            if yielding {
                again || !kn
            } else {
                engine.warp_iteration_yields()
            }
        }
        _ => unreachable!(),
    };
    if yielding {
        engine.jit_yield = true;
        u64::MAX - 2
    } else {
        finish(c, pc)
    }
}
