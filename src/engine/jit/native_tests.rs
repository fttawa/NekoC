use super::super::{CallFrame, Program, RangeState, Script, ScriptEvent};
use super::*;

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
