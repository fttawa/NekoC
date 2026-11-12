//! Local interpreter layout/evaluation regressions, not official-runtime evidence.
use super::*;

fn engine(ops: Vec<Op>, semantics: RuntimeSemantics) -> Engine {
    let project = crate::studio::document::Document::blank().value().clone();
    let mut program = Program::compile(&project).unwrap();
    program.semantics = semantics;
    program.initial = vec![0.0];
    program.initial_values = vec![None];
    program.local_count = 1;
    program.values = vec![ValueExpr::Constant(0)];
    program.constants = vec![Cell::Text("french".into())];
    program.expressions = vec![ExprOp::Constant(0.0)];
    program.expression_starts = vec![0];
    program.deep_values.clear();
    program.sources = (0..ops.len())
        .map(|pc| format!("interp-layout-block-{pc}"))
        .collect();
    program.ops = ops;
    program.scripts = vec![Script {
        hat: "interp-layout-test".into(),
        actor: 1,
        event: ScriptEvent::Start,
        start: 0,
    }];
    let mut engine = Engine::new(program);
    engine.disable_jit();
    engine.start();
    engine.current_task = 0;
    engine
}

// Match the scheduler's preincrement without advancing a tick or running a
// successor. All assertions concern exec's own boundary, not advance's checks.
fn exec_at(engine: &mut Engine, pc: usize) -> Result<bool> {
    let op = engine.program.ops[pc];
    let actor = engine.tasks[0].actor;
    engine.tasks[0].pc = pc + 1;
    engine.exec(0, pc, op, actor)
}

#[test]
fn hot_and_cold_fallthrough_take_pending_value_error_at_original_source() {
    for semantics in [RuntimeSemantics::KnCurrent, RuntimeSemantics::Kitten4] {
        for op in [Op::SetValue(Target::Global(0), 0), Op::Ranking(None, false)] {
            let mut e = engine(vec![op, Op::Halt], semantics);
            e.cloud.ranking = Some(0);
            e.value_error = Some("pending-layout-error".into());

            let error = exec_at(&mut e, 0).unwrap_err();
            assert_eq!(
                error.to_string(),
                "pending-layout-error at block interp-layout-block-0"
            );
            assert!(e.value_error.is_none());
            assert_eq!(e.tasks[0].pc, 1);
            assert!(!e.tasks[0].done);
            assert_eq!(e.slots[0], 0.0);
            if matches!(op, Op::Ranking(..)) {
                // Normal cold fallthrough still performs its side effect before
                // the shared trailing error check consumes the pending error.
                assert_eq!(e.cloud.ranking, None);
            }
        }
    }
}

#[test]
fn cold_direct_helper_return_keeps_pending_value_error_even_when_true() {
    for semantics in [RuntimeSemantics::KnCurrent, RuntimeSemantics::Kitten4] {
        let mut e = engine(
            vec![Op::K4Media(k4_media::Command::Language(0)), Op::Halt],
            semantics,
        );
        e.value_error = Some("pending-layout-error".into());

        assert!(exec_at(&mut e, 0).unwrap());
        assert_eq!(e.value_error.as_deref(), Some("pending-layout-error"));
        assert_eq!(e.tasks[0].pc, 1);
        assert!(!e.tasks[0].done);
        assert_eq!(e.tasks[0].pending, 0);
    }
}

#[test]
fn cold_blocking_early_returns_keep_pending_error_and_request_side_effects() {
    for semantics in [RuntimeSemantics::KnCurrent, RuntimeSemantics::Kitten4] {
        for op in [Op::Ask(0, None), Op::StageDialog(0, usize::MAX)] {
            let mut e = engine(vec![op, Op::Halt], semantics);
            e.value_error = Some("pending-layout-error".into());
            let task_id = e.tasks[0].id;
            let next_ask = e.next_ask;

            assert!(!exec_at(&mut e, 0).unwrap());
            assert_eq!(e.value_error.as_deref(), Some("pending-layout-error"));
            assert_eq!(e.tasks[0].pc, 1);
            assert_eq!(e.tasks[0].pending, 1);
            assert_eq!(e.next_ask, next_ask + 1);
            assert!(!e.tasks[0].done);
            match op {
                Op::Ask(..) => {
                    let request = e.asks.front().unwrap();
                    assert_eq!(request.question, "french");
                    assert_eq!(request.task, task_id);
                    assert!(request.choices.is_none());
                    assert!(e.stage_dialogs.is_empty());
                }
                Op::StageDialog(..) => {
                    let request = e.pending_stage_dialog().unwrap();
                    assert_eq!(request.text, "french");
                    assert_eq!(request.task, task_id);
                    assert!(e.asks.is_empty());
                }
                _ => unreachable!(),
            }
        }
    }
}

