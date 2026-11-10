//! Cranelift tier for hot bytecode. Numeric work runs as machine code; typed
//! helpers preserve Cells and procedure frames. Scheduling boundaries return a
//! yield flag to tick; reporters that can re-enter the VM remain interpreted.
//! Instruction counts are exact. Fuel leaders share native code so returning to
//! another entry does not recompile an overlapping control-flow region.
use super::{
    Binary, Cell, Engine, Expr, ExprOp, ListRef, Op, RuntimeSemantics, Target, Unary, ValueExpr,
    contains_list, list_index, read_list_index,
};
use anyhow::anyhow;
use cranelift_codegen::ir::{
    AbiParam, Block, InstBuilder, MemFlags, Signature, Value,
    condcodes::{FloatCC, IntCC},
    types,
};
use cranelift_codegen::isa::CallConv;
use cranelift_codegen::settings::{self, Configurable};
use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext};
use cranelift_jit::{JITBuilder, JITModule};
use cranelift_module::{Linkage, Module, default_libcall_names};
use std::collections::{BTreeMap, BTreeSet};

mod entries;
mod parameters;
mod runtime;
mod timing;
use runtime::{h_append_cell, h_boundary, h_call, h_reentrant, h_return};

/// Interpreted executions of one pc before it is compiled.
const HOT_THRESHOLD: u16 = 500;
const COLD_NEVER: u16 = u16::MAX;
const MAX_REGION_OPS: usize = 48;
/// A terminal entry can only call Rust and leave. Keep a small real-native
/// sample, then prefer the interpreter instead of paying a trampoline forever.
const TERMINAL_SAMPLE: u8 = 32;
/// Upper bound on one native run, so the scheduler still samples its clock.
const FUEL_SLICE: usize = 1 << 16;

#[derive(Default, serde::Serialize)]
pub(super) struct Profile {
    native_ops: u64,
    interpreted_ops: u64,
    delegated_ops: u64,
    node_calls: u64,
    regions: u64,
    fallback_reasons: BTreeMap<String, u64>,
    /// Static candidates within fallback instructions, not separate op counts.
    fallback_inputs: BTreeMap<String, u64>,
    #[serde(skip)]
    input_cache: BTreeMap<usize, Vec<String>>,
    helper_reasons: BTreeMap<String, u64>,
}

fn variant(value: impl std::fmt::Debug) -> String {
    format!("{value:?}")
        .split(['(', ' ', '{'])
        .next()
        .unwrap()
        .into()
}

#[repr(C)]
struct NativeContext {
    engine: *mut Engine,
    slots: *mut f64,
    locals: *mut f64,
    fuel: i64,
    index: usize,
    actor: usize,
    values: *mut Option<Cell>,
    local_values: *mut Option<Cell>,
    // Appended: generated code's existing numeric-pointer/fuel offsets stay fixed.
    timing: Option<timing::Handle>,
    parameters: *const Cell,
    parameter_count: usize,
}
const OFF_VALUES: i32 = 48;
const OFF_LOCAL_VALUES: i32 = 56;
const OFF_SLOTS: i32 = 8;
const OFF_LOCALS: i32 = 16;
const OFF_FUEL: i32 = 24;

type Entry = unsafe extern "C" fn(*mut NativeContext, u64) -> u64;

#[derive(Clone)]
struct Region {
    code: Entry,
    written_slots: std::rc::Rc<[usize]>,
    written_locals: std::rc::Rc<[usize]>,
}

pub(super) struct Jit {
    module: JITModule,
    regions: Vec<Option<Region>>,
    hot: Vec<u16>,
    terminal_runs: Vec<u8>,
    next_name: usize,
    timing: Option<timing::Handle>,
}

/// Tag byte of an empty `Option<Cell>`, or None if the layout native code relies on
/// does not hold for this compiler (the tier then stays off).
fn none_tag() -> Option<u8> {
    let tag = |value: &Option<Cell>| unsafe { *(value as *const Option<Cell>).cast::<u8>() };
    let none = tag(&None);
    let samples = [
        Cell::Number(1.0),
        Cell::Bool(false),
        Cell::Text("".into()),
        Cell::List(Default::default()),
        Cell::Null,
        Cell::Costume("".into()),
        Cell::Object(Default::default()),
        Cell::Undefined,
        Cell::Midi(std::rc::Rc::new(Cell::Number(0.0))),
    ];
    samples
        .into_iter()
        .all(|cell| tag(&Some(cell)) != none)
        .then_some(none)
}

/// A value the generated code handles as a plain number.
#[derive(Clone, Copy)]
enum Numeric {
    Expr(usize),
    Constant(f64),
    Global(usize),
    Local(usize),
    Actor(usize, usize),
    Parameter(usize),
    Add(usize, usize),
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Guard {
    Slot(bool, usize),
    Actor(usize, usize),
    Parameter(usize),
}

impl Jit {
    /// None when disabled (`NEKOC_JIT=0`) or the host has no native backend.
    pub(super) fn new(ops: usize) -> Option<Box<Self>> {
        if std::env::var_os("NEKOC_JIT").is_some_and(|v| v == "0") {
            return None;
        }
        none_tag()?;
        if !parameters::number_layout() {
            return None;
        }
        let mut flags = settings::builder();
        flags.set("opt_level", "speed").ok()?;
        let isa = cranelift_native::builder()
            .ok()?
            .finish(settings::Flags::new(flags))
            .ok()?;
        let module = JITModule::new(JITBuilder::with_isa(isa, default_libcall_names()));
        Some(Box::new(Self {
            module,
            regions: (0..ops).map(|_| None).collect(),
            hot: vec![0; ops],
            terminal_runs: vec![0; ops],
            next_name: 0,
            timing: timing::from_env(),
        }))
    }
}

impl Engine {
    /// Opt-in counters. Native ops include delegated ops; node calls are reporter
    /// evaluations, not instructions, and must not be added to the denominator.
    pub fn enable_jit_profile(&mut self) {
        self.jit_profile = Some(Profile::default());
    }

    pub fn jit_profile(&self) -> serde_json::Value {
        let mut profile =
            serde_json::to_value(&self.jit_profile).expect("serializable JIT counters");
        if let Some(timing) = self.jit.as_ref().and_then(|jit| jit.timing.as_ref()) {
            if profile.is_null() {
                profile = serde_json::json!({});
            }
            let mut measured = timing::snapshot(timing);
            // Resolve observed op sites only, without evaluating any expression.
            let pcs: BTreeSet<usize> = measured["sites"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|row| {
                    let name = row["name"].as_str().unwrap();
                    name == "compile"
                        || name.starts_with("region/")
                        || name.starts_with("reentrant/")
                        || matches!(
                            name,
                            "helper/call"
                                | "helper/return"
                                | "helper/reentrant"
                                | "helper/append-cell"
                                | "helper/boundary"
                                | "helper/exec"
                                | "helper/error-check"
                                | "helper/replace-item"
                        )
                })
                .map(|row| row["site"].as_u64().unwrap() as usize)
                .collect();
            measured["op_sites"] = serde_json::Value::Array(
                pcs.into_iter()
                    .filter_map(|pc| {
                        self.program.ops.get(pc).map(|op| {
                            serde_json::json!({
                                "pc":pc,"op":variant(op),"source":self.program.sources.get(pc)
                            })
                        })
                    })
                    .collect(),
            );
            measured["expression_sites"] = serde_json::Value::Array(
                measured["sites"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|row| row["name"] == "reporter/node")
                    .filter_map(|row| {
                        let pc = row["site"].as_u64().unwrap() as usize;
                        self.program.expressions.get(pc).map(|op| {
                            let value = match op {
                                ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => {
                                    self.program.values.get(*i).map(variant)
                                }
                                _ => None,
                            };
                            serde_json::json!({"pc":pc,"expression":variant(op),"value":value})
                        })
                    })
                    .collect(),
            );
            profile["timing"] = measured;
        }
        profile
    }

    pub(super) fn jit_record_interpreted(&mut self, pc: usize) {
        if self.jit_profile.is_none() {
            return;
        }
        let op = self.program.ops[pc];
        let reason = if let Some(jit) = self.jit.as_ref() {
            if !self.jit_supported(op) {
                format!("unsupported-or-impure/{}", variant(op))
            } else if jit.hot[pc] == COLD_NEVER {
                "backend-rejected".into()
            } else if jit.terminal_runs[pc] > TERMINAL_SAMPLE {
                "unprofitable-terminal-entry".into()
            } else if jit.regions[pc].is_some() {
                "boxed-write-or-fuel-exit".into()
            } else {
                format!("cold/{}", variant(op))
            }
        } else {
            "disabled-or-unavailable".into()
        };
        let profile = self.jit_profile.as_mut().unwrap();
        profile.interpreted_ops += 1;
        *profile.fallback_reasons.entry(reason).or_default() += 1;
        if let Some(reasons) = profile.input_cache.get(&pc) {
            for reason in reasons {
                *profile.fallback_inputs.entry(reason.clone()).or_default() += 1;
            }
            return;
        }
        // Attribute expression limitations without evaluating reporters again or
        // changing random draws. These are candidates, not executed leaf counts.
        let mut pending = match op {
            Op::Set(_, e)
            | Op::SetLocal(_, e)
            | Op::Change(_, e, _)
            | Op::ChangeLocal(_, e, _)
            | Op::ChangeActorVariable(_, e, _)
            | Op::Branch(e, _)
            | Op::Repeat(e, _) => vec![(false, e.end as usize - 1)],
            Op::SetValue(_, v)
            | Op::SetActorVariable(_, v)
            | Op::ReturnValue(v)
            | Op::AppendList(_, v) => vec![(true, v)],
            Op::Call(_, args) => self.program.call_arguments[args]
                .iter()
                .map(|&v| (true, v))
                .collect(),
            _ => Vec::new(),
        };
        let mut seen = BTreeSet::new();
        let mut reasons = BTreeSet::new();
        while let Some(key) = pending.pop() {
            if !seen.insert(key) {
                continue;
            }
            if key.0 {
                let reason = match self.program.values[key.1] {
                    ValueExpr::ActorVariable(..) => Some("private-variable"),
                    ValueExpr::Item(..) | ValueExpr::List(..) | ValueExpr::Find(..) => Some("list"),
                    ValueExpr::CallReturn(..) => Some("reporter-procedure"),
                    ValueExpr::ObjectLiteral(..)
                    | ValueExpr::ObjectGet(..)
                    | ValueExpr::ObjectSet(..)
                    | ValueExpr::ObjectKeys(..)
                    | ValueExpr::JsonParse(..)
                    | ValueExpr::JsonStringify(..) => Some("object"),
                    ValueExpr::Boolean(..)
                    | ValueExpr::Encode64(..)
                    | ValueExpr::Decode64(..)
                    | ValueExpr::ParseFloat(..)
                    | ValueExpr::IsNumber(..)
                    | ValueExpr::ParseInt(..) => Some("conversion"),
                    ValueExpr::Join(..) => Some("text"),
                    ValueExpr::Compare(..) | ValueExpr::Logic(..) => Some("comparison-or-logic"),
                    _ => None,
                };
                if let Some(reason) = reason {
                    reasons.insert(reason);
                }
            }
            pending.extend(self.evaluation_children(key));
        }
        let profile = self.jit_profile.as_mut().unwrap();
        let reasons: Vec<String> = reasons.into_iter().map(String::from).collect();
        for reason in &reasons {
            *profile.fallback_inputs.entry(reason.clone()).or_default() += 1;
        }
        profile.input_cache.insert(pc, reasons);
    }

    /// Runs native code at `pc` when available. Returns the instructions executed,
    /// or None when the interpreter must execute this op.
    #[inline]
    pub(super) fn jit_try(
        &mut self,
        index: usize,
        pc: usize,
        actor: usize,
        left: usize,
    ) -> Option<usize> {
        let jit = self.jit.as_mut()?;
        if jit.terminal_runs[pc] > TERMINAL_SAMPLE {
            return None;
        }
        if jit.regions[pc].is_none() {
            let hot = &mut jit.hot[pc];
            if *hot == COLD_NEVER {
                return None;
            }
            *hot += 1;
            if *hot < HOT_THRESHOLD {
                return None;
            }
            self.jit_compile(pc);
        }
        let used = self.jit_run(index, pc, actor, left);
        if used.is_some_and(|n| n > 0) {
            let jit = self.jit.as_mut().unwrap();
            if jit.terminal_runs[pc] != 0 {
                jit.terminal_runs[pc] += 1;
            }
        }
        used
    }

