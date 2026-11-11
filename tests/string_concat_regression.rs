//! Original synthetic programs for immutable/deferred text concatenation.
//! Keep semantic assertions in addition to interpreter/native differential checks:
//! the two execution tiers can otherwise agree on the same aliasing mistake.
use nekoc::engine::{Cell, Engine, Program, encode_frame};
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc, time::Duration};

const ITERATIONS: usize = 900;

fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}

fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}

fn get(id: &str) -> Value {
    json!({"type":"variables_get","fields":{"variable":id}})
}

fn set(id: &str, value: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":id},"inputs":{"value":value}})
}

fn list(id: &str) -> Value {
    json!({"type":"pure_list_get","fields":{"list":id}})
}

fn append(target: Value, value: Value) -> Value {
    json!({"type":"list_append","inputs":{"list":target,"list_item_value":value}})
}

fn arithmetic(op: &str, a: Value, b: Value) -> Value {
    json!({"type":"math_arithmetic","fields":{"type":op},"inputs":{"A":a,"B":b}})
}

fn join(parts: Vec<Value>) -> Value {
    let inputs: serde_json::Map<String, Value> = parts
        .into_iter()
        .enumerate()
        .map(|(i, value)| (format!("ADD{i}"), value))
        .collect();
    json!({"type":"text_join","inputs":inputs})
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

fn variable(p: &mut Value, id: &str, initial: Value) {
    p["variables"]["variablesDict"][id] =
        json!({"id":id,"name":id,"isGlobal":true,"value":initial});
}

fn list_variable(p: &mut Value, id: &str, initial: Value) {
    variable(p, id, initial);
    p["variables"]["variablesDict"][id]["type"] = json!("list");
}

fn project(k4: bool, body: Value) -> Value {
    let mut p = nekoc::studio::document::Document::blank().value().clone();
    if k4 {
        // Importer-validated provenance selects K4 semantics. Reuse only that
        // marker, not any third-party script, asset, actor, or variable.
        let source: Value =
            serde_json::from_str(include_str!("fixtures/kitten4/actor-variables.bcm")).unwrap();
        let imported = nekoc::kitten4::to_neko(&source).unwrap();
        p["_nekocKitten4"] = imported["_nekocKitten4"].clone();
    }
    variable(&mut p, "tick", json!(0));
    let body = chain(vec![
        json!({"type":"change_variables","fields":{"variable":"tick"},"inputs":{"value":num(1.0)}}),
        body,
    ]);
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":num(ITERATIONS as f64)},"statements":{"DO":body}
        }}}
    }]);
    p
}

fn normalized(bytes: &[u8]) -> (Value, Vec<u8>) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let mut meta: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    for key in ["execute_us", "budget_yield"] {
        meta.as_object_mut().unwrap().remove(key);
    }
    (meta, bytes[4 + length..].to_vec())
}

fn compare_hot(p: &Value, mut expect: impl FnMut(&Engine)) {
    let compiled = || Engine::new(Program::compile(p).unwrap());
    let mut interpreter = compiled();
    interpreter.disable_jit();
    let mut native = compiled();
    native.enable_jit_profile();
    // Retain compiled regions over start(), but reset all text/list values.
    for restart in 0..2 {
        for vm in [&mut interpreter, &mut native] {
            vm.set_random_seed(0x9E37_79B9_7F4A_7C15);
            // Compare instruction-boundary state, not host-dependent KN 4 ms
            // warp slices (native compilation may itself cross that deadline).
            vm.use_virtual_clock();
            vm.start();
        }
        let mut finished = false;
        for frame in 0..10_000 {
            // Force suspension inside the hot loop, not only at completion.
            let a = interpreter
                .advance(1.0 / 60.0, 73, Duration::from_secs(5))
                .unwrap();
            let b = native
                .advance(1.0 / 60.0, 73, Duration::from_secs(5))
                .unwrap();
            assert_eq!(
                interpreter.jit_debug_snapshot(),
                native.jit_debug_snapshot(),
                "precise state: restart {restart}, frame {frame}"
            );
            assert_eq!(
                interpreter.debug_snapshot(),
                native.debug_snapshot(),
                "values: restart {restart}, frame {frame}"
            );
            assert_eq!(
                normalized(&encode_frame(&a).unwrap()),
                normalized(&encode_frame(&b).unwrap()),
                "frame output: restart {restart}, frame {frame}"
            );
            assert_eq!(a.budget_yield, b.budget_yield);
            assert_eq!(interpreter.active_tasks(), native.active_tasks());
            interpreter.recycle_lines(a.lines);
            native.recycle_lines(b.lines);
            if interpreter.active_tasks() == 0 {
                finished = true;
                break;
            }
        }
        assert!(finished, "unfinished restart {restart}");
        assert_eq!(native.variable_text("tick"), ITERATIONS.to_string());
        expect(&interpreter);
        expect(&native);
        let profile = native.jit_profile();
        assert!(profile["native_ops"].as_u64().unwrap() > 0, "{profile}");
        assert!(profile["regions"].as_u64().unwrap() > 0, "{profile}");
    }
}