#[test]
fn cold_physics_argument_error_reaches_tail_without_allocating_world() {
    let bad = Expr { end: 1 };
    let zero = Expr { end: 2 };
    for semantics in [RuntimeSemantics::KnCurrent, RuntimeSemantics::Kitten4] {
        for op in [
            Op::LegacyPhysics(physics::Command::LegacyMass, 1),
            Op::LegacyPhysicsVector(physics::Command::LegacyVelocityVector, 1, 2),
            Op::PhysicsVelocity(1, 2),
            Op::Physics(physics::Command::Speed, bad, zero, zero),
        ] {
            let mut e = engine(vec![op, Op::Set(0, zero), Op::Halt], semantics);
            e.program.constants = vec![Cell::Text("(".into()), Cell::Number(0.0)];
            e.program.values = vec![
                ValueExpr::Constant(0),
                ValueExpr::Calculate(0),
                ValueExpr::Constant(1),
            ];
            e.program.expressions = vec![ExprOp::Value(1), ExprOp::Constant(0.0)];
            e.program.expression_starts = vec![0, 1];
            e.slots[0] = 99.0;
            let wake = e.tasks[0].wake;

            assert!(e.physics.is_none());
            let error = exec_at(&mut e, 0).unwrap_err();
            assert_eq!(
                error.to_string(),
                "block_bad_math_expression at block interp-layout-block-0"
            );
            assert!(e.value_error.is_none());
            assert!(e.physics.is_none());
            assert_eq!(e.tasks[0].wake, wake);
            assert_eq!(e.tasks[0].pending, 0);
            assert_eq!(e.tasks[0].pc, 1);
            assert_eq!(e.slots[0], 99.0);
            assert!(!e.tasks[0].done);
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum EvaluationPath {
    // Empty deep_values: eval_value_one::<true> is the ordinary fast path.
    ShallowPrepared,
    // Nonempty deep_values, but this root is unmarked: ordinary <false> path.
    ShallowUnprepared,
    // Marked 72-parent tree: <false> enters the walker, which uses <true> with
    // scoped operand queues and calls <false> to consume prepared children.
    DeepPrepared,
}

fn microbit_engine(
    semantics: RuntimeSemantics,
    path: EvaluationPath,
    sockets: [usize; 5],
) -> (Engine, usize) {
    let mut e = engine(vec![Op::Halt], semantics);
    e.program.constants = vec![Cell::Number(1.0)];
    e.program.values = vec![ValueExpr::Constant(0)];
    e.program.strings = (0..5).map(|i| format!("socket-{i}")).collect();
    e.program.call_arguments = vec![vec![]];
    e.program.procedure_entries.clear();
    // Distinct reporter procedures make order and duplicate evaluations visible.
    // They run through the same current task, exercising nested exec re-entry.
    for i in 0..5 {
        e.program.procedure_entries.push(e.program.ops.len());
        e.program.ops.extend([Op::Log(i), Op::ReturnValue(0)]);
        e.program.values.push(ValueExpr::CallReturn(i, 0));
    }
    // Nonzero start and trailing padding catch accidental whole-table iteration.
    e.program.value_args = vec![0, 0];
    e.program.value_args.extend(sockets.map(|i| i + 1));
    e.program.value_args.push(0);
    let mut root = e.program.values.len();
    e.program
        .values
        .push(ValueExpr::OfflineMicrobitMap(Span { start: 2, len: 5 }));
    match path {
        EvaluationPath::ShallowPrepared => {}
        EvaluationPath::ShallowUnprepared => {
            // The unrelated constant selects <false> without marking the map.
            e.program.deep_values.insert(0);
        }
        EvaluationPath::DeepPrepared => {
            for _ in 0..72 {
                let parent = e.program.values.len();
                // Numeric conversion preserves a typed NaN rather than turning
                // the observation into a boolean or a formatted string.
                e.program.values.push(ValueExpr::Convert(root, true));
                root = parent;
            }
            // Mirror compiler deep_value_inner's marking of compiled children.
            e.program.deep_values.extend(0..e.program.values.len());
        }
    }
    e.program.ops[0] = Op::Audio(root, true);
    e.program.sources = (0..e.program.ops.len())
        .map(|pc| format!("microbit-layout-block-{pc}"))
        .collect();
    (e, root)
}

#[test]
fn microbit_span_keeps_order_duplicates_and_typed_nan_on_both_evaluation_paths() {
    for semantics in [RuntimeSemantics::KnCurrent, RuntimeSemantics::Kitten4] {
        for path in [
            EvaluationPath::ShallowPrepared,
            EvaluationPath::ShallowUnprepared,
            EvaluationPath::DeepPrepared,
        ] {
            for sockets in [[0, 1, 2, 3, 4], [1, 0, 1, 4, 2]] {
                let expected: Vec<_> = sockets.iter().map(|i| format!("socket-{i}")).collect();
                // First observe the value directly, independently of exec's
                // cold dispatch, and then repeat on a fresh VM through Audio.
                for through_cold_exec in [false, true] {
                    let (mut e, root) = microbit_engine(semantics, path, sockets);
                    let cell = if through_cold_exec {
                        assert!(exec_at(&mut e, 0).unwrap());
                        assert_eq!(e.audio_commands.len(), 1);
                        let command = &e.audio_commands[0];
                        assert!(command.play);
                        assert!(command.wait.is_none());
                        assert!(command.property.is_none());
                        command.audio.clone()
                    } else {
                        e.eval_value(root, 1)
                    };
                    assert!(
                        matches!(cell, Cell::Number(n) if n.is_nan()),
                        "{semantics:?} {path:?} cold_exec={through_cold_exec}"
                    );
                    assert_eq!(e.logs, expected);
                    assert!(e.value_error.is_none());
                    assert!(e.evaluation_cache.is_empty());
                    assert_eq!(e.reporter_depth, 0);
                    assert!(e.tasks[0].calls.is_empty());
                    assert!(e.tasks[0].returned.is_none());
                    assert_eq!(e.tasks[0].pending, 0);
                    assert_eq!(e.tasks[0].pc, usize::from(through_cold_exec));
                    assert!(!e.tasks[0].done);
                }
            }
        }
    }
}

// These are synthetic, bounded layout regressions, not new runtime evidence.
// Ternary evaluates both arms in this VM; constant unused arms preserve the
// selected Cell's type without introducing additional observable side effects.
fn side_table_parents(e: &mut Engine, mut value: usize, deep: bool) -> usize {
    if deep {
        let constant = e.program.constants.len();
        e.program.constants.push(Cell::Bool(true));
        let condition = e.program.values.len();
        e.program.values.push(ValueExpr::Constant(constant));
        for _ in 0..72 {
            let parent = e.program.values.len();
            e.program
                .values
                .push(ValueExpr::Ternary(condition, value, condition));
            value = parent;
        }
    }
    value
}

fn side_table_reporter(e: &mut Engine, label: &str, value: Cell) -> usize {
    let constant = e.program.constants.len();
    e.program.constants.push(value);
    let result = e.program.values.len();
    e.program.values.push(ValueExpr::Constant(constant));
    let label_index = e.program.strings.len();
    e.program.strings.push(label.into());
    let procedure = e.program.procedure_entries.len();
    e.program.procedure_entries.push(e.program.ops.len());
    e.program
        .ops
        .extend([Op::Log(label_index), Op::ReturnValue(result)]);
    let args = e.program.call_arguments.len();
    e.program.call_arguments.push(vec![]);
    let root = e.program.values.len();
    e.program
        .values
        .push(ValueExpr::CallReturn(procedure, args));
    root
}

fn side_table_ready(e: &mut Engine, deep: bool) {
    if deep {
        e.program.deep_values.extend(0..e.program.values.len());
    }
    e.program.sources = (0..e.program.ops.len())
        .map(|pc| format!("side-table-layout-block-{pc}"))
        .collect();
}

fn assert_side_table_unwound(e: &Engine) {
    assert!(e.evaluation_cache.is_empty());
    assert_eq!(e.reporter_depth, 0);
    assert!(e.tasks[0].calls.is_empty());
    assert!(e.tasks[0].returned.is_none());
    assert_eq!(e.tasks[0].pending, 0);
    assert!(!e.tasks[0].done);
}

#[test]
fn k4_media_side_table_translate_consumes_ordered_and_repeated_deep_inputs_once() {
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            for repeated in [false, true] {
                let mut e = engine(vec![Op::Halt], RuntimeSemantics::Kitten4);
                let text = side_table_reporter(&mut e, "text", Cell::Text("bonjour".into()));
                let language = side_table_reporter(&mut e, "language", Cell::Text("en".into()));
                let text = side_table_parents(&mut e, text, deep_input);
                let language = if repeated {
                    text
                } else {
                    side_table_parents(&mut e, language, deep_input)
                };
                e.program.k4_media = vec![
                    k4_media::Reporter::Voice,
                    k4_media::Reporter::Midi(0),
                    k4_media::Reporter::Translate(text, language),
                ];
                let reporter = e.program.values.len();
                e.program.values.push(ValueExpr::K4Media(2));
                let root = side_table_parents(&mut e, reporter, deep_parent);
                side_table_ready(&mut e, deep_input || deep_parent);

                // Re-evaluation must run the reporters again, not reuse a
                // previous root's cache. A duplicate socket is two evaluations.
                for _ in 0..2 {
                    e.logs.clear();
                    assert!(
                        matches!(e.eval_value(root, 1), Cell::Text(s) if s.as_ref() == "bonjour")
                    );
                    assert_eq!(
                        e.logs,
                        if repeated {
                            vec!["text", "text"]
                        } else {
                            vec!["text", "language"]
                        }
                    );
                    assert!(e.value_error.is_none());
                    assert_side_table_unwound(&e);
                }
            }
        }
    }
}

#[test]
fn k4_media_side_table_midi_preserves_typed_values_and_deep_input_error() {
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            for bad_math in [false, true] {
                let mut e = engine(vec![Op::Halt], RuntimeSemantics::Kitten4);
                let input = side_table_reporter(
                    &mut e,
                    "midi-input",
                    if bad_math {
                        Cell::Text("(".into())
                    } else {
                        Cell::Bool(true)
                    },
                );
                let input = if bad_math {
                    let calculated = e.program.values.len();
                    e.program.values.push(ValueExpr::Calculate(input));
                    calculated
                } else {
                    input
                };
                let input = side_table_parents(&mut e, input, deep_input);
                e.program.k4_media =
                    vec![k4_media::Reporter::Scan, k4_media::Reporter::Midi(input)];
                let reporter = e.program.values.len();
                e.program.values.push(ValueExpr::K4Media(1));
                let root = side_table_parents(&mut e, reporter, deep_parent);
                side_table_ready(&mut e, deep_input || deep_parent);

                for _ in 0..2 {
                    e.logs.clear();
                    let Cell::Midi(value) = e.eval_value(root, 1) else {
                        panic!("MIDI wrapper lost its Cell type");
                    };
                    if bad_math {
                        assert!(matches!(&*value, Cell::Number(n) if n.is_nan()));
                        assert_eq!(
                            e.value_error.take().as_deref(),
                            Some("block_bad_math_expression")
                        );
                    } else {
                        assert!(matches!(&*value, Cell::Bool(true)));
                        assert!(e.value_error.is_none());
                    }
                    assert_eq!(e.logs, ["midi-input"]);
                    assert_side_table_unwound(&e);
                }
            }
        }
    }
}

