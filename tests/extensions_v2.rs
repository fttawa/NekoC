//! Host-extension v2 contracts, including suspension and native-tier boundaries.
//! Fixtures are canonical in-memory KN; no editor/project artifacts are written.
use nekoc::{
    engine::{Engine, Frame, Program, encode_frame},
    extensions::{
        API_VERSION, BlockKind, BlockMetadata, BlockSchema, CallPolicy, CallResult, ErrorPolicy,
        Extension, ExtensionRegistry, ExtensionRequest, Parameter, ValueType, negotiate_version,
    },
    studio::document::Document,
};
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc, time::Duration};

const ACTOR: &str = "nekoc-default-actor";
const WALL_BUDGET: Duration = Duration::from_secs(5);

fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}

fn get(id: &str) -> Value {
    json!({"type":"variables_get","fields":{"variable":id}})
}

fn set(id: &str, value: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":id},"inputs":{"value":value}})
}

fn add(a: Value, b: Value) -> Value {
    json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":a,"B":b}})
}

fn chain(ops: Vec<Value>) -> Value {
    ops.into_iter()
        .rev()
        .reduce(|next, mut op| {
            op["next"] = next;
            op
        })
        .unwrap()
}

fn start(body: Value) -> Value {
    json!({"type":"on_running_group_activated","next":body})
}

fn project(roots: Vec<Value>) -> Value {
    let mut p = Document::blank().value().clone();
    for id in [
        "out", "left", "right", "branch", "after", "other", "hits", "tick", "payload",
    ] {
        p["variables"]["variablesDict"][id] =
            json!({"id":id,"name":id,"value":0,"type":"any","isGlobal":true});
    }
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!(roots);
    p
}

fn reporter(opcode: &str, inputs: Value) -> Value {
    json!({"type":"nekoc_extension_reporter","fields":{"opcode":opcode},"inputs":inputs})
}

fn boolean(opcode: &str, inputs: Value) -> Value {
    json!({"type":"nekoc_extension_boolean","fields":{"opcode":opcode},"inputs":inputs})
}

fn hat(opcode: &str, body: Value) -> Value {
    json!({"type":"nekoc_extension_hat","fields":{"opcode":opcode},"next":body})
}

fn schema(
    opcode: &str,
    kind: BlockKind,
    returns: Option<ValueType>,
    blocking: bool,
) -> BlockSchema {
    BlockSchema {
        api_version: 2,
        opcode: opcode.into(),
        parameters: vec![],
        returns,
        blocking,
        network: false,
        kind: Some(kind),
        metadata: Some(BlockMetadata {
            name: "测试 block".into(),
            category: "Offline".into(),
        }),
    }
}

#[derive(Clone, Copy, Debug)]
enum Behavior {
    Echo,
    Positive,
    Ready,
    Pending,
    Error,
    WrongType,
    Panic,
}

#[derive(Debug)]
struct Host {
    behavior: Behavior,
    calls: RefCell<Vec<ExtensionRequest>>,
}

impl Host {
    fn new(behavior: Behavior) -> Rc<Self> {
        Rc::new(Self {
            behavior,
            calls: RefCell::new(vec![]),
        })
    }

    fn count(&self) -> usize {
        self.calls.borrow().len()
    }
}

impl Extension for Host {
    fn call(&self, request: &ExtensionRequest) -> anyhow::Result<CallResult> {
        self.calls.borrow_mut().push(request.clone());
        Ok(match self.behavior {
            Behavior::Echo => CallResult::Ready(request.arguments[0].clone()),
            Behavior::Positive => {
                CallResult::Ready(json!(request.arguments[0].as_f64().unwrap() > 0.0))
            }
            Behavior::Ready => CallResult::Ready(json!(7)),
            Behavior::Pending => CallResult::Pending,
            Behavior::Error => anyhow::bail!("host deliberately failed"),
            Behavior::WrongType => CallResult::Ready(json!("not a number")),
            Behavior::Panic => panic!("host deliberately panicked"),
        })
    }
}

