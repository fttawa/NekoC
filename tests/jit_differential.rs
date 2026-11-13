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
    // A slow CI host must not hit the wall-clock budget on only one side.
    vm.use_virtual_clock();
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
    compare_hot_budget(project, error, 100_000, 1000)
}

fn compare_hot_budget(
    project: &Value,
    error: Option<&str>,
    instructions: usize,
    frames: usize,
) -> Engine {
    let mut a = engine(project, false);
    let mut b = engine(project, true);
    b.enable_jit_profile();
    for restart in 0..2 {
        a.start();
        b.start();
        let mut failed = false;
        let mut finished = false;
        for frame in 0..frames {
            let x = a.advance(1.0 / 60.0, instructions, Duration::from_secs(5));
            let y = b.advance(1.0 / 60.0, instructions, Duration::from_secs(5));
            assert_eq!(
                a.jit_debug_snapshot(),
                b.jit_debug_snapshot(),
                "precise state: restart {restart} frame {frame}"
            );
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
                        x.to_string()
                            .contains(error.unwrap_or_else(|| panic!("unexpected error: {x:#}"))),
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
                if k4 {
                    // The failed assignment must retain its last successful
                    // value, not replace it with the evaluator's error sentinel.
                    assert_eq!(vm.variable_text("out"), "12");
                } else {
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
fn hot_k4_failed_change_inputs_and_nonfinite_move_stop_before_successors() {
    use serde_json::json;
    for (operation, target) in [
        ("set", "out"),
        ("increase", "out"),
        ("decrease", "out"),
        ("move", "out"),
        ("set", "private"),
        ("increase", "private"),
        ("decrease", "private"),
    ] {
        for numeric in [false, true] {
            let index = json!({"type":"logic_ternary","inputs":{
                "condition":{"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":get("tick"),"B":num(850.0)}},
                "ifTrue":arithmetic("divide",num(0.0),num(0.0)),"ifFalse":num(1.0)
            }});
            let value = json!({"type":"list_item","fields":{"item":"any"},"inputs":{
                "list":{"type":"pure_list_get","fields":{"list":"items"}},"list_index":index
            }});
            let value = if numeric {
                arithmetic("multiply", value, num(2.0))
            } else {
                value
            };
            let failing = match operation {
                "set" => set(target, value),
                "increase" => changed(target, value, false),
                "decrease" => changed(target, value, true),
                _ => json!({"type":"self_go_forward","inputs":{"steps":value}}),
            };
            let body = chain(vec![
                changed("tick", num(1.0), false),
                set(target, num(7.0)),
                failing,
                set("after", get("tick")),
            ]);
            let mut p = private_project(body, json!(0), true);
            p["variables"]["variablesDict"]["items"] =
                json!({"id":"items","type":"list","isGlobal":true,"value":[2]});
            let vm = compare_hot(&p, Some("invalid non-finite list index"));
            assert_eq!(vm.variable_text("tick"), "851", "{operation}/{numeric}");
            if target == "private" {
                assert_eq!(
                    vm.debug_snapshot()["actors"]["nekoc-default-actor"]["variables"][target],
                    7.0,
                    "{operation}/{numeric}"
                );
            } else {
                assert_eq!(vm.variable_text(target), "7", "{operation}/{numeric}");
            }
            assert_eq!(vm.variable_text("after"), "850", "{operation}/{numeric}");
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
                        assert!(x.to_string().contains("clone_entity_not_exist"));
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

fn text(value: &str) -> Value {
    serde_json::json!({"type":"text","fields":{"TEXT":value}})
}

fn arithmetic(op: &str, a: Value, b: Value) -> Value {
    serde_json::json!({"type":"math_arithmetic","fields":{"type":op},"inputs":{"A":a,"B":b}})
}

fn parameter(id: &str) -> Value {
    serde_json::json!({"type":"procedures_2_parameter","fields":{"param_name":id},
        "mutation":format!("<mutation id=\"{id}\"/>")})
}

fn call(id: &str, args: &[(&str, Value)]) -> Value {
    let inputs: serde_json::Map<String, Value> = args
        .iter()
        .map(|(id, value)| ((*id).into(), value.clone()))
        .collect();
    serde_json::json!({"type":"procedures_2_callnoreturn",
        "mutation":format!("<mutation def_id=\"{id}\"/>"),"inputs":inputs})
}

fn procedure(params: &[(&str, &str)], body: Value) -> Value {
    let mut inputs = serde_json::Map::new();
    let mut mutation = String::from("<mutation>");
    for &(id, kind) in params {
        mutation.push_str(&format!("<arg type=\"{kind}\" name=\"{id}\" id=\"{id}\"/>"));
        inputs.insert(
            id.into(),
            serde_json::json!({
                "type":"procedures_2_stable_parameter","id":id,"fields":{"param_name":id}
            }),
        );
    }
    mutation.push_str("</mutation>");
    serde_json::json!({
        "params":params.iter().map(|(id, kind)| serde_json::json!({"id":id,"name":id,"type":kind})).collect::<Vec<_>>(),
        "nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","mutation":mutation,
            "inputs":inputs,"statements":{"STACK":body}}]
    })
}

fn changed(id: &str, value: Value, decrease: bool) -> Value {
    serde_json::json!({"type":"change_variables","fields":{
        "variable":id,"method":if decrease { "decrease" } else { "increase" }
    },"inputs":{"value":value}})
}

fn branch(condition: Value, body: Value) -> Value {
    serde_json::json!({"type":"controls_if","inputs":{"IF0":condition},"statements":{"DO0":body}})
}

fn assert_native_helper(vm: &Engine, reason: &str) {
    let profile = vm.jit_profile();
    let independent = reason.strip_prefix("op/").map(|op| format!("native/{op}"));
    assert!(
        profile["helper_reasons"][reason].as_u64().unwrap_or(0) > 0
            || independent.as_ref().is_some_and(|reason| {
                profile["helper_reasons"][reason].as_u64().unwrap_or(0) > 0
            }),
        "expected native helper {reason}: {profile}"
    );
}

#[test]
fn hot_conversion_results_preserve_nan_negative_zero_and_number_predicate_types() {
    use nekoc::engine::Cell;
    use serde_json::json;
    for k4 in [false, true] {
        let body = chain(vec![
            call(
                "capture",
                &[(
                    "value",
                    json!({"type":"parseInt","fields":{"radix":"10"},"inputs":{"str":text("-0tail")}}),
                )],
            ),
            set("negative_zero", get("out")),
            call(
                "capture",
                &[(
                    "value",
                    json!({"type":"parseFloat","inputs":{"str":text("not-a-number")}}),
                )],
            ),
            set("nan", get("out")),
            call(
                "capture",
                &[(
                    "value",
                    json!({"type":"isFinite","inputs":{"value":text("12")}}),
                )],
            ),
            set("compared", get("out")),
            call(
                "capture",
                &[(
                    "value",
                    json!({"type":"isFinite","inputs":{"value":num(12.0)}}),
                )],
            ),
            set("typed_compared", get("out")),
            call(
                "capture",
                &[(
                    "value",
                    json!({"type":"logic_to_boolean","inputs":{"VALUE":num(0.0)}}),
                )],
            ),
            set("after", get("out")),
        ]);
        let mut p = private_project(body, json!(0), k4);
        for id in ["negative_zero", "nan"] {
            p["variables"]["variablesDict"][id] = json!({"id":id,"value":0,"isGlobal":true});
        }
        p["procedures"]["proceduresDict"]["capture"] =
            procedure(&[("value", "Number")], set("out", parameter("value")));
        let vm = compare_hot(&p, None);
        assert!(
            matches!(vm.variable_value("negative_zero"),Cell::Number(n) if n == 0.0 && n.is_sign_negative())
        );
        assert!(matches!(vm.variable_value("nan"),Cell::Number(n) if n.is_nan()));
        assert_eq!(vm.variable_text("compared"), "false");
        assert_eq!(vm.variable_text("typed_compared"), "true");
        assert_eq!(vm.variable_text("after"), "false");
        assert_native_helper(&vm, "op/Call");
    }
}

#[test]
fn hot_call_arguments_and_branches_accept_non_scheduling_conversions() {
    use serde_json::json;
    // These are the compiler's actual socket names; parseInt's radix is a
    // dropdown field, not an expression input. Read from cells to avoid folding.
    let conversions = [
        (
            "bool",
            "Boolean",
            json!({"type":"logic_to_boolean","inputs":{"VALUE":get("source")}}),
            "true",
            "Boolean",
        ),
        (
            "integer",
            "Number",
            json!({"type":"parseInt","fields":{"radix":"16"},"inputs":{"str":get("source")}}),
            "18",
            "ParseInt",
        ),
        (
            "float",
            "Number",
            json!({"type":"parseFloat","inputs":{"str":get("source")}}),
            "12",
            "ParseFloat",
        ),
        (
            "finite",
            "Boolean",
            json!({"type":"isFinite","inputs":{"value":get("source")}}),
            "false",
            "IsNumber",
        ),
        (
            "nan",
            "Boolean",
            json!({"type":"isNaN","inputs":{"value":arithmetic("divide",num(0.0),num(0.0))}}),
            "true",
            "IsNumber",
        ),
        (
            "encoded",
            "String",
            json!({"type":"btoa","inputs":{"data":get("source")}}),
            "MTI=",
            "Encode64",
        ),
        (
            "decoded",
            "String",
            json!({"type":"atob","inputs":{"encoded":get("base64")}}),
            "12",
            "Decode64",
        ),
    ];
    for k4 in [false, true] {
        for (id, kind, conversion, expected, reporter) in &conversions {
            let body = chain(vec![
                call("capture", &[("value", conversion.clone())]),
                branch(conversion.clone(), changed("tick", num(1.0), false)),
            ]);
            let mut p = private_project(body, json!(0), k4);
            p["variables"]["variablesDict"]["source"] =
                json!({"id":"source","value":"12","isGlobal":true});
            p["variables"]["variablesDict"]["base64"] =
                json!({"id":"base64","value":"MTI=","isGlobal":true});
            p["procedures"]["proceduresDict"]["capture"] =
                procedure(&[("value", kind)], set("out", parameter("value")));
            let vm = compare_hot(&p, None);
            assert_eq!(vm.variable_text("out"), *expected, "{id} k4={k4}");
            assert_eq!(
                vm.variable_text("tick"),
                if *expected == "false" { "0" } else { "900" },
                "{id} k4={k4}"
            );
            // The only call site contains the conversion; unrelated numeric
            // loop ops becoming native is not enough to satisfy this assertion.
            assert_native_helper(&vm, "op/Call");
            assert_native_helper(&vm, &format!("reporter/{reporter}"));
        }
    }
}

#[test]
fn hot_recursive_calls_restore_typed_parameters_and_loop_stacks() {
    use serde_json::json;
    for k4 in [false, true] {
        let recurse = call(
            "recurse",
            &[
                ("depth", arithmetic("minus", parameter("depth"), num(1.0))),
                ("payload", parameter("payload")),
                ("flag", parameter("flag")),
            ],
        );
        let body = chain(vec![
            call(
                "recurse",
                &[
                    ("depth", num(3.0)),
                    ("payload", get("typed")),
                    (
                        "flag",
                        json!({"type":"logic_boolean","fields":{"BOOL":"TRUE"}}),
                    ),
                ],
            ),
            changed("after", num(1.0), false),
        ]);
        let mut p = private_project(body, json!(0), k4);
        p["variables"]["variablesDict"]["typed"] =
            json!({"id":"typed","value":["12",true,[7]],"isGlobal":true});
        p["procedures"]["proceduresDict"]["leaf"] = procedure(
            &[
                ("depth", "Number"),
                ("payload", "String"),
                ("flag", "Boolean"),
            ],
            chain(vec![
                set("out", parameter("payload")),
                set("compared", parameter("flag")),
            ]),
        );
        p["procedures"]["proceduresDict"]["recurse"] = procedure(
            &[
                ("depth", "Number"),
                ("payload", "String"),
                ("flag", "Boolean"),
            ],
            chain(vec![
                branch(
                    json!({"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":parameter("depth"),"B":num(0.0)}}),
                    recurse,
                ),
                // Return from inside a loop must discard this frame's loop,
                // without truncating either the caller's loop or parameters.
                json!({"type":"repeat_n_times","inputs":{"times":num(2.0)},"statements":{"DO":{
                    "type":"traverse_number","inputs":{
                        "value":{"type":"traverse_number_param","fields":{"TEXT":"inner-index"}},
                        "from":num(1.0),"to":num(2.0),"by":num(1.0)
                    },"statements":{"DO":chain(vec![
                    call("leaf", &[("depth",text("shadow")),("payload",text("inner")),("flag",json!({"type":"logic_boolean","fields":{"BOOL":"FALSE"}}))]),
                    set("out",parameter("payload")),
                    set("compared",parameter("flag")),
                    changed("numeric",parameter("depth"),false),
                    changed("tick",num(1.0),false),
                    json!({"type":"procedures_2_return_value","mutation":"<mutation items=\"1\"/>",
                        "inputs":{"VALUE":parameter("payload")},"shadows":{"VALUE":num(0.0)}}),
                    set("typed_compared",num(99.0)),
                ])}}}}),
                set("typed_compared", num(100.0)),
            ]),
        );
        let vm = compare_hot_budget(&p, None, 37, 10_000);
        assert_eq!(vm.variable_text("out"), "12,true,7");
        assert_eq!(vm.variable_text("compared"), "true");
        assert_eq!(vm.variable_text("numeric"), "5400");
        assert_eq!(vm.variable_text("tick"), "3600");
        assert_eq!(vm.variable_text("after"), "900");
        assert_eq!(vm.variable_text("typed_compared"), "0");
        assert_native_helper(&vm, "op/Call");
        assert_native_helper(&vm, "op/Return");
        assert_native_helper(&vm, "op/ReturnValue");
    }
}

#[test]
fn hot_k4_change_guards_keep_text_add_decrease_nan_and_negative_zero() {
    use nekoc::engine::Cell;
    use serde_json::json;
    let body = chain(vec![
        set("out", num(10.0)),
        call("increase", &[("delta", num(2.0))]),
        set("numeric", get("out")),
        call("increase", &[("delta", text("3"))]),
        set("compared", get("out")),
        call("increase", &[("delta", num(0.0))]),
        changed("out", text("30"), true),
        set("after", get("out")),
        call("increase", &[("delta", num(1.0))]),
        set("typed_compared", arithmetic("add", text("x"), get("out"))),
        set("nan", arithmetic("divide", num(0.0), num(0.0))),
        changed("nan", num(1.0), false),
        set(
            "negative_zero",
            arithmetic(
                "divide",
                num(-1.0),
                arithmetic("divide", num(1.0), num(0.0)),
            ),
        ),
        changed("negative_zero", num(0.0), true),
        set(
            "reciprocal",
            arithmetic("divide", num(1.0), get("negative_zero")),
        ),
    ]);
    let mut p = private_project(body, json!(0), true);
    // Re-enter exactly the same Kitten4Change PC with number -> text -> number
    // operands and previous-cell types. Separate statically typed PCs cannot
    // exercise stale guards at a hot change site.
    p["procedures"]["proceduresDict"]["increase"] = procedure(
        &[("delta", "Number")],
        changed("out", parameter("delta"), false),
    );
    for id in ["nan", "negative_zero", "reciprocal"] {
        p["variables"]["variablesDict"][id] = json!({"id":id,"value":0,"isGlobal":true});
    }
    let vm = compare_hot(&p, None);
    assert_eq!(vm.variable_text("numeric"), "12");
    assert_eq!(vm.variable_text("compared"), "123");
    assert_eq!(vm.variable_text("after"), "1200");
    assert_eq!(vm.variable_text("out"), "1201");
    assert_eq!(vm.variable_text("typed_compared"), "x1201");
    assert!(matches!(vm.variable_value("nan"),Cell::Number(n) if n.is_nan()));
    assert!(
        matches!(vm.variable_value("negative_zero"),Cell::Number(n) if n == 0.0 && n.is_sign_negative())
    );
    assert!(matches!(vm.variable_value("reciprocal"),Cell::Number(n) if n == f64::NEG_INFINITY));
    assert_native_helper(&vm, "op/Kitten4Change");
    // This is the new guarded path itself, not merely the surrounding loop.
    let profile = vm.jit_profile();
    assert_eq!(
        profile["fallback_reasons"]["unsupported-or-impure/Kitten4Change"]
            .as_u64()
            .unwrap_or(0),
        0,
        "{profile}"
    );
}

fn append(list: Value, value: Value) -> Value {
    serde_json::json!({"type":"list_append","inputs":{"list":list,"list_item_value":value}})
}

fn item(list: Value, index: f64) -> Value {
    serde_json::json!({"type":"list_item","fields":{"item":"any"},
        "inputs":{"list":list,"list_index":num(index)}})
}

#[test]
fn hot_append_global_private_variable_and_expression_refs_keep_typed_aliases() {
    use serde_json::json;
    for k4 in [false, true] {
        for reference in [
            "global",
            "private",
            "variable",
            "local",
            "expression",
            "parameter",
        ] {
            let global = json!({"type":"pure_list_get","fields":{"list":"items"}});
            let target = match reference {
                "global" => global.clone(),
                "private" => get("private"),
                "variable" => get("alias"),
                "local" => json!({"type":"script_variables_value","fields":{"TEXT":"local-alias"}}),
                "expression" => item(get("private"), 1.0),
                "parameter" => parameter("target"),
                _ => unreachable!(),
            };
            let mut p = private_project(set("out", num(0.0)), json!([[]]), k4);
            p["variables"]["variablesDict"]["items"] =
                json!({"id":"items","type":"list","value":[],"isGlobal":true});
            p["variables"]["variablesDict"]["alias"] =
                json!({"id":"alias","value":0,"isGlobal":true});
            p["variables"]["variablesDict"]["typed"] =
                json!({"id":"typed","value":["12",true,[7]],"isGlobal":true});
            let typed = item(get("typed"), 1.0);
            let write = chain(vec![
                append(target.clone(), typed),
                append(target.clone(), item(get("typed"), 2.0)),
                append(target.clone(), item(get("typed"), 3.0)),
                // Copy a list handle, not its current contents. Mutation through
                // this alias must be observed by the original reference too.
                set(
                    "out",
                    json!({"type":"list_length","inputs":{"list":target}}),
                ),
            ]);
            let hot_body = if reference == "parameter" {
                p["procedures"]["proceduresDict"]["append"] =
                    procedure(&[("target", "String")], write);
                call("append", &[("target", global.clone())])
            } else {
                write
            };
            p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
                chain(vec![
                    set("alias", global.clone()),
                    json!({"type":"script_variables","inputs":{"PARAMS0":{"type":"script_variables_param","fields":{"TEXT":"local-alias"}}}}),
                    json!({"type":"variables_set","fields":{"variable":json!({"name":"local-alias","type":"NEKO_SCRIPT_VARIABLE_TYPE-test"}).to_string()},"inputs":{"value":global.clone()}}),
                    json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":hot_body}}}}),
                    append(item(get("typed"), 3.0), text("tail")),
                ]);
            let vm = compare_hot(&p, None);
            assert_eq!(
                vm.variable_text("out"),
                if reference == "private" {
                    "2701"
                } else {
                    "2700"
                },
                "{reference} k4={k4}"
            );
            let snapshot = vm.debug_snapshot();
            let values = match reference {
                "private" => &snapshot["actors"]["nekoc-default-actor"]["variables"]["private"],
                "expression" => {
                    &snapshot["actors"]["nekoc-default-actor"]["variables"]["private"][0]
                }
                _ => &snapshot["lists"]["items"],
            }
            .as_array()
            .unwrap();
            let start = usize::from(reference == "private");
            assert_eq!(values.len(), 2700 + start);
            for triple in values[start..].as_chunks::<3>().0 {
                assert_eq!(triple, &[json!("12"), json!(true), json!([7.0, "tail"])]);
            }
            assert_native_helper(&vm, "op/AppendList");
        }
    }
}

#[test]
fn hot_append_rejects_direct_and_nested_cycles_before_mutation() {
    use serde_json::json;
    for k4 in [false, true] {
        for nested in [false, true] {
            for private in [false, true] {
                let list = if private {
                    get("private")
                } else {
                    json!({"type":"pure_list_get","fields":{"list":"items"}})
                };
                let cycle = if nested {
                    json!({"type":"temporary_list","mutation":"<mutation items=\"1\"/>","inputs":{"ITEM0":list.clone()}})
                } else {
                    list.clone()
                };
                let value = json!({"type":"logic_ternary","inputs":{
                    "condition":{"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":get("tick"),"B":num(850.0)}},
                    "ifTrue":cycle,"ifFalse":text("ok")
                }});
                let mut write = append(list, value);
                write["id"] = json!("hot-cycle");
                let mut p = private_project(
                    chain(vec![
                        changed("tick", num(1.0), false),
                        write,
                        set("after", get("tick")),
                    ]),
                    json!([]),
                    k4,
                );
                p["variables"]["variablesDict"]["items"] =
                    json!({"id":"items","type":"list","value":[],"isGlobal":true});
                let vm = compare_hot(&p, Some("cyclic list at hot-cycle"));
                assert_eq!(vm.variable_text("tick"), "851");
                assert_eq!(vm.variable_text("after"), "850");
                let snapshot = vm.debug_snapshot();
                let values = if private {
                    &snapshot["actors"]["nekoc-default-actor"]["variables"]["private"]
                } else {
                    &snapshot["lists"]["items"]
                };
                assert_eq!(values.as_array().unwrap().len(), 850);
                assert!(values.as_array().unwrap().iter().all(|value| value == "ok"));
                assert_native_helper(&vm, "op/AppendList");
            }
        }
    }
}

#[test]
fn hot_append_evaluates_value_before_expression_target_even_on_error() {
    use serde_json::json;
    for k4 in [false, true] {
        for error in [false, true] {
            let mut p = private_project(set("out", num(0.0)), json!([]), k4);
            p["variables"]["variablesDict"]["items"] =
                json!({"id":"items","type":"list","value":[],"isGlobal":true});
            let global = json!({"type":"pure_list_get","fields":{"list":"items"}});
            // Reporter calls are reentrant: the native gateway must terminate
            // its region and reacquire task/slot pointers after evaluation.
            let mut value = call("value", &[]);
            value["type"] = json!("procedures_2_callreturn");
            let mut target = call("target", &[]);
            target["type"] = json!("procedures_2_callreturn");
            let return_value = |expr: Value| {
                json!({"type":"procedures_2_return_value",
                "mutation":"<mutation items=\"1\"/>","inputs":{"VALUE":expr},"shadows":{"VALUE":num(0.0)}})
            };
            p["procedures"]["proceduresDict"]["value"] = procedure(
                &[],
                chain(vec![
                    changed("tick", num(1.0), false),
                    return_value(text("v")),
                ]),
            );
            let resolved = if error {
                // Resolve an out-of-scope private list only after value ran.
                get("private")
            } else {
                global.clone()
            };
            p["procedures"]["proceduresDict"]["target"] = procedure(
                &[],
                chain(vec![set("numeric", get("tick")), return_value(resolved)]),
            );
            let mut other = p["actors"]["actorsDict"]["nekoc-default-actor"].clone();
            other["id"] = json!("other");
            other["nekoBlockJsonList"] = json!([]);
            p["actors"]["actorsDict"]["other"] = other;
            p["scenes"]["scenesDict"]["nekoc-scene-main"]["actorIds"]
                .as_array_mut()
                .unwrap()
                .push(json!("other"));
            let hot = json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":chain(vec![
                append(global.clone(),text("warm")),changed("after",num(1.0),false),
            ])}}}});
            let mut write = append(target, value);
            write["id"] = json!("ordered-append");
            p["procedures"]["proceduresDict"]["write"] = procedure(&[], write);
            p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
                chain(vec![
                    hot,
                    json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":call("write",&[])}}}}),
                    if error {
                        json!({"type":"sync_tell","fields":{"sprite":"other"},"statements":{"DO":call("write",&[])}})
                    } else {
                        set("out", num(1.0))
                    },
                    set("out", num(1.0)),
                ]);
            let vm = compare_hot(
                &p,
                error.then_some("entity_variable_operation_out_of_scope"),
            );
            assert_eq!(vm.variable_text("tick"), if error { "901" } else { "900" });
            assert_eq!(
                vm.variable_text("numeric"),
                if error { "901" } else { "900" }
            );
            assert_eq!(vm.variable_text("after"), "900");
            assert_eq!(vm.variable_text("out"), if error { "0" } else { "1" });
            assert_eq!(
                vm.debug_snapshot()["lists"]["items"]
                    .as_array()
                    .unwrap()
                    .len(),
                if error { 900 } else { 1800 }
            );
            assert_native_helper(&vm, "op/AppendList");
            assert_native_helper(&vm, "native/reentrant-AppendList");
        }
    }
}