fn k4_layout_descriptor() -> (k4_properties::Property, Vec<String>) {
    // Repository-original fixture supplies the private descriptor fields; its
    // scripts are compiled only, never scheduled or used as oracle evidence.
    let source = crate::json::from_str(include_str!(
        "../../tests/fixtures/kitten4/partial-properties-get_clone_index_property-actor.bcm"
    ))
    .unwrap();
    let project = crate::kitten4::to_neko(&source).unwrap();
    let program = Program::compile(&project).unwrap();
    (program.k4_properties[0], program.strings)
}

fn kn_layout_descriptor() -> kn_appearance::CloneProperty {
    let mut project = crate::studio::document::Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = serde_json::json!([{
        "type": "on_running_group_activated",
        "next": {
            "type": "console_log",
            "inputs": {"console_log": {
                "type": "get_clone_index_property",
                "fields": {"sprite": "--self", "attribute": "x"},
                "inputs": {"index": {"type": "math_number", "fields": {"NUM": 0}}}
            }}
        }
    }]);
    Program::compile(&project).unwrap().kn_clone_properties[0]
}

fn property_layout_root(
    e: &mut Engine,
    index: Cell,
    deep_input: bool,
    deep_parent: bool,
    repeated: bool,
) -> usize {
    let input = side_table_reporter(e, "clone-index", index);
    let input = side_table_parents(e, input, deep_input);
    let reporter = e.program.values.len();
    if e.program.semantics == RuntimeSemantics::Kitten4 {
        // Slot zero intentionally points at a different index: treating a
        // descriptor slot as an operand ID cannot accidentally pass.
        e.program.k4_properties[0].index = Some(0);
        e.program.k4_properties[1].index = Some(input);
        e.program.values.push(ValueExpr::K4Property(1));
    } else {
        e.program.kn_clone_properties[0].index = 0;
        e.program.kn_clone_properties[1].index = input;
        e.program.values.push(ValueExpr::KnCloneProperty(1));
    }
    let root = if repeated {
        e.program.value_args = vec![0, reporter, reporter, 0];
        let list = e.program.values.len();
        e.program
            .values
            .push(ValueExpr::Temporary(Span { start: 1, len: 2 }));
        list
    } else {
        reporter
    };
    let root = side_table_parents(e, root, deep_parent);
    side_table_ready(e, deep_input || deep_parent);
    root
}

