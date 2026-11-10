use super::super::{CallFrame, Program, RangeState, Script, ScriptEvent};
use super::*;

#[test]
fn native_context_offsets_match_both_diagnostic_and_normal_builds() {
    assert_eq!(
        std::mem::offset_of!(NativeContext, slots),
        OFF_SLOTS as usize
    );
    assert_eq!(
        std::mem::offset_of!(NativeContext, locals),
        OFF_LOCALS as usize
    );
    assert_eq!(
        std::mem::offset_of!(NativeContext, values),
        OFF_VALUES as usize
    );
    assert_eq!(
        std::mem::offset_of!(NativeContext, local_values),
        OFF_LOCAL_VALUES as usize
    );
    assert_eq!(std::mem::offset_of!(NativeContext, fuel), OFF_FUEL as usize);
}

fn engine(ops: Vec<Op>) -> Engine {
    let project = crate::studio::document::Document::blank().value().clone();
    let mut program = Program::compile(&project).unwrap();
    program.initial = vec![0.0; 3];
    program.initial_values = vec![None; 3];
    program.local_count = 1;
    program.values = vec![ValueExpr::Constant(0), ValueExpr::Global(0)];
    program.constants = vec![Cell::Number(2.0)];
    program.expressions = vec![ExprOp::Constant(1.0)];
    program.expression_starts = vec![0];
    program.sources = vec!["native-test".into(); ops.len()];
    program.ops = ops;
    program.scripts = vec![Script {
        hat: "test".into(),
        actor: 1,
        event: ScriptEvent::Start,
        start: 0,
    }];
    let mut engine = Engine::new(program);
    engine.start();
    engine.current_task = 0;
    engine.enable_jit_profile();
    engine
}

#[test]
fn call_return_conversion_arguments_are_native_and_restore_stacks() {
    let mut e = engine(vec![Op::Call(0, 0), Op::Halt, Op::ReturnValue(3)]);
    e.program
        .values
        .extend([ValueExpr::Boolean(0), ValueExpr::Parameter(0)]);
    e.program.call_arguments = vec![vec![2]];
    e.program.procedure_entries = vec![2];
    e.tasks[0].parameters = vec![Cell::Text("caller".into())];
    e.tasks[0].loops = vec![7];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
    assert_eq!(e.tasks[0].pc, 2);
    assert!(matches!(e.tasks[0].parameters[0], Cell::Bool(true)));
    e.tasks[0].loops.push(9);
    e.tasks[0].ranges.push(RangeState {
        value: 1.0,
        end: 3.0,
        step: 1.0,
    });
    e.jit_compile(2);
    assert_eq!(e.jit_run(0, 2, 1, 1), Some(1));
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(e.tasks[0].loops, [7]);
    assert!(e.tasks[0].ranges.is_empty());
    assert!(matches!(e.tasks[0].parameters[0], Cell::Text(_)));
    assert!(matches!(e.tasks[0].returned, Some(Cell::Bool(true))));
    assert_eq!(e.jit_profile()["delegated_ops"], 0);
}

#[test]
fn conversion_purity_traverses_every_descendant() {
    let mut e = engine(vec![Op::Halt]);
    for conversion in [
        ValueExpr::Boolean(0),
        ValueExpr::Encode64(0),
        ValueExpr::Decode64(0),
        ValueExpr::ParseFloat(0),
        ValueExpr::IsNumber(0, true),
        ValueExpr::ParseInt(0, 0),
    ] {
        e.program.values.push(conversion);
        let v = e.program.values.len() - 1;
        assert!(e.jit_pure_value(v));
        e.program.values[0] = ValueExpr::CallReturn(0, 0);
        assert!(!e.jit_pure_value(v));
        e.program.values[0] = ValueExpr::Constant(0);
    }
}

#[test]
fn kitten4_change_guards_keep_typed_fallback_and_following_numeric_writes() {
    for target in [Target::Global(0), Target::Local(0)] {
        let mut e = engine(vec![
            Op::Kitten4Change(target, 0, false),
            Op::SetValue(target, 0),
            Op::Halt,
        ]);
        e.program.semantics = RuntimeSemantics::Kitten4;
        e.jit_compile(0);
        assert_eq!(e.jit_run(0, 0, 1, 2), Some(2));
        assert_eq!(e.jit_profile()["delegated_ops"], 0);
        e.assign(target, Cell::Text("x".into()));
        // Force one-instruction fuel chunk to inspect the typed change alone.
        e.program.ops[1] = Op::Halt;
        e.jit_compile(0);
        assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
        let cell = match target {
            Target::Global(s) => e.global_value(s),
            Target::Local(s) => e.local_value(s),
        };
        assert!(matches!(cell, Cell::Text(ref s) if &**s == "x2"));
        assert_eq!(e.tasks[0].pc, 1);
    }
}