#[test]
fn hot_k4_yielding_next_keeps_the_final_iteration_in_a_separate_frame() {
    use serde_json::json;
    let mut p = private_project(changed("tick", num(1.0), false), json!(0), true);
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] = chain(vec![
        json!({"type":"repeat_n_times","inputs":{"times":num(900.0)},"statements":{"DO":changed("tick",num(1.0),false)}}),
        set("after", get("tick")),
    ]);
    let vm = compare_hot_budget(&p, None, 100_000, 1100);
    assert_eq!(vm.variable_text("tick"), "900");
    assert_eq!(vm.variable_text("after"), "900");
    assert_native_helper(&vm, "op/Next");
    // Explicitly observe the final Next boundary after native warmup. The
    // differential helper already compared every frame and both starts.
    let mut vm = vm;
    vm.start();
    for frame in 0..900 {
        vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(vm.variable_text("tick"), (frame + 1).to_string());
        assert_eq!(vm.variable_text("after"), "0");
        assert_eq!(vm.active_tasks(), 1);
    }
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
        .unwrap();
    assert_eq!(vm.variable_text("after"), "900");
    assert_eq!(vm.active_tasks(), 0);
}

#[test]
fn hot_k4_warp_iteration_and_instruction_budgets_match_each_frame() {
    use serde_json::json;
    for instructions in [7, 100_000] {
        let mut p = private_project(changed("tick", num(1.0), false), json!(0), true);
        // More than K4's 10,000 warp iterations; a large instruction budget
        // must still suspend at the K4 boundary, not run the whole loop at once.
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] = chain(
            vec![
                json!({"type":"warp","statements":{"DO":{"type":"repeat_n_times","inputs":{"times":num(10_010.0)},"statements":{"DO":changed("tick",num(1.0),false)}}}}),
                set("after", get("tick")),
            ],
        );
        let vm = compare_hot_budget(&p, None, instructions, 6000);
        assert_eq!(vm.variable_text("tick"), "10010");
        assert_eq!(vm.variable_text("after"), "10010");
        assert_native_helper(&vm, "op/Next");
        if instructions == 100_000 {
            let mut vm = vm;
            vm.start();
            let frame = vm
                .advance(1.0 / 60.0, instructions, Duration::from_secs(5))
                .unwrap();
            assert!(!frame.budget_yield);
            assert_eq!(vm.variable_text("tick"), "10002");
            assert_eq!(vm.variable_text("after"), "0");
            assert_eq!(vm.active_tasks(), 1);
        }
    }
}