    fn jit_run(&mut self, index: usize, pc: usize, actor: usize, left: usize) -> Option<usize> {
        let timing = self.jit.as_ref()?.timing.clone();
        let _run = timing::span(timing.as_ref(), "region/run", pc);
        let entry_timing = timing::span(timing.as_ref(), "region/entry", pc);
        self.jit_yield = false;
        if self.output_limit_reached() {
            timing::count(timing.as_ref(), "entry/output-limit", pc, 1);
            return None;
        }
        let region = self.jit.as_ref()?.regions[pc].as_ref()?;
        let code = region.code;
        let locals = &self.tasks[index].local_values;
        // Native writes never touch boxed values: enter only while they are empty.
        // Only SetValue boxes, and slots it targets in this region clear on write.
        if !region
            .written_slots
            .iter()
            .all(|&s| self.values[s].is_none())
            || !region.written_locals.iter().all(|&s| locals[s].is_none())
        {
            timing::count(timing.as_ref(), "entry/boxed-write", pc, 1);
            return None;
        }
        let fuel = left.min(FUEL_SLICE) as i64;
        let slots = self.slots.as_mut_ptr();
        let locals = self.tasks[index].locals.as_mut_ptr();
        let values = self.values.as_mut_ptr();
        let local_values = self.tasks[index].local_values.as_mut_ptr();
        let mut context = NativeContext {
            engine: self,
            slots,
            locals,
            fuel,
            index,
            actor,
            values,
            local_values,
            timing: timing.clone(),
            parameters: self.tasks[index].parameters.as_ptr(),
            parameter_count: self.tasks[index].parameters.len(),
        };
        drop(entry_timing);
        // SAFETY: ordinary helpers do not invalidate cached numeric pointers.
        // Reentrant helpers may invalidate them, but are terminal: no generated
        // instruction after that call reads anything except NativeContext fuel.
        let native_timing = timing::span(timing.as_ref(), "region/native", pc);
        let next = unsafe { code(&mut context, pc as u64) } as usize;
        drop(native_timing);
        let _exit = timing::span(timing.as_ref(), "region/exit", pc);
        let used = (fuel - context.fuel) as usize;
        timing::count(timing.as_ref(), "region/ops", pc, used as u64);
        if used == 0 {
            timing::count(timing.as_ref(), "exit/zero-ops", pc, 1);
        }
        if context.fuel <= 0 {
            timing::count(timing.as_ref(), "exit/fuel-exhausted", pc, 1);
        }
        if self.jit_yield {
            timing::count(timing.as_ref(), "exit/yield", pc, 1);
        }
        if let Some(profile) = self.jit_profile.as_mut() {
            profile.native_ops += used as u64;
        }
        self.tasks[index].pc = next;
        if let Some(error) = self.value_error.take() {
            // An explicit instruction error (e.g. cyclic append or stack limit)
            // takes precedence over a pending evaluator error, just as in exec.
            if self.jit_error.is_none() {
                self.jit_error = Some(anyhow::anyhow!(error));
            }
        }
        (used > 0 || self.jit_error.is_some()).then_some(used)
    }

    fn jit_compile(&mut self, entry: usize) {
        let _timing = crate::import_perf::span("jit_compile_hot");
        let timing = self.jit.as_ref().and_then(|jit| jit.timing.clone());
        let _compile = timing::span(timing.as_ref(), "compile", entry);
        let mut jit = self.jit.take().expect("jit present");
        match compile(&mut jit, self, entry) {
            Some((region, entries)) => {
                timing::count(timing.as_ref(), "compile/accepted", entry, 1);
                // Only leaders can enter independently: each owns its fuel
                // deduction. Share code/guard storage without replacing older
                // entries, and still recheck pointers/boxed writes on every run.
                for pc in entries {
                    if jit.regions[pc].is_none() {
                        jit.regions[pc] = Some(region.clone());
                        if self.jit_reentrant(self.program.ops[pc]) {
                            jit.terminal_runs[pc] = 1;
                        }
                    }
                }
                jit.regions[entry] = Some(region);
                if let Some(profile) = self.jit_profile.as_mut() {
                    profile.regions += 1;
                }
            }
            None => {
                timing::count(timing.as_ref(), "compile/rejected", entry, 1);
                jit.hot[entry] = COLD_NEVER;
            }
        }
        self.jit = Some(jit);
    }

    /// The subtree cannot run a reporter procedure (the only expression that can
    /// box a slot or re-enter the scheduler), so native code may evaluate it.
    pub(super) fn jit_pure_expr(&self, root: usize) -> bool {
        let start = self.program.expression_starts[root] as usize;
        (start..=root).all(|pc| match self.program.expressions[pc] {
            ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => self.jit_pure_value(i),
            ExprOp::ListItem(ListRef::Expression(i), _)
            | ExprOp::ListLength(ListRef::Expression(i)) => self.jit_pure_value(i as usize),
            _ => true,
        })
    }

    fn jit_pure_value(&self, i: usize) -> bool {
        self.jit_pure_tree((true, i))
    }

    fn jit_pure_tree(&self, root: (bool, usize)) -> bool {
        let mut pending = vec![root];
        let mut seen = BTreeSet::new();
        while let Some(key) = pending.pop() {
            if !seen.insert(key) {
                continue;
            }
            // Conversions do not schedule, but object/JSON operations remain
            // interpreter-only. Reporter procedures can invalidate native pointers.
            if key.0
                && matches!(
                    self.program.values[key.1],
                    ValueExpr::CallReturn(..)
                        | ValueExpr::OfflineOcrCheck(..)
                        | ValueExpr::OfflineMicrobitMap(..)
                        | ValueExpr::OfflineMicrobitLed(..)
                        | ValueExpr::ObjectLiteral(..)
                        | ValueExpr::ObjectGet(..)
                        | ValueExpr::ObjectSet(..)
                        | ValueExpr::ObjectKeys(..)
                        | ValueExpr::JsonParse(..)
                        | ValueExpr::JsonStringify(..)
                )
            {
                return false;
            }
            pending.extend(self.evaluation_children(key));
        }
        true
    }

    /// Non-suspending ops native code delegates to `exec`.
    fn jit_delegable(&self, op: Op) -> bool {
        let pure = |e: Expr| self.jit_pure_expr(e.end as usize - 1);
        let value = |v: usize| self.jit_pure_value(v);
        let list = |r: ListRef| match r {
            ListRef::Expression(v) => value(v as usize),
            _ => true,
        };
        match op {
            Op::Move(e)
            | Op::X(e)
            | Op::Y(e)
            | Op::AddX(e)
            | Op::AddY(e)
            | Op::Turn(e)
            | Op::Direction(e)
            | Op::Scale(e)
            | Op::Opacity(e)
            | Op::Size(e)
            | Op::PenProperty(_, e, _) => pure(e),
            Op::Position(x, y) => pure(x) && pure(y),
            Op::Visible(_) | Op::Pen(_) | Op::Color(_) | Op::Clear => true,
            Op::ClearList(r) => list(r),
            Op::SetValue(_, v) | Op::ReturnValue(v) | Op::Kitten4Change(_, v, _) => value(v),
            Op::AppendList(r, v) => list(r) && value(v),
            Op::SetActorVariable(_, v) => value(v),
            Op::ChangeActorVariable(_, e, _) => pure(e),
            Op::Return => true,
            Op::Call(_, args) => self.program.call_arguments[args].iter().all(|&v| value(v)),
            Op::DeleteList(r, e) => list(r) && e.is_none_or(pure),
            Op::InsertList(r, e, v) => list(r) && pure(e) && value(v),
            Op::ReplaceList(r, e, v) => list(r) && e.is_none_or(pure) && value(v),
            _ => false,
        }
    }

    /// Whether native code can run `op` without leaving the VM's control flow.
    fn jit_supported(&self, op: Op) -> bool {
        if self.jit_reentrant(op) {
            return true;
        }
        let pure = |e: Expr| self.jit_pure_expr(e.end as usize - 1);
        match op {
            Op::Set(_, e)
            | Op::SetLocal(_, e)
            | Op::Change(_, e, _)
            | Op::ChangeLocal(_, e, _)
            | Op::Branch(e, _)
            | Op::Repeat(e, _) => pure(e),
            Op::Range(spec, _) => {
                let range = self.program.ranges[spec];
                pure(range.from) && pure(range.to) && pure(range.by)
            }
            Op::Jump(_) | Op::Break(..) => true,
            Op::Next(..) | Op::RangeNext(..) | Op::WarpIteration => true,
            other => self.jit_delegable(other),
        }
    }

    /// Instructions with reporter-procedure operands require a tail gateway,
    /// never the normal numeric lowering. Keep this whitelist narrow: adding a
    /// scheduling opcode here also requires preserving exec's continuation flag.
    fn jit_reentrant(&self, op: Op) -> bool {
        match op {
            Op::Call(_, args) => self.program.call_arguments[args]
                .iter()
                .any(|&v| !self.jit_pure_value(v)),
            Op::Branch(e, _) => !self.jit_pure_expr(e.end as usize - 1),
            Op::AppendList(list, v) => {
                !self.jit_pure_value(v)
                    || matches!(list, ListRef::Expression(v) if !self.jit_pure_value(v as usize))
            }
            Op::SetValue(_, v) | Op::ReturnValue(v) | Op::Kitten4Change(_, v, _) => {
                !self.jit_pure_value(v)
            }
            _ => false,
        }
    }
}

unsafe extern "C" fn h_node(c: *mut NativeContext, pc: u64) -> f64 {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "reporter/node", pc as usize);
    let engine = unsafe { &mut *c.engine };
    if let Some(profile) = engine.jit_profile.as_mut() {
        profile.node_calls += 1;
        let reason = match engine.program.expressions[pc as usize] {
            ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => {
                variant(engine.program.values[i])
            }
            other => variant(other),
        };
        *profile
            .helper_reasons
            .entry(format!("reporter/{reason}"))
            .or_default() += 1;
    }
    unsafe { (*c.engine).node(pc as usize, c.actor) }
}
// Encoded ListRef: low two bits select global/local/variable/expression.
fn list_key(list: ListRef) -> u64 {
    let (tag, slot) = match list {
        ListRef::Global(s) => (0, s),
        ListRef::Local(s) => (1, s),
        ListRef::Variable(s) => (2, s),
        ListRef::Expression(s) => (3, s),
    };
    (u64::from(slot) << 2) | tag
}

fn key_list(key: u64) -> ListRef {
    let slot = (key >> 2) as u32;
    match key & 3 {
        0 => ListRef::Global(slot),
        1 => ListRef::Local(slot),
        2 => ListRef::Variable(slot),
        _ => ListRef::Expression(slot),
    }
}

unsafe extern "C" fn h_list_item(c: *mut NativeContext, list: u64, at: f64) -> f64 {
    let _timing = timing::span(
        unsafe { (*c).timing.as_ref() },
        "helper/list-item",
        list as usize,
    );
    let engine = unsafe { &mut *(*c).engine };
    engine.check_list_index(at);
    engine
        .resolve_list(key_list(list))
        .map_or(f64::NAN, |list| {
            let values = list.borrow();
            read_list_index(at, values.len(), engine.program.semantics)
                .and_then(|i| values.get(i))
                .map_or(f64::NAN, Cell::number)
        })
}

unsafe extern "C" fn h_list_length(c: *mut NativeContext, list: u64) -> f64 {
    let _timing = timing::span(
        unsafe { (*c).timing.as_ref() },
        "helper/list-length",
        list as usize,
    );
    let engine = unsafe { &mut *(*c).engine };
    engine
        .resolve_list(key_list(list))
        .map_or(f64::NAN, |l| l.borrow().len() as f64)
}