#[test]
fn hot_self_assignment_preserves_variable_aliases_and_list_text_snapshots() {
    const PIECE: &str = "猫😀/";
    for k4 in [false, true] {
        for private in [false, true] {
            for prepend in [false, true] {
                let parts = if prepend {
                    vec![text(PIECE), get("s")]
                } else {
                    vec![get("s"), text(PIECE)]
                };
                let save = json!({"type":"controls_if","inputs":{"IF0":{
                    "type":"logic_compare","fields":{"OP":"EQ"},"inputs":{
                        "A":arithmetic("mod", get("tick"), num(300.0)),"B":num(0.0)
                    }
                }},"statements":{"DO0":append(list("history"), get("s"))}});
                let body = chain(vec![
                    set("alias", get("s")),
                    save,
                    set("s", join(parts)),
                    set("alias_branch", join(vec![get("alias"), text("!")])),
                    set("out", get("s")),
                    set(
                        "length",
                        json!({"type":"text_length","inputs":{"text":get("s")}}),
                    ),
                ]);
                let mut p = project(k4, body);
                variable(&mut p, "s", json!("seed"));
                if private {
                    p["variables"]["variablesDict"]["s"]["isGlobal"] = json!(false);
                    p["variables"]["variablesDict"]["s"]["currentEntityId"] =
                        json!("nekoc-default-actor");
                }
                for id in ["alias", "alias_branch", "out", "length"] {
                    variable(&mut p, id, json!(0));
                }
                list_variable(&mut p, "history", json!([]));
                let expected = |n: usize| {
                    if prepend {
                        format!("{}seed", PIECE.repeat(n))
                    } else {
                        format!("seed{}", PIECE.repeat(n))
                    }
                };
                compare_hot(&p, |vm| {
                    assert_eq!(vm.variable_text("out"), expected(ITERATIONS));
                    assert_eq!(vm.variable_text("alias"), expected(ITERATIONS - 1));
                    assert_eq!(
                        vm.variable_text("alias_branch"),
                        format!("{}!", expected(ITERATIONS - 1))
                    );
                    // The astral character counts as two UTF-16 units.
                    assert_eq!(vm.variable_text("length"), (4 + ITERATIONS * 4).to_string());
                    assert_eq!(
                        vm.debug_snapshot()["lists"]["history"],
                        json!([expected(299), expected(599), expected(899)])
                    );
                });
            }
        }
    }
}

#[test]
fn hot_k4_add_and_change_self_assignment_preserve_old_text() {
    for change in [false, true] {
        let update = if change {
            json!({"type":"change_variables","fields":{"variable":"s","method":"increase"},
                "inputs":{"value":text("x")}})
        } else {
            set("s", arithmetic("add", get("s"), text("x")))
        };
        let mut p = project(
            true,
            chain(vec![
                set("alias", get("s")),
                update,
                set("branch", arithmetic("add", get("alias"), num(2.0))),
                json!({"type":"controls_if","inputs":{"IF0":{
                    "type":"logic_compare","fields":{"OP":"EQ"},"inputs":{
                        "A":get("tick"),"B":num(850.0)
                    }
                }},"statements":{"DO0":append(list("history"), get("s"))}}),
            ]),
        );
        variable(&mut p, "s", json!("seed"));
        for id in ["alias", "branch"] {
            variable(&mut p, id, json!(""));
        }
        list_variable(&mut p, "history", json!([]));
        compare_hot(&p, |vm| {
            assert_eq!(vm.variable_text("s"), format!("seed{}", "x".repeat(900)));
            assert_eq!(
                vm.variable_text("alias"),
                format!("seed{}", "x".repeat(899))
            );
            assert_eq!(
                vm.variable_text("branch"),
                format!("seed{}2", "x".repeat(899))
            );
            assert_eq!(
                vm.debug_snapshot()["lists"]["history"],
                json!([format!("seed{}", "x".repeat(850))])
            );
        });
    }
}