#[test]
fn append_all_list_refs_preserve_cells_and_check_cycles_without_exec() {
    for k4 in [false, true] {
        for list in [
            ListRef::Global(0),
            ListRef::Variable(0),
            ListRef::Local(0),
            ListRef::Expression(1),
        ] {
            let mut e = engine(vec![Op::AppendList(list, 0), Op::Halt]);
            if k4 {
                e.program.semantics = RuntimeSemantics::Kitten4;
            }
            let values = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
            e.lists = vec![values.clone()];
            e.assign(Target::Global(0), Cell::List(values.clone()));
            e.assign(Target::Local(0), Cell::List(values.clone()));
            e.jit_compile(0);
            assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
            assert!(matches!(values.borrow()[0], Cell::Number(2.0)));
            e.program.constants[0] = Cell::Bool(true);
            e.jit_compile(0);
            assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
            assert!(matches!(values.borrow()[1], Cell::Bool(true)));
            e.program.constants[0] = Cell::List(values.clone());
            e.jit_compile(0);
            assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
            assert_eq!(e.tasks[0].pc, 1);
            assert_eq!(values.borrow().len(), 2);
            assert_eq!(
                e.jit_error.take().unwrap().to_string(),
                "cyclic list at native-test"
            );
            assert_eq!(e.jit_profile()["delegated_ops"], 0);
        }
    }
}

#[test]
fn native_boundaries_charge_one_op_yield_once_and_refund_later_ops() {
    for op in [Op::Next(0, true), Op::RangeNext(0, true), Op::WarpIteration] {
        let mut e = engine(vec![op, Op::Set(2, Expr { end: 1 }), Op::Halt]);
        e.program.semantics = RuntimeSemantics::Kitten4;
        e.tasks[0].loops = vec![1];
        e.tasks[0].ranges = vec![RangeState {
            value: 1.0,
            end: 1.0,
            step: 1.0,
        }];
        e.warp_iterations = 10_001;
        e.jit_compile(0);
        assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
        assert!(e.jit_yield);
        assert_eq!(e.tasks[0].pc, 1);
        assert_eq!(e.slots[2], 0.0);
        assert_eq!(e.jit_profile()["delegated_ops"], 0);
    }
}

#[test]
fn hot_call_change_append_and_branch_really_run_without_generic_delegation() {
    let mut e = engine(vec![
        Op::Call(0, 0),
        Op::Jump(0),
        Op::Kitten4Change(Target::Global(1), 0, false),
        Op::AppendList(ListRef::Global(0), 0),
        Op::Branch(Expr { end: 1 }, 5),
        Op::Return,
    ]);
    e.program.semantics = RuntimeSemantics::Kitten4;
    e.program.values.push(ValueExpr::Boolean(0));
    e.program.expressions = vec![ExprOp::Truth(2)];
    e.program.call_arguments = vec![vec![2]];
    e.program.procedure_entries = vec![2];
    e.lists = vec![Default::default()];
    for _ in 0..HOT_THRESHOLD - 1 {
        assert_eq!(e.jit_try(0, 0, 1, 100), None);
    }
    assert_eq!(e.jit_try(0, 0, 1, 600), Some(600));
    assert_eq!(e.tasks[0].pc, 0);
    assert_eq!(e.slots[1], 200.0);
    assert_eq!(e.lists[0].borrow().len(), 100);
    assert_eq!(e.jit_profile()["delegated_ops"], 0);
    assert_eq!(e.jit_profile()["regions"], 1);
}

#[test]
fn native_invalid_return_and_stack_limit_match_pc_and_fuel() {
    let mut e = engine(vec![Op::Return, Op::Halt]);
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(
        e.jit_error.take().unwrap().to_string(),
        "invalid procedure return"
    );
    e.program.ops[0] = Op::Call(0, 0);
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries = vec![1];
    e.tasks[0].calls = vec![
        CallFrame {
            pc: 1,
            parameters: vec![],
            loops: 0,
            ranges: 0
        };
        10_000
    ];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(
        e.jit_error.take().unwrap().to_string(),
        "procedure stack limit at native-test"
    );
}