fn registry(
    behavior: Behavior,
    blocking: bool,
    errors: ErrorPolicy,
) -> (ExtensionRegistry, Rc<Host>) {
    let host = Host::new(behavior);
    let mut r = ExtensionRegistry::new();
    r.set_call_policy(CallPolicy {
        timeout: Duration::from_secs(1),
        errors,
    })
    .unwrap();
    r.register(
        schema(
            "test.value",
            BlockKind::Reporter,
            Some(ValueType::Number),
            blocking,
        ),
        host.clone(),
    )
    .unwrap();
    (r, host)
}

fn engine(p: &Value, r: &ExtensionRegistry, jit: bool) -> Engine {
    let mut e = Engine::new(Program::compile_with_extensions(p, r).unwrap());
    if !jit {
        e.disable_jit();
    }
    e.use_virtual_clock();
    e.start();
    e
}

fn frame(e: &mut Engine) -> Frame {
    e.advance(1.0 / 60.0, 100_000, WALL_BUDGET).unwrap()
}

fn finish(e: &mut Engine) -> Vec<String> {
    let mut logs = vec![];
    for _ in 0..16 {
        logs.extend(frame(e).logs);
        if e.active_tasks() == 0 {
            return logs;
        }
    }
    panic!("extension script did not finish");
}

#[test]
fn v1_deserialization_and_highest_common_version_negotiation() {
    let value = json!({"api_version":1,"opcode":"legacy.parse","parameters":[],"returns":"any","blocking":false});
    let old: BlockSchema = serde_json::from_value(value).unwrap();
    old.validate().unwrap();
    assert_eq!(old.block_kind(), BlockKind::Command);
    assert!(old.kind.is_none() && old.metadata.is_none() && !old.network);
    let encoded = serde_json::to_value(&old).unwrap();
    assert!(encoded.get("kind").is_none() && encoded.get("metadata").is_none());
    assert_eq!(API_VERSION, 2);
    assert_eq!(negotiate_version(&[1, 2]).unwrap(), 2);
    assert_eq!(negotiate_version(&[2, 1, 2, 99]).unwrap(), 2);
    assert_eq!(negotiate_version(&[1]).unwrap(), 1);
    assert!(negotiate_version(&[]).is_err());
    assert!(negotiate_version(&[0, 3, 99]).is_err());
}