#[test]
fn hot_mixed_join_and_addition_keep_exact_coercions() {
    for k4 in [false, true] {
        let body = chain(vec![
            set("pair", join(vec![get("prefix"), get("items")])),
            set(
                "mixed",
                join(vec![
                    get("pair"),
                    text("|"),
                    get("flag"),
                    text("|"),
                    get("n"),
                    text("|"),
                    get("empty"),
                    text("|"),
                    get("nested"),
                ]),
            ),
            set("numeric_text_add", arithmetic("add", text("12"), get("n"))),
            set("list_add", arithmetic("add", get("items"), num(2.0))),
            set("bool_add", arithmetic("add", get("flag"), num(2.0))),
            set("empty_join", join(vec![])),
            set("single_join", join(vec![get("mixed")])),
        ]);
        let mut p = project(k4, body);
        for (id, initial) in [
            ("prefix", json!("P:")),
            ("items", json!([1, true, "猫", [7]])),
            ("nested", json!([[], [2, false], ""])),
            ("flag", json!(true)),
            ("n", json!(3)),
            ("empty", json!(null)),
        ] {
            variable(&mut p, id, initial);
        }
        for id in [
            "pair",
            "mixed",
            "numeric_text_add",
            "list_add",
            "bool_add",
            "empty_join",
            "single_join",
        ] {
            variable(&mut p, id, json!(0));
        }
        compare_hot(&p, |vm| {
            assert_eq!(vm.variable_text("pair"), "P:1,true,猫,7");
            // A null initial scalar declaration uses the VM's numeric-zero slot.
            // Cell-level null stringification is covered separately below.
            assert_eq!(
                vm.variable_text("mixed"),
                "P:1,true,猫,7|true|3|0|,2,false,"
            );
            assert_eq!(vm.variable_text("single_join"), vm.variable_text("mixed"));
            assert_eq!(vm.variable_text("empty_join"), "");
            assert!(matches!(vm.variable_value("empty_join"), Cell::Text(_)));
            assert_eq!(
                vm.variable_text("numeric_text_add"),
                if k4 { "123" } else { "15" }
            );
            assert_eq!(
                vm.variable_text("list_add"),
                if k4 { "1,true,猫,72" } else { "NaN" }
            );
            assert_eq!(vm.variable_text("bool_add"), "3");
        });
    }
}

#[test]
fn hot_kn_text_left_join_preserves_undefined_cutoff_and_right_side_effects() {
    let missing = json!({"type":"_object_get","inputs":{
        "obj":{"type":"_object_literal","inputs":{}},"key":text("absent")
    }});
    let mut p = project(
        false,
        chain(vec![
            set("trace", text("")),
            set(
                "left_missing",
                join(vec![missing.clone(), reporter("side")]),
            ),
            set("right_missing", join(vec![get("s"), missing.clone()])),
            set("empty_right", join(vec![text(""), missing])),
        ]),
    );
    for id in ["trace", "left_missing", "right_missing", "empty_right"] {
        variable(&mut p, id, json!(""));
    }
    variable(&mut p, "s", json!("keep猫"));
    p["procedures"]["proceduresDict"]["side"] = procedure(chain(vec![
        set("trace", join(vec![get("trace"), text("R")])),
        returned(text("discarded")),
    ]));
    compare_hot(&p, |vm| {
        assert_eq!(vm.variable_text("left_missing"), "");
        assert_eq!(vm.variable_text("right_missing"), "keep猫");
        assert_eq!(vm.variable_text("empty_right"), "");
        assert_eq!(vm.variable_text("trace"), "R");
    });
}

fn reporter(id: &str) -> Value {
    json!({"type":"procedures_2_callreturn","mutation":format!("<mutation def_id=\"{id}\"/>")})
}

fn procedure(body: Value) -> Value {
    json!({"params":[],"nekoBlockJsonList":[{
        "type":"procedures_2_defreturn","statements":{"STACK":body}
    }]})
}

fn returned(value: Value) -> Value {
    json!({"type":"procedures_2_return_value","mutation":"<mutation items=\"1\"/>",
        "inputs":{"VALUE":value},"shadows":{"VALUE":num(0.0)}})
}

fn replace_first(value: Value) -> Value {
    json!({"type":"replace_list_item","fields":{"item":"any"},"inputs":{
        "list":list("items"),"list_index":num(1.0),"list_item_value":value
    }})
}

