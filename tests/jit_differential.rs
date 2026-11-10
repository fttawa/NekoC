//! The native tier must be indistinguishable from the interpreter: same project and
//! input, byte-identical frames (minus wall-clock fields) on every update.
use nekoc::engine::{Engine, Program, encode_frame};
use serde_json::Value;
use std::time::Duration;

const FRAMES: usize = 2400;

fn engine(project: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.set_random_seed(0x9E37_79B9_7F4A_7C15);
    vm.start();
    vm
}

/// Frame JSON with the fields that legitimately depend on timing removed.
fn normalized(bytes: &[u8]) -> (Value, Vec<u8>) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let mut meta: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    let object = meta.as_object_mut().unwrap();
    for key in ["execute_us", "budget_yield"] {
        object.remove(key);
    }
    (meta, bytes[4 + length..].to_vec())
}

fn compare(name: &str, keys: &[&str]) {
    compare_with(name, keys, &[], None);
}

fn compare_with(name: &str, keys: &[&str], tapped: &[&str], expect_positive: Option<&str>) {
    let path = name;
    let text = std::fs::read_to_string(path).unwrap();
    let project: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
    let mut a = engine(&project, false);
    let mut b = engine(&project, true);
    let pressed: std::collections::BTreeSet<String> = keys.iter().map(|k| k.to_string()).collect();
    for vm in [&mut a, &mut b] {
        vm.set_pressed_keys(pressed.iter().cloned());
    }
    // A generous budget: scheduling must not depend on the host's speed here.
    let budget = Duration::from_secs(5);
    for frame in 0..FRAMES {
        if frame == 120 {
            for vm in [&mut a, &mut b] {
                vm.set_pressed_keys(tapped.iter().map(|k| k.to_string()));
                for key in tapped {
                    vm.key(key);
                }
            }
        }
        // Releasing the key is what most projects react to.
        if frame == 122 {
            for vm in [&mut a, &mut b] {
                vm.set_pressed_keys(pressed.iter().cloned());
            }
        }
        let x = a.advance(1.0 / 60.0, 200_000_000, budget);
        let y = b.advance(1.0 / 60.0, 200_000_000, budget);
        match (x, y) {
            (Ok(x), Ok(y)) => {
                let left = normalized(&encode_frame(&x).unwrap());
                let right = normalized(&encode_frame(&y).unwrap());
                if left.0 != right.0 {
                    let (l, r) = (left.0.as_object().unwrap(), right.0.as_object().unwrap());
                    let differing: Vec<_> = l.keys().filter(|k| l[*k] != r[*k]).collect();
                    let detail: Vec<String> = differing
                        .iter()
                        .take(3)
                        .map(|k| {
                            let cut =
                                |v: &Value| v.to_string().chars().take(400).collect::<String>();
                            format!("{k}: {} <> {}", cut(&l[*k]), cut(&r[*k]))
                        })
                        .collect();
                    panic!(
                        "{name}: metadata diverged at frame {frame}: {differing:?}\n{detail:#?}"
                    );
                }
                assert!(
                    left.1 == right.1,
                    "{name}: pen lines diverged at frame {frame}"
                );
                a.recycle_lines(x.lines);
                b.recycle_lines(y.lines);
            }
            (Err(x), Err(y)) => {
                assert_eq!(x.to_string(), y.to_string(), "{name}: errors differ");
                return;
            }
            (x, y) => panic!("{name}: frame {frame}: {:?} <> {:?}", x.err(), y.err()),
        }
    }
    if let Some(variable) = expect_positive {
        let id = project["variables"]["variablesDict"]
            .as_object()
            .unwrap()
            .iter()
            .find(|(_, v)| v["name"] == variable)
            .map(|(id, _)| id.as_str())
            .unwrap();
        let slot = a
            .program
            .variable_names
            .iter()
            .position(|n| n == id || n == variable)
            .unwrap();
        assert!(
            a.numeric_variables()[slot] > 0.0,
            "{name}: {variable} stayed at zero"
        );
    }
}