#[test]
fn schema_metadata_kinds_and_registry_validation() {
    for (kind, returns) in [
        (BlockKind::Command, None),
        (BlockKind::Reporter, Some(ValueType::Number)),
        (BlockKind::Boolean, Some(ValueType::Boolean)),
        (BlockKind::Hat, None),
    ] {
        let valid = schema("test.block", kind, returns, false);
        valid.validate().unwrap();
        let roundtrip: BlockSchema =
            serde_json::from_value(serde_json::to_value(&valid).unwrap()).unwrap();
        assert_eq!(roundtrip.block_kind(), kind);
        assert_eq!(roundtrip.metadata.unwrap().name, "测试 block");
    }
    let base = schema(
        "test.block",
        BlockKind::Reporter,
        Some(ValueType::Number),
        false,
    );
    let mut bad = vec![];
    let mut s = base.clone();
    s.api_version = 1;
    bad.push(s);
    let mut s = base.clone();
    s.api_version = 3;
    bad.push(s);
    let mut s = base.clone();
    s.returns = None;
    bad.push(s);
    let mut s = base.clone();
    s.kind = Some(BlockKind::Boolean);
    bad.push(s);
    let mut s = base.clone();
    s.metadata.as_mut().unwrap().name.clear();
    bad.push(s);
    let mut s = base.clone();
    s.metadata.as_mut().unwrap().category.clear();
    bad.push(s);
    let mut s = base.clone();
    s.metadata.as_mut().unwrap().name = "x".repeat(129);
    bad.push(s);
    let mut s = base.clone();
    s.metadata.as_mut().unwrap().category = "x".repeat(129);
    bad.push(s);
    for invalid in bad {
        assert!(invalid.validate().is_err(), "{invalid:?}");
    }
    for alteration in 0..3 {
        let mut s = schema("test.event", BlockKind::Hat, None, false);
        match alteration {
            0 => s.blocking = true,
            1 => s.returns = Some(ValueType::Any),
            _ => s.parameters.push(Parameter {
                name: "arg".into(),
                value_type: ValueType::Any,
            }),
        }
        assert!(s.validate().is_err());
    }
    let mut encoded = serde_json::to_value(&base).unwrap();
    encoded["metadata"]["extra"] = json!(true);
    assert!(serde_json::from_value::<BlockSchema>(encoded).is_err());
    let mut encoded = serde_json::to_value(&base).unwrap();
    encoded["kind"] = json!("expression");
    assert!(serde_json::from_value::<BlockSchema>(encoded).is_err());

    let mut r = ExtensionRegistry::new();
    assert!(r.register_hat(base.clone()).is_err());
    assert!(
        r.register(
            schema("test.event", BlockKind::Hat, None, false),
            Host::new(Behavior::Ready)
        )
        .is_err()
    );
    r.register(base.clone(), Host::new(Behavior::Ready))
        .unwrap();
    let mut detached = r.schemas();
    detached[0].metadata.as_mut().unwrap().name.clear();
    assert_eq!(r.schemas()[0].metadata.as_ref().unwrap().name, "测试 block");
    assert!(r.register(base, Host::new(Behavior::Ready)).is_err());
    for timeout in [
        Duration::ZERO,
        Duration::from_nanos(999_999),
        Duration::from_secs(61),
    ] {
        assert!(
            r.set_call_policy(CallPolicy {
                timeout,
                errors: ErrorPolicy::Report
            })
            .is_err()
        );
    }
    for timeout in [Duration::from_millis(1), Duration::from_secs(60)] {
        r.set_call_policy(CallPolicy {
            timeout,
            errors: ErrorPolicy::DefaultValue,
        })
        .unwrap();
    }
}

#[test]
fn nested_reporter_and_boolean_feed_variables_and_conditions() {
    let echo = Host::new(Behavior::Echo);
    let positive = Host::new(Behavior::Positive);
    let mut r = ExtensionRegistry::new();
    for (opcode, kind, returns, host) in [
        (
            "test.echo",
            BlockKind::Reporter,
            ValueType::Number,
            echo.clone(),
        ),
        (
            "test.positive",
            BlockKind::Boolean,
            ValueType::Boolean,
            positive.clone(),
        ),
    ] {
        let mut s = schema(opcode, kind, Some(returns), false);
        s.parameters.push(Parameter {
            name: "value".into(),
            value_type: ValueType::Number,
        });
        r.register(s, host).unwrap();
    }
    let nested = || {
        reporter(
            "test.echo",
            json!({"value":reporter("test.echo", json!({"value":num(7.0)}))}),
        )
    };
    let p = project(vec![start(chain(vec![
        set("out", add(nested(), num(3.0))),
        set("left", boolean("test.positive", json!({"value":nested()}))),
        json!({"type":"controls_if","inputs":{"IF0":boolean("test.positive", json!({"value":nested()}))},"statements":{"DO0":set("branch", num(1.0))}}),
        set("after", num(1.0)),
    ]))]);
    for jit in [false, true] {
        let before_echo = echo.count();
        let before_positive = positive.count();
        let mut e = engine(&p, &r, jit);
        finish(&mut e);
        assert_eq!(e.variable_text("out"), "10");
        assert_eq!(e.variable_text("left"), "true");
        assert_eq!(e.variable_text("branch"), "1");
        assert_eq!(
            echo.count() - before_echo,
            6,
            "nested operands must not run twice"
        );
        assert_eq!(positive.count() - before_positive, 2);
    }
    let wrong = project(vec![start(set(
        "out",
        boolean("test.echo", json!({"value":num(1.0)})),
    ))]);
    assert!(Program::compile_with_extensions(&wrong, &r).is_err());
    let wrong = project(vec![start(set(
        "out",
        reporter("test.positive", json!({"value":num(1.0)})),
    ))]);
    assert!(Program::compile_with_extensions(&wrong, &r).is_err());
}

