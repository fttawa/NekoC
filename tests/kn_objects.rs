use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc, time::Duration};

fn project() -> Value {
    serde_json::from_str(include_str!("fixtures/kn-semantics/objects.bcmkn")).unwrap()
}
fn get(name: &str) -> Value {
    json!({"type":"variables_get","fields":{"variable":name}})
}
fn n(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn key(k: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":k}})
}
fn prop(obj: Value, k: &str) -> Value {
    json!({"type":"_object_get","inputs":{"obj":obj,"key":key(k)}})
}
fn put(obj: Value, k: &str, v: Value) -> Value {
    json!({"type":"_object_set","inputs":{"obj":obj,"key":key(k),"value":v}})
}
fn set(name: &str, v: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":name},"inputs":{"value":v}})
}
fn chain(nodes: Vec<Value>) -> Value {
    nodes
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}
fn body(p: &mut Value, nodes: Vec<Value>) {
    p["actors"]["actorsDict"]["20000000-0000-4000-8000-000000000001"]["nekoBlockJsonList"][0]["next"] =
        chain(nodes);
}
fn run(p: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(p).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.enable_jit_profile();
    vm.use_virtual_clock();
    vm.start();
    for _ in 0..180 {
        vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
            .unwrap();
    }
    vm
}

#[test]
fn kn_objects_literal_alias_nested_list_and_missing() {
    for jit in [false, true] {
        let vm = run(&project(), jit);
        assert_eq!(vm.variable_value("read").number(), 9.0);
        assert_eq!(vm.variable_value("joined").text(), "[object Object]");
        assert_eq!(vm.variable_value("missing").number(), 0.0);
        assert_eq!(vm.variable_value("missingText").text(), "");
        assert!(vm.variable_value("same").truth());
        assert!(vm.variable_value("fresh").truth());
        assert!(vm.variable_value("obj").equals(&vm.variable_value("alias")));
        let Cell::List(items) = vm.variable_value("items") else {
            panic!()
        };
        assert!(items.borrow()[0].equals(&vm.variable_value("obj")));
        assert_eq!(
            serde_json::to_value(vm.variable_value("emptyStop")).unwrap(),
            json!({"a":1.0})
        );
        assert_eq!(
            serde_json::to_value(vm.variable_value("nonstring")).unwrap(),
            json!({"b":2.0})
        );
        assert_eq!(
            serde_json::to_value(vm.variable_value("duplicate")).unwrap(),
            json!({"a":2.0})
        );
    }
}

#[test]
fn kn_objects_matches_archived_official_case_in_both_tiers() {
    fn encoded(v: &Cell) -> Value {
        match v {
            Cell::Number(n) if !n.is_finite() => {
                json!({"$number":if n.is_nan(){"NaN"}else if *n>0.0{"Infinity"}else{"-Infinity"}})
            }
            Cell::Number(n) => json!(*n),
            Cell::Undefined => json!({"$undefined":true}),
            Cell::List(v) => Value::Array(v.borrow().iter().map(encoded).collect()),
            Cell::Object(v) => Value::Object(
                v.borrow()
                    .iter()
                    .map(|(k, v)| (k.clone(), encoded(v)))
                    .collect(),
            ),
            _ => serde_json::to_value(v).unwrap(),
        }
    }
    fn numbers(v: &Value) -> Value {
        match v {
            Value::Number(n) => json!(n.as_f64().unwrap()),
            Value::Array(v) => Value::Array(v.iter().map(numbers).collect()),
            Value::Object(v) => {
                Value::Object(v.iter().map(|(k, v)| (k.clone(), numbers(v))).collect())
            }
            _ => v.clone(),
        }
    }
    let report: Value =
        serde_json::from_str(include_str!("../docs/kn-objects-official.json")).unwrap();
    for jit in [false, true] {
        let vm = run(&project(), jit);
        for (id, expected) in report["cases"]["objects"]["variables"].as_object().unwrap() {
            assert_eq!(
                encoded(&vm.variable_value(id)),
                numbers(expected),
                "{id} jit={jit}"
            );
        }
    }
}

#[test]
fn kn_objects_hot_jit_side_exit_keeps_boxed_globals_and_lists() {
    let mut p = project();
    let literal = json!({"type":"_object_literal","inputs":{"key0":key("n"),"value0":n(0.0)}});
    let add = json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":prop(get("obj"),"n"),"B":n(1.0)}});
    body(
        &mut p,
        vec![
            set("obj", literal),
            json!({"type":"warp","statements":{"DO":json!({"type":"repeat_n_times","inputs":{"times":n(1200.0)},"statements":{"DO":chain(vec![
                put(get("obj"),"n",add), set("alias",get("obj")),
                json!({"type":"list_append","inputs":{"list":{"type":"pure_list_get","fields":{"list":"items"}},"list_item_value":get("obj")}}),
                json!({"type":"change_variables","fields":{"variable":"done","method":"increase"},"inputs":{"value":n(1.0)}})
            ])}})}}),
        ],
    );
    for jit in [false, true] {
        let vm = run(&p, jit);
        assert_eq!(
            serde_json::to_value(vm.variable_value("obj")).unwrap(),
            json!({"n":1200.0})
        );
        let Cell::List(items) = vm.variable_value("items") else {
            panic!()
        };
        assert_eq!(items.borrow().len(), 1200);
        assert!(
            items
                .borrow()
                .iter()
                .all(|v| v.equals(&vm.variable_value("obj")))
        );
        assert_eq!(vm.variable_value("done").number(), 1200.0);
        if jit {
            assert!(vm.jit_profile()["native_ops"].as_u64().unwrap() > 0);
        }
    }
}

#[test]
fn kn_objects_cyclic_clone_text_serialize_and_equality_are_safe() {
    let mut p = project();
    body(
        &mut p,
        vec![
            set("obj", json!({"type":"_object_literal","inputs":{}})),
            put(get("obj"), "self", get("obj")),
        ],
    );
    let vm = run(&p, true);
    let object = vm.variable_value("obj");
    assert_eq!(object.text(), "[object Object]");
    assert!(serde_json::to_value(&object).is_err());
    let Cell::Object(vm_props) = object else {
        panic!()
    };
    assert!(vm_props.borrow()[0].1.equals(&vm.variable_value("obj")));
    vm_props.borrow_mut().clear();
    let props = Rc::new(RefCell::new(vec![]));
    let obj = Cell::Object(props.clone());
    props.borrow_mut().push(("self".into(), obj.clone()));
    let copy = obj.deep_clone();
    assert!(!copy.equals(&obj));
    assert!(copy.k4_equals(&obj));
    assert_eq!(copy.text(), "[object Object]");
    assert!(
        serde_json::to_string(&copy)
            .unwrap_err()
            .to_string()
            .contains("cyclic")
    );
    let Cell::Object(copied) = &copy else {
        panic!()
    };
    assert!(copied.borrow()[0].1.equals(&copy));
    copied.borrow_mut().clear();
    props.borrow_mut().clear();
    let items = Rc::new(RefCell::new(vec![]));
    items.borrow_mut().push(Cell::List(items.clone()));
    assert_eq!(Cell::List(items.clone()).text(), "");
    assert!(serde_json::to_value(Cell::List(items.clone())).is_err());
    items.borrow_mut().clear();
}

#[test]
fn kn_objects_initialize_from_json() {
    let mut p = project();
    p["variables"]["variablesDict"]["obj"]["value"] = json!({"x":{"n":2}});
    body(&mut p, vec![set("read", prop(prop(get("obj"), "x"), "n"))]);
    assert_eq!(run(&p, false).variable_value("read").number(), 2.0);
    // JSON value-level deep copy retains nested identity within one graph.
    let initial = Cell::from_json(&json!({"a":[1,{"b":2}]})).unwrap();
    assert!(initial.k4_equals(&initial.deep_clone()));
}

#[test]
fn kn_objects_do_not_enable_json_objects_in_k4_initial_values() {
    let source: Value =
        serde_json::from_str(include_str!("fixtures/kitten4/k4fix-fill.bcm")).unwrap();
    let mut p = nekoc::kitten4::to_neko(&source).unwrap();
    p["variables"]["variablesDict"]["object"] =
        json!({"id":"object","value":[{"x":1}],"type":"list","isGlobal":true});
    let error = match Program::compile(&p) {
        Ok(_) => panic!("K4 objects must stay rejected"),
        Err(e) => e,
    };
    assert!(format!("{error:#}").contains("object values are not supported by K4"));
}

#[test]
fn kn_objects_json_keys_and_roundtrip() {
    let p: Value =
        serde_json::from_str(include_str!("fixtures/kn-semantics/object-json.bcmkn")).unwrap();
    for jit in [false, true] {
        let vm = run(&p, jit);
        assert_eq!(
            serde_json::to_value(vm.variable_value("keys")).unwrap(),
            json!(["1", "2", "z", "a"])
        );
        assert_eq!(
            vm.variable_value("json").text(),
            "{\"1\":3,\"2\":2,\"z\":1,\"a\":[true,null,\"猫\"]}"
        );
        assert_eq!(vm.variable_value("bad").number(), 0.0);
        assert_eq!(
            serde_json::to_value(vm.variable_value("scalarKeys")).unwrap(),
            json!([])
        );
    }
}