/// Guards never raise errors: on missing scope or a non-number the original
/// evaluator executes, preserving Cell types and the precise error semantics.
unsafe extern "C" fn h_actor_is_number(c: *mut NativeContext, actor: u64, slot: u64) -> u64 {
    let c = unsafe { &*c };
    let _timing = timing::span(c.timing.as_ref(), "guard/actor", slot as usize);
    let engine = unsafe { &*c.engine };
    let actor = if actor == u64::MAX {
        c.actor
    } else {
        actor as usize
    };
    let valid = engine
        .sprites
        .get(actor)
        .filter(|s| s.alive)
        .and_then(|s| s.variables.get(&(slot as usize)))
        .is_some_and(|v| matches!(v, Cell::Number(_)));
    timing::count(
        c.timing.as_ref(),
        if valid {
            "guard/actor-pass"
        } else {
            "guard/actor-fail"
        },
        slot as usize,
        1,
    );
    u64::from(valid)
}

unsafe extern "C" fn h_actor_number(c: *mut NativeContext, actor: u64, slot: u64) -> f64 {
    let c = unsafe { &*c };
    let _timing = timing::span(c.timing.as_ref(), "helper/actor-read", slot as usize);
    let engine = unsafe { &mut *c.engine };
    let actor = if actor == u64::MAX {
        c.actor
    } else {
        actor as usize
    };
    engine.read_actor_variable(actor, slot as usize).number()
}

unsafe extern "C" fn h_set_actor_number(c: *mut NativeContext, slot: u64, value: f64) {
    let c = unsafe { &*c };
    let _timing = timing::span(c.timing.as_ref(), "helper/actor-write", slot as usize);
    unsafe { &mut *c.engine }.write_actor_variable(c.actor, slot as usize, Cell::Number(value));
}

unsafe extern "C" fn h_error(c: *mut NativeContext, pc: u64, next: u64) -> u64 {
    let c = unsafe { &*c };
    let _timing = timing::span(c.timing.as_ref(), "helper/error-check", pc as usize);
    let engine = unsafe { &mut *c.engine };
    if let Some(error) = engine.value_error.take() {
        engine.tasks[c.index].pc = next as usize;
        engine.jit_error = Some(anyhow!(
            "{error} at block {}",
            engine.program.sources[pc as usize]
        ));
        1
    } else {
        0
    }
}
extern "C" fn h_mod(a: f64, b: f64) -> f64 {
    Binary::Mod.apply(a, b)
}
extern "C" fn h_pow(a: f64, b: f64) -> f64 {
    Binary::Pow.apply(a, b)
}
extern "C" fn h_divisible(a: f64, b: f64) -> f64 {
    Binary::Divisible.apply(a, b)
}
extern "C" fn h_floor(v: f64) -> f64 {
    v.floor()
}
extern "C" fn h_ceil(v: f64) -> f64 {
    v.ceil()
}
extern "C" fn h_unary(op: u64, v: f64) -> f64 {
    // SAFETY: `op` is the address of a leaked Unary created by the code generator.
    unsafe { *(op as *const Unary) }.apply(v)
}
/// 0: skip the body, 1: entered.
unsafe extern "C" fn h_repeat(c: *mut NativeContext, n: f64) -> u64 {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "helper/repeat", 0);
    let k4 = unsafe { (*c.engine).program.semantics == RuntimeSemantics::Kitten4 };
    let n = if k4 { n.ceil() } else { n.floor() }.clamp(0.0, u32::MAX as f64) as u64;
    if n == 0 {
        return 0;
    }
    unsafe { (&mut (*c.engine).tasks)[c.index].loops.push(n) };
    1
}
unsafe extern "C" fn h_break(c: *mut NativeContext, pop: u64) {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "helper/break", 0);
    let task = unsafe { &mut (&mut (*c.engine).tasks)[c.index] };
    if pop == 1 {
        task.loops.pop();
    } else if pop == 2 {
        task.ranges.pop();
    }
}
/// 0: not executed (output limit), 1: done, 2: executed and failed.
unsafe extern "C" fn h_exec(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "helper/exec", pc as usize);
    let engine = unsafe { &mut *c.engine };
    if engine.output_limit_reached() {
        return 0;
    }
    let pc = pc as usize;
    engine.tasks[c.index].pc = pc + 1;
    let op = engine.program.ops[pc];
    if let Some(profile) = engine.jit_profile.as_mut() {
        profile.delegated_ops += 1;
        *profile
            .helper_reasons
            .entry(format!("op/{}", variant(op)))
            .or_default() += 1;
    }
    match engine.exec(c.index, pc, op, c.actor) {
        Ok(_) => 1,
        Err(error) => {
            engine.jit_error = Some(error);
            2
        }
    }
}

/// Returns the new pc, MAX for an unexecuted op, MAX-1 for an executed error.
unsafe extern "C" fn h_transfer(c: *mut NativeContext, pc: u64) -> u64 {
    match unsafe { h_exec(c, pc) } {
        0 => return u64::MAX,
        2 => return u64::MAX - 1,
        _ => {}
    }
    // A drawing/audio helper may just have filled the output budget. Do not
    // execute subsequent inlined instructions before tick observes that limit.
    if unsafe { (*(*c).engine).output_limit_reached() } {
        return u64::MAX - 2;
    }
    unsafe { h_pc(c) }
}

unsafe extern "C" fn h_pc(c: *mut NativeContext) -> u64 {
    let c = unsafe { &*c };
    unsafe { (&(*c.engine).tasks)[c.index].pc as u64 }
}
/// Same semantics as `Op::ReplaceList` for a number written to a global list.
unsafe extern "C" fn h_replace_number(c: *mut NativeContext, list: u64, at: f64, value: f64) {
    let _timing = timing::span(
        unsafe { (*c).timing.as_ref() },
        "helper/replace-number",
        list as usize,
    );
    let engine = unsafe { &*(*c).engine };
    let mut values = engine.lists[list as usize].borrow_mut();
    if let Some(at) = list_index(at) {
        match values.get_mut(at) {
            Some(cell) => *cell = Cell::Number(value),
            None => values.push(Cell::Number(value)),
        }
    }
}
/// `Op::ReplaceList` copying a cell between global lists. 2: executed and failed.
unsafe extern "C" fn h_replace_item(
    c: *mut NativeContext,
    target: u64,
    at: f64,
    source: u64,
    from: f64,
    pc: u64,
) -> u64 {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "helper/replace-item", pc as usize);
    let engine = unsafe { &mut *c.engine };
    let cell = {
        let values = engine.lists[source as usize].borrow();
        list_index(from)
            .and_then(|i| values.get(i))
            .cloned()
            .unwrap_or(Cell::Number(f64::NAN))
    };
    if contains_list(&cell, &engine.lists[target as usize]) {
        engine.tasks[c.index].pc = pc as usize + 1;
        engine.jit_error = Some(anyhow!(
            "cyclic list at {}",
            engine.program.sources[pc as usize]
        ));
        return 2;
    }
    let mut values = engine.lists[target as usize].borrow_mut();
    if let Some(at) = list_index(at) {
        match values.get_mut(at) {
            Some(slot) => *slot = cell,
            None => values.push(cell),
        }
    }
    1
}
unsafe extern "C" fn h_append_number(c: *mut NativeContext, list: u64, value: f64) {
    let _timing = timing::span(
        unsafe { (*c).timing.as_ref() },
        "helper/append-number",
        list as usize,
    );
    let engine = unsafe { &mut *(*c).engine };
    if let Some(list) = engine.resolve_list(key_list(list)) {
        list.borrow_mut().push(Cell::Number(value));
    }
}
/// `target = list[at]` without the generic dispatch: bit 0 of `target` selects locals.
unsafe extern "C" fn h_assign_item(c: *mut NativeContext, target: u64, list: u64, at: f64) {
    let c = unsafe { &mut *c };
    let _timing = timing::span(c.timing.as_ref(), "helper/assign-item", target as usize);
    let engine = unsafe { &mut *c.engine };
    engine.check_list_index(at);
    let cell = engine
        .resolve_list(key_list(list))
        .map_or(Cell::Null, |list| {
            let values = list.borrow();
            let index = read_list_index(at, values.len(), engine.program.semantics);
            match index.and_then(|i| values.get(i)) {
                Some(cell) => cell.clone(),
                None => {
                    if engine.program.semantics == RuntimeSemantics::Kitten4
                        && engine.value_error.is_none()
                    {
                        engine.value_error = Some(format!(
                            "lists_get_value_bad_index (index {:?}, length {})",
                            index.and_then(|i| i.checked_add(1)),
                            values.len()
                        ));
                    }
                    Cell::Number(f64::NAN)
                }
            }
        });
    let slot = (target >> 1) as usize;
    let target = if target & 1 == 1 {
        Target::Local(slot)
    } else {
        Target::Global(slot)
    };
    engine.assign(target, cell);
}
unsafe extern "C" fn h_clear_slot(c: *mut NativeContext, slot: u64) {
    unsafe { (&mut (*(*c).engine).values)[slot as usize] = None };
}
unsafe extern "C" fn h_clear_local(c: *mut NativeContext, slot: u64) {
    let c = unsafe { &mut *c };
    unsafe { (&mut (*c.engine).tasks)[c.index].local_values[slot as usize] = None };
}

struct Gen<'a, 'b> {
    b: &'a mut FunctionBuilder<'b>,
    engine: &'a Engine,
    ctx: Value,
    conv: CallConv,
    slots: Value,
    locals: Value,
    boxed_slots: &'a BTreeSet<usize>,
    boxed_locals: &'a BTreeSet<usize>,
    values: Value,
    local_values: Value,
    none: i64,
    returns: &'a [usize],
}

impl Gen<'_, '_> {
    /// Report an expression error at the instruction that evaluated it, after
    /// that instruction's writes but before any subsequent op can run.
    fn check_error(&mut self, pc: usize, remaining: i64) {
        let next = self.b.ins().iconst(types::I64, pc as i64 + 1);
        self.check_error_next(pc, remaining, next);
    }

    fn check_error_next(&mut self, pc: usize, remaining: i64, next_pc: Value) {
        // Keep the pre-existing pure numeric loop fast path free of helper calls.
        let expr = match self.engine.program.ops[pc] {
            Op::Set(_, e)
            | Op::SetLocal(_, e)
            | Op::Change(_, e, _)
            | Op::ChangeLocal(_, e, _)
            | Op::Branch(e, _)
            | Op::Repeat(e, _) => Some(e),
            _ => None,
        };
        if expr.is_some_and(|e| {
            let root = e.end as usize - 1;
            (self.engine.program.expression_starts[root] as usize..=root).all(|i| {
                matches!(
                    self.engine.program.expressions[i],
                    ExprOp::Constant(_)
                        | ExprOp::Slot(_)
                        | ExprOp::Local(_)
                        | ExprOp::Binary(_)
                        | ExprOp::Unary(_)
                )
            })
        }) {
            return;
        }
        let site = self.b.ins().iconst(types::I64, pc as i64);
        let failed = self
            .call(
                h_error as *const () as usize,
                &[types::I64, types::I64, types::I64],
                Some(types::I64),
                &[self.ctx, site, next_pc],
            )
            .unwrap();
        let exit = self.b.create_block();
        let next = self.b.create_block();
        self.b.ins().brif(failed, exit, &[], next, &[]);
        self.b.switch_to_block(exit);
        // The failing instruction already executed; refund only later ops.
        self.executed_error(remaining);
        self.b.switch_to_block(next);
    }