#[test]
fn hot_k4_range_next_final_yield_and_warp_iteration_boundaries_match() {
    use serde_json::json;
    for kind in ["range", "while"] {
        for warped in [false, true] {
            let count = if warped { 10_010.0 } else { 900.0 };
            let body = changed("tick", num(1.0), false);
            let iteration = if kind == "range" {
                json!({"type":"traverse_number","inputs":{
                    "value":{"type":"traverse_number_param","fields":{"TEXT":"index"}},
                    "from":num(1.0),"to":num(count),"by":num(1.0)
                },"statements":{"DO":body}})
            } else {
                json!({"type":"controls_while","inputs":{"BOOL":{
                    "type":"logic_compare","fields":{"OP":"LT"},"inputs":{"A":get("tick"),"B":num(count)}
                }},"statements":{"DO":body}})
            };
            let iteration = if warped {
                json!({"type":"warp","statements":{"DO":iteration}})
            } else {
                iteration
            };
            let mut p = private_project(body, json!(0), true);
            p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
                chain(vec![iteration, set("after", get("tick"))]);
            let vm = compare_hot_budget(&p, None, 100_000, 1100);
            assert_eq!(vm.variable_text("tick"), count.to_string());
            assert_eq!(vm.variable_text("after"), count.to_string());
            if kind == "range" {
                assert_native_helper(&vm, "op/RangeNext");
            } else if warped {
                assert_native_helper(&vm, "op/WarpIteration");
            }
            let mut vm = vm;
            vm.start();
            if warped {
                let frame = vm
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                    .unwrap();
                assert!(!frame.budget_yield);
                assert_eq!(vm.variable_text("tick"), "10002", "{kind}");
                assert_eq!(vm.variable_text("after"), "0");
            } else {
                for _ in 0..900 {
                    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                        .unwrap();
                }
                assert_eq!(vm.variable_text("tick"), "900");
                assert_eq!(vm.variable_text("after"), "0");
                assert_eq!(vm.active_tasks(), 1);
            }
        }
    }
}

