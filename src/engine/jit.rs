//! Cranelift tier for hot bytecode. Numeric work runs as machine code; everything
//! that can suspend, spawn or switch tasks side-exits to the interpreter, which
//! stays the single source of truth for semantics. Instruction counts are exact.
use super::{
    Binary, Cell, Engine, Expr, ExprOp, ListRef, Op, Target, Unary, ValueExpr, contains_list,
    list_index,
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

/// Interpreted executions of one pc before it is compiled.
const HOT_THRESHOLD: u16 = 500;
const COLD_NEVER: u16 = u16::MAX;
const MAX_REGION_OPS: usize = 400;
/// Upper bound on one native run, so the scheduler still samples its clock.
const FUEL_SLICE: usize = 1 << 16;

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
}
const OFF_VALUES: i32 = 48;
const OFF_LOCAL_VALUES: i32 = 56;
const OFF_SLOTS: i32 = 8;
const OFF_LOCALS: i32 = 16;
const OFF_FUEL: i32 = 24;

type Entry = unsafe extern "C" fn(*mut NativeContext) -> u64;

struct Region {
    code: Entry,
    written_slots: Vec<usize>,
    written_locals: Vec<usize>,
}

pub(super) struct Jit {
    module: JITModule,
    regions: Vec<Option<Region>>,
    hot: Vec<u16>,
    next_name: usize,
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
}

impl Jit {
    /// None when disabled (`NEKOC_JIT=0`) or the host has no native backend.
    pub(super) fn new(ops: usize) -> Option<Box<Self>> {
        if std::env::var_os("NEKOC_JIT").is_some_and(|v| v == "0") {
            return None;
        }
        none_tag()?;
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
            next_name: 0,
        }))
    }
}

impl Engine {
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
        self.jit_run(index, pc, actor, left)
    }

    fn jit_run(&mut self, index: usize, pc: usize, actor: usize, left: usize) -> Option<usize> {
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
        };
        // SAFETY: the region was generated for this program, and the helpers it
        // calls never resize slots, tasks or locals.
        let next = unsafe { code(&mut context) } as usize;
        let used = (fuel - context.fuel) as usize;
        self.tasks[index].pc = next;
        if let Some(error) = self.value_error.take() {
            self.jit_error = Some(anyhow::anyhow!(error));
        }
        (used > 0 || self.jit_error.is_some()).then_some(used)
    }

    fn jit_compile(&mut self, entry: usize) {
        let mut jit = self.jit.take().expect("jit present");
        match compile(&mut jit, self, entry) {
            Some(region) => jit.regions[entry] = Some(region),
            None => jit.hot[entry] = COLD_NEVER,
        }
        self.jit = Some(jit);
    }

    /// The subtree cannot run a reporter procedure (the only expression that can
    /// box a slot or re-enter the scheduler), so native code may evaluate it.
    pub(super) fn jit_pure_expr(&self, root: usize) -> bool {
        let start = self.program.expression_starts[root] as usize;
        (start..=root).all(|pc| match self.program.expressions[pc] {
            ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => self.jit_pure_value(i),
            _ => true,
        })
    }

    fn jit_pure_value(&self, i: usize) -> bool {
        let expr = |e: Expr| self.jit_pure_expr(e.end as usize - 1);
        let span = |parts: super::Span| {
            (parts.start..parts.start + parts.len)
                .all(|k| self.jit_pure_value(self.program.value_args[k as usize]))
        };
        match self.program.values[i] {
            ValueExpr::CallReturn(..) => false,
            ValueExpr::Number(e) => expr(e),
            ValueExpr::Item(_, e) => e.is_none_or(expr),
            ValueExpr::Received(a)
            | ValueExpr::Convert(a, _)
            | ValueExpr::Kitten4Convert(a, _)
            | ValueExpr::Not(a) => self.jit_pure_value(a),
            ValueExpr::Find(_, a, _) => self.jit_pure_value(a),
            ValueExpr::Contains(a, b)
            | ValueExpr::Split(a, b)
            | ValueExpr::Compare(a, b, _)
            | ValueExpr::Logic(a, b, _) => self.jit_pure_value(a) && self.jit_pure_value(b),
            ValueExpr::Ternary(a, b, c) => {
                self.jit_pure_value(a) && self.jit_pure_value(b) && self.jit_pure_value(c)
            }
            ValueExpr::Join(parts) | ValueExpr::Temporary(parts) => span(parts),
            ValueExpr::Select(a, x, y) => self.jit_pure_value(a) && expr(x) && expr(y),
            ValueExpr::CloneProperty(_, e, _) => expr(e),
            _ => true,
        }
    }

    /// Non-suspending ops native code delegates to `exec`.
    fn jit_delegable(&self, op: Op) -> bool {
        let pure = |e: Expr| self.jit_pure_expr(e.end as usize - 1);
        let value = |v: usize| self.jit_pure_value(v);
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
            Op::Visible(_) | Op::Pen(_) | Op::Color(_) | Op::Clear | Op::ClearList(_) => true,
            Op::SetValue(_, v) | Op::AppendList(_, v) | Op::ReturnValue(v) => value(v),
            Op::Return => true,
            Op::Call(_, args) => self.program.call_arguments[args].iter().all(|&v| value(v)),
            Op::DeleteList(_, e) => e.is_none_or(pure),
            Op::InsertList(_, e, v) => pure(e) && value(v),
            Op::ReplaceList(_, e, v) => e.is_none_or(pure) && value(v),
            _ => false,
        }
    }

    /// Whether native code can run `op` without leaving the VM's control flow.
    fn jit_supported(&self, op: Op) -> bool {
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
            Op::Next(_, yielding) | Op::RangeNext(_, yielding) => !yielding,
            other => self.jit_delegable(other),
        }
    }
}