#[test]
fn output_limit_does_not_execute_native_helpers_or_charge_fuel() {
    for op in [
        Op::Call(0, 0),
        Op::Return,
        Op::AppendList(ListRef::Global(0), 0),
    ] {
        let mut e = engine(vec![op, Op::Halt]);
        e.program.call_arguments = vec![vec![]];
        e.program.procedure_entries = vec![1];
        e.lists = vec![Default::default()];
        e.jit_compile(0);
        e.audio_commands
            .resize_with(1024, || super::super::AudioCommand {
                audio: Cell::Null,
                play: false,
                wait: None,
                property: None,
            });
        assert_eq!(e.jit_run(0, 0, 1, 100), None);
        assert_eq!(e.tasks[0].pc, 0);
        assert_eq!(e.jit_profile()["native_ops"], 0);
        assert!(e.jit_error.is_none());
    }
}

#[test]
fn dedicated_helpers_preserve_error_side_effects_and_instruction_precedence() {
    // Parameter evaluation raises a value error, but the call frame and callee
    // pc are already installed before exec's trailing error check.
    let mut e = engine(vec![Op::Call(0, 0), Op::Halt, Op::Return]);
    e.program.actor_variable_names = vec!["missing".into()];
    e.program
        .values
        .push(ValueExpr::ActorVariable(usize::MAX, 0, None));
    e.program.call_arguments = vec![vec![2]];
    e.program.procedure_entries = vec![2];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
    assert_eq!(e.tasks[0].pc, 2);
    assert_eq!(e.tasks[0].calls.len(), 1);
    assert_eq!(
        e.jit_error.take().unwrap().to_string(),
        "entity_variable_operation_out_of_scope: missing at block native-test"
    );
    // The explicit stack-limit error precedes exec's trailing value-error check.
    e.tasks[0].calls.resize(
        10_000,
        CallFrame {
            pc: 1,
            parameters: vec![],
            loops: 0,
            ranges: 0,
        },
    );
    assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(
        e.jit_error.take().unwrap().to_string(),
        "procedure stack limit at native-test"
    );
    assert!(e.value_error.is_none());

    let mut e = engine(vec![Op::AppendList(ListRef::Global(0), 2), Op::Halt]);
    e.program.actor_variable_names = vec!["missing".into()];
    e.program
        .values
        .push(ValueExpr::ActorVariable(usize::MAX, 0, None));
    e.lists = vec![Default::default()];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 10), Some(1));
    // The failed reporter's Null is appended before raising the expression error.
    assert!(matches!(e.lists[0].borrow()[0], Cell::Null));
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(
        e.jit_error.take().unwrap().to_string(),
        "entity_variable_operation_out_of_scope: missing at block native-test"
    );
    assert_eq!(e.jit_profile()["delegated_ops"], 0);
}

#[test]
fn reentrant_call_branch_and_append_are_terminal_even_with_native_successors() {
    for op in [
        Op::Call(1, 0),
        Op::Branch(Expr { end: 1 }, 2),
        Op::AppendList(ListRef::Global(0), 2),
        Op::SetValue(Target::Global(2), 2),
    ] {
        let mut e = engine(vec![
            op,
            Op::Set(1, Expr { end: 2 }),
            Op::Halt,
            Op::ReturnValue(0),
            Op::Return,
        ]);
        e.program.values.push(ValueExpr::CallReturn(0, 1));
        e.program.expressions = vec![ExprOp::Truth(2), ExprOp::Constant(99.0)];
        e.program.expression_starts = vec![0, 1];
        e.program.call_arguments = vec![vec![2], vec![]];
        e.program.procedure_entries = vec![3, 4];
        e.lists = vec![Default::default()];
        assert!(e.jit_reentrant(op));
        e.jit_compile(0);
        assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
        assert_eq!(e.slots[1], 0.0, "tail helper must not run successor");
        assert_eq!(
            e.tasks[0].pc,
            if matches!(op, Op::Call(..)) { 4 } else { 1 }
        );
        assert_eq!(
            e.jit_profile()["delegated_ops"],
            if matches!(op, Op::SetValue(..)) { 1 } else { 0 }
        );
    }
}