#[test]
fn ready_blocking_and_native_pending_resume_parent_expression_exactly_once() {
    for jit in [false, true] {
        for (behavior, blocking) in [
            (Behavior::Ready, false),
            (Behavior::Ready, true),
            (Behavior::Pending, true),
        ] {
            let (mut r, host) = registry(behavior, blocking, ErrorPolicy::Propagate);
            let sibling = Host::new(Behavior::Ready);
            r.register(
                schema(
                    "test.sibling",
                    BlockKind::Reporter,
                    Some(ValueType::Number),
                    false,
                ),
                sibling.clone(),
            )
            .unwrap();
            let p = project(vec![start(chain(vec![
                set(
                    "out",
                    add(
                        reporter("test.sibling", json!({})),
                        reporter("test.value", json!({})),
                    ),
                ),
                set("after", num(1.0)),
            ]))]);
            let mut e = engine(&p, &r, jit);
            assert!(frame(&mut e).extension_requests.is_empty());
            assert_eq!(host.count(), 1);
            assert_eq!(sibling.count(), 1);
            if blocking {
                assert_eq!(e.variable_text("out"), "0");
                assert_eq!(e.variable_text("after"), "0");
            }
            if matches!(behavior, Behavior::Pending) {
                let id = host.calls.borrow()[0].id;
                assert_eq!(host.calls.borrow()[0].actor, ACTOR);
                for _ in 0..2 {
                    assert!(frame(&mut e).extension_requests.is_empty());
                }
                assert_eq!(host.count(), 1);
                assert!(e.complete_extension(id, Ok(json!(9))).unwrap());
                assert!(!e.complete_extension(id, Ok(json!(99))).unwrap());
            }
            finish(&mut e);
            assert_eq!(
                e.variable_text("out"),
                if matches!(behavior, Behavior::Pending) {
                    "16"
                } else {
                    "14"
                }
            );
            assert_eq!(e.variable_text("after"), "1");
            assert_eq!(host.count(), 1);
            assert_eq!(sibling.count(), 1);
        }
    }
}

#[test]
fn simultaneous_remote_reporters_keep_results_task_local() {
    let mut r = ExtensionRegistry::new();
    r.register_remote(schema(
        "test.value",
        BlockKind::Reporter,
        Some(ValueType::Number),
        true,
    ))
    .unwrap();
    let p = project(vec![
        start(set(
            "left",
            add(reporter("test.value", json!({})), num(10.0)),
        )),
        start(set(
            "right",
            add(reporter("test.value", json!({})), num(20.0)),
        )),
    ]);
    let mut e = engine(&p, &r, true);
    let requests = frame(&mut e).extension_requests;
    assert_eq!(requests.len(), 2);
    assert_ne!(requests[0].id, requests[1].id);
    assert!(e.complete_extension(requests[1].id, Ok(json!(2))).unwrap());
    frame(&mut e);
    assert_eq!(e.variable_text("left"), "0");
    assert_eq!(e.variable_text("right"), "22");
    assert!(e.complete_extension(requests[0].id, Ok(json!(1))).unwrap());
    finish(&mut e);
    assert_eq!(e.variable_text("left"), "11");
    assert_eq!(e.variable_text("right"), "22");
}