#[test]
fn pencraft_matches_interpreter() {
    compare("projects/pencraft/pencraft.bcmkn", &["87", "39"]);
}
#[test]
fn polyhedron_matches_interpreter() {
    compare("samples/pen_polyhedron.bcmkn", &[]);
}
#[test]
fn pen_display_matches_interpreter() {
    compare("samples/pen_display_fast.bcmkn", &[]);
}
#[test]
fn columns_match_interpreter() {
    compare("samples/pen_display_columns.bcmkn", &[]);
}
#[test]
fn starhold_matches_interpreter() {
    compare("projects/starhold/starhold.bcmkn", &[]);
}
#[test]
fn native_studio_matches_interpreter() {
    compare("samples/native-studio.bcmkn", &[]);
}
#[test]
fn tiny_lm_generation_matches_interpreter() {
    compare_with(
        "projects/tiny-lm/tiny_lm.bcmkn",
        &[],
        &["51"],
        Some("lm_generated"),
    );
}
#[test]
fn list_writes_match_interpreter() {
    compare("tests/fixtures/list_writes.bcmkn", &[]);
}

#[test]
fn nonfinite_values_match_interpreter() {
    for name in ["kn.bcmkn", "kn-list.bcmkn", "kitten4.bcm"] {
        let loaded =
            nekoc::project::load_project(format!("tests/fixtures/nonfinite/{name}")).unwrap();
        let project = if nekoc::kitten4::is_kitten4(&loaded.value) {
            nekoc::kitten4::to_neko(&loaded.value).unwrap()
        } else {
            loaded.value
        };
        let mut a = engine(&project, false);
        let mut b = engine(&project, true);
        // Repeated starts heat native regions while also exercising reset.
        for _ in 0..10 {
            a.start();
            b.start();
            for frame in 0..1000 {
                let x = a
                    .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
                    .unwrap();
                let y = b
                    .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
                    .unwrap();
                assert_eq!(
                    normalized(&encode_frame(&x).unwrap()),
                    normalized(&encode_frame(&y).unwrap()),
                    "{name}, frame {frame}"
                );
            }
        }
    }
}

#[test]
fn nonfinite_arithmetic_in_hot_native_loop_matches_reference() {
    use nekoc::{runtime::RuntimeValue, studio::document::Document};
    use serde_json::json;
    let num = |n: f64| json!({"type":"math_number","fields":{"NUM":n}});
    let get = |s| json!({"type":"variables_get","fields":{"variable":s}});
    let binary =
        |op, a, b| json!({"type":"math_arithmetic","fields":{"type":op},"inputs":{"A":a,"B":b}});
    let mut p = Document::blank().value().clone();
    for (id, n) in [
        ("zero", 0),
        ("one", 1),
        ("nan", 0),
        ("inf", 0),
        ("neg", 0),
        ("rem", 0),
        ("huge", 0),
    ] {
        p["variables"]["variablesDict"][id] = json!({"id":id,"name":id,"value":n});
    }
    let mut body = json!({"type":"self_set_position_x","inputs":{"value":get("nan")}});
    for (id, value) in [
        ("nan", binary("divide", get("zero"), get("zero"))),
        ("inf", binary("divide", get("one"), get("zero"))),
        ("neg", binary("divide", num(-1.0), get("zero"))),
        ("rem", binary("mod", get("one"), get("zero"))),
        ("huge", binary("multiply", num(1e308), num(1e308))),
    ]
    .into_iter()
    .rev()
    {
        body = json!({"type":"variables_set","fields":{"variable":id},"inputs":{"value":value},"next":body});
    }
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{"type":"repeat_n_times","inputs":{"times":num(500.0)},"statements":{"DO":body}}
    }]);
    let mut a = engine(&p, false);
    let mut b = engine(&p, true);
    for _ in 0..2100 {
        let x = a
            .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
            .unwrap();
        let y = b
            .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(
            normalized(&encode_frame(&x).unwrap()),
            normalized(&encode_frame(&y).unwrap())
        );
    }
    let reference = nekoc::runtime::run_project(&p, 2100).unwrap();
    for id in ["nan", "inf", "neg", "rem", "huge"] {
        let slot = a
            .program
            .variable_names
            .iter()
            .position(|n| n == id)
            .unwrap();
        let expected = match &reference.variables[id] {
            RuntimeValue::Number(n) => *n,
            other => panic!("{other:?}"),
        };
        let left = a.numeric_variables()[slot];
        let right = b.numeric_variables()[slot];
        if matches!(id, "nan" | "rem") {
            assert!(expected.is_nan() && left.is_nan() && right.is_nan());
        } else {
            assert_eq!(left, expected);
            assert_eq!(right, expected);
            assert!(expected.is_infinite());
        }
    }
}