#[test]
fn k4_property_side_table_deep_inputs_and_parents_keep_repeated_evaluations() {
    let (property, strings) = k4_layout_descriptor();
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            let mut e = engine(vec![Op::Halt], RuntimeSemantics::Kitten4);
            e.program.strings = strings.clone();
            e.program.k4_properties = vec![property, property];
            e.sprites[1].x = 42.25;
            let root =
                property_layout_root(&mut e, Cell::Number(0.0), deep_input, deep_parent, true);
            for _ in 0..2 {
                e.logs.clear();
                let Cell::List(values) = e.eval_value(root, 1) else {
                    panic!("property pair lost its list type");
                };
                let values = values.borrow();
                assert_eq!(values.len(), 2);
                assert!(values.iter().all(|v| matches!(v, Cell::Number(42.25))));
                assert_eq!(e.logs, ["clone-index", "clone-index"]);
                assert!(e.value_error.is_none());
                assert_side_table_unwound(&e);
            }
        }
    }
}

#[test]
fn k4_property_side_table_preserves_index_type_errors_and_missing_clone_error() {
    let (property, strings) = k4_layout_descriptor();
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            for (index, error) in [
                (
                    Cell::Text("0".into()),
                    "clone_entity_index_only_support_number",
                ),
                (Cell::Bool(false), "clone_entity_index_only_support_number"),
                (Cell::Number(f64::NAN), "clone_entity_not_exist"),
            ] {
                let mut e = engine(vec![Op::Halt], RuntimeSemantics::Kitten4);
                e.program.strings = strings.clone();
                e.program.k4_properties = vec![property, property];
                let root = property_layout_root(&mut e, index, deep_input, deep_parent, false);
                for _ in 0..2 {
                    e.logs.clear();
                    assert!(matches!(e.eval_value(root, 1), Cell::Number(n) if n.is_nan()));
                    assert_eq!(e.value_error.take().as_deref(), Some(error));
                    assert_eq!(e.logs, ["clone-index"]);
                    assert_side_table_unwound(&e);
                }
            }
        }
    }
}