#[test]
fn extension_hats_are_explicit_typed_events_and_obey_restart_stop_capabilities() {
    let mut r = ExtensionRegistry::new();
    r.register_hat(schema("test.event", BlockKind::Hat, None, false))
        .unwrap();
    r.register_hat(schema("test.stop", BlockKind::Hat, None, false))
        .unwrap();
    let body = chain(vec![
        set("payload", json!({"type":"self_listen_value"})),
        set("hits", add(get("hits"), num(1.0))),
    ]);
    let p = project(vec![
        hat("test.event", body),
        hat("test.stop", json!({"type":"stop","fields":{"scope":"0"}})),
    ]);
    assert!(Program::compile(&p).is_err());
    let mut e = engine(&p, &r, true);
    frame(&mut e);
    assert_eq!(e.variable_text("hits"), "0");
    assert_eq!(e.active_tasks(), 0);
    assert!(e.emit_extension_event("missing.event", json!(1)).is_err());
    assert!(
        e.emit_extension_event("test.event", json!({"object":"not supported"}))
            .is_err()
    );
    assert_eq!(e.active_tasks(), 0);
    assert_eq!(
        e.emit_extension_event("test.event", json!(["猫", true, 3, null]))
            .unwrap(),
        1
    );
    finish(&mut e);
    assert_eq!(
        e.debug_snapshot()["variables"]["payload"],
        json!(["猫", true, 3.0, null])
    );
    assert_eq!(e.variable_text("hits"), "1");
    frame(&mut e);
    assert_eq!(
        e.variable_text("hits"),
        "1",
        "hat must not poll or auto-repeat"
    );
    assert_eq!(e.emit_extension_event("test.event", json!(99)).unwrap(), 1);
    e.start(); // Discard a queued event rather than replaying it after restart.
    frame(&mut e);
    assert_eq!(e.variable_text("hits"), "0");
    assert_eq!(
        e.emit_extension_event("test.event", json!("restarted"))
            .unwrap(),
        1
    );
    finish(&mut e);
    assert_eq!(e.variable_text("payload"), "restarted");
    assert_eq!(e.emit_extension_event("test.stop", Value::Null).unwrap(), 1);
    frame(&mut e);
    assert_eq!(
        e.emit_extension_event("test.event", json!("stopped"))
            .unwrap(),
        0
    );
    frame(&mut e);
    assert_eq!(e.variable_text("payload"), "restarted");
    e.start();
    assert_eq!(e.emit_extension_event("test.event", json!(42)).unwrap(), 1);
    finish(&mut e);
    assert_eq!(e.variable_text("payload"), "42");

    let mut network = schema("network.event", BlockKind::Hat, None, false);
    network.network = true;
    assert!(r.register_hat(network.clone()).is_err());
    r.set_allow_network(true);
    r.register_hat(network).unwrap();
    let (r, _) = registry(Behavior::Ready, false, ErrorPolicy::Propagate);
    let mut e = engine(&project(vec![]), &r, true);
    assert!(
        e.emit_extension_event("test.value", json!(1)).is_err(),
        "reporters are not event capabilities"
    );
}

#[test]
fn error_wrong_type_and_panic_respect_each_call_error_policy() {
    for jit in [false, true] {
        for behavior in [Behavior::Error, Behavior::WrongType, Behavior::Panic] {
            for errors in [
                ErrorPolicy::Propagate,
                ErrorPolicy::Report,
                ErrorPolicy::DefaultValue,
            ] {
                let (r, host) = registry(behavior, false, errors);
                let p = project(vec![
                    start(chain(vec![
                        set("out", add(reporter("test.value", json!({})), num(5.0))),
                        set("after", num(1.0)),
                    ])),
                    start(set("other", num(1.0))),
                ]);
                let mut e = engine(&p, &r, jit);
                let result = e.advance(1.0 / 60.0, 100_000, WALL_BUDGET);
                assert_eq!(host.count(), 1);
                if errors == ErrorPolicy::Propagate {
                    let message = format!("{:#}", result.unwrap_err());
                    assert!(message.contains("test.value"), "{message}");
                    assert_eq!(e.variable_text("after"), "0");
                } else {
                    let mut logs = result.unwrap().logs;
                    logs.extend(finish(&mut e));
                    assert_eq!(logs.len(), 1, "{behavior:?}/{errors:?}: {logs:?}");
                    assert!(logs[0].contains("test.value"));
                    assert_eq!(e.variable_text("other"), "1", "Report is not stop-all");
                    assert_eq!(
                        e.variable_text("out"),
                        if errors == ErrorPolicy::Report {
                            "0"
                        } else {
                            "5"
                        }
                    );
                    assert_eq!(
                        e.variable_text("after"),
                        if errors == ErrorPolicy::Report {
                            "0"
                        } else {
                            "1"
                        }
                    );
                }
            }
        }
    }
}