fn reporter(id: &str, args: &[(&str, Value)]) -> Value {
    let mut block = call(id, args);
    block["type"] = serde_json::json!("procedures_2_callreturn");
    block
}

fn returned(value: Value) -> Value {
    serde_json::json!({"type":"procedures_2_return_value","mutation":"<mutation items=\"1\"/>",
        "inputs":{"VALUE":value},"shadows":{"VALUE":num(0.0)}})
}

fn local_set(id: &str, value: Value) -> Value {
    set(
        &serde_json::json!({"name":id,"type":"NEKO_SCRIPT_VARIABLE_TYPE-test"}).to_string(),
        value,
    )
}

#[test]
fn hot_reentrant_reporters_reacquire_cells_parameters_and_aliases_after_clone_growth() {
    use serde_json::json;
    for k4 in [false, true] {
        for site in ["Call", "Branch", "AppendValue", "AppendTarget"] {
            let a = json!({"type":"pure_list_get","fields":{"list":"items-a"}});
            let b = json!({"type":"pure_list_get","fields":{"list":"items-b"}});
            let eval = reporter("mutate", &[("payload", text("reporter-shadow"))]);
            let operation = match site {
                "Call" => call("capture", &[("first", eval), ("second", get("alias"))]),
                "Branch" => branch(eval, changed("numeric", num(1.0), false)),
                "AppendValue" => append(get("alias"), eval),
                "AppendTarget" => append(eval, text("appended")),
                _ => unreachable!(),
            };
            let body = call("driver", &[("payload", get("typed"))]);
            let mut p = private_project(body, json!(0), k4);
            for id in ["items-a", "items-b"] {
                p["variables"]["variablesDict"][id] =
                    json!({"id":id,"type":"list","value":[],"isGlobal":true});
            }
            for id in [
                "alias",
                "target",
                "local_after",
                "clones",
                "captured",
                "captured_alias",
            ] {
                p["variables"]["variablesDict"][id] = json!({"id":id,"value":0,"isGlobal":true});
            }
            p["variables"]["variablesDict"]["typed"] =
                json!({"id":"typed","value":["caller",true,[7]],"isGlobal":true});
            p["procedures"]["proceduresDict"]["capture"] = procedure(
                &[("first", "String"), ("second", "String")],
                chain(vec![
                    set("captured", parameter("first")),
                    set("captured_alias", parameter("second")),
                ]),
            );
            p["procedures"]["proceduresDict"]["driver"] = procedure(
                &[("payload", "String")],
                chain(vec![
                    changed("tick", num(1.0), false),
                    set("target", num(12.0)),
                    set("alias", a.clone()),
                    local_set("scratch", num(1.0)),
                    operation,
                    // These must use fresh pointers, restored caller parameters,
                    // and the cells/aliases modified by the nested reporter.
                    local_set(
                        "scratch",
                        arithmetic(
                            "add",
                            json!({"type":"script_variables_value","fields":{"TEXT":"scratch"}}),
                            num(2.0),
                        ),
                    ),
                    set(
                        "local_after",
                        json!({"type":"script_variables_value","fields":{"TEXT":"scratch"}}),
                    ),
                    set("out", parameter("payload")),
                    set("compared", get("target")),
                    append(get("alias"), text("after")),
                    set("after", get("tick")),
                ]),
            );
            let value = if site == "Branch" {
                json!({"type":"logic_boolean","fields":{"BOOL":"TRUE"}})
            } else if site == "AppendTarget" {
                get("alias")
            } else {
                parameter("payload")
            };
            p["procedures"]["proceduresDict"]["mutate"] = procedure(
                &[("payload", "String")],
                chain(vec![
                    set("target", text("changed-by-reporter")),
                    set("alias", b.clone()),
                    local_set("scratch", num(40.0)),
                    // Clone hats enqueue new tasks synchronously. Grow far past
                    // the small initial task capacity only AFTER the site heats.
                    branch(
                        json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":get("tick"),"B":num(851.0)}}),
                        json!({"type":"repeat_n_times","inputs":{"times":num(40.0)},"statements":{"DO":{
                            "type":"mirror","fields":{"sprite":"--self"}
                        }}}),
                    ),
                    returned(value),
                ]),
            );
            let hot =
                p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"]
                    .clone();
            p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
                {"type":"on_running_group_activated","next":chain(vec![
                    json!({"type":"script_variables","inputs":{"PARAMS0":{"type":"script_variables_param","fields":{"TEXT":"scratch"}}}}),hot
                ])},
                {"type":"start_as_a_mirror","statements":{"DO":changed("clones",num(1.0),false)}}
            ]);
            let vm = compare_hot_budget(&p, None, 73, 10_000);
            assert_eq!(vm.variable_text("out"), "caller,true,7", "{site} k4={k4}");
            assert_eq!(vm.variable_text("compared"), "changed-by-reporter");
            assert_eq!(vm.variable_text("local_after"), "42");
            assert_eq!(vm.variable_text("after"), "900");
            assert_eq!(vm.variable_text("clones"), "40");
            let snapshot = vm.debug_snapshot();
            assert_eq!(snapshot["lists"]["items-a"], json!([]));
            let values = snapshot["lists"]["items-b"].as_array().unwrap();
            assert_eq!(
                values.len(),
                if site.starts_with("Append") {
                    1800
                } else {
                    900
                }
            );
            if site == "AppendValue" {
                for pair in values.as_chunks::<2>().0 {
                    assert_eq!(pair, &[json!("reporter-shadow"), json!("after")]);
                }
            } else if site == "AppendTarget" {
                for pair in values.as_chunks::<2>().0 {
                    assert_eq!(pair, &[json!("appended"), json!("after")]);
                }
            } else if site == "Branch" {
                assert_eq!(vm.variable_text("numeric"), "900");
            }
            if site == "Call" {
                assert_eq!(vm.variable_text("captured"), "reporter-shadow");
                assert_eq!(
                    snapshot["variables"]["captured_alias"],
                    snapshot["lists"]["items-b"]
                );
            }
            let op = if site.starts_with("Append") {
                "AppendList"
            } else {
                site
            };
            assert_native_helper(&vm, &format!("native/reentrant-{op}"));
        }
    }
}