fn num(n: f64) -> Value {
    serde_json::json!({"type":"math_number","fields":{"NUM":n}})
}

fn get(id: &str) -> Value {
    serde_json::json!({"type":"variables_get","fields":{"variable":id}})
}

fn set(id: &str, value: Value) -> Value {
    serde_json::json!({"type":"variables_set","fields":{"variable":id},"inputs":{"value":value}})
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

fn private_project(body: Value, initial: Value, k4: bool) -> Value {
    let mut p = nekoc::studio::document::Document::blank().value().clone();
    if k4 {
        // RuntimeSemantics uses validated importer provenance, not a toolType or
        // an ad-hoc flag. Keep the source intact; edit only the in-memory KN form.
        let source: Value =
            serde_json::from_str(include_str!("fixtures/kitten4/actor-variables.bcm")).unwrap();
        let imported = nekoc::kitten4::to_neko(&source).unwrap();
        p["_nekocKitten4"] = imported["_nekocKitten4"].clone();
    }
    p["variables"]["variablesDict"]["private"] = serde_json::json!({
        "id":"private","name":"private","type":"any","value":initial,
        "isGlobal":false,"currentEntityId":"nekoc-default-actor"
    });
    for id in [
        "out",
        "compared",
        "after",
        "tick",
        "numeric",
        "typed_compared",
    ] {
        p["variables"]["variablesDict"][id] =
            serde_json::json!({"id":id,"value":0,"isGlobal":true});
    }
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = serde_json::json!([{
        "type":"on_running_group_activated","next":{"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":body}
        }}}
    }]);
    p
}

/// Run beyond the heat threshold, compare full entity cells as well as frames,
/// then restart with the same compiled regions to catch stale entity/list handles.
fn compare_hot(project: &Value, error: Option<&str>) -> Engine {
    let mut a = engine(project, false);
    let mut b = engine(project, true);
    b.enable_jit_profile();
    for restart in 0..2 {
        a.start();
        b.start();
        let mut failed = false;
        let mut finished = false;
        for frame in 0..1000 {
            let x = a.advance(1.0 / 60.0, 100_000, Duration::from_secs(5));
            let y = b.advance(1.0 / 60.0, 100_000, Duration::from_secs(5));
            assert_eq!(
                a.debug_snapshot(),
                b.debug_snapshot(),
                "restart {restart} frame {frame}"
            );
            match (x, y) {
                (Ok(x), Ok(y)) => {
                    assert_eq!(
                        normalized(&encode_frame(&x).unwrap()),
                        normalized(&encode_frame(&y).unwrap())
                    );
                    assert_eq!(x.budget_yield, y.budget_yield);
                    a.recycle_lines(x.lines);
                    b.recycle_lines(y.lines);
                    assert_eq!(a.active_tasks(), b.active_tasks());
                    if a.active_tasks() == 0 {
                        finished = true;
                        break;
                    }
                }
                (Err(x), Err(y)) => {
                    assert_eq!(x.to_string(), y.to_string());
                    assert!(
                        x.to_string().contains(error.expect("unexpected error")),
                        "{x:#}"
                    );
                    failed = true;
                    break;
                }
                (x, y) => panic!("different results: {:?} <> {:?}", x.err(), y.err()),
            }
        }
        assert_eq!(failed, error.is_some());
        assert!(
            failed || finished,
            "hot project did not finish on restart {restart}"
        );
        let profile = b.jit_profile();
        assert!(profile["native_ops"].as_u64().unwrap() > 0, "{profile}");
        assert!(profile["regions"].as_u64().unwrap() > 0, "{profile}");
    }
    b
}