#[test]
fn default_value_reports_and_continues_with_the_declared_neutral_type() {
    for (kind, neutral) in [
        (ValueType::Number, json!(0.0)),
        (ValueType::String, json!("")),
        (ValueType::Boolean, json!(false)),
        (ValueType::List, json!([])),
        (ValueType::Any, Value::Null),
    ] {
        let mut r = ExtensionRegistry::new();
        r.set_call_policy(CallPolicy {
            timeout: Duration::from_secs(1),
            errors: ErrorPolicy::DefaultValue,
        })
        .unwrap();
        r.register(
            schema("test.default", BlockKind::Reporter, Some(kind), true),
            Host::new(Behavior::Error),
        )
        .unwrap();
        let echo = Host::new(Behavior::Echo);
        let mut sink = schema(
            "test.sink",
            BlockKind::Reporter,
            Some(ValueType::Any),
            false,
        );
        sink.parameters.push(Parameter {
            name: "VALUE".into(),
            value_type: ValueType::Any,
        });
        r.register(sink, echo.clone()).unwrap();
        let p = project(vec![start(chain(vec![
            set(
                "out",
                reporter(
                    "test.sink",
                    json!({"VALUE":reporter("test.default", json!({}))}),
                ),
            ),
            set("after", num(1.0)),
        ]))]);
        let mut e = engine(&p, &r, true);
        let logs = finish(&mut e);
        assert_eq!(logs.len(), 1);
        assert_eq!(echo.calls.borrow()[0].arguments, vec![neutral.clone()]);
        // The extension boundary preserves JSON null. A subsequent ordinary
        // KN global assignment deliberately applies the host language's null
        // fallback, rather than changing all KN variables for extension use.
        let assigned = if kind == ValueType::Any {
            json!(0.0)
        } else {
            neutral
        };
        assert_eq!(e.debug_snapshot()["variables"]["out"], assigned, "{kind:?}");
        assert_eq!(e.variable_text("after"), "1");
    }
}

#[test]
fn pending_completion_errors_and_invalid_values_use_the_same_policies() {
    for errors in [
        ErrorPolicy::Propagate,
        ErrorPolicy::Report,
        ErrorPolicy::DefaultValue,
    ] {
        for invalid_type in [false, true] {
            let (r, host) = registry(Behavior::Pending, true, errors);
            let p = project(vec![
                start(chain(vec![
                    set("out", add(reporter("test.value", json!({})), num(5.0))),
                    set("after", num(1.0)),
                ])),
                start(set("other", num(1.0))),
            ]);
            let mut e = engine(&p, &r, true);
            frame(&mut e);
            let id = host.calls.borrow()[0].id;
            let result = if invalid_type {
                Ok(json!(false))
            } else {
                Err("async host failed".into())
            };
            let completed = e.complete_extension(id, result);
            if errors == ErrorPolicy::Propagate {
                assert!(completed.is_err());
                // A propagated invalid completion is retryable, but never leaks the bad value.
                assert_eq!(e.variable_text("out"), "0");
                assert!(e.complete_extension(id, Ok(json!(7))).unwrap());
            } else {
                assert!(completed.unwrap());
                assert!(!e.complete_extension(id, Ok(json!(99))).unwrap());
            }
            let logs = finish(&mut e);
            assert_eq!(host.count(), 1);
            assert_eq!(e.variable_text("other"), "1");
            match errors {
                ErrorPolicy::Propagate => assert_eq!(e.variable_text("out"), "12"),
                ErrorPolicy::Report => {
                    assert_eq!(logs.len(), 1);
                    assert_eq!(e.variable_text("out"), "0");
                    assert_eq!(e.variable_text("after"), "0");
                }
                ErrorPolicy::DefaultValue => {
                    assert_eq!(logs.len(), 1);
                    assert_eq!(e.variable_text("out"), "5");
                    assert_eq!(e.variable_text("after"), "1");
                }
            }
        }
    }
}