unsafe extern "C" fn h_node(c: *mut NativeContext, pc: u64) -> f64 {
    let c = unsafe { &mut *c };
    unsafe { (*c.engine).node(pc as usize, c.actor) }
}
unsafe extern "C" fn h_list_item(c: *mut NativeContext, list: u64, at: f64) -> f64 {
    let engine = unsafe { &*(*c).engine };
    let values = engine.lists[list as usize].borrow();
    list_index(at)
        .and_then(|i| values.get(i))
        .map_or(f64::NAN, Cell::number)
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
    let n = n.floor().clamp(0.0, u32::MAX as f64) as u64;
    if n == 0 {
        return 0;
    }
    unsafe { (&mut (*c.engine).tasks)[c.index].loops.push(n) };
    1
}
/// 0: side exit, 1: run the body again, 2: loop finished.
unsafe extern "C" fn h_next(c: *mut NativeContext) -> u64 {
    let c = unsafe { &mut *c };
    let loops = unsafe { &mut (&mut (*c.engine).tasks)[c.index].loops };
    let Some(left) = loops.last_mut() else {
        return 0;
    };
    *left -= 1;
    if *left > 0 {
        1
    } else {
        loops.pop();
        2
    }
}
/// 0: side exit (the interpreter reports the error), 1: again, 2: finished.
unsafe extern "C" fn h_range_next(c: *mut NativeContext) -> u64 {
    let c = unsafe { &mut *c };
    let ranges = unsafe { &mut (&mut (*c.engine).tasks)[c.index].ranges };
    let Some(range) = ranges.last_mut() else {
        return 0;
    };
    let next = range.value + range.step;
    if next == range.value {
        return 0;
    }
    range.value = next;
    if (range.step > 0.0 && next <= range.end) || (range.step < 0.0 && next >= range.end) {
        1
    } else {
        ranges.pop();
        2
    }
}
unsafe extern "C" fn h_break(c: *mut NativeContext, pop: u64) {
    let c = unsafe { &mut *c };
    let task = unsafe { &mut (&mut (*c.engine).tasks)[c.index] };
    if pop == 1 {
        task.loops.pop();
    } else if pop == 2 {
        task.ranges.pop();
    }
}
/// Delegates one op to the interpreter. 0: leave the region at this op, 1: done.
unsafe extern "C" fn h_exec(c: *mut NativeContext, pc: u64) -> u64 {
    let c = unsafe { &mut *c };
    let engine = unsafe { &mut *c.engine };
    if engine.output_limit_reached() {
        return 0;
    }
    let pc = pc as usize;
    engine.tasks[c.index].pc = pc + 1;
    let op = engine.program.ops[pc];
    match engine.exec(c.index, pc, op, c.actor) {
        Ok(_) => 1,
        Err(error) => {
            engine.jit_error = Some(error);
            0
        }
    }
}