#[test]
fn reentrant_tail_refreshes_tasks_and_guards_after_reporter_spawns_and_boxes() {
    let mut e = engine(vec![
        Op::Set(0, Expr { end: 1 }),
        Op::AppendList(ListRef::Global(0), 2),
        Op::Halt,
        Op::SetValue(Target::Global(0), 3),
        Op::Broadcast(3, None, false),
        Op::ReturnValue(0),
    ]);
    e.program.constants.push(Cell::Text("boxed".into()));
    e.program
        .values
        .extend([ValueExpr::CallReturn(0, 0), ValueExpr::Constant(1)]);
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries = vec![3];
    e.lists = vec![Default::default()];
    // Many listeners force tasks Vec growth while native cached local pointers
    // are live. call_reporter executes them only after the outer instruction.
    for _ in 0..128 {
        e.program.scripts.push(Script {
            hat: "listener".into(),
            actor: 1,
            event: ScriptEvent::Broadcast(3, false),
            start: 2,
        });
    }
    e.tasks.shrink_to_fit();
    let old_capacity = e.tasks.capacity();
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 100), Some(2));
    assert_eq!(e.tasks[0].pc, 2);
    assert!(e.tasks.capacity() > old_capacity);
    assert!(matches!(e.global_value(0), Cell::Text(ref s) if &**s == "boxed"));
    assert!(matches!(e.lists[0].borrow()[0], Cell::Number(2.0)));
    assert_eq!(
        e.jit_run(0, 0, 1, 100),
        None,
        "tail's typed write must not exempt earlier numeric write from entry guard"
    );
}

#[test]
fn reentrant_tail_preserves_error_fuel_pc_and_reporter_done_state() {
    for stop in [false, true] {
        let mut e = engine(vec![
            Op::Branch(Expr { end: 1 }, 2),
            Op::Set(1, Expr { end: 2 }),
            Op::Halt,
            if stop {
                Op::Stop(1)
            } else {
                Op::ReturnValue(3)
            },
        ]);
        e.program.values.extend([
            ValueExpr::CallReturn(0, 0),
            ValueExpr::ActorVariable(usize::MAX, 0, None),
        ]);
        e.program.actor_variable_names = vec!["missing".into()];
        e.program.expressions = vec![ExprOp::Truth(2), ExprOp::Constant(99.0)];
        e.program.expression_starts = vec![0, 1];
        e.program.call_arguments = vec![vec![]];
        e.program.procedure_entries = vec![3];
        e.jit_compile(0);
        assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
        assert_eq!(e.tasks[0].pc, 2);
        assert_eq!(e.slots[1], 0.0);
        assert_eq!(e.tasks[0].done, stop);
        if !stop {
            assert!(
                e.jit_error
                    .take()
                    .unwrap()
                    .to_string()
                    .contains("missing at block native-test")
            );
        }
    }
}

#[test]
fn compiled_control_flow_shares_leader_entries_without_recompiling() {
    let mut e = engine(vec![
        Op::Branch(Expr { end: 1 }, 3),
        Op::Set(0, Expr { end: 1 }),
        Op::Jump(3),
        Op::Change(1, Expr { end: 1 }, 1.0),
        Op::Jump(0),
    ]);
    e.jit_compile(0);
    let jit = e.jit.as_ref().unwrap();
    for pc in [0, 1, 3] {
        assert!(jit.regions[pc].is_some(), "missing leader {pc}");
        assert_eq!(
            jit.regions[pc].as_ref().unwrap().code as usize,
            jit.regions[0].as_ref().unwrap().code as usize
        );
    }
    assert_eq!(e.jit_profile()["regions"], 1);
    // Entry at a non-original leader charges only the instructions it executes.
    assert_eq!(e.jit_try(0, 3, 1, 2), Some(2));
    assert_eq!(e.tasks[0].pc, 0);
    assert_eq!(e.slots[0], 0.0);
    assert_eq!(e.slots[1], 1.0);
    assert_eq!(e.jit_profile()["regions"], 1);
    assert_eq!(e.jit_try(0, 1, 1, 1), None);
    assert_eq!(
        e.slots[0], 0.0,
        "insufficient chunk fuel cannot run a prefix"
    );
    assert_eq!(e.jit_try(0, 1, 1, 2), Some(2));
    assert_eq!(e.tasks[0].pc, 3);
    assert_eq!(e.slots[0], 1.0);
}