#[test]
fn kn_clone_property_side_table_deep_inputs_and_parents_keep_repeated_evaluations() {
    let property = kn_layout_descriptor();
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            let mut e = engine(vec![Op::Halt], RuntimeSemantics::KnCurrent);
            e.program.kn_clone_properties = vec![property, property];
            e.sprites[1].x = 42.25;
            let root =
                property_layout_root(&mut e, Cell::Number(0.0), deep_input, deep_parent, true);
            for _ in 0..2 {
                e.logs.clear();
                let Cell::List(values) = e.eval_value(root, 1) else {
                    panic!("clone property pair lost its list type");
                };
                let values = values.borrow();
                assert_eq!(values.len(), 2);
                assert!(values.iter().all(|v| matches!(v, Cell::Number(42.25))));
                assert_eq!(e.logs, ["clone-index", "clone-index"]);
                assert!(e.value_error.is_none());
                assert_side_table_unwound(&e);
            }
        }
    }
}

#[test]
fn kn_clone_property_side_table_keeps_typed_invalid_indices_and_scene_undefined() {
    let property = kn_layout_descriptor();
    for deep_input in [false, true] {
        for deep_parent in [false, true] {
            for scene in [false, true] {
                for index in [
                    Cell::Text("0".into()),
                    Cell::Bool(false),
                    Cell::Number(f64::NAN),
                ] {
                    let mut e = engine(vec![Op::Halt], RuntimeSemantics::KnCurrent);
                    e.program.kn_clone_properties = vec![property, property];
                    e.sprites[1].stage = scene;
                    let root = property_layout_root(&mut e, index, deep_input, deep_parent, false);
                    for _ in 0..2 {
                        e.logs.clear();
                        let value = e.eval_value(root, 1);
                        if scene {
                            assert!(matches!(value, Cell::Undefined));
                        } else {
                            assert!(matches!(value, Cell::Number(n) if n.is_nan()));
                        }
                        assert_eq!(e.logs, ["clone-index"]);
                        assert!(e.value_error.is_none());
                        assert_side_table_unwound(&e);
                    }
                }
            }
        }
    }
}