/// Runs a control-transfer op. Returns the new pc, or u64::MAX to leave at this op.
unsafe extern "C" fn h_transfer(c: *mut NativeContext, pc: u64) -> u64 {
    if unsafe { h_exec(c, pc) } == 0 {
        return u64::MAX;
    }
    let c = unsafe { &*c };
    unsafe { (&(*c.engine).tasks)[c.index].pc as u64 }
}
/// Same semantics as `Op::ReplaceList` for a number written to a global list.
unsafe extern "C" fn h_replace_number(c: *mut NativeContext, list: u64, at: f64, value: f64) {
    let engine = unsafe { &*(*c).engine };
    let mut values = engine.lists[list as usize].borrow_mut();
    if let Some(at) = list_index(at) {
        match values.get_mut(at) {
            Some(cell) => *cell = Cell::Number(value),
            None => values.push(Cell::Number(value)),
        }
    }
}
/// `Op::ReplaceList` copying a cell between global lists. 0: failed, leave the region.
unsafe extern "C" fn h_replace_item(
    c: *mut NativeContext,
    target: u64,
    at: f64,
    source: u64,
    from: f64,
    pc: u64,
) -> u64 {
    let c = unsafe { &mut *c };
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
        return 0;
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
    let engine = unsafe { &*(*c).engine };
    engine.lists[list as usize]
        .borrow_mut()
        .push(Cell::Number(value));
}
/// `target = list[at]` without the generic dispatch: bit 0 of `target` selects locals.
unsafe extern "C" fn h_assign_item(c: *mut NativeContext, target: u64, list: u64, at: f64) {
    let c = unsafe { &mut *c };
    let engine = unsafe { &mut *c.engine };
    let cell = {
        let values = engine.lists[list as usize].borrow();
        list_index(at)
            .and_then(|i| values.get(i))
            .cloned()
            .unwrap_or(Cell::Number(f64::NAN))
    };
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
        match self.engine.program.expressions[pc] {
            ExprOp::Constant(n) => self.b.ins().f64const(n),
            ExprOp::Slot(s) => self.load(self.slots, s),
            ExprOp::Local(s) => self.load(self.locals, s),
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
            ExprOp::ListItem(ListRef::Global(list), false) => {
                let at = self.expr(pc - 1);
                let list = self.b.ins().iconst(types::I64, list as i64);
                let ctx = self.ctx;
                self.call(
                    h_list_item as *const () as usize,
                    &[types::I64, types::I64, types::F64],
                    Some(types::F64),
                    &[ctx, list, at],
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
    fn numeric(&self, i: usize, guards: &mut Vec<(bool, usize)>) -> Option<Numeric> {
        match self.engine.program.values[i] {
            ValueExpr::Number(e) => Some(Numeric::Expr(e.end as usize - 1)),
            ValueExpr::Constant(c) => match self.engine.program.constants[c] {
                Cell::Number(n) => Some(Numeric::Constant(n)),
                _ => None,
            },
            ValueExpr::Global(s) => {
                guards.push((false, s));
                Some(Numeric::Global(s))
            }
            ValueExpr::Local(s) => {
                guards.push((true, s));
                Some(Numeric::Local(s))
            }
            _ => None,
        }
    }

    /// Whether the truth of this value is computable from numbers alone.
    fn truth_tree(&self, i: usize, guards: &mut Vec<(bool, usize)>) -> bool {
        match self.engine.program.values[i] {
            ValueExpr::Compare(a, b, op) => {
                matches!(
                    op,
                    Binary::Eq | Binary::Ne | Binary::Lt | Binary::Le | Binary::Gt | Binary::Ge
                ) && self.numeric(a, guards).is_some()
                    && self.numeric(b, guards).is_some()
            }
            ValueExpr::Not(a) => self.truth_tree(a, guards),
            ValueExpr::Logic(a, b, _) => self.truth_tree(a, guards) && self.truth_tree(b, guards),
            _ => self.numeric(i, guards).is_some(),
        }
    }

    fn numeric_value(&mut self, value: Numeric) -> Value {
        match value {
            Numeric::Expr(pc) => self.expr(pc),
            Numeric::Constant(n) => self.b.ins().f64const(n),
            Numeric::Global(s) => self.load(self.slots, s),
            Numeric::Local(s) => self.load(self.locals, s),
        }
    }

    fn truth_flag(&mut self, i: usize) -> Value {
        match self.engine.program.values[i] {
            ValueExpr::Compare(a, b, op) => {
                let a = self.numeric(a, &mut Vec::new()).unwrap();
                let b = self.numeric(b, &mut Vec::new()).unwrap();
                let a = self.numeric_value(a);
                let b = self.numeric_value(b);
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
                let flag = self.truth_flag(a);
                self.b.ins().bxor_imm(flag, 1)
            }
            ValueExpr::Logic(a, b, and) => {
                let a = self.truth_flag(a);
                let b = self.truth_flag(b);
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
        }
    }

    /// Branches to `slow` unless every listed variable is unboxed.
    fn check_unboxed(&mut self, guards: &[(bool, usize)], slow: Block) {
        let stride = std::mem::size_of::<Option<Cell>>();
        for &(local, slot) in guards {
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
            Binary::Div => {
                let zero = self.b.ins().f64const(0.0);
                let is_zero = self.b.ins().fcmp(FloatCC::Equal, b, zero);
                let quotient = self.b.ins().fdiv(a, b);
                self.b.ins().select(is_zero, zero, quotient)
            }
            Binary::KnDiv => self.b.ins().fdiv(a, b),
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

    /// Calls h_transfer; a failed transfer leaves the region, returns the new pc otherwise.
    fn transfer(&mut self, pc: usize, remaining: i64) -> Value {
        let at = self.b.ins().iconst(types::I64, pc as i64);
        let ctx = self.ctx;
        let next = self
            .call(
                h_transfer as *const () as usize,
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
        next
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

    /// Writes a number to a global list directly; anything else takes `h_exec`.
    fn list_write(
        &mut self,
        pc: usize,
        list: u32,
        at: Option<Expr>,
        v: usize,
        blocks: &BTreeMap<usize, Block>,
        remaining: i64,
    ) {
        let next = blocks[&(pc + 1)];
        if let (Some(at), ValueExpr::Item(ListRef::Global(source), Some(from))) =
            (at, self.engine.program.values[v])
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
            self.b.ins().brif(done, next, &[], exit, &[]);
            self.b.switch_to_block(exit);
            self.side_exit(pc, remaining);
            return;
        }
        let slow = self.b.create_block();
        let mut guards = Vec::new();
        if let Some(value) = self.numeric(v, &mut guards) {
            self.check_unboxed(&guards, slow);
            let at = at.map(|e| self.expr(e.end as usize - 1));
            let number = self.numeric_value(value);
            let list = self.b.ins().iconst(types::I64, list as i64);
            let ctx = self.ctx;
            match at {
                Some(at) => self.call(
                    h_replace_number as *const () as usize,
                    &[types::I64, types::I64, types::F64, types::F64],
                    None,
                    &[ctx, list, at, number],
                ),
                None => self.call(
                    h_append_number as *const () as usize,
                    &[types::I64, types::I64, types::F64],
                    None,
                    &[ctx, list, number],
                ),
            };
            self.b.ins().jump(next, &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        let at = self.b.ins().iconst(types::I64, pc as i64);
        let ctx = self.ctx;
        let done = self
            .call(
                h_exec as *const () as usize,
                &[types::I64, types::I64],
                Some(types::I64),
                &[ctx, at],
            )
            .unwrap();
        let exit = self.b.create_block();
        self.b.ins().brif(done, next, &[], exit, &[]);
        self.b.switch_to_block(exit);
        self.side_exit(pc, remaining);
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
        if let ValueExpr::Item(ListRef::Global(list), Some(e)) = self.engine.program.values[v] {
            let at = self.expr(e.end as usize - 1);
            let encoded = match target {
                Target::Global(s) => (s as i64) << 1,
                Target::Local(s) => ((s as i64) << 1) | 1,
            };
            let encoded = self.b.ins().iconst(types::I64, encoded);
            let list = self.b.ins().iconst(types::I64, list as i64);
            let ctx = self.ctx;
            self.call(
                h_assign_item as *const () as usize,
                &[types::I64, types::I64, types::I64, types::F64],
                None,
                &[ctx, encoded, list, at],
            );
            self.b.ins().jump(next, &[]);
            return;
        }
        let slow = self.b.create_block();
        let mut guards = Vec::new();
        if let Some(value) = self.numeric(v, &mut guards) {
            self.check_unboxed(&guards, slow);
            let number = self.numeric_value(value);
            self.assign_number(target, number);
            self.b.ins().jump(next, &[]);
        } else {
            self.b.ins().jump(slow, &[]);
        }
        self.b.switch_to_block(slow);
        let at = self.b.ins().iconst(types::I64, pc as i64);
        let ctx = self.ctx;
        let done = self
            .call(
                h_exec as *const () as usize,
                &[types::I64, types::I64],
                Some(types::I64),
                &[ctx, at],
            )
            .unwrap();
        let exit = self.b.create_block();
        self.b.ins().brif(done, next, &[], exit, &[]);
        self.b.switch_to_block(exit);
        self.side_exit(pc, remaining);
    }

    fn op(&mut self, pc: usize, op: Op, blocks: &BTreeMap<usize, Block>, remaining: i64) {
        let ctx = self.ctx;
        let block = |at: usize| blocks[&at];
        match op {
            Op::Set(s, e) => {
                let v = self.expr(e.end as usize - 1);
                self.store(self.slots, s, v);
                self.clear_global(s);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::SetLocal(s, e) => {
                let v = self.expr(e.end as usize - 1);
                self.store(self.locals, s, v);
                self.clear_local(s);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::Change(s, e, sign) => {
                self.change(self.slots, s, e, sign);
                self.clear_global(s);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::ChangeLocal(s, e, sign) => {
                self.change(self.locals, s, e, sign);
                self.clear_local(s);
                self.b.ins().jump(block(pc + 1), &[]);
            }
            Op::Branch(e, target) => {
                let v = self.expr(e.end as usize - 1);
                let t = self.truth(v);
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
                self.b
                    .ins()
                    .brif(entered, block(pc + 1), &[], block(end), &[]);
            }
            Op::Next(target, _) | Op::RangeNext(target, _) => {
                let helper = if matches!(op, Op::Next(..)) {
                    h_next as *const () as usize
                } else {
                    h_range_next as *const () as usize
                };
                let state = self
                    .call(helper, &[types::I64], Some(types::I64), &[ctx])
                    .unwrap();
                let check = self.b.create_block();
                let exit = self.b.create_block();
                self.b.ins().brif(state, check, &[], exit, &[]);
                self.b.switch_to_block(exit);
                self.side_exit(pc, remaining);
                self.b.switch_to_block(check);
                let again = self.b.ins().icmp_imm(IntCC::Equal, state, 1);
                self.b
                    .ins()
                    .brif(again, block(target), &[], block(pc + 1), &[]);
            }
            Op::SetValue(target, v) => self.set_value(pc, target, v, blocks, remaining),
            Op::ReplaceList(ListRef::Global(list), Some(at), v) => {
                self.list_write(pc, list, Some(at), v, blocks, remaining)
            }
            Op::AppendList(ListRef::Global(list), v) => {
                self.list_write(pc, list, None, v, blocks, remaining)
            }
            Op::Range(_, end) => {
                let next = self.transfer(pc, remaining);
                let skipped = self.b.ins().icmp_imm(IntCC::Equal, next, end as i64);
                self.b
                    .ins()
                    .brif(skipped, block(end), &[], block(pc + 1), &[]);
            }
            Op::Call(procedure, _) => {
                self.transfer(pc, remaining);
                let target = self.engine.program.procedure_entries[procedure];
                self.b.ins().jump(block(target), &[]);
            }
            Op::Return | Op::ReturnValue(_) => {
                let next = self.transfer(pc, remaining);
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
                let at = self.b.ins().iconst(types::I64, pc as i64);
                let done = self
                    .call(
                        h_exec as *const () as usize,
                        &[types::I64, types::I64],
                        Some(types::I64),
                        &[ctx, at],
                    )
                    .unwrap();
                let exit = self.b.create_block();
                self.b.ins().brif(done, block(pc + 1), &[], exit, &[]);
                self.b.switch_to_block(exit);
                self.side_exit(pc, remaining);
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
        match ops[pc] {
            Op::Set(s, _) | Op::Change(s, _, _) => {
                written_slots.insert(s);
            }
            Op::SetLocal(s, _) | Op::ChangeLocal(s, _, _) => {
                written_locals.insert(s);
            }
            Op::SetValue(Target::Global(s), _) => {
                boxed_slots.insert(s);
            }
            Op::SetValue(Target::Local(s), _) => {
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
    signature.returns.push(AbiParam::new(types::I64));
    let mut context = cranelift_codegen::Context::new();
    context.func.signature = signature;
    let mut scope = FunctionBuilderContext::new();
    {
        let mut b = FunctionBuilder::new(&mut context.func, &mut scope);
        let start = b.create_block();
        b.append_block_params_for_function_params(start);
        b.switch_to_block(start);
        let ctx = b.block_params(start)[0];
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
        b.ins().jump(blocks[&entry], &[]);
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
            while is_straight(ops[last])
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
        written_slots: written_slots.difference(&boxed_slots).copied().collect(),
        written_locals: written_locals.difference(&boxed_locals).copied().collect(),
    })
}

fn compile(jit: &mut Jit, engine: &Engine, entry: usize) -> Option<Region> {
    let BuiltRegion {
        mut context,
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
    Some(Region {
        code,
        written_slots,
        written_locals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