#[test]
fn hot_private_numeric_reads_writes_and_comparisons_match() {
    use serde_json::json;
    for k4 in [false, true] {
        let body = chain(vec![
            json!({"type":"change_variables","fields":{"variable":"private"},"inputs":{"value":num(2.0)}}),
            set("out", get("private")),
            set(
                "numeric",
                json!({"type":"math_arithmetic","fields":{"type":"multiply"},"inputs":{"A":get("private"),"B":num(3.0)}}),
            ),
            set(
                "compared",
                json!({"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":get("private"),"B":num(10.0)}}),
            ),
        ]);
        let vm = compare_hot(&private_project(body, json!(0), k4), None);
        assert_eq!(vm.variable_text("out"), "1800", "k4={k4}");
        assert_eq!(vm.variable_text("numeric"), "5400", "k4={k4}");
        assert_eq!(vm.variable_text("compared"), "true", "k4={k4}");
    }
}

#[test]
fn hot_private_type_changes_preserve_typed_comparisons() {
    use serde_json::json;
    for k4 in [false, true] {
        for initial in [json!("12"), json!(true), json!(null), json!([1, 2])] {
            let body = chain(vec![
                // Alternate numeric and typed cells on every hot iteration, so
                // neither a cached unbox nor initial-value-only tests can pass.
                set("private", num(12.0)),
                set(
                    "compared",
                    json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("private"),"B":num(12.0)}}),
                ),
                set("private", get("typed")),
                set(
                    "typed_compared",
                    json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("private"),"B":num(12.0)}}),
                ),
                set("out", get("private")),
            ]);
            let mut p = private_project(body, initial.clone(), k4);
            p["variables"]["variablesDict"]["typed"] =
                json!({"id":"typed","value":initial,"isGlobal":true});
            let vm = compare_hot(&p, None);
            assert_eq!(vm.variable_text("compared"), "true");
            assert_eq!(vm.variable_text("typed_compared"), "false");
            assert_eq!(vm.variable_text("out"), vm.variable_text("typed"));
        }
    }
}

#[test]
fn hot_private_and_global_lists_keep_index_and_cell_semantics() {
    use serde_json::json;
    for k4 in [false, true] {
        for private in [false, true] {
            for (index, kn_expected, k4_expected) in [
                (-3.0, "12", "12"),
                (-1.0, "12", "7"),
                (0.0, "12", "NaN"),
                (1.4, "12", "NaN"),
                (1.5, "true", "NaN"),
                (2.0, "true", "true"),
                (3.0, "7", "7"),
                (4.0, "NaN", "NaN"),
            ] {
                // K4 rejects these indices; exercise them only after heating in the
                // boundary test below, rather than failing before native code runs.
                if k4 && [0.0, 1.4, 1.5, 4.0].contains(&index) {
                    continue;
                }
                let list = if private {
                    get("private")
                } else {
                    json!({"type":"pure_list_get","fields":{"list":"items"}})
                };
                let item = json!({"type":"list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":num(index)}});
                let body = chain(vec![
                    set("out", item.clone()),
                    set(
                        "numeric",
                        json!({"type":"math_arithmetic","fields":{"type":"multiply"},"inputs":{"A":item.clone(),"B":num(2.0)}}),
                    ),
                    set(
                        "compared",
                        json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":item.clone(),"B":num(12.0)}}),
                    ),
                    set(
                        "typed_compared",
                        json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":item,"B":{"type":"text","fields":{"TEXT":"12"}}}}),
                    ),
                    set(
                        "after",
                        json!({"type":"list_length","inputs":{"list":list}}),
                    ),
                ]);
                let mut p = private_project(body, json!(["12", true, [7]]), k4);
                p["variables"]["variablesDict"]["items"] = json!({"id":"items","name":"items","type":"list","isGlobal":true,"value":["12",true,[7]]});
                let vm = compare_hot(&p, None);
                assert_eq!(
                    vm.variable_text("out"),
                    if k4 { k4_expected } else { kn_expected },
                    "k4={k4}, private={private}, index={index}"
                );
                assert_eq!(vm.variable_text("after"), "3");
                assert_eq!(vm.variable_text("compared"), "false");
                assert_eq!(
                    vm.variable_text("typed_compared"),
                    if vm.variable_text("out") == "12" {
                        "true"
                    } else {
                        "false"
                    }
                );
            }
        }
    }
}