#[test]
fn native_pending_and_remote_calls_timeout_and_discard_late_completions() {
    for remote in [false, true] {
        for errors in [
            ErrorPolicy::Propagate,
            ErrorPolicy::Report,
            ErrorPolicy::DefaultValue,
        ] {
            let (mut r, host) = registry(Behavior::Pending, true, errors);
            if remote {
                r = ExtensionRegistry::new();
                r.register_remote(schema(
                    "test.value",
                    BlockKind::Reporter,
                    Some(ValueType::Number),
                    true,
                ))
                .unwrap();
            }
            r.set_call_policy(CallPolicy {
                timeout: Duration::from_millis(2),
                errors,
            })
            .unwrap();
            let p = project(vec![
                start(chain(vec![
                    set("out", add(reporter("test.value", json!({})), num(5.0))),
                    set("after", num(1.0)),
                ])),
                start(set("other", num(1.0))),
            ]);
            let mut e = engine(&p, &r, true);
            let first = frame(&mut e);
            let id = if remote {
                assert_eq!(first.extension_requests.len(), 1);
                first.extension_requests[0].id
            } else {
                assert!(first.extension_requests.is_empty());
                host.calls.borrow()[0].id
            };
            std::thread::sleep(Duration::from_millis(8));
            let result = e.advance(1.0 / 60.0, 100_000, WALL_BUDGET);
            if errors == ErrorPolicy::Propagate {
                assert!(format!("{:#}", result.unwrap_err()).contains("timed out"));
                assert_eq!(e.variable_text("after"), "0");
            } else {
                let expired = result.unwrap();
                assert!(expired.extension_requests.is_empty());
                let mut logs = expired.logs;
                logs.extend(finish(&mut e));
                assert_eq!(logs.len(), 1);
                assert!(logs[0].contains("timed out"));
                assert_eq!(
                    e.variable_text("after"),
                    if errors == ErrorPolicy::Report {
                        "0"
                    } else {
                        "1"
                    }
                );
                assert_eq!(
                    e.variable_text("out"),
                    if errors == ErrorPolicy::Report {
                        "0"
                    } else {
                        "5"
                    }
                );
            }
            assert_eq!(e.variable_text("other"), "1");
            assert!(!e.complete_extension(id, Ok(json!(99))).unwrap());
            assert_eq!(host.count(), usize::from(!remote));
        }
    }
}

#[test]
fn restart_and_stop_cancel_pending_reporters_without_reusing_request_ids() {
    let (r, host) = registry(Behavior::Pending, true, ErrorPolicy::Propagate);
    let p = project(vec![start(set("out", reporter("test.value", json!({}))))]);
    let mut e = engine(&p, &r, true);
    frame(&mut e);
    let old = host.calls.borrow()[0].id;
    e.start();
    frame(&mut e);
    let new = host.calls.borrow()[1].id;
    assert!(new > old);
    assert!(!e.complete_extension(old, Ok(json!(99))).unwrap());
    assert!(e.complete_extension(new, Ok(json!(7))).unwrap());
    finish(&mut e);
    assert_eq!(e.variable_text("out"), "7");

    let p = project(vec![
        start(set("out", reporter("test.value", json!({})))),
        start(json!({"type":"stop","fields":{"scope":"0"}})),
    ]);
    let mut e = engine(&p, &r, true);
    frame(&mut e);
    let cancelled = host.calls.borrow().last().unwrap().id;
    assert!(!e.complete_extension(cancelled, Ok(json!(99))).unwrap());
    assert_eq!(e.variable_text("out"), "0");
}