#[test]
fn hot_join_reporters_run_left_to_right_and_freeze_each_list_operand_in_time() {
    for k4 in [false, true] {
        // Deliberately insert ADD10 before ADD2 and ADD0. Socket numbers, not
        // object insertion order or lexicographic order, determine evaluation.
        let multi = json!({"type":"text_join","inputs":{
            "ADD10":list("items"),"ADD2":reporter("right"),"ADD0":reporter("left")
        }});
        let reset = || {
            vec![
                set("trace", text("")),
                set("s", text("left")),
                replace_first(text("old")),
            ]
        };
        let mut ops = reset();
        ops.push(set("pair", join(vec![reporter("left"), reporter("right")])));
        ops.push(set("pair_trace", get("trace")));
        ops.extend(reset());
        ops.push(set("multi", multi));
        ops.push(set("multi_trace", get("trace")));
        ops.extend(reset());
        ops.push(set("text_pair", join(vec![get("s"), reporter("right")])));
        ops.push(set("text_trace", get("trace")));
        ops.extend(reset());
        ops.push(set(
            "added",
            arithmetic("add", reporter("left"), reporter("right")),
        ));
        ops.push(set("add_trace", get("trace")));
        let mut p = project(k4, chain(ops));
        list_variable(&mut p, "items", json!(["old", true, [7]]));
        for id in [
            "s",
            "trace",
            "pair",
            "pair_trace",
            "multi",
            "multi_trace",
            "text_pair",
            "text_trace",
            "added",
            "add_trace",
        ] {
            variable(&mut p, id, json!(""));
        }
        p["procedures"]["proceduresDict"]["left"] = procedure(chain(vec![
            set("trace", join(vec![get("trace"), text("L")])),
            returned(list("items")),
        ]));
        p["procedures"]["proceduresDict"]["right"] = procedure(chain(vec![
            set("trace", join(vec![get("trace"), text("R")])),
            replace_first(text("new")),
            set("s", text("changed")),
            returned(text("R")),
        ]));
        compare_hot(&p, |vm| {
            assert_eq!(vm.variable_text("pair"), "old,true,7R");
            assert_eq!(vm.variable_text("multi"), "old,true,7Rnew,true,7");
            assert_eq!(vm.variable_text("text_pair"), "leftR");
            assert_eq!(vm.variable_text("s"), "changed");
            for id in ["pair_trace", "multi_trace", "add_trace"] {
                assert_eq!(vm.variable_text(id), "LR", "{id}");
            }
            assert_eq!(vm.variable_text("text_trace"), "R");
            // K4 + converts the retained list only after the right reporter,
            // unlike text_join's per-operand conversion. KN + is numeric.
            assert_eq!(
                vm.variable_text("added"),
                if k4 { "new,true,7R" } else { "NaN" }
            );
            assert_eq!(
                vm.debug_snapshot()["lists"]["items"],
                json!(["new", true, [7.0]])
            );
        });
    }
}

#[test]
fn cell_concat_keeps_long_shared_text_immutable_and_snapshots_mutable_operands() {
    const PIECE: &str = "猫😀/";
    let mut value = Cell::Text("seed".into());
    let piece = Cell::Text(PIECE.into());
    let mut retained = Vec::new();
    for i in 0..16_384 {
        if i % 4096 == 0 {
            retained.push((i, value.clone()));
        }
        value = Cell::concat(&value, &piece);
    }
    let expected = format!("seed{}", PIECE.repeat(16_384));
    assert_eq!(value.text(), expected);
    assert_eq!(serde_json::to_value(&value).unwrap(), json!(expected));
    assert!(value.equals(&Cell::Text(expected.as_str().into())));
    for (n, old) in retained {
        assert_eq!(old.text(), format!("seed{}", PIECE.repeat(n)));
    }
    let doubled = Cell::concat(&value, &value);
    assert_eq!(doubled.text(), expected.repeat(2));
    assert_eq!(value.text(), expected);
    assert_eq!(
        Cell::concat(&Cell::Text("".into()), &value).text(),
        expected
    );
    assert_eq!(
        Cell::concat(&value, &Cell::Text("".into())).text(),
        expected
    );

    let items = Rc::new(RefCell::new(vec![value.clone(), Cell::Bool(true)]));
    let frozen = Cell::concat(&Cell::List(items.clone()), &Cell::Number(-0.0));
    items.borrow_mut()[0] = Cell::Text("replaced".into());
    items.borrow_mut().push(Cell::Number(99.0));
    assert_eq!(frozen.text(), format!("{expected},true0"));
    assert_eq!(value.text(), expected);

    let digits = Cell::concat(&Cell::Text("12".into()), &Cell::Text(".5".into()));
    assert_eq!(digits.number(), 12.5);
    assert!(digits.truth());
    assert!(digits.equals(&Cell::Text("12.5".into())));
    assert!(!digits.equals(&Cell::Number(12.5)));
    assert_eq!(digits.index_in(&[Cell::Text("12.5".into())]), Some(0));
}