#[test]
fn shared_leader_entry_keeps_boxed_write_guards() {
    let mut e = engine(vec![
        Op::Branch(Expr { end: 1 }, 2),
        Op::Jump(2),
        Op::Change(0, Expr { end: 1 }, 1.0),
        Op::Halt,
    ]);
    e.jit_compile(0);
    assert!(e.jit.as_ref().unwrap().regions[2].is_some());
    e.assign(Target::Global(0), Cell::Text("keep".into()));
    assert_eq!(e.jit_try(0, 2, 1, 10), None);
    assert!(matches!(e.global_value(0), Cell::Text(ref s) if &**s == "keep"));
    assert_eq!(e.jit_profile()["native_ops"], 0);
}

#[test]
fn shared_return_entries_restore_the_actual_callers_frame() {
    let mut e = engine(vec![
        Op::Call(0, 0),
        Op::Jump(0),
        Op::Change(1, Expr { end: 1 }, 1.0),
        Op::Return,
    ]);
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries = vec![2];
    e.jit_compile(0);
    assert!(e.jit.as_ref().unwrap().regions[2].is_some());
    // Stop after the call and resume via its shared callee entry.
    assert_eq!(e.jit_run(0, 0, 1, 1), Some(1));
    assert_eq!(e.tasks[0].calls.len(), 1);
    assert_eq!(e.tasks[0].pc, 2);
    assert_eq!(e.jit_try(0, 2, 1, 2), Some(2));
    assert!(e.tasks[0].calls.is_empty());
    assert_eq!(e.tasks[0].pc, 1);
    assert_eq!(e.slots[1], 1.0);
    assert_eq!(e.jit_profile()["regions"], 1);
}

#[test]
fn shared_entry_reentrant_tail_does_not_expose_uncharged_successors() {
    let mut e = engine(vec![
        Op::Branch(Expr { end: 1 }, 2),
        Op::Jump(2),
        Op::AppendList(ListRef::Global(0), 2),
        Op::Set(1, Expr { end: 1 }),
        Op::Halt,
        Op::ReturnValue(0),
    ]);
    e.program.values.push(ValueExpr::CallReturn(0, 0));
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries = vec![5];
    e.lists = vec![Default::default()];
    e.jit_compile(0);
    assert!(e.jit.as_ref().unwrap().regions[2].is_some());
    assert!(e.jit.as_ref().unwrap().regions[3].is_none());
    assert_eq!(e.jit_try(0, 2, 1, 100), Some(1));
    assert_eq!(e.tasks[0].pc, 3);
    assert_eq!(e.slots[1], 0.0);
    assert!(matches!(e.lists[0].borrow()[0], Cell::Number(2.0)));
}

#[test]
fn inline_parameters_refresh_after_calls_and_returns_and_keep_typed_fallback() {
    let mut e = engine(vec![
        Op::Call(0, 0),
        Op::SetValue(Target::Global(0), 2),
        Op::Halt,
        Op::SetValue(Target::Global(1), 2),
        Op::Return,
    ]);
    e.program.values.push(ValueExpr::Parameter(0));
    e.program.call_arguments = vec![vec![0]];
    e.program.procedure_entries = vec![3];
    e.tasks[0].parameters = vec![Cell::Number(7.0)];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 100), Some(4));
    assert_eq!(e.slots[0], 7.0);
    assert_eq!(e.slots[1], 2.0);
    for value in [Cell::Text("typed".into()), Cell::Bool(true), Cell::Null] {
        e.tasks[0].parameters = vec![value.clone()];
        assert_eq!(e.jit_run(0, 1, 1, 100), Some(1));
        let expected = if matches!(value, Cell::Null) {
            Cell::Number(0.0)
        } else {
            value
        };
        assert_eq!(variant(e.global_value(0)), variant(expected));
    }
    e.tasks[0].parameters.clear();
    assert_eq!(e.jit_run(0, 1, 1, 100), Some(1));
    assert!(matches!(e.global_value(0), Cell::Number(n) if n.is_nan()));
}