#[test]
fn hot_reentrant_reporter_errors_done_and_restart_stop_at_the_same_boundary() {
    use serde_json::json;
    for k4 in [false, true] {
        for site in ["Call", "Branch", "AppendValue", "AppendTarget"] {
            for ending in ["error", "done", "restart"] {
                let list = json!({"type":"pure_list_get","fields":{"list":"items"}});
                let eval = reporter("boundary", &[]);
                let operation = match site {
                    "Call" => call("capture", &[("value", eval)]),
                    "Branch" => branch(eval, set("numeric", get("tick"))),
                    "AppendValue" => append(list.clone(), eval),
                    "AppendTarget" => append(eval, text("value")),
                    _ => unreachable!(),
                };
                let mut p = private_project(
                    chain(vec![
                        changed("tick", num(1.0), false),
                        operation,
                        set("after", get("tick")),
                    ]),
                    json!(0),
                    k4,
                );
                p["variables"]["variablesDict"]["items"] =
                    json!({"id":"items","type":"list","value":[],"isGlobal":true});
                p["procedures"]["proceduresDict"]["capture"] =
                    procedure(&[("value", "String")], set("numeric", parameter("value")));
                let terminal = match ending {
                    "error" => {
                        // Self-append always fails in both KN/K4; it does not
                        // depend on their intentionally different index policy.
                        let mut block = append(list.clone(), list.clone());
                        block["id"] = json!("reporter-cycle");
                        block
                    }
                    "done" => json!({"type":"stop","fields":{"scope":"0"}}),
                    "restart" => json!({"type":"restart"}),
                    _ => unreachable!(),
                };
                p["procedures"]["proceduresDict"]["boundary"] = procedure(
                    &[],
                    chain(vec![
                        branch(
                            json!({"type":"logic_compare","fields":{"OP":"GT"},"inputs":{"A":get("tick"),"B":num(850.0)}}),
                            terminal,
                        ),
                        returned(if site == "AppendTarget" {
                            list
                        } else {
                            text("ok")
                        }),
                    ]),
                );
                let op = if site.starts_with("Append") {
                    "AppendList"
                } else {
                    site
                };
                if ending == "restart" {
                    // A real restart is intentionally non-terminating. Bound
                    // observations instead of asking compare_hot to finish;
                    // hot counters/regions survive start and runtime restarts.
                    let mut a = engine(&p, false);
                    let mut b = engine(&p, true);
                    b.enable_jit_profile();
                    for start in 0..2 {
                        a.start();
                        b.start();
                        for frame in 0..3 {
                            let x = a
                                .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                                .unwrap();
                            let y = b
                                .advance(1.0 / 60.0, 100_000, Duration::from_secs(5))
                                .unwrap();
                            assert_eq!(
                                a.jit_debug_snapshot(),
                                b.jit_debug_snapshot(),
                                "{site} k4={k4}, start={start}, frame={frame}"
                            );
                            assert_eq!(a.debug_snapshot(), b.debug_snapshot());
                            assert_eq!(
                                normalized(&encode_frame(&x).unwrap()),
                                normalized(&encode_frame(&y).unwrap())
                            );
                            assert_eq!(x.budget_yield, y.budget_yield);
                            a.recycle_lines(x.lines);
                            b.recycle_lines(y.lines);
                        }
                    }
                    assert_native_helper(&b, &format!("native/reentrant-{op}"));
                } else {
                    let expected_error = if ending == "error" {
                        Some("cyclic list at reporter-cycle")
                    } else if site == "AppendTarget" {
                        // stop-all ends the reporter before ReturnValue, so it
                        // produces Null. The outer instruction still resolves
                        // that target: resolve_list rejects it in both KN/K4,
                        // even though the enclosing task has already stopped.
                        Some("list operation received a non-list value")
                    } else {
                        None
                    };
                    let vm = compare_hot(&p, expected_error);
                    assert_eq!(vm.variable_text("tick"), "851");
                    assert_eq!(vm.variable_text("after"), "850");
                    assert_native_helper(&vm, &format!("native/reentrant-{op}"));
                }
            }
        }
    }
}