#[test]
fn hot_list_errors_stop_at_the_same_boundary() {
    use serde_json::json;
    for k4 in [false, true] {
        for private in [false, true] {
            for invalid in [
                num(0.0),
                num(1.4),
                num(4.0),
                json!({"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{"A":num(0.0),"B":num(0.0)}}),
                json!({"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{"A":num(1.0),"B":num(0.0)}}),
            ] {
                let nonfinite = invalid["type"] == "math_arithmetic";
                let out_of_range = invalid["fields"]["NUM"] == 4.0;
                let list = if private {
                    get("private")
                } else {
                    json!({"type":"pure_list_get","fields":{"list":"items"}})
                };
                let index = json!({"type":"logic_ternary","inputs":{
                    "condition":{"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":get("tick"),"B":num(850.0)}},
                    "ifTrue":invalid,"ifFalse":num(1.0)
                }});
                let body = chain(vec![
                    json!({"type":"change_variables","fields":{"variable":"tick"},"inputs":{"value":num(1.0)}}),
                    set(
                        "out",
                        json!({"type":"list_item","fields":{"item":"any"},"inputs":{"list":list,"list_index":index}}),
                    ),
                    // A statement after the throwing reporter must not execute.
                    set("after", get("tick")),
                ]);
                let mut p = private_project(body, json!(["12", true, [7]]), k4);
                p["variables"]["variablesDict"]["items"] =
                    json!({"id":"items","type":"list","isGlobal":true,"value":["12",true,[7]]});
                let error = k4.then_some(if nonfinite {
                    "invalid non-finite list index"
                } else {
                    "lists_get_value_bad_index"
                });
                let vm = compare_hot(&p, error);
                assert_eq!(vm.variable_text("tick"), if k4 { "851" } else { "900" });
                assert_eq!(vm.variable_text("after"), if k4 { "850" } else { "900" });
                if !k4 {
                    assert_eq!(
                        vm.variable_text("out"),
                        if nonfinite || out_of_range {
                            "NaN"
                        } else {
                            "12"
                        }
                    );
                }
            }
        }
    }
}

#[test]
fn hot_private_tell_context_and_scope_errors_match() {
    use serde_json::json;
    for k4 in [false, true] {
        for failure in [None, Some(false), Some(true)] {
            let body = chain(vec![
                json!({"type":"change_variables","fields":{"variable":"private"},"inputs":{"value":num(2.0)}}),
                set("out", get("private")),
            ]);
            let mut p = private_project(body, json!(0), k4);
            let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
            other["id"] = json!("other");
            other["nekoBlockJsonList"] = json!([]);
            p["actors"]["actorsDict"]["other"] = other;
            p["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"]
                .as_array_mut()
                .unwrap()
                .push(json!("other"));
            p["variables"]["variablesDict"]["private"]["currentEntityId"] = json!("other");
            let hot =
                p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]
                    .clone();
            let mut ops = vec![
                json!({"type":"sync_tell","fields":{"sprite":"other"},"statements":{"DO":hot}}),
            ];
            if let Some(write) = failure {
                ops.push(if write {
                    set("private", num(99.0))
                } else {
                    set("out", get("private"))
                });
                ops.push(set("after", num(1.0)));
            }
            p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
                chain(ops);
            let vm = compare_hot(
                &p,
                failure.map(|_| "entity_variable_operation_out_of_scope"),
            );
            assert_eq!(vm.variable_text("after"), "0");
            if failure.is_none() {
                assert_eq!(vm.variable_text("out"), "1800");
            }
            let snapshot = vm.debug_snapshot();
            assert_eq!(snapshot["actors"]["other"]["variables"]["private"], 1800.0);
            assert!(
                snapshot["actors"]["nekoc-default-actor"]["variables"]
                    .get("private")
                    .is_none()
            );
        }
    }
}

#[test]
fn hot_private_nan_and_list_equality_respects_runtime_semantics() {
    use serde_json::json;
    for k4 in [false, true] {
        let nan = json!({"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{"A":num(0.0),"B":num(0.0)}});
        let body = chain(vec![
            set("private", nan),
            set(
                "compared",
                json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("private"),"B":get("private")}}),
            ),
            set(
                "typed_compared",
                json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("left"),"B":get("right")}}),
            ),
            // Branch uses ExprOp::Truth/native truth_tree, unlike assigning a
            // comparison Cell. K4 treats NaN as equal to itself in both paths.
            json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("private"),"B":get("private")}}},"statements":{"DO0":{
                "type":"change_variables","fields":{"variable":"out"},"inputs":{"value":num(1.0)}
            }}}),
            json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"NEQ"},"inputs":{"A":get("private"),"B":get("private")}}},"statements":{"DO0":{
                "type":"change_variables","fields":{"variable":"after"},"inputs":{"value":num(1.0)}
            }}}),
        ]);
        let mut p = private_project(body, json!(0), k4);
        for id in ["left", "right"] {
            p["variables"]["variablesDict"][id] =
                json!({"id":id,"isGlobal":true,"value":[[1,2],true,"12"]});
        }
        let vm = compare_hot(&p, None);
        for id in ["compared", "typed_compared"] {
            assert_eq!(
                vm.variable_text(id),
                if k4 { "true" } else { "false" },
                "k4={k4}, {id}"
            );
        }
        assert_eq!(vm.variable_text("out"), if k4 { "900" } else { "0" });
        assert_eq!(vm.variable_text("after"), if k4 { "0" } else { "900" });
    }
}