    fn call(
        &mut self,
        address: usize,
        params: &[types::Type],
        ret: Option<types::Type>,
        args: &[Value],
    ) -> Option<Value> {
        let mut sig = Signature::new(self.conv);
        sig.params.extend(params.iter().map(|t| AbiParam::new(*t)));
        sig.returns.extend(ret.map(AbiParam::new));
        let sig = self.b.import_signature(sig);
        let callee = self.b.ins().iconst(types::I64, address as i64);
        let call = self.b.ins().call_indirect(sig, callee, args);
        self.b.inst_results(call).first().copied()
    }
    fn call1(&mut self, address: usize, a: Value) -> Value {
        self.call(address, &[types::F64], Some(types::F64), &[a])
            .unwrap()
    }
    fn call2(&mut self, address: usize, a: Value, b: Value) -> Value {
        self.call(
            address,
            &[types::F64, types::F64],
            Some(types::F64),
            &[a, b],
        )
        .unwrap()
    }
    fn load(&mut self, base: Value, slot: usize) -> Value {
        self.b
            .ins()
            .load(types::F64, MemFlags::trusted(), base, (slot * 8) as i32)
    }
    fn store(&mut self, base: Value, slot: usize, value: Value) {
        self.b
            .ins()
            .store(MemFlags::trusted(), value, base, (slot * 8) as i32);
    }
    fn truth(&mut self, v: Value) -> Value {
        // abs(v) > 0 is false for both signed zeros and NaNs, and true for
        // every other f64 (including infinities). Unlike `fcmp one`, this
        // predicate and its complement can both be lowered by aarch64.
        let magnitude = self.b.ins().fabs(v);
        let zero = self.b.ins().f64const(0.0);
        self.b.ins().fcmp(FloatCC::GreaterThan, magnitude, zero)
    }
    fn number(&mut self, flag: Value) -> Value {
        let one = self.b.ins().f64const(1.0);
        let zero = self.b.ins().f64const(0.0);
        self.b.ins().select(flag, one, zero)
    }

    fn expr(&mut self, pc: usize) -> Value {
        // Avoid heap traversal for the usual tiny numeric expression. Postfix
        // span bounds this recursion; mixed-value roots cannot inline deep trees.
        if pc - (self.engine.program.expression_starts[pc] as usize) < 64 {
            return match self.engine.program.expressions[pc] {
                ExprOp::Binary(op) => {
                    let right = pc - 1;
                    let left = self.engine.program.expression_starts[right] as usize - 1;
                    let a = self.expr(left);
                    let b = self.expr(right);
                    self.binary(op, a, b)
                }
                ExprOp::Unary(op) => {
                    let a = self.expr(pc - 1);
                    self.unary(op, a)
                }
                // Global indexed reads and other helpers use the common
                // explicit-stack path below to preserve operand order.
                ExprOp::ListItem(_, false) => self.expr_iterative(pc),
                _ => self.expr_leaf(pc),
            };
        }
        self.expr_iterative(pc)
    }
    fn expr_iterative(&mut self, pc: usize) -> Value {
        let mut work = vec![(pc, false)];
        let mut values = Vec::new();
        while let Some((at, exit)) = work.pop() {
            if !exit {
                match self.engine.program.expressions[at] {
                    ExprOp::Binary(_) => {
                        let right = at - 1;
                        let left = self.engine.program.expression_starts[right] as usize - 1;
                        work.extend([(at, true), (right, false), (left, false)]);
                        continue;
                    }
                    ExprOp::Unary(_) | ExprOp::ListItem(_, false) => {
                        work.extend([(at, true), (at - 1, false)]);
                        continue;
                    }
                    _ => {}
                }
            }
            let value = match self.engine.program.expressions[at] {
                ExprOp::Binary(op) => {
                    let b = values.pop().unwrap();
                    let a = values.pop().unwrap();
                    self.binary(op, a, b)
                }
                ExprOp::Unary(op) => {
                    let a = values.pop().unwrap();
                    self.unary(op, a)
                }
                ExprOp::ListItem(list, false) => {
                    let at = values.pop().unwrap();
                    let list = self.b.ins().iconst(types::I64, list_key(list) as i64);
                    let ctx = self.ctx;
                    self.call(
                        h_list_item as *const () as usize,
                        &[types::I64, types::I64, types::F64],
                        Some(types::F64),
                        &[ctx, list, at],
                    )
                    .unwrap()
                }
                _ => self.expr_leaf(at),
            };
            values.push(value);
        }
        values.pop().unwrap()
    }
    fn expr_leaf(&mut self, pc: usize) -> Value {
        match self.engine.program.expressions[pc] {
            ExprOp::Constant(n) => self.b.ins().f64const(n),
            ExprOp::Slot(s) => self.load(self.slots, s),
            ExprOp::Local(s) => self.load(self.locals, s),
            ExprOp::ListLength(list) => {
                let list = self.b.ins().iconst(types::I64, list_key(list) as i64);
                self.call(
                    h_list_length as *const () as usize,
                    &[types::I64, types::I64],
                    Some(types::F64),
                    &[self.ctx, list],
                )
                .unwrap()
            }
            ExprOp::Truth(i) if self.truth_tree(i, &mut Vec::new()) => self.guarded(
                pc,
                |g| {
                    let flag = g.truth_flag(i);
                    g.number(flag)
                },
                i,
            ),
            ExprOp::Value(i) if self.numeric(i, &mut Vec::new()).is_some() => self.guarded(
                pc,
                |g| {
                    let n = g.numeric(i, &mut Vec::new()).unwrap();
                    g.numeric_value(n)
                },
                i,
            ),
            _ => self.node_call(pc),
        }
    }

    fn node_call(&mut self, pc: usize) -> Value {
        let at = self.b.ins().iconst(types::I64, pc as i64);
        let ctx = self.ctx;
        self.call(
            h_node as *const () as usize,
            &[types::I64, types::I64],
            Some(types::F64),
            &[ctx, at],
        )
        .unwrap()
    }

    /// Classifies a value as numeric, recording which variables must be unboxed.
    fn numeric(&self, i: usize, guards: &mut Vec<Guard>) -> Option<Numeric> {
        // Deep mixed-value trees use the heap evaluator through h_node rather
        // than recursively inlining Number -> Value -> Number chains.
        if self.engine.program.deep_values.contains(&i) {
            return None;
        }
        match self.engine.program.values[i] {
            ValueExpr::Number(e) => Some(Numeric::Expr(e.end as usize - 1)),
            ValueExpr::Constant(c) => match self.engine.program.constants[c] {
                Cell::Number(n) => Some(Numeric::Constant(n)),
                _ => None,
            },
            ValueExpr::Global(s) => {
                guards.push(Guard::Slot(false, s));
                Some(Numeric::Global(s))
            }
            ValueExpr::Local(s) => {
                guards.push(Guard::Slot(true, s));
                Some(Numeric::Local(s))
            }
            ValueExpr::ActorVariable(actor, slot, None) => {
                guards.push(Guard::Actor(actor, slot));
                Some(Numeric::Actor(actor, slot))
            }
            ValueExpr::Parameter(slot) => {
                guards.push(Guard::Parameter(slot));
                Some(Numeric::Parameter(slot))
            }
            ValueExpr::Kitten4Add(a, b) => {
                self.numeric(a, guards)?;
                self.numeric(b, guards)?;
                Some(Numeric::Add(a, b))
            }
            _ => None,
        }
    }

    /// Whether the truth of this value is computable from numbers alone.
    fn truth_tree(&self, i: usize, guards: &mut Vec<Guard>) -> bool {
        let mut pending = vec![i];
        while let Some(i) = pending.pop() {
            match self.engine.program.values[i] {
                ValueExpr::Compare(a, b, op) => {
                    if !(matches!(
                        op,
                        Binary::Eq | Binary::Ne | Binary::Lt | Binary::Le | Binary::Gt | Binary::Ge
                    ) && self.numeric(a, guards).is_some()
                        && self.numeric(b, guards).is_some())
                    {
                        return false;
                    }
                }
                ValueExpr::Not(a) => pending.push(a),
                ValueExpr::Logic(a, b, _) => pending.extend([b, a]),
                _ => {
                    if self.numeric(i, guards).is_none() {
                        return false;
                    }
                }
            }
        }
        true
    }

    fn numeric_value(&mut self, value: Numeric) -> Value {
        match value {
            Numeric::Expr(pc) => self.expr(pc),
            Numeric::Constant(n) => self.b.ins().f64const(n),
            Numeric::Global(s) => self.load(self.slots, s),
            Numeric::Local(s) => self.load(self.locals, s),
            Numeric::Actor(actor, slot) => {
                let actor = self.b.ins().iconst(types::I64, actor as i64);
                let slot = self.b.ins().iconst(types::I64, slot as i64);
                self.call(
                    h_actor_number as *const () as usize,
                    &[types::I64, types::I64, types::I64],
                    Some(types::F64),
                    &[self.ctx, actor, slot],
                )
                .unwrap()
            }
            Numeric::Parameter(slot) => self.parameter(slot, false),
            Numeric::Add(a, b) => {
                // Every caller first classified the complete Add tree and ran
                // its guards. Reclassification here must not become an entry
                // point that bypasses parameter length/tag checks.
                let a = self.numeric(a, &mut Vec::new()).unwrap();
                let b = self.numeric(b, &mut Vec::new()).unwrap();
                let a = self.numeric_value(a);
                let b = self.numeric_value(b);
                self.b.ins().fadd(a, b)
            }
        }
    }

    fn truth_flag(&mut self, i: usize) -> Value {
        let mut pending = vec![(i, false)];
        let mut output = Vec::new();
        while let Some((i, exit)) = pending.pop() {
            if !exit {
                pending.push((i, true));
                match self.engine.program.values[i] {
                    ValueExpr::Not(a) => pending.push((a, false)),
                    ValueExpr::Logic(a, b, _) => pending.extend([(b, false), (a, false)]),
                    _ => {}
                }
                continue;
            }
            let value = match self.engine.program.values[i] {
                ValueExpr::Compare(a, b, op) => {
                    let a = self.numeric(a, &mut Vec::new()).unwrap();
                    let b = self.numeric(b, &mut Vec::new()).unwrap();
                    let a = self.numeric_value(a);
                    let b = self.numeric_value(b);
                    if self.engine.program.semantics == RuntimeSemantics::Kitten4
                        && matches!(op, Binary::Eq | Binary::Ne)
                    {
                        // Official Y+p1 (lodash isEqual): NaN equals NaN in
                        // value comparisons, unlike numeric arithmetic Eq.
                        let equal = self.b.ins().fcmp(FloatCC::Equal, a, b);
                        let nan_a = self.b.ins().fcmp(FloatCC::Unordered, a, a);
                        let nan_b = self.b.ins().fcmp(FloatCC::Unordered, b, b);
                        let both_nan = self.b.ins().band(nan_a, nan_b);
                        let equal = self.b.ins().bor(equal, both_nan);
                        let result = if matches!(op, Binary::Ne) {
                            self.b.ins().bxor_imm(equal, 1)
                        } else {
                            equal
                        };
                        output.push(result);
                        continue;
                    }
                    let cc = match op {
                        Binary::Eq => FloatCC::Equal,
                        Binary::Ne => FloatCC::NotEqual,
                        Binary::Lt => FloatCC::LessThan,
                        Binary::Le => FloatCC::LessThanOrEqual,
                        Binary::Gt => FloatCC::GreaterThan,
                        _ => FloatCC::GreaterThanOrEqual,
                    };
                    self.b.ins().fcmp(cc, a, b)
                }
                ValueExpr::Not(a) => {
                    let _ = a;
                    let flag = output.pop().unwrap();
                    self.b.ins().bxor_imm(flag, 1)
                }
                ValueExpr::Logic(a, b, and) => {
                    let _ = (a, b);
                    let b = output.pop().unwrap();
                    let a = output.pop().unwrap();
                    if and {
                        self.b.ins().band(a, b)
                    } else {
                        self.b.ins().bor(a, b)
                    }
                }
                _ => {
                    let n = self.numeric(i, &mut Vec::new()).unwrap();
                    let v = self.numeric_value(n);
                    self.truth(v)
                }
            };
            output.push(value);
        }
        output.pop().unwrap()
    }

    /// Branches to `slow` unless every listed variable is unboxed.
    fn check_unboxed(&mut self, guards: &[Guard], slow: Block) {
        let stride = std::mem::size_of::<Option<Cell>>();
        for &guard in guards {
            let (local, slot) = match guard {
                Guard::Slot(local, slot) => (local, slot),
                Guard::Parameter(slot) => {
                    let value = self.parameter(slot, true);
                    let valid = self.truth(value);
                    let next = self.b.create_block();
                    self.b.ins().brif(valid, next, &[], slow, &[]);
                    self.b.switch_to_block(next);
                    continue;
                }
                Guard::Actor(actor, slot) => {
                    let actor = self.b.ins().iconst(types::I64, actor as i64);
                    let slot = self.b.ins().iconst(types::I64, slot as i64);
                    let valid = self
                        .call(
                            h_actor_is_number as *const () as usize,
                            &[types::I64, types::I64, types::I64],
                            Some(types::I64),
                            &[self.ctx, actor, slot],
                        )
                        .unwrap();
                    let next = self.b.create_block();
                    self.b.ins().brif(valid, next, &[], slow, &[]);
                    self.b.switch_to_block(next);
                    continue;
                }
            };
            let base = if local {
                self.local_values
            } else {
                self.values
            };
            let tag =
                self.b
                    .ins()
                    .load(types::I8, MemFlags::trusted(), base, (slot * stride) as i32);
            let unboxed = self.b.ins().icmp_imm(IntCC::Equal, tag, self.none);
            let next = self.b.create_block();
            self.b.ins().brif(unboxed, next, &[], slow, &[]);
            self.b.switch_to_block(next);
        }
    }