/// Preserve everything except actual elapsed execution time, including budget_yield.
fn normalized(bytes: &[u8]) -> (Value, Vec<u8>) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let mut meta: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    meta.as_object_mut().unwrap().remove("execute_us");
    (meta, bytes[4 + length..].to_vec())
}

#[test]
fn hot_extension_loop_matches_interpreter_at_every_budget_boundary() {
    // 620 executions exceed the 500-hit native threshold. Small budgets test
    // suspension precisely; larger budgets test regions spanning many KN ops.
    // Four budgets x three seeds is one compact fixture, not a scenario cross product.
    let body = chain(vec![
        set("tick", add(get("tick"), num(1.0))),
        set(
            "out",
            add(
                reporter(
                    "test.echo",
                    json!({"value":json!({"type":"random_num","inputs":{"A":num(1.0),"B":num(9.0)}})}),
                ),
                get("tick"),
            ),
        ),
        set("after", add(get("after"), get("out"))),
    ]);
    let p = project(vec![start(json!({"type":"warp","statements":{"DO":{
        "type":"repeat_n_times","inputs":{"times":num(620.0)},"statements":{"DO":body}
    }}}))]);
    for budget in [1, 2, 997, 100_000] {
        for seed in [1, 6, 42] {
            let mut engines = vec![];
            let mut hosts = vec![];
            for jit in [false, true] {
                let host = Host::new(Behavior::Echo);
                let mut r = ExtensionRegistry::new();
                let mut s = schema(
                    "test.echo",
                    BlockKind::Reporter,
                    Some(ValueType::Number),
                    false,
                );
                s.parameters.push(Parameter {
                    name: "value".into(),
                    value_type: ValueType::Number,
                });
                r.register(s, host.clone()).unwrap();
                let mut e = engine(&p, &r, jit);
                e.set_random_seed(seed);
                e.enable_jit_profile();
                hosts.push(host);
                engines.push(e);
            }
            let mut finished = false;
            for tick in 0..12_000 {
                let a = engines[0].advance(1.0 / 60.0, budget, WALL_BUDGET).unwrap();
                let b = engines[1].advance(1.0 / 60.0, budget, WALL_BUDGET).unwrap();
                assert_eq!(
                    engines[0].debug_snapshot(),
                    engines[1].debug_snapshot(),
                    "budget={budget} seed={seed} frame={tick}"
                );
                assert_eq!(
                    engines[0].jit_debug_snapshot(),
                    engines[1].jit_debug_snapshot(),
                    "precise state: budget={budget} seed={seed} frame={tick}"
                );
                assert_eq!(
                    normalized(&encode_frame(&a).unwrap()),
                    normalized(&encode_frame(&b).unwrap()),
                    "frame encoding: budget={budget} seed={seed} frame={tick}"
                );
                engines[0].recycle_lines(a.lines);
                engines[1].recycle_lines(b.lines);
                assert_eq!(hosts[0].count(), hosts[1].count());
                if engines[0].active_tasks() == 0 {
                    assert_eq!(engines[1].active_tasks(), 0);
                    finished = true;
                    break;
                }
            }
            assert!(finished, "budget={budget} seed={seed}: loop did not finish");
            assert_eq!(engines[1].variable_text("tick"), "620");
            assert_eq!(hosts[0].count(), 620);
            assert_eq!(hosts[1].count(), 620);
            let profile = engines[1].jit_profile();
            assert!(
                profile["native_ops"].as_u64().unwrap() > 0,
                "budget={budget} seed={seed}: {profile}"
            );
            assert!(
                profile["helper_reasons"]["op/Extension"]
                    .as_u64()
                    .unwrap_or(0)
                    > 0,
                "budget={budget} seed={seed}: {profile}"
            );
        }
    }
}