/// Many loops turn hot in the same frame. Compilation is spread over frames
/// (at most two regions per frame) so one frame never stalls on all of them,
/// and the result stays identical to the interpreter.
#[test]
fn hot_regions_compile_over_several_frames() {
    let ids: Vec<String> = (0..6).map(|i| format!("v{i}")).collect();
    let mut p = nekoc::studio::document::Document::blank().value().clone();
    for id in &ids {
        p["variables"]["variablesDict"][id] =
            serde_json::json!({"id":id,"value":0,"isGlobal":true});
    }
    // One script per loop: each script's code is its own region.
    let scripts: Vec<Value> = ids
        .iter()
        .map(|id| {
            let body = serde_json::json!({"type":"repeat_n_times","inputs":{"times":num(900.0)},
                "statements":{"DO":set(id, serde_json::json!({"type":"math_arithmetic",
                    "fields":{"type":"add"},"inputs":{"A":get(id),"B":num(1.0)}}))}});
            serde_json::json!({"type":"on_running_group_activated","next":{"type":"repeat_forever",
                "statements":{"DO":{"type":"warp","statements":{"DO":body}}}}})
        })
        .collect();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = Value::Array(scripts);
    let mut a = engine(&p, false);
    let mut b = engine(&p, true);
    b.enable_jit_profile();
    let mut regions = vec![];
    for _ in 0..6 {
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
        assert_eq!(a.debug_snapshot(), b.debug_snapshot());
        regions.push(b.jit_profile()["regions"].as_u64().unwrap());
    }
    let mut previous = 0;
    for &count in &regions {
        assert!(count - previous <= 2, "{regions:?}");
        previous = count;
    }
    assert!(
        regions[5] >= 6,
        "every loop is eventually compiled: {regions:?}"
    );
}