    /// `fast` when the value's variables are unboxed, the interpreted node otherwise.
    fn guarded(&mut self, pc: usize, fast: impl FnOnce(&mut Self) -> Value, i: usize) -> Value {
        let mut guards = Vec::new();
        if !self.truth_tree(i, &mut guards) {
            self.numeric(i, &mut guards);
        }
        guards.sort_unstable();
        guards.dedup();
        if guards.is_empty() {
            return fast(self);
        }
        let slow = self.b.create_block();
        let merge = self.b.create_block();
        let result = self.b.append_block_param(merge, types::F64);
        self.check_unboxed(&guards, slow);
        let v = fast(self);
        self.b.ins().jump(merge, &[v.into()]);
        self.b.switch_to_block(slow);
        let v = self.node_call(pc);
        self.b.ins().jump(merge, &[v.into()]);
        self.b.switch_to_block(merge);
        result
    }

    /// Stores a number into a variable and drops any boxed value it held.
    fn assign_number(&mut self, target: Target, v: Value) {
        let (local, slot) = match target {
            Target::Global(s) => (false, s),
            Target::Local(s) => (true, s),
        };
        self.store(if local { self.locals } else { self.slots }, slot, v);
        if local {
            self.clear_local(slot)
        } else {
            self.clear_global(slot)
        }
    }

    fn compare(&mut self, cc: FloatCC, a: Value, b: Value) -> Value {
        let flag = self.b.ins().fcmp(cc, a, b);
        self.number(flag)
    }

    fn binary(&mut self, op: Binary, a: Value, b: Value) -> Value {
        match op {
            Binary::Add => self.b.ins().fadd(a, b),
            Binary::Sub => self.b.ins().fsub(a, b),
            Binary::Mul => self.b.ins().fmul(a, b),
            Binary::Div => self.b.ins().fdiv(a, b),
            Binary::Mod => self.call2(h_mod as *const () as usize, a, b),
            Binary::Pow => self.call2(h_pow as *const () as usize, a, b),
            Binary::Divisible => self.call2(h_divisible as *const () as usize, a, b),
            Binary::Eq => self.compare(FloatCC::Equal, a, b),
            Binary::Ne => self.compare(FloatCC::NotEqual, a, b),
            Binary::Lt => self.compare(FloatCC::LessThan, a, b),
            Binary::Le => self.compare(FloatCC::LessThanOrEqual, a, b),
            Binary::Gt => self.compare(FloatCC::GreaterThan, a, b),
            Binary::Ge => self.compare(FloatCC::GreaterThanOrEqual, a, b),
            Binary::And | Binary::Or => {
                let x = self.truth(a);
                let y = self.truth(b);
                let flag = if matches!(op, Binary::And) {
                    self.b.ins().band(x, y)
                } else {
                    self.b.ins().bor(x, y)
                };
                self.number(flag)
            }
        }
    }

    fn unary(&mut self, op: Unary, a: Value) -> Value {
        match op {
            Unary::Neg => self.b.ins().fneg(a),
            Unary::Abs => self.b.ins().fabs(a),
            Unary::Sqrt => self.b.ins().sqrt(a),
            Unary::Floor => self.call1(h_floor as *const () as usize, a),
            Unary::Ceil => self.call1(h_ceil as *const () as usize, a),
            Unary::Round => {
                let half = self.b.ins().f64const(0.5);
                let v = self.b.ins().fadd(a, half);
                self.call1(h_floor as *const () as usize, v)
            }
            Unary::Not => {
                let t = self.truth(a);
                let flag = self.b.ins().bxor_imm(t, 1);
                self.number(flag)
            }
            other => {
                // Compiled code lives as long as the process-owned module.
                let op: &'static Unary = Box::leak(Box::new(other));
                let at = self.b.ins().iconst(types::I64, op as *const Unary as i64);
                self.call(
                    h_unary as *const () as usize,
                    &[types::I64, types::F64],
                    Some(types::F64),
                    &[at, a],
                )
                .unwrap()
            }
        }
    }

    /// Refunds this op and the rest of its chunk, then leaves at `pc`.
    fn side_exit(&mut self, pc: usize, remaining: i64) {
        let fuel = self
            .b
            .ins()
            .load(types::I64, MemFlags::trusted(), self.ctx, OFF_FUEL);
        let refunded = self.b.ins().iadd_imm(fuel, remaining);
        self.b
            .ins()
            .store(MemFlags::trusted(), refunded, self.ctx, OFF_FUEL);
        let value = self.b.ins().iconst(types::I64, pc as i64);
        self.b.ins().return_(&[value]);
    }

    /// Slots this region can box through SetValue need their value dropped on write.
    fn clear_boxed(&mut self, helper: usize, local: bool, slot: usize) {
        let drop_value = self.b.create_block();
        let done = self.b.create_block();
        let stride = std::mem::size_of::<Option<Cell>>();
        let base = if local {
            self.local_values
        } else {
            self.values
        };
        let tag = self
            .b
            .ins()
            .load(types::I8, MemFlags::trusted(), base, (slot * stride) as i32);
        let unboxed = self.b.ins().icmp_imm(IntCC::Equal, tag, self.none);
        self.b.ins().brif(unboxed, done, &[], drop_value, &[]);
        self.b.switch_to_block(drop_value);
        let slot = self.b.ins().iconst(types::I64, slot as i64);
        let ctx = self.ctx;
        self.call(helper, &[types::I64, types::I64], None, &[ctx, slot]);
        self.b.ins().jump(done, &[]);
        self.b.switch_to_block(done);
    }
    fn clear_global(&mut self, slot: usize) {
        if self.boxed_slots.contains(&slot) {
            self.clear_boxed(h_clear_slot as *const () as usize, false, slot);
        }
    }
    fn clear_local(&mut self, slot: usize) {
        if self.boxed_locals.contains(&slot) {
            self.clear_boxed(h_clear_local as *const () as usize, true, slot);
        }
    }

    /// Calls the generic delegated helper.
    fn transfer(&mut self, pc: usize, remaining: i64) -> Value {
        self.transfer_with(h_transfer as *const () as usize, pc, remaining)
    }

    /// Dedicated instruction helpers share MAX / MAX-1 exit sentinels.
    fn transfer_with(&mut self, helper: usize, pc: usize, remaining: i64) -> Value {
        let at = self.b.ins().iconst(types::I64, pc as i64);
        let ctx = self.ctx;
        let next = self
            .call(
                helper,
                &[types::I64, types::I64],
                Some(types::I64),
                &[ctx, at],
            )
            .unwrap();
        let failed = self.b.ins().icmp_imm(IntCC::Equal, next, -1);
        let ok = self.b.create_block();
        let exit = self.b.create_block();
        self.b.ins().brif(failed, exit, &[], ok, &[]);
        self.b.switch_to_block(exit);
        self.side_exit(pc, remaining);
        self.b.switch_to_block(ok);
        let failed = self.b.ins().icmp_imm(IntCC::Equal, next, -2);
        let ok = self.b.create_block();
        let error = self.b.create_block();
        self.b.ins().brif(failed, error, &[], ok, &[]);
        self.b.switch_to_block(error);
        self.executed_error(remaining);
        self.b.switch_to_block(ok);
        let yielded = self.b.ins().icmp_imm(IntCC::Equal, next, -3);
        let ok = self.b.create_block();
        let exit = self.b.create_block();
        self.b.ins().brif(yielded, exit, &[], ok, &[]);
        self.b.switch_to_block(exit);
        // The boundary ran, but nothing after it may run in this scheduler pass.
        self.executed_error(remaining);
        self.b.switch_to_block(ok);
        next
    }

    fn executed_error(&mut self, remaining: i64) {
        let fuel = self
            .b
            .ins()
            .load(types::I64, MemFlags::trusted(), self.ctx, OFF_FUEL);
        let fuel = self.b.ins().iadd_imm(fuel, remaining - 1);
        self.b
            .ins()
            .store(MemFlags::trusted(), fuel, self.ctx, OFF_FUEL);
        let next = self
            .call(
                h_pc as *const () as usize,
                &[types::I64],
                Some(types::I64),
                &[self.ctx],
            )
            .unwrap();
        self.b.ins().return_(&[next]);
    }

    fn change(&mut self, base: Value, slot: usize, e: Expr, sign: f64) {
        // Matches `slot += eval * sign`: Rust evaluates the f64 operand first.
        let v = self.expr(e.end as usize - 1);
        let sign = self.b.ins().f64const(sign);
        let delta = self.b.ins().fmul(v, sign);
        let old = self.load(base, slot);
        let sum = self.b.ins().fadd(old, delta);
        self.store(base, slot, sum);
    }