#[test]
fn inline_parameter_nonzero_slots_preserve_bits_and_recheck_length_and_type() {
    for slot in [1, 7] {
        let mut e = engine(vec![Op::SetValue(Target::Global(0), 2), Op::Halt]);
        e.program.values.push(ValueExpr::Parameter(slot));
        e.jit_compile(0);
        for number in [-0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 123.5] {
            e.tasks[0].parameters = vec![Cell::Null; slot + 1];
            e.tasks[0].parameters[slot] = Cell::Number(number);
            assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
            assert_eq!(e.slots[0].to_bits(), number.to_bits());
        }
        for value in [
            Cell::Text("typed".into()),
            Cell::Bool(true),
            Cell::Null,
            Cell::List(Default::default()),
            Cell::Object(Default::default()),
            Cell::Undefined,
            Cell::Midi(std::rc::Rc::new(Cell::Number(3.0))),
        ] {
            e.tasks[0].parameters[slot] = value.clone();
            assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
            let expected = if matches!(value, Cell::Null | Cell::Undefined) {
                Cell::Number(0.0)
            } else {
                value
            };
            assert_eq!(variant(e.global_value(0)), variant(expected));
        }
        for len in [slot, 0, slot + 1, slot] {
            e.tasks[0].parameters = vec![Cell::Number(9.0); len];
            assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
            assert!(if len > slot {
                e.slots[0] == 9.0
            } else {
                e.slots[0].is_nan()
            });
        }
    }
}

#[test]
fn inline_parameters_refresh_twice_in_one_native_run() {
    let mut e = engine(vec![
        Op::Call(0, 0),
        Op::SetValue(Target::Global(0), 2),
        Op::Halt,
        Op::Call(1, 1),
        Op::SetValue(Target::Global(1), 2),
        Op::Return,
        Op::SetValue(Target::Global(2), 2),
        Op::Return,
    ]);
    e.program
        .values
        .extend([ValueExpr::Parameter(1), ValueExpr::Constant(1)]);
    e.program.constants.push(Cell::Number(11.0));
    e.program.call_arguments = vec![vec![0, 0], vec![0, 3, 0, 0]];
    e.program.procedure_entries = vec![3, 6];
    e.tasks[0].parameters = vec![Cell::Number(0.0), Cell::Number(7.0)];
    e.jit_compile(0);
    assert_eq!(e.jit_run(0, 0, 1, 100), Some(7));
    assert_eq!(e.slots, [7.0, 2.0, 11.0]);
    assert!(e.tasks[0].calls.is_empty());
}

#[test]
fn region_capacity_does_not_publish_an_uncompiled_leader() {
    let mut ops = vec![Op::Jump(1)];
    ops.extend(std::iter::repeat_n(
        Op::Set(0, Expr { end: 1 }),
        MAX_REGION_OPS,
    ));
    ops.push(Op::Halt);
    let mut e = engine(ops);
    e.jit_compile(0);
    assert!(e.jit.as_ref().unwrap().regions[1].is_some());
    assert!(e.jit.as_ref().unwrap().regions[MAX_REGION_OPS].is_none());
    assert_eq!(
        e.jit_run(0, 1, 1, MAX_REGION_OPS + 10),
        Some(MAX_REGION_OPS - 1)
    );
    assert_eq!(e.tasks[0].pc, MAX_REGION_OPS);
    assert_eq!(e.slots[0], 1.0);
}

#[test]
fn numeric_writes_observe_a_pending_error_from_an_early_returning_helper() {
    for change in [false, true] {
        for native in [false, true] {
            let mut e = engine(vec![
                Op::Move(Expr { end: 2 }),
                if change {
                    Op::Kitten4Change(Target::Global(0), 0, false)
                } else {
                    Op::SetValue(Target::Global(0), 0)
                },
                Op::SetValue(Target::Global(1), 0),
                Op::Halt,
            ]);
            e.program.semantics = RuntimeSemantics::Kitten4;
            e.program.expressions = vec![
                ExprOp::Constant(f64::NAN),
                ExprOp::ListItem(ListRef::Global(0), false),
            ];
            e.program.expression_starts = vec![0, 0];
            e.lists = vec![Default::default()];
            // The error belongs to Move's input, not the following assignment.
            // Official LmbJ/compile_domain_functions evaluates inputs before invocation;
            // the official text_indexOf probes also preserve the assignment sentinel.
            let error = if native {
                e.jit_compile(0);
                assert_eq!(e.jit_run(0, 0, 1, 100), Some(1));
                e.jit_error.take().unwrap()
            } else {
                e.tasks[0].pc = 1;
                e.exec(0, 0, e.program.ops[0], 1).unwrap_err()
            };
            assert!(error.to_string().contains("invalid non-finite list index"));
            assert_eq!(e.slots[0], 0.0);
            assert_eq!(e.slots[1], 0.0);
            assert_eq!(e.tasks[0].pc, 1);
            assert!(e.value_error.is_none());
        }
    }
}