#[test]
fn hot_kn_list_writes_check_private_reporter_errors_before_the_next_statement() {
    use serde_json::json;
    for replace in [false, true] {
        let call =
            json!({"type":"procedures_2_callnoreturn","mutation":"<mutation def_id=\"write\"/>"});
        let mut p = private_project(set("out", num(0.0)), json!(12), false);
        p["variables"]["variablesDict"]["items"] =
            json!({"id":"items","type":"list","isGlobal":true,"value":[0]});
        let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
        other["id"] = json!("other");
        other["nekoBlockJsonList"] = json!([]);
        p["actors"]["actorsDict"]["other"] = other;
        p["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"]
            .as_array_mut()
            .unwrap()
            .push(json!("other"));
        let value = json!({"type":"math_arithmetic","fields":{"type":"multiply"},"inputs":{"A":get("private"),"B":num(2.0)}});
        let write = if replace {
            json!({"id":"hot-list-write","type":"replace_list_item","fields":{"item":"any"},"inputs":{
                "list":{"type":"pure_list_get","fields":{"list":"items"}},"list_index":num(1.0),"list_item_value":value
            }})
        } else {
            json!({"id":"hot-list-write","type":"list_append","inputs":{
                "list":{"type":"pure_list_get","fields":{"list":"items"}},"list_item_value":value
            }})
        };
        p["procedures"]["proceduresDict"]["write"] = json!({"params":[],"nekoBlockJsonList":[{
            "type":"procedures_2_defnoreturn","statements":{"STACK":{
                "type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":chain(vec![write,set("after",num(1.0))])}
            }}
        }]});
        // The same compiled procedure/PC is hot in its owning actor first, then
        // runs without permission under tell. No restart or separate cold PC.
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] = json!({
            "type":"warp","statements":{"DO":chain(vec![
                call.clone(),
                set("after",num(0.0)),
                json!({"type":"sync_tell","fields":{"sprite":"other"},"statements":{"DO":call}}),
                set("out",num(1.0)),
            ])}
        });
        let vm = compare_hot(
            &p,
            Some("entity_variable_operation_out_of_scope: private at block hot-list-write"),
        );
        assert_eq!(vm.variable_text("after"), "0");
        assert_eq!(vm.variable_text("out"), "0");
    }
}