    fn kitten4_change(
        &mut self,
        pc: usize,
        target: Target,
        value: usize,
        decrease: bool,
        blocks: &BTreeMap<usize, Block>,
        remaining: i64,
    ) {
        let slow = self.b.create_block();
        let (local, slot) = match target {
            Target::Global(s) => (false, s),
            Target::Local(s) => (true, s),
        };
        let mut guards = vec![Guard::Slot(local, slot)];
        if let Some(value) = self.numeric(value, &mut guards) {
            self.check_unboxed(&guards, slow);
            // K4 evaluates the increment before reading the previous value.
            let delta = self.numeric_value(value);
            let base = if local { self.locals } else { self.slots };
            let old = self.load(base, slot);
            let number = if decrease {
                self.b.ins().fsub(old, delta)
            } else {
                self.b.ins().fadd(old, delta)
            };
            self.store(base, slot, number);
            self.check_error(pc, remaining);
            self.b.ins().jump(blocks[&(pc + 1)], &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        // The original typed operation owns concatenation, coercion, and no-op
        // writes to List/Costume/Null. Never replace it with numeric coercion.
        self.transfer(pc, remaining);
        self.b.ins().jump(blocks[&(pc + 1)], &[]);
    }

    fn append_list(
        &mut self,
        pc: usize,
        list: ListRef,
        value: usize,
        blocks: &BTreeMap<usize, Block>,
        remaining: i64,
    ) {
        let slow = self.b.create_block();
        let mut guards = Vec::new();
        if let Some(value) = self.numeric(value, &mut guards) {
            self.check_unboxed(&guards, slow);
            let number = self.numeric_value(value);
            let list = self.b.ins().iconst(types::I64, list_key(list) as i64);
            self.call(
                h_append_number as *const () as usize,
                &[types::I64, types::I64, types::F64],
                None,
                &[self.ctx, list, number],
            );
            self.check_error(pc, remaining);
            self.b.ins().jump(blocks[&(pc + 1)], &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        self.transfer_with(h_append_cell as *const () as usize, pc, remaining);
        self.b.ins().jump(blocks[&(pc + 1)], &[]);
    }

    /// Replaces a number in a KN global list; other replacement rules use exec.
    fn list_write(
        &mut self,
        pc: usize,
        list: u32,
        at: Expr,
        v: usize,
        blocks: &BTreeMap<usize, Block>,
        remaining: i64,
    ) {
        let next = blocks[&(pc + 1)];
        // K4 splice/index/error rules differ from KN's rounded append path.
        if self.engine.program.semantics == RuntimeSemantics::Kitten4 {
            self.transfer(pc, remaining);
            self.b.ins().jump(next, &[]);
            return;
        }
        if let ValueExpr::Item(ListRef::Global(source), Some(from)) = self.engine.program.values[v]
        {
            let at = self.expr(at.end as usize - 1);
            let from = self.expr(from.end as usize - 1);
            let target = self.b.ins().iconst(types::I64, list as i64);
            let source = self.b.ins().iconst(types::I64, source as i64);
            let site = self.b.ins().iconst(types::I64, pc as i64);
            let ctx = self.ctx;
            let done = self
                .call(
                    h_replace_item as *const () as usize,
                    &[
                        types::I64,
                        types::I64,
                        types::F64,
                        types::I64,
                        types::F64,
                        types::I64,
                    ],
                    Some(types::I64),
                    &[ctx, target, at, source, from, site],
                )
                .unwrap();
            let exit = self.b.create_block();
            let success = self.b.ins().icmp_imm(IntCC::Equal, done, 1);
            let checked = self.b.create_block();
            self.b.ins().brif(success, checked, &[], exit, &[]);
            self.b.switch_to_block(exit);
            self.executed_error(remaining);
            self.b.switch_to_block(checked);
            self.check_error(pc, remaining);
            self.b.ins().jump(next, &[]);
            return;
        }
        let slow = self.b.create_block();
        let mut guards = Vec::new();
        if let Some(value) = self.numeric(v, &mut guards) {
            self.check_unboxed(&guards, slow);
            let at = self.expr(at.end as usize - 1);
            let number = self.numeric_value(value);
            let list = self.b.ins().iconst(types::I64, list as i64);
            let ctx = self.ctx;
            self.call(
                h_replace_number as *const () as usize,
                &[types::I64, types::I64, types::F64, types::F64],
                None,
                &[ctx, list, at, number],
            );
            self.check_error(pc, remaining);
            self.b.ins().jump(next, &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        self.transfer(pc, remaining);
        self.b.ins().jump(next, &[]);
    }

    fn set_value(
        &mut self,
        pc: usize,
        target: Target,
        v: usize,
        blocks: &BTreeMap<usize, Block>,
        remaining: i64,
    ) {
        let next = blocks[&(pc + 1)];
        if let ValueExpr::Item(list, Some(e)) = self.engine.program.values[v] {
            let at = self.expr(e.end as usize - 1);
            let encoded = match target {
                Target::Global(s) => (s as i64) << 1,
                Target::Local(s) => ((s as i64) << 1) | 1,
            };
            let encoded = self.b.ins().iconst(types::I64, encoded);
            let list = self.b.ins().iconst(types::I64, list_key(list) as i64);
            let ctx = self.ctx;
            self.call(
                h_assign_item as *const () as usize,
                &[types::I64, types::I64, types::I64, types::F64],
                None,
                &[ctx, encoded, list, at],
            );
            self.check_error(pc, remaining);
            self.b.ins().jump(next, &[]);
            return;
        }
        let slow = self.b.create_block();
        let mut guards = Vec::new();
        if let Some(value) = self.numeric(v, &mut guards) {
            self.check_unboxed(&guards, slow);
            let number = self.numeric_value(value);
            self.assign_number(target, number);
            self.check_error(pc, remaining);
            self.b.ins().jump(next, &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        self.transfer(pc, remaining);
        self.b.ins().jump(next, &[]);
    }

    fn op(&mut self, pc: usize, op: Op, blocks: &BTreeMap<usize, Block>, remaining: i64) {
        if self.engine.jit_reentrant(op) {
            let helper = match op {
                Op::Call(..) => h_call as *const () as usize,
                Op::AppendList(..) => h_append_cell as *const () as usize,
                Op::ReturnValue(..) => h_return as *const () as usize,
                _ => h_reentrant as *const () as usize,
            };
            let next = self.transfer_with(helper, pc, remaining);
            // No cached slots/locals/boxed pointers may be used after this call.
            // Only context fuel is live across a reporter that can spawn tasks,
            // box variables, stop scripts, or change scenes.
            let fuel = self
                .b
                .ins()
                .load(types::I64, MemFlags::trusted(), self.ctx, OFF_FUEL);
            let refunded = self.b.ins().iadd_imm(fuel, remaining - 1);
            self.b
                .ins()
                .store(MemFlags::trusted(), refunded, self.ctx, OFF_FUEL);
            self.b.ins().return_(&[next]);
            return;
        }
        let ctx = self.ctx;
        let block = |at: usize| blocks[&at];
        match op {
            Op::Set(s, e) => {
                let v = self.expr(e.end as usize - 1);
                self.store(self.slots, s, v);
                self.clear_global(s);
                self.check_error(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::SetLocal(s, e) => {
                let v = self.expr(e.end as usize - 1);
                self.store(self.locals, s, v);
                self.clear_local(s);
                self.check_error(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::Change(s, e, sign) => {
                self.change(self.slots, s, e, sign);
                self.clear_global(s);
                self.check_error(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::ChangeLocal(s, e, sign) => {
                self.change(self.locals, s, e, sign);
                self.clear_local(s);
                self.check_error(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::Branch(e, target) => {
                let v = self.expr(e.end as usize - 1);
                let t = self.truth(v);
                let yes = self.b.ins().iconst(types::I64, pc as i64 + 1);
                let no = self.b.ins().iconst(types::I64, target as i64);
                let next = self.b.ins().select(t, yes, no);
                self.check_error_next(pc, remaining, next);
                self.b.ins().brif(t, block(pc + 1), &[], block(target), &[]);
            }
            Op::Jump(target) => {
                self.b.ins().jump(block(target), &[]);
            }
            Op::Repeat(e, end) => {
                let v = self.expr(e.end as usize - 1);
                let entered = self
                    .call(
                        h_repeat as *const () as usize,
                        &[types::I64, types::F64],
                        Some(types::I64),
                        &[ctx, v],
                    )
                    .unwrap();
                let yes = self.b.ins().iconst(types::I64, pc as i64 + 1);
                let no = self.b.ins().iconst(types::I64, end as i64);
                let next = self.b.ins().select(entered, yes, no);
                self.check_error_next(pc, remaining, next);
                self.b
                    .ins()
                    .brif(entered, block(pc + 1), &[], block(end), &[]);
            }
            Op::Next(target, _) | Op::RangeNext(target, _) => {
                let next = self.transfer_with(h_boundary as *const () as usize, pc, remaining);
                let again = self.b.ins().icmp_imm(IntCC::Equal, next, target as i64);
                self.b
                    .ins()
                    .brif(again, block(target), &[], block(pc + 1), &[]);
            }
            Op::WarpIteration => {
                self.transfer_with(h_boundary as *const () as usize, pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::SetValue(target, v) => self.set_value(pc, target, v, blocks, remaining),
            Op::Kitten4Change(target, v, decrease) => {
                self.kitten4_change(pc, target, v, decrease, blocks, remaining)
            }
            Op::SetActorVariable(slot, v) => {
                let slow = self.b.create_block();
                let mut guards = Vec::new();
                if let Some(value) = self.numeric(v, &mut guards) {
                    self.check_unboxed(&guards, slow);
                    let number = self.numeric_value(value);
                    let slot = self.b.ins().iconst(types::I64, slot as i64);
                    self.call(
                        h_set_actor_number as *const () as usize,
                        &[types::I64, types::I64, types::F64],
                        None,
                        &[ctx, slot, number],
                    );
                    self.check_error(pc, remaining);
                    self.b.ins().jump(block(pc + 1), &[]);
                } else {
                    self.b.ins().jump(slow, &[]);
                }
                self.b.switch_to_block(slow);
                self.transfer(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::ChangeActorVariable(slot, e, sign) => {
                let previous = self.numeric_value(Numeric::Actor(usize::MAX, slot));
                let delta = self.expr(e.end as usize - 1);
                let sign = self.b.ins().f64const(sign);
                let delta = self.b.ins().fmul(delta, sign);
                let number = self.b.ins().fadd(previous, delta);
                let slot = self.b.ins().iconst(types::I64, slot as i64);
                self.call(
                    h_set_actor_number as *const () as usize,
                    &[types::I64, types::I64, types::F64],
                    None,
                    &[ctx, slot, number],
                );
                self.check_error(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::ReplaceList(ListRef::Global(list), Some(at), v) => {
                self.list_write(pc, list, at, v, blocks, remaining)
            }
            Op::AppendList(list, v) => self.append_list(pc, list, v, blocks, remaining),
            Op::Range(_, end) => {
                let next = self.transfer(pc, remaining);
                let skipped = self.b.ins().icmp_imm(IntCC::Equal, next, end as i64);
                self.b
                    .ins()
                    .brif(skipped, block(end), &[], block(pc + 1), &[]);
            }
            Op::Call(procedure, _) => {
                self.transfer_with(h_call as *const () as usize, pc, remaining);
                let target = self.engine.program.procedure_entries[procedure];
                self.b.ins().jump(block(target), &[]);
            }
            Op::Return | Op::ReturnValue(_) => {
                let next = self.transfer_with(h_return as *const () as usize, pc, remaining);
                // Direct jumps for call sites in this region; others re-enter.
                for &site in self.returns {
                    let hit = self.b.ins().icmp_imm(IntCC::Equal, next, site as i64);
                    let miss = self.b.create_block();
                    self.b.ins().brif(hit, block(site), &[], miss, &[]);
                    self.b.switch_to_block(miss);
                }
                self.b.ins().return_(&[next]);
            }
            Op::Break(target, pop) => {
                let pop = self.b.ins().iconst(types::I64, pop as i64);
                self.call(
                    h_break as *const () as usize,
                    &[types::I64, types::I64],
                    None,
                    &[ctx, pop],
                );
                self.b.ins().jump(block(target), &[]);
            }
            _ => {
                self.transfer(pc, remaining);
                self.b.ins().jump(block(pc + 1), &[]);
            }
        }
    }
}

fn is_straight(op: Op) -> bool {
    !matches!(
        op,
        Op::Branch(..)
            | Op::Jump(_)
            | Op::Repeat(..)
            | Op::Range(..)
            | Op::Next(..)
            | Op::RangeNext(..)
            | Op::Break(..)
            | Op::Call(..)
            | Op::Return
            | Op::ReturnValue(_)
    )
}

struct BuiltRegion {
    context: cranelift_codegen::Context,
    entries: Vec<usize>,
    written_slots: Vec<usize>,
    written_locals: Vec<usize>,
}

// Keep IR generation independent of executable memory so other backends can be
// checked on the CI host without ever executing foreign machine code.
fn build_region(engine: &Engine, entry: usize, conv: CallConv) -> Option<BuiltRegion> {
    let ops = &engine.program.ops;
    if !engine.jit_supported(ops[entry]) {
        return None;
    }
    // Discover the region; a leader starts a fuel-accounted chunk.
    let mut region = BTreeSet::new();
    let mut exits = BTreeSet::new();
    let mut leaders = BTreeSet::from([entry]);
    let mut pending = vec![entry];
    let (mut written_slots, mut written_locals) = (BTreeSet::new(), BTreeSet::new());
    let (mut boxed_slots, mut boxed_locals) = (BTreeSet::new(), BTreeSet::new());
    let mut returns = BTreeSet::new();
    while let Some(pc) = pending.pop() {
        if region.contains(&pc) || exits.contains(&pc) {
            continue;
        }
        if pc >= ops.len() || !engine.jit_supported(ops[pc]) || region.len() >= MAX_REGION_OPS {
            exits.insert(pc);
            continue;
        }
        region.insert(pc);
        if engine.jit_reentrant(ops[pc]) {
            // Tail evaluation can invalidate every pointer. Do not explore its
            // successors or treat its typed writes as boxing exemptions for an
            // earlier numeric write's entry guard.
            continue;
        }
        match ops[pc] {
            Op::Set(s, _) | Op::Change(s, _, _) => {
                written_slots.insert(s);
            }
            Op::SetLocal(s, _) | Op::ChangeLocal(s, _, _) => {
                written_locals.insert(s);
            }
            Op::SetValue(Target::Global(s), _) | Op::Kitten4Change(Target::Global(s), _, _) => {
                boxed_slots.insert(s);
            }
            Op::SetValue(Target::Local(s), _) | Op::Kitten4Change(Target::Local(s), _, _) => {
                boxed_locals.insert(s);
            }
            _ => {}
        }
        match ops[pc] {
            Op::Branch(_, t)
            | Op::Repeat(_, t)
            | Op::Range(_, t)
            | Op::Next(t, _)
            | Op::RangeNext(t, _) => {
                leaders.extend([t, pc + 1]);
                pending.extend([t, pc + 1]);
            }
            Op::Jump(t) | Op::Break(t, _) => {
                leaders.insert(t);
                pending.push(t);
            }
            Op::Call(procedure, _) => {
                let t = engine.program.procedure_entries[procedure];
                leaders.extend([t, pc + 1]);
                pending.extend([t, pc + 1]);
                returns.insert(pc + 1);
            }
            Op::Return | Op::ReturnValue(_) => {}
            _ => pending.push(pc + 1),
        }
    }

    let returns: Vec<usize> = returns.into_iter().take(16).collect();
    let none = i64::from(none_tag()?);
    let mut signature = Signature::new(conv);
    signature.params.push(AbiParam::new(types::I64));
    signature.params.push(AbiParam::new(types::I64));
    signature.returns.push(AbiParam::new(types::I64));
    let mut context = cranelift_codegen::Context::new();
    context.func.signature = signature;
    let mut scope = FunctionBuilderContext::new();
    let entries;
    {
        let mut b = FunctionBuilder::new(&mut context.func, &mut scope);
        let start = b.create_block();
        b.append_block_params_for_function_params(start);
        b.switch_to_block(start);
        let ctx = b.block_params(start)[0];
        let entry_pc = b.block_params(start)[1];
        let slots = b
            .ins()
            .load(types::I64, MemFlags::trusted(), ctx, OFF_SLOTS);
        let locals = b
            .ins()
            .load(types::I64, MemFlags::trusted(), ctx, OFF_LOCALS);
        let values = b
            .ins()
            .load(types::I64, MemFlags::trusted(), ctx, OFF_VALUES);
        let local_values = b
            .ins()
            .load(types::I64, MemFlags::trusted(), ctx, OFF_LOCAL_VALUES);
        let blocks: BTreeMap<usize, Block> = region
            .iter()
            .chain(exits.iter())
            .map(|&pc| (pc, b.create_block()))
            .collect();
        entries = entries::dispatch(&mut b, entry_pc, &leaders, &region, &blocks);
        for &pc in &exits {
            b.switch_to_block(blocks[&pc]);
            let value = b.ins().iconst(types::I64, pc as i64);
            b.ins().return_(&[value]);
        }
        let mut g = Gen {
            b: &mut b,
            engine,
            ctx,
            conv,
            slots,
            locals,
            boxed_slots: &boxed_slots,
            boxed_locals: &boxed_locals,
            values,
            local_values,
            none,
            returns: &returns,
        };
        for &pc in &region {
            g.b.switch_to_block(blocks[&pc]);
            // This op plus the rest of its chunk: charged at a leader, refunded on exit.
            let mut last = pc;
            while !engine.jit_reentrant(ops[last])
                && is_straight(ops[last])
                && region.contains(&(last + 1))
                && !leaders.contains(&(last + 1))
            {
                last += 1;
            }
            let remaining = (last - pc + 1) as i64;
            if leaders.contains(&pc) {
                let fuel =
                    g.b.ins()
                        .load(types::I64, MemFlags::trusted(), ctx, OFF_FUEL);
                let after = g.b.ins().iadd_imm(fuel, -remaining);
                let ok =
                    g.b.ins()
                        .icmp_imm(IntCC::SignedGreaterThanOrEqual, after, 0);
                let run = g.b.create_block();
                let stop = g.b.create_block();
                g.b.ins().brif(ok, run, &[], stop, &[]);
                g.b.switch_to_block(stop);
                let value = g.b.ins().iconst(types::I64, pc as i64);
                g.b.ins().return_(&[value]);
                g.b.switch_to_block(run);
                g.b.ins().store(MemFlags::trusted(), after, ctx, OFF_FUEL);
            }
            g.op(pc, ops[pc], &blocks, remaining);
        }
        b.seal_all_blocks();
        b.finalize();
    }
    Some(BuiltRegion {
        context,
        entries,
        written_slots: written_slots.difference(&boxed_slots).copied().collect(),
        written_locals: written_locals.difference(&boxed_locals).copied().collect(),
    })
}

fn compile(jit: &mut Jit, engine: &Engine, entry: usize) -> Option<(Region, Vec<usize>)> {
    let BuiltRegion {
        mut context,
        entries,
        written_slots,
        written_locals,
    } = build_region(engine, entry, jit.module.isa().default_call_conv())?;
    let name = format!("region{}", jit.next_name);
    jit.next_name += 1;
    let module = &mut jit.module;
    let id = module
        .declare_function(&name, Linkage::Local, &context.func.signature)
        .ok()?;
    // A backend panic must only cost this region its native code, not the VM.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        module.define_function(id, &mut context).map_err(|_| ())
    }))
    .ok()?
    .ok()?;
    module.clear_context(&mut context);
    module.finalize_definitions().ok()?;
    let code = module.get_finalized_function(id);
    // SAFETY: `code` was just generated with exactly this signature.
    let code: Entry = unsafe { std::mem::transmute::<*const u8, Entry>(code) };
    Some((
        Region {
            code,
            written_slots: written_slots.into(),
            written_locals: written_locals.into(),
        },
        entries,
    ))
}

#[cfg(test)]
#[path = "jit/native_tests.rs"]
mod native_tests;

#[cfg(test)]
mod tests {
    #[test]
    fn list_expression_reporter_calls_cannot_reenter_native_code() {
        let project = crate::studio::document::Document::blank().value().clone();
        let mut engine = super::Engine::new(super::super::Program::compile(&project).unwrap());
        engine.program.values = vec![super::ValueExpr::CallReturn(0, 0)];
        let list = super::ListRef::Expression(0);
        assert!(!engine.jit_delegable(super::Op::ClearList(list)));
        engine.program.constants = vec![super::Cell::Number(3.0)];
        engine.program.values.push(super::ValueExpr::Constant(0));
        assert!(!engine.jit_delegable(super::Op::AppendList(list, 1)));
    }

    #[test]
    fn executed_native_errors_keep_pc_and_charge_the_failed_instruction() {
        use super::super::{Expr, ExprOp, Program, Script, ScriptEvent};
        use super::*;
        for delegated in [false, true] {
            let project = crate::studio::document::Document::blank().value().clone();
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            engine.program.actor_variable_names = vec!["missing".into()];
            engine.program.initial = vec![0.0];
            engine.program.initial_values = vec![None];
            engine.program.variable_names = vec!["after".into()];
            engine.slots = vec![0.0];
            engine.values = vec![None];
            engine.program.constants = vec![Cell::Text("typed".into())];
            engine.program.values = vec![ValueExpr::Constant(0)];
            engine.program.expressions = vec![ExprOp::Constant(1.0)];
            engine.program.expression_starts = vec![0];
            engine.program.ops = vec![
                if delegated {
                    Op::SetActorVariable(0, 0)
                } else {
                    Op::ChangeActorVariable(0, Expr { end: 1 }, 1.0)
                },
                Op::Set(0, Expr { end: 1 }),
                Op::Halt,
            ];
            engine.program.sources = vec!["failed".into(), "after".into(), "halt".into()];
            engine.jit = Jit::new(engine.program.ops.len());
            engine.program.scripts = vec![Script {
                hat: "error".into(),
                actor: 1,
                event: ScriptEvent::Start,
                start: 0,
            }];
            engine.enable_jit_profile();
            engine.start();
            engine.jit_compile(0);
            assert!(engine.jit.as_ref().unwrap().regions[0].is_some());
            let used = engine.jit_run(0, 0, 1, 100).unwrap();
            assert_eq!(used, 1, "delegated={delegated}");
            assert_eq!(engine.tasks[0].pc, 1);
            assert_eq!(engine.slots[0], 0.0);
            assert_eq!(
                engine.jit_error.take().unwrap().to_string(),
                "entity_variable_operation_out_of_scope: missing at block failed"
            );
            assert_eq!(engine.jit_profile()["native_ops"], 1);
        }
    }

    #[test]
    fn failing_native_conditions_keep_the_interpreters_control_transfer() {
        use super::super::{Expr, ExprOp, Program, Script, ScriptEvent};
        use super::*;
        for repeat in [false, true] {
            let project = crate::studio::document::Document::blank().value().clone();
            let mut engine = Engine::new(Program::compile(&project).unwrap());
            engine.program.actor_variable_names = vec!["missing".into()];
            engine.program.values = vec![ValueExpr::ActorVariable(usize::MAX, 0, None)];
            engine.program.expressions = vec![ExprOp::Value(0)];
            engine.program.expression_starts = vec![0];
            engine.program.ops = vec![
                if repeat {
                    Op::Repeat(Expr { end: 1 }, 2)
                } else {
                    Op::Branch(Expr { end: 1 }, 2)
                },
                Op::Halt,
                Op::Halt,
            ];
            engine.program.sources = vec!["condition".into(); 3];
            engine.program.scripts = vec![Script {
                hat: "error".into(),
                actor: 1,
                event: ScriptEvent::Start,
                start: 0,
            }];
            engine.jit = Jit::new(3);
            engine.start();
            engine.jit_compile(0);
            assert_eq!(engine.jit_run(0, 0, 1, 10), Some(1));
            assert_eq!(engine.tasks[0].pc, 2);
            assert!(
                engine
                    .jit_error
                    .take()
                    .unwrap()
                    .to_string()
                    .ends_with("at block condition")
            );
        }
    }

    #[test]
    fn ten_thousand_numeric_and_truth_nodes_compile_native_regions() {
        use super::super::{ExprOp, Program, Unary};
        use serde_json::json;
        let mut project =
            crate::json::from_str(include_str!("../../samples/native-studio.bcmkn")).unwrap();
        for section in ["scenes", "actors", "procedures"] {
            let dict = format!("{section}Dict");
            for owner in project[section][&dict]
                .as_object_mut()
                .into_iter()
                .flat_map(|o| o.values_mut())
            {
                crate::json::discard(owner["nekoBlockJsonList"].take());
                owner["nekoBlockJsonList"] = json!([]);
            }
        }
        let mut program = Program::compile(&project).unwrap();
        program.expressions = vec![ExprOp::Constant(7.0)];
        program
            .expressions
            .extend(std::iter::repeat_n(ExprOp::Unary(Unary::Neg), 10000));
        program.expression_starts = super::super::expression_starts(&program.expressions).unwrap();
        program.initial = vec![0.0];
        program.initial_values = vec![None];
        program.ops = vec![
            super::Op::Set(0, super::Expr { end: 10001 }),
            super::Op::Halt,
        ];
        program.sources = vec!["deep".into(); 2];
        let mut engine = super::Engine::new(program);
        assert_eq!(engine.node(10000, 0), 7.0);
        if engine.jit.is_none() {
            return;
        }
        engine.jit_compile(0);
        assert!(engine.jit.as_ref().unwrap().regions[0].is_some());
        engine.program.scripts.push(super::super::Script {
            hat: "deep-native".into(),
            actor: 0,
            event: super::super::ScriptEvent::Start,
            start: 0,
        });
        engine.start();
        engine
            .advance(1.0 / 60.0, 100_000, std::time::Duration::from_secs(60))
            .unwrap();
        assert_eq!(engine.slots[0], 7.0);
        engine.program.values = vec![super::ValueExpr::Constant(0)];
        engine.program.constants = vec![super::Cell::Number(1.0)];
        for i in 0..10000 {
            engine.program.values.push(super::ValueExpr::Not(i));
        }
        // Match the compiler's marking of deep mixed-value trees: the cold
        // instruction before native dispatch must also use the heap evaluator.
        engine.program.deep_values.insert(10000);
        engine.program.expressions = vec![ExprOp::Truth(10000)];
        engine.program.expression_starts = vec![0];
        engine.program.ops[0] = super::Op::Set(0, super::Expr { end: 1 });
        engine.jit_compile(0);
        assert!(engine.jit.as_ref().unwrap().regions[0].is_some());
        engine.start();
        engine
            .advance(1.0 / 60.0, 100_000, std::time::Duration::from_secs(60))
            .unwrap();
        assert_eq!(engine.slots[0], 1.0);
    }
    use super::*;

    #[test]
    fn deep_kitten4_add_uses_heap_evaluation_and_checks_descendant_purity() {
        let source = crate::json::from_str(include_str!(
            "../../tests/fixtures/kitten4/runerr-addition.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        let mut engine = Engine::new(super::super::Program::compile(&project).unwrap());
        engine.program.constants = vec![super::Cell::Number(1.0)];
        engine.program.values = vec![ValueExpr::Constant(0)];
        for i in 0..10000 {
            engine.program.values.push(ValueExpr::Kitten4Add(i, 0));
        }
        engine.program.deep_values.insert(10000);
        engine.program.expressions = vec![ExprOp::Value(10000)];
        engine.program.expression_starts = vec![0];
        engine.program.ops = vec![Op::Set(0, Expr { end: 1 }), Op::Halt];
        engine.program.sources = vec!["deep-add".into(); 2];
        assert!(engine.jit_pure_value(10000));
        assert_eq!(engine.node(0, 0), 10001.0);
        if engine.jit.is_some() {
            engine.jit_compile(0);
            assert!(engine.jit.as_ref().unwrap().regions[0].is_some());
            engine.program.scripts.truncate(1);
            engine.program.scripts[0].start = 0;
            engine.start();
            engine
                .advance(1.0 / 60.0, 100_000, std::time::Duration::from_secs(60))
                .unwrap();
            assert_eq!(engine.slots[0], 10001.0);
        }
        // An impure leaf below ten thousand ADDs must not be hidden by the new
        // variant. Do not execute this deliberately synthetic reporter call.
        engine.program.values[0] = ValueExpr::CallReturn(0, 0);
        assert!(!engine.jit_pure_value(10000));
    }

    #[test]
    fn iterative_random_keeps_platform_endpoint_policy_and_draw_count() {
        let source = crate::json::from_str(include_str!(
            "../../tests/fixtures/kitten4/runerr-random.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        for semantics in [RuntimeSemantics::Kitten4, RuntimeSemantics::KnCurrent] {
            let mut engine = Engine::new(super::super::Program::compile(&project).unwrap());
            engine.program.semantics = semantics;
            engine.program.expressions = vec![
                ExprOp::Constant(0.25),
                ExprOp::Constant(10.75),
                ExprOp::Random,
            ];
            engine.program.expressions.extend(std::iter::repeat_n(
                ExprOp::Unary(super::super::Unary::Neg),
                10000,
            ));
            engine.program.expression_starts =
                super::super::expression_starts(&engine.program.expressions).unwrap();
            engine.set_random_seed(42);
            let shallow = engine.node(2, 0);
            let state = engine.random_state;
            engine.set_random_seed(42);
            assert_eq!(engine.node(10002, 0), shallow);
            assert_eq!(engine.random_state, state);
        }
    }

    #[test]
    fn k4_warp_body_is_native_but_suspends_at_the_official_boundary() {
        let source = crate::json::from_str(include_str!(
            "../../tests/fixtures/kitten4/runerr-warp-10002.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        let mut engine = Engine::new(super::super::Program::compile(&project).unwrap());
        engine.start();
        engine
            .advance(1.0 / 60.0, 2_000_000, std::time::Duration::from_secs(5))
            .unwrap();
        assert!(
            engine
                .jit
                .as_ref()
                .unwrap()
                .regions
                .iter()
                .any(Option::is_some)
        );
        assert_eq!(engine.oracle_snapshot(1)["variables"]["log"], 10002.0);
        engine
            .advance(1.0 / 60.0, 2_000_000, std::time::Duration::from_secs(5))
            .unwrap();
        assert_eq!(engine.oracle_snapshot(2)["variables"]["log"], -1.0);
    }

    #[test]
    fn private_variable_programs_retain_native_global_slots() {
        let mut project = crate::studio::document::Document::blank().value().clone();
        let actor = project["actors"]["actorsDict"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone();
        project["variables"]["variablesDict"]["score"] =
            serde_json::json!({"id":"score", "value":0, "isGlobal":true});
        project["actors"]["actorsDict"][&actor]["nekoBlockJsonList"] = serde_json::json!([
            {"type":"on_running_group_activated", "next":{
                "type":"variables_set", "fields":{"variable":"score"},
                "inputs":{"value":{"type":"math_number", "fields":{"NUM":3}}}
            }}
        ]);
        let global = Engine::new(super::super::Program::compile(&project).unwrap());
        assert!(
            global.jit.is_some(),
            "global programs must retain native slots"
        );
        project["variables"]["variablesDict"]["private"] = serde_json::json!({
            "id":"private", "value":[[7]], "isGlobal":false, "currentEntityId":actor
        });
        let private = Engine::new(super::super::Program::compile(&project).unwrap());
        assert!(private.jit.is_some());
        assert_eq!(private.program.variable_names, ["score"]);
        assert_eq!(private.slots.len(), 1);
        assert_eq!(private.program.actor_variable_names, ["private"]);
    }

    #[test]
    fn aarch64_compiles_project_regions() {
        assert_aarch64_regions(&[
            "samples/pen_polyhedron.bcmkn",
            "samples/native-studio.bcmkn",
            "tests/fixtures/list_writes.bcmkn",
        ]);
    }

    #[test]
    #[ignore = "exhaustive backend check; run before releases with --ignored --exact"]
    fn aarch64_compiles_all_project_regions() {
        assert_aarch64_regions(&[
            "samples/pen_polyhedron.bcmkn",
            "projects/pencraft/pencraft.bcmkn",
            "samples/native-studio.bcmkn",
            "samples/pen_display_fast.bcmkn",
            "samples/pen_display_columns.bcmkn",
            "projects/starhold/starhold.bcmkn",
            "projects/tiny-lm/tiny_lm.bcmkn",
            "tests/fixtures/list_writes.bcmkn",
        ]);
    }

    fn assert_aarch64_regions(paths: &[&str]) {
        let mut flags = settings::builder();
        flags.set("opt_level", "speed").unwrap();
        let isa = cranelift_codegen::isa::lookup("aarch64-linux-android".parse().unwrap())
            .unwrap()
            .finish(settings::Flags::new(flags))
            .unwrap();
        for path in paths {
            let project = crate::project::load_project(path).unwrap();
            let engine = Engine::new(super::super::Program::compile(&project.value).unwrap());
            let mut compiled = 0;
            for pc in 0..engine.program.ops.len() {
                let Some(mut region) = build_region(&engine, pc, isa.default_call_conv()) else {
                    continue;
                };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    region
                        .context
                        .compile(isa.as_ref(), &mut Default::default())
                        .map(|code| code.code_buffer().len())
                        .map_err(|error| format!("{error:?}"))
                }));
                match result {
                    Ok(Ok(bytes)) => assert!(bytes > 0),
                    other => panic!("{path}: aarch64 compilation failed at pc={pc}: {other:?}"),
                }
                compiled += 1;
            }
            assert!(compiled > 0, "no native regions checked in {path}");
            eprintln!("{path}: {compiled} aarch64 regions compiled");
        }
    }

    fn predicate(engine: &Engine, conv: CallConv, kind: usize) -> cranelift_codegen::Context {
        let mut context = cranelift_codegen::Context::new();
        context.func.signature = Signature::new(conv);
        context.func.signature.params = vec![AbiParam::new(types::F64); 2];
        context
            .func
            .signature
            .returns
            .push(AbiParam::new(types::F64));
        let mut scope = FunctionBuilderContext::new();
        let mut b = FunctionBuilder::new(&mut context.func, &mut scope);
        let start = b.create_block();
        b.append_block_params_for_function_params(start);
        b.switch_to_block(start);
        let a = b.block_params(start)[0];
        let c = b.block_params(start)[1];
        let empty = BTreeSet::new();
        let mut g = Gen {
            b: &mut b,
            engine,
            ctx: a,
            conv,
            slots: a,
            locals: a,
            boxed_slots: &empty,
            boxed_locals: &empty,
            values: a,
            local_values: a,
            none: 0,
            returns: &[],
        };
        let result = match kind {
            0 => {
                let flag = g.truth(a);
                g.number(flag)
            }
            1 => {
                let flag = g.truth(a);
                let flag = g.b.ins().bxor_imm(flag, 1);
                g.number(flag)
            }
            2 => g.binary(Binary::And, a, c),
            3 => g.binary(Binary::Or, a, c),
            // Exercise the originally suspected comparison unions and their
            // complements too, with the ordinary bor/band emission restored.
            4 | 5 => {
                let lt = g.b.ins().fcmp(FloatCC::LessThan, a, c);
                let gt = g.b.ins().fcmp(FloatCC::GreaterThan, a, c);
                let flag = g.b.ins().bor(lt, gt);
                let flag = if kind == 5 {
                    g.b.ins().bxor_imm(flag, 1)
                } else {
                    flag
                };
                g.number(flag)
            }
            _ => unreachable!(),
        };
        g.b.ins().return_(&[result]);
        b.seal_all_blocks();
        b.finalize();
        context
    }

    #[test]
    fn fractional_kitten4_repeat_really_compiles_a_native_region() {
        let source = crate::json::from_str(include_str!(
            "../../tests/fixtures/kitten4/scheduling-fractional.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        let mut engine = Engine::new(super::super::Program::compile(&project).unwrap());
        for _ in 0..650 {
            engine.start();
            for _ in 0..4 {
                engine
                    .advance(1.0 / 60.0, 10000, std::time::Duration::from_secs(5))
                    .unwrap();
            }
            assert_eq!(engine.oracle_snapshot(4)["variables"]["log"], "AAC");
        }
        assert!(
            engine
                .jit
                .as_ref()
                .expect("native JIT required for this test")
                .regions
                .iter()
                .any(Option::is_some)
        );
    }

    #[test]
    fn truth_and_comparison_predicates_preserve_ieee_semantics() {
        let project = crate::studio::document::Document::blank();
        let engine = Engine::new(super::super::Program::compile(project.value()).unwrap());
        let mut flags = settings::builder();
        flags.set("opt_level", "speed").unwrap();
        let flags = settings::Flags::new(flags);
        let arm = cranelift_codegen::isa::lookup("aarch64-linux-android".parse().unwrap())
            .unwrap()
            .finish(flags.clone())
            .unwrap();
        let host = cranelift_native::builder().unwrap().finish(flags).unwrap();
        let mut module = JITModule::new(JITBuilder::with_isa(host, default_libcall_names()));
        let cases = [
            0.0,
            -0.0,
            1.0,
            -1.0,
            f64::MIN,
            f64::MAX,
            f64::from_bits(1),
            -f64::from_bits(1),
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
            f64::from_bits(0x7ff0_0000_0000_0001),
            f64::from_bits(0xfff8_0000_0000_0001),
        ];
        for kind in 0..6 {
            let mut cross = predicate(&engine, arm.default_call_conv(), kind);
            cross
                .compile(arm.as_ref(), &mut Default::default())
                .unwrap();
            let mut native = predicate(&engine, module.isa().default_call_conv(), kind);
            let id = module
                .declare_function(
                    &format!("predicate{kind}"),
                    Linkage::Local,
                    &native.func.signature,
                )
                .unwrap();
            module.define_function(id, &mut native).unwrap();
            module.finalize_definitions().unwrap();
            // SAFETY: compiled on the host with the signature above. The module
            // owns the executable memory until all calls have completed.
            let code: unsafe extern "C" fn(f64, f64) -> f64 =
                unsafe { std::mem::transmute(module.get_finalized_function(id)) };
            for a in cases {
                for c in cases {
                    let ordered_unequal = matches!(
                        a.partial_cmp(&c),
                        Some(std::cmp::Ordering::Less | std::cmp::Ordering::Greater)
                    );
                    let expected = match kind {
                        0 => super::super::truth(a),
                        1 => !super::super::truth(a),
                        2 => super::super::truth(a) && super::super::truth(c),
                        3 => super::super::truth(a) || super::super::truth(c),
                        4 => ordered_unequal,
                        5 => !ordered_unequal,
                        _ => unreachable!(),
                    };
                    assert_eq!(
                        unsafe { code(a, c) },
                        u8::from(expected) as f64,
                        "kind={kind}, a={a:?}, b={c:?}"
                    );
                }
            }
        }
    }
}