#[test]
fn failed_assignment_inputs_preserve_numeric_and_typed_targets_in_both_tiers() {
    for target in [Target::Global(0), Target::Local(0)] {
        for initial in [Cell::Number(7.0), Cell::Text("sentinel".into())] {
            for mode in 0..3 {
                for change in [None, Some(false), Some(true)] {
                    for native in [false, true] {
                        let op = match change {
                            None if mode == 2 => match target {
                                Target::Global(slot) => Op::Set(slot, Expr { end: 2 }),
                                Target::Local(slot) => Op::SetLocal(slot, Expr { end: 2 }),
                            },
                            None => Op::SetValue(target, 2),
                            Some(decrease) => Op::Kitten4Change(target, 2, decrease),
                        };
                        let mut e = engine(vec![op, Op::SetValue(Target::Global(1), 0), Op::Halt]);
                        e.program.semantics = RuntimeSemantics::Kitten4;
                        e.program.expressions = vec![
                            ExprOp::Constant(f64::NAN),
                            ExprOp::ListItem(ListRef::Global(0), false),
                        ];
                        e.program.expression_starts = vec![0, 0];
                        e.program.values.push(if mode != 0 {
                            ValueExpr::Number(Expr { end: 2 })
                        } else {
                            ValueExpr::Item(ListRef::Global(0), Some(Expr { end: 1 }))
                        });
                        e.lists = vec![Default::default()];
                        e.assign(target, initial.clone());
                        let error = if native {
                            e.jit_compile(0);
                            let ran = e.jit_run(0, 0, 1, 100);
                            if mode == 2 && change.is_none() && matches!(initial, Cell::Text(_)) {
                                // Numeric Set/SetLocal rejects boxed targets at
                                // entry; the scheduler must run the interpreter.
                                assert_eq!(ran, None);
                                e.tasks[0].pc = 1;
                                e.exec(0, 0, op, 1).unwrap_err()
                            } else {
                                assert_eq!(ran, Some(1));
                                e.jit_error.take().unwrap()
                            }
                        } else {
                            // The scheduler advances PC before invoking exec.
                            e.tasks[0].pc = 1;
                            e.exec(0, 0, op, 1).unwrap_err()
                        };
                        assert!(error.to_string().contains("invalid non-finite list index"));
                        let actual = match target {
                            Target::Global(slot) => e.global_value(slot),
                            Target::Local(slot) => e.local_value(slot),
                        };
                        assert_eq!(format!("{actual:?}"), format!("{initial:?}"));
                        assert_eq!(e.slots[1], 0.0);
                        assert_eq!(e.tasks[0].pc, 1);
                        assert!(e.value_error.is_none());
                    }
                }
            }
        }
    }
}

#[test]
fn terminal_only_entry_stops_paying_native_trampoline_after_real_sample() {
    let mut e = engine(vec![
        Op::AppendList(ListRef::Global(0), 2),
        Op::Halt,
        Op::ReturnValue(0),
    ]);
    e.program.values.push(ValueExpr::CallReturn(0, 0));
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries = vec![2];
    e.lists = vec![Default::default()];
    e.jit_compile(0);
    for _ in 0..TERMINAL_SAMPLE {
        assert_eq!(e.jit_try(0, 0, 1, 100), Some(1));
    }
    assert_eq!(e.jit_profile()["native_ops"], u64::from(TERMINAL_SAMPLE));
    assert_eq!(e.jit_try(0, 0, 1, 100), None);
    e.jit_record_interpreted(0);
    assert_eq!(e.jit_profile()["interpreted_ops"], 1);
    assert_eq!(
        e.jit_profile()["fallback_reasons"]["unprofitable-terminal-entry"],
        1
    );
    assert_eq!(e.lists[0].borrow().len(), usize::from(TERMINAL_SAMPLE));
    // A different entry may still execute useful instructions before the tail.
    e.program.ops[1] = Op::Jump(0);
    e.jit_compile(1);
    assert_eq!(e.jit_try(0, 1, 1, 100), Some(2));
}
