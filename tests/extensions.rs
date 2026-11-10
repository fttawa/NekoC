use nekoc::{
    engine::{Engine, Program},
    extensions::{
        CallResult, Extension, ExtensionRegistry, ExtensionRequest, JsonParse, ValueType,
    },
    studio::document::Document,
};
use serde_json::{Value, json};
use std::{rc::Rc, time::Duration};

fn project(text: Value, next: Value) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["output"] =
        json!({"id":"output","name":"output","value":0,"type":"number"});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{
            "id":"parse","type":"nekoc_extension_call","fields":{"opcode":"example.json.parse","result":"output"},
            "inputs":{"text":text},"next":next
        }
    }]);
    p
}
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn movement() -> Value {
    json!({"type":"self_move_to","inputs":{"x":{"type":"math_number","fields":{"NUM":42}},"y":{"type":"math_number","fields":{"NUM":0}}}})
}
fn frame(vm: &mut Engine) -> nekoc::engine::Frame {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
        .unwrap()
}
fn vm(registry: &ExtensionRegistry, p: &Value) -> Engine {
    let mut vm = Engine::new(Program::compile_with_extensions(p, registry).unwrap());
    vm.start();
    vm
}

#[test]
fn explicit_registration_offline_example_and_jit_fallback() {
    for blocking in [false, true] {
        for interpreter in [false, true] {
            let p = project(text("[1,true,\"猫\",null]"), movement());
            assert!(
                format!("{:#}", Program::compile(&p).unwrap_err())
                    .contains("unregistered extension")
            );
            let mut registry = ExtensionRegistry::new();
            registry
                .register(JsonParse::schema(blocking), Rc::new(JsonParse))
                .unwrap();
            let mut vm = vm(&registry, &p);
            if interpreter {
                vm.disable_jit();
            }
            frame(&mut vm);
            assert_eq!(
                vm.debug_snapshot()["variables"]["output"],
                json!([1.0, true, "猫", null])
            );
            if blocking {
                assert_eq!(
                    vm.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
                    0.0
                );
                frame(&mut vm);
            }
            assert_eq!(
                vm.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
                42.0
            );
            assert!(frame(&mut vm).extension_requests.is_empty());
        }
    }
}

#[test]
fn remote_pending_once_completion_types_errors_restart_and_stale_replies() {
    let mut registry = ExtensionRegistry::new();
    registry.register_remote(JsonParse::schema(true)).unwrap();
    let mut vm = vm(&registry, &project(text("7"), movement()));
    let first = frame(&mut vm).extension_requests[0].clone();
    assert_eq!(frame(&mut vm).extension_requests[0].id, first.id);
    assert_eq!(
        vm.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
        0.0
    );
    assert!(
        vm.complete_extension(first.id, Err("parse failed".into()))
            .is_err()
    );
    assert!(
        vm.complete_extension(first.id, Ok(json!({"not":"supported"})))
            .is_err()
    );
    assert!(vm.complete_extension(first.id, Ok(json!(7))).unwrap());
    assert!(!vm.complete_extension(first.id, Ok(json!(9))).unwrap());
    frame(&mut vm);
    assert_eq!(vm.debug_snapshot()["variables"]["output"], 7.0);
    assert_eq!(
        vm.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
        42.0
    );
    vm.start();
    let old = frame(&mut vm).extension_requests[0].id;
    vm.start();
    let new = frame(&mut vm).extension_requests[0].id;
    assert!(new > old);
    assert!(!vm.complete_extension(old, Ok(json!(3))).unwrap());
    assert!(vm.complete_extension(new, Ok(json!(4))).unwrap());
}

#[derive(Debug)]
struct Pending;
impl Extension for Pending {
    fn call(&self, _: &ExtensionRequest) -> anyhow::Result<CallResult> {
        Ok(CallResult::Pending)
    }
}