/// Native repeat tails take a fast path when profiling is off. Run without a
/// profile (so that path is the one under test) through nested final
/// iterations, KN's count-only warp yields (tail 30002 under the virtual
/// clock) and pen output, comparing every frame with the interpreter.
#[test]
fn unprofiled_native_repeat_tails_match_the_interpreter() {
    let inc = |id: &str| {
        set(
            id,
            serde_json::json!({"type":"math_arithmetic","fields":{"type":"add"},
                "inputs":{"A":get(id),"B":num(1.0)}}),
        )
    };
    let repeat = |times: f64, body: Value| {
        serde_json::json!({"type":"repeat_n_times","inputs":{"times":num(times)},
            "statements":{"DO":body}})
    };
    let mut p = nekoc::studio::document::Document::blank().value().clone();
    for id in ["inner", "outer", "frames", "x"] {
        p["variables"]["variablesDict"][id] =
            serde_json::json!({"id":id,"value":0,"isGlobal":true});
    }
    let counting = chain(vec![
        serde_json::json!({"type":"warp","statements":{"DO":repeat(
            50.0,
            chain(vec![repeat(1500.0, inc("inner")), inc("outer")]),
        )}}),
        inc("frames"),
    ]);
    let drawing = serde_json::json!({"type":"warp","statements":{"DO":repeat(
        700.0,
        chain(vec![
            inc("x"),
            serde_json::json!({"type":"self_move_to","inputs":{"x":get("x"),"y":num(0.0)}}),
            // (x - x) / 0 is NaN: that axis keeps its value, y still moves.
            serde_json::json!({"type":"self_move_to","inputs":{
                "x":{"type":"math_arithmetic","fields":{"type":"divide"},"inputs":{
                    "A":{"type":"math_arithmetic","fields":{"type":"minus"},
                        "inputs":{"A":get("x"),"B":get("x")}},
                    "B":num(0.0)}},
                "y":get("x")}}),
        ]),
    )}});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = serde_json::json!([
        {"type":"on_running_group_activated","next":{"type":"repeat_forever",
            "statements":{"DO":counting}}},
        {"type":"on_running_group_activated","next":{"type":"self_pen_down","next":{
            "type":"repeat_forever","statements":{"DO":drawing}}}}
    ]);
    let mut a = engine(&p, false);
    let mut b = engine(&p, true);
    let mut lines = 0;
    for frame in 0..120 {
        let x = a
            .advance(1.0 / 60.0, 10_000_000, Duration::from_secs(5))
            .unwrap();
        let y = b
            .advance(1.0 / 60.0, 10_000_000, Duration::from_secs(5))
            .unwrap();
        assert_eq!(
            normalized(&encode_frame(&x).unwrap()),
            normalized(&encode_frame(&y).unwrap()),
            "frame {frame}"
        );
        assert_eq!(a.debug_snapshot(), b.debug_snapshot(), "frame {frame}");
        lines += y.lines.len();
        a.recycle_lines(x.lines);
        b.recycle_lines(y.lines);
    }
    let state = b.debug_snapshot();
    // Each warp runs 75,050 tails, so KN yields inside it and one pass of the
    // forever body spans several frames; it must still have completed passes.
    let passes = state["variables"]["frames"].as_f64().unwrap();
    assert!(passes > 0.0 && passes < 60.0, "{passes}");
    assert!(lines > 0);
}