#[test]
fn hot_parameters_switch_numeric_and_text_comparisons_and_addition() {
    use serde_json::json;
    for k4 in [false, true] {
        let param = json!({"type":"procedures_2_parameter","fields":{"param_name":"x"},"mutation":"<mutation id=\"arg-x\"/>"});
        let call = |value: Value| json!({"type":"procedures_2_callnoreturn","mutation":"<mutation def_id=\"typed\"/>","inputs":{"arg-x":value}});
        let body = chain(vec![
            call(num(12.0)),
            set("numeric", get("out")),
            call(json!({"type":"text","fields":{"TEXT":"12"}})),
        ]);
        let mut p = private_project(body, json!(0), k4);
        p["procedures"]["proceduresDict"]["typed"] = json!({
            "params":[{"type":"String","id":"arg-x","name":"x"}],
            "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn",
                "mutation":"<mutation><arg type=\"String\" name=\"x\" id=\"arg-x\"/></mutation>",
                "inputs":{"arg-x":{"type":"procedures_2_stable_parameter","id":"arg-x","fields":{"param_name":"x"}}},
                "statements":{"STACK":chain(vec![
                    set("compared",json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":param.clone(),"B":num(12.0)}})),
                    set("typed_compared",json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":param.clone(),"B":{"type":"text","fields":{"TEXT":"12"}}}})),
                    json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":param.clone(),"B":num(12.0)}}},"statements":{"DO0":{
                        "type":"change_variables","fields":{"variable":"tick"},"inputs":{"value":num(1.0)}
                    }}}),
                    json!({"type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"NEQ"},"inputs":{"A":param.clone(),"B":num(12.0)}}},"statements":{"DO0":{
                        "type":"change_variables","fields":{"variable":"after"},"inputs":{"value":num(1.0)}
                    }}}),
                    set("out",json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":param.clone(),"B":param.clone()}})),
                ])}
            }]
        });
        let vm = compare_hot(&p, None);
        assert_eq!(vm.variable_text("numeric"), "24");
        assert_eq!(vm.variable_text("out"), if k4 { "1212" } else { "24" });
        assert_eq!(vm.variable_text("compared"), "false");
        assert_eq!(vm.variable_text("typed_compared"), "true");
        assert_eq!(vm.variable_text("tick"), "900");
        assert_eq!(vm.variable_text("after"), "900");
    }
}