#[test]
fn rejects_invalid_schemas_capabilities_inputs_results_and_nonblocking_pending() {
    let mut r = ExtensionRegistry::new();
    let mut s = JsonParse::schema(false);
    assert!(r.register_remote(s.clone()).is_err());
    s.api_version = 2;
    assert!(r.register(s.clone(), Rc::new(JsonParse)).is_err());
    s = JsonParse::schema(false);
    s.network = true;
    assert!(r.register(s.clone(), Rc::new(JsonParse)).is_err());
    r.set_allow_network(true);
    r.register(s, Rc::new(JsonParse)).unwrap();
    assert!(
        r.register(JsonParse::schema(false), Rc::new(JsonParse))
            .is_err()
    );
    assert!(ValueType::Number.validate(&json!("1")).is_err());
    assert!(ValueType::Any.validate(&json!({})).is_err());
    let mut r = ExtensionRegistry::new();
    r.register(JsonParse::schema(false), Rc::new(Pending))
        .unwrap();
    let mut v = vm(&r, &project(text("1"), movement()));
    assert!(
        v.advance(0.016, 1000, Duration::from_secs(1))
            .unwrap_err()
            .to_string()
            .contains("nonblocking")
    );
    let mut r = ExtensionRegistry::new();
    r.register(JsonParse::schema(false), Rc::new(JsonParse))
        .unwrap();
    for input in [
        text("invalid"),
        text("{\"a\":1}"),
        json!({"type":"math_number","fields":{"NUM":1}}),
    ] {
        assert!(
            vm(&r, &project(input, movement()))
                .advance(0.016, 1000, Duration::from_secs(1))
                .is_err()
        );
    }
    let mut p = project(text("1"), movement());
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["fields"]["result"] =
        json!("missing");
    assert!(Program::compile_with_extensions(&p, &r).is_err());
    // Reading an undeclared result ID must not declare it as a side effect.
    let mut schema = JsonParse::schema(false);
    schema.parameters[0].value_type = ValueType::Any;
    let mut r = ExtensionRegistry::new();
    r.register(schema, Rc::new(JsonParse)).unwrap();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["inputs"]["text"] =
        json!({"type":"variables_get","fields":{"variable":"missing"}});
    assert!(Program::compile_with_extensions(&p, &r).is_err());
}

#[test]
fn cancelled_requests_do_not_exhaust_capacity_in_the_same_tick() {
    let mut registry = ExtensionRegistry::new();
    registry.register_remote(JsonParse::schema(true)).unwrap();
    let mut p = project(text("8"), movement());
    let original = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
    let call = original["nekoBlockJsonList"][0].clone();
    let mut roots = vec![call.clone(); 256];
    roots.push(json!({"type":"on_running_group_activated","next":{
        "type":"stop","fields":{"scope":"2"},"next":call["next"]
    }}));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!(roots);
    let mut engine = vm(&registry, &p);
    assert_eq!(frame(&mut engine).extension_requests.len(), 1);
}

#[test]
fn pending_call_does_not_suspend_other_scripts_and_stopped_task_cancels_reply() {
    let mut registry = ExtensionRegistry::new();
    registry.register_remote(JsonParse::schema(true)).unwrap();
    let mut p = project(text("8"), movement());
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"].as_array_mut().unwrap().push(json!({
        "type":"on_running_group_activated","next":{
            "type":"self_move_to","inputs":{"x":{"type":"math_number","fields":{"NUM":13}},"y":{"type":"math_number","fields":{"NUM":0}}}
        }
    }));
    let mut engine = vm(&registry, &p);
    let f = frame(&mut engine);
    assert_eq!(f.extension_requests.len(), 1);
    assert_eq!(
        engine.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
        13.0
    );
    assert!(
        engine
            .complete_extension(f.extension_requests[0].id, Ok(json!(8)))
            .unwrap()
    );
    frame(&mut engine);
    assert_eq!(
        engine.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
        42.0
    );

    // A stop-all script after the caller cancels the pending call in the same tick.
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][1]["next"] =
        json!({"type":"stop","fields":{"scope":"0"}});
    let mut engine = vm(&registry, &p);
    assert!(frame(&mut engine).extension_requests.is_empty());
    assert!(!engine.complete_extension(1, Ok(json!(8))).unwrap());
}

#[derive(Debug)]
struct Command;
impl Extension for Command {
    fn call(&self, _: &ExtensionRequest) -> anyhow::Result<CallResult> {
        Ok(CallResult::Ready(Value::Null))
    }
}

#[test]
fn command_without_return_and_native_pending_completion() {
    let mut schema = JsonParse::schema(false);
    schema.returns = None;
    let mut registry = ExtensionRegistry::new();
    registry.register(schema, Rc::new(Command)).unwrap();
    let mut p = project(text("ignored"), movement());
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["fields"]["result"] =
        json!("");
    let mut engine = vm(&registry, &p);
    frame(&mut engine);
    assert_eq!(
        engine.debug_snapshot()["actors"]["nekoc-default-actor"]["x"],
        42.0
    );
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]["fields"]["result"] =
        json!("output");
    assert!(Program::compile_with_extensions(&p, &registry).is_err());

    let mut registry = ExtensionRegistry::new();
    registry
        .register(JsonParse::schema(true), Rc::new(Pending))
        .unwrap();
    let mut engine = vm(&registry, &p);
    // Native pending calls are not sent to a JS host.
    assert!(frame(&mut engine).extension_requests.is_empty());
    assert!(engine.complete_extension(1, Ok(json!(12))).unwrap());
    frame(&mut engine);
    assert_eq!(engine.debug_snapshot()["variables"]["output"], 12.0);
}