#[test]
fn hot_private_clone_numeric_and_nested_list_cells_are_isolated() {
    use serde_json::json;
    for k4 in [false, true] {
        let parent_loop = chain(vec![
            json!({"type":"change_variables","fields":{"variable":"counter"},"inputs":{"value":num(1.0)}}),
            set(
                "numeric",
                json!({"type":"list_length","inputs":{"list":get("private")}}),
            ),
        ]);
        let mut p = private_project(parent_loop, json!([[7]]), k4);
        p["variables"]["variablesDict"]["counter"] = json!({
            "id":"counter","value":41,"isGlobal":false,"currentEntityId":"nekoc-default-actor"
        });
        let hot = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]
            .clone();
        let clone_loop = chain(vec![
            json!({"type":"change_variables","fields":{"variable":"counter"},"inputs":{"value":num(2.0)}}),
            set(
                "numeric",
                json!({"type":"list_length","inputs":{"list":get("private")}}),
            ),
        ]);
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":chain(vec![
                hot,
                json!({"type":"mirror","fields":{"sprite":"--self"}}),
                json!({"type":"wait","inputs":{"time":num(0.1)}}),
                set("out", get("private")),
                set("compared", get("counter")),
            ])},
            {"type":"start_as_a_mirror","statements":{"DO":chain(vec![
                json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":clone_loop}}}}),
                json!({"type":"list_append","inputs":{"list":{"type":"list_item","fields":{"item":"any"},"inputs":{"list":get("private"),"list_index":num(1.0)}},"list_item_value":num(8.0)}}),
                set("after", get("private")),
                set("typed_compared", get("counter")),
            ])}}
        ]);
        let vm = compare_hot(&p, None);
        assert_eq!(vm.variable_text("out"), "7");
        assert_eq!(vm.variable_text("after"), "7,8");
        assert_eq!(vm.variable_text("compared"), "941");
        assert_eq!(vm.variable_text("typed_compared"), "2741");
    }
}

#[test]
fn hot_official_private_clone_fixtures_match_after_restarts() {
    for file in [
        "tests/fixtures/actor-variables.bcmkn",
        "tests/fixtures/actor-variables-deleted.bcmkn",
        "tests/fixtures/kitten4/actor-variables.bcm",
        "tests/fixtures/kitten4/actor-variables-deleted.bcm",
    ] {
        let loaded = nekoc::project::load_project(file).unwrap();
        let p = if nekoc::kitten4::is_kitten4(&loaded.value) {
            nekoc::kitten4::to_neko(&loaded.value).unwrap().into_value()
        } else {
            loaded.value.into_value()
        };
        let mut a = engine(&p, false);
        let mut b = engine(&p, true);
        b.enable_jit_profile();
        for restart in 0..520 {
            a.start();
            b.start();
            let mut finished = false;
            for frame in 0..90 {
                let x = a.advance(1.0 / 60.0, 100_000, Duration::from_secs(5));
                let y = b.advance(1.0 / 60.0, 100_000, Duration::from_secs(5));
                assert_eq!(
                    a.debug_snapshot(),
                    b.debug_snapshot(),
                    "{file} {restart}/{frame}"
                );
                match (x, y) {
                    (Ok(x), Ok(y)) => {
                        assert_eq!(
                            normalized(&encode_frame(&x).unwrap()),
                            normalized(&encode_frame(&y).unwrap())
                        );
                        assert_eq!(a.active_tasks(), b.active_tasks());
                        a.recycle_lines(x.lines);
                        b.recycle_lines(y.lines);
                        // Keep all 520 starts (including hot clone/deleted-clone
                        // paths), but not dozens of empty frames after completion.
                        if a.active_tasks() == 0 {
                            finished = true;
                            break;
                        }
                    }
                    (Err(x), Err(y)) => {
                        assert_eq!(x.to_string(), y.to_string());
                        assert!(file.ends_with("kitten4/actor-variables-deleted.bcm"));
                        assert!(x.to_string().contains("clone_not_found"));
                        finished = true;
                        break;
                    }
                    (x, y) => panic!("{file}: {:?} <> {:?}", x.err(), y.err()),
                }
            }
            assert!(finished, "{file}: unfinished restart {restart}");
        }
        assert!(
            b.jit_profile()["native_ops"].as_u64().unwrap() > 0,
            "{file}"
        );
    }
}
