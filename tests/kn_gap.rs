use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

fn number(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn local() -> Value {
    json!({"type":"_variable_get","fields":{"VAR":"x"}})
}
fn log(value: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":value}})
}
fn chain(blocks: Vec<Value>) -> Value {
    blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}
fn fixture() -> Value {
    let mut blocks = vec![
        json!({"type":"_variable_set","fields":{"VAR":"x"},"inputs":{"VALUE":number(7.0)}}),
        log(local()),
        json!({"type":"_variable_set","fields":{"VAR":"x"},"inputs":{"VALUE":text("5")}}),
    ];
    for (kind, value) in [
        ("math_add_assign", 2.0),
        ("math_sub_assign", 1.0),
        ("math_mul_assign", 3.0),
        ("math_div_assign", 2.0),
        ("math_mod_assign", 4.0),
        ("math_increment", 0.0),
        ("math_decrement", 0.0),
    ] {
        let mut block = json!({"type":kind,"fields":{"VAR":"x"}});
        if !matches!(kind, "math_increment" | "math_decrement") {
            block["inputs"] = json!({"value":number(value)});
        }
        blocks.push(block);
        blocks.push(log(local()));
    }
    blocks.extend([
        log(json!({"type":"logic_to_boolean","inputs":{"VALUE":text("0")}})),
        log(json!({"type":"btoa","inputs":{"data":text("Hello")}})),
        log(json!({"type":"atob","inputs":{"encoded":text("SGVsbG8=")}})),
        log(json!({"type":"parseInt","fields":{"radix":"16"},"inputs":{"str":text(" -0xfftail")}})),
        log(json!({"type":"parseFloat","inputs":{"str":text(" -12.5e2tail")}})),
        log(json!({"type":"isNaN","inputs":{"value":text("bad")}})),
        log(json!({"type":"isFinite","inputs":{"value":number(42.0)}})),
    ]);
    let mut project = Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","id":"gap-start","next":chain(blocks)}
    ]);
    // All project files emitted by this test use the same deterministic ids.
    fn ids(block: &mut Value, next: &mut usize, parent: &str) {
        if !block.is_object() {
            return;
        }
        *next += 1;
        let id = format!("gap-{next}");
        block["id"] = json!(id);
        block["parent_id"] = json!(parent);
        block["shield"] = json!(false);
        for key in ["inputs", "statements"] {
            if let Some(children) = block.get_mut(key).and_then(Value::as_object_mut) {
                for child in children.values_mut() {
                    ids(child, next, &id);
                }
            }
        }
        if let Some(child) = block.get_mut("next") {
            ids(child, next, &id);
        }
    }
    ids(
        &mut project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0],
        &mut 0,
        "",
    );
    project
}
fn run(project: &Value) -> Vec<String> {
    let mut vm = Engine::new(Program::compile(project).unwrap());
    vm.start();
    let mut logs = vec![];
    for _ in 0..20 {
        let frame = vm
            .advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
            .unwrap();
        logs.extend(frame.logs);
    }
    logs
}

#[test]
fn sixteen_catalog_gaps_execute_in_native_project() {
    let project = fixture();
    assert_eq!(
        run(&project),
        [
            "7", "7", "6", "18", "9", "1", "2", "1", "true", "SGVsbG8=", "Hello", "-255", "-1250",
            "false", "true"
        ]
    );
    // Opt-in artifact only: caller must run tools/editor-compat.mjs on this file.
    if std::env::var_os("NEKOC_WRITE_KN_GAP_FIXTURE").is_some() {
        std::fs::create_dir_all("dist/kngap").unwrap();
        std::fs::write(
            "dist/kngap/scalars.bcmkn",
            serde_json::to_vec_pretty(&project).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn helpers_cover_prefix_invalid_and_latin1_edges() {
    let mut project = fixture();
    let mut blocks = vec![];
    for (kind, key, values) in [
        (
            "parseFloat",
            "str",
            vec![
                "1.e2x",
                "1e+x",
                ".25!",
                "Infinity!",
                "bad",
                "\u{feff}12!",
                "\u{85}12!",
            ],
        ),
        ("btoa", "data", vec!["é", "猫", ""]),
        (
            "atob",
            "encoded",
            vec!["6Q==", "YQ", " Y Q ==\n", "Y!Q==", "Y==="],
        ),
    ] {
        for value in values {
            blocks.push(log(json!({"type":kind,"inputs":{key:text(value)}})));
        }
    }
    for (value, radix) in [
        ("0xff", 0.0),
        ("101tail", 2.0),
        ("09", 10.0),
        ("10", 1.0),
        ("-0", 10.0),
    ] {
        blocks.push(log(
            json!({"type":"parseInt","fields":{"radix":radix},"inputs":{"str":text(value)}}),
        ));
    }
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
        chain(blocks);
    assert_eq!(
        run(&project),
        [
            "100", "1", "0.25", "Infinity", "NaN", "12", "NaN", "6Q==", "", "", "é", "a", "a", "",
            "", "255", "5", "9", "NaN", "0"
        ]
    );
}

#[test]
fn compound_assignment_recovers_nan_and_preserves_ieee_remainder() {
    let mut project = fixture();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
        chain(vec![
            json!({"type":"_variable_set","fields":{"VAR":"x"},"inputs":{"VALUE":text("bad")}}),
            json!({"type":"math_mul_assign","fields":{"VAR":"x"},"inputs":{"value":number(2.0)}}),
            log(local()),
            json!({"type":"math_increment","fields":{"VAR":"x"}}),
            log(local()),
            json!({"type":"math_div_assign","fields":{"VAR":"x"},"inputs":{"value":number(0.0)}}),
            log(local()),
            json!({"type":"math_mod_assign","fields":{"VAR":"x"},"inputs":{"value":number(0.0)}}),
            log(local()),
            json!({"type":"math_decrement","fields":{"VAR":"x"}}),
            log(local()),
        ]);
    assert_eq!(run(&project), ["NaN", "1", "NaN", "NaN", "-1"]);
}

#[test]
fn hot_loop_side_exits_for_code_view_helpers_and_compound_assignments() {
    let mut project = fixture();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] = chain(
        vec![
            log(local()), // An undeclared code variable is NaN, not legacy local zero.
            json!({"type":"_variable_set","fields":{"VAR":"x"},"inputs":{"VALUE":number(0.0)}}),
            json!({"type":"warp","statements":{"DO":{
                "type":"repeat_n_times","inputs":{"times":number(2500.0)},"statements":{"DO":chain(vec![
                    json!({"type":"math_add_assign","fields":{"VAR":"x"},"inputs":{"value":{
                        "type":"parseFloat","inputs":{"str":text("1suffix")}
                    }}}),
                    json!({"type":"variables_set","fields":{"variable":"sum"},"inputs":{"value":{
                        "type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":local(),"B":{
                            "type":"parseInt","fields":{"radix":"2"},"inputs":{"str":text("10")}
                        }}
                    }}}),
                ])}
            }}}),
            log(local()),
            log(json!({"type":"variables_get","fields":{"variable":"sum"}})),
        ],
    );
    assert_eq!(run(&project), ["NaN", "2500", "2502"]);
}

#[test]
fn number_predicates_are_strict_and_boolean_conversion_uses_value_truthiness() {
    let mut project = fixture();
    let nan = json!({"type":"parseFloat","inputs":{"str":text("bad")}});
    let infinity = json!({"type":"parseFloat","inputs":{"str":text("Infinity")}});
    let mut blocks = vec![];
    for value in [text("12"), text("bad"), number(12.0), nan, infinity] {
        blocks.push(log(json!({"type":"isNaN","inputs":{"value":value}})));
        blocks.push(log(json!({"type":"isFinite","inputs":{"value":value}})));
        blocks.push(log(
            json!({"type":"logic_to_boolean","inputs":{"VALUE":value}}),
        ));
    }
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
        chain(blocks);
    assert_eq!(
        run(&project),
        [
            "false", "false", "true", "false", "false", "true", "false", "true", "true", "true",
            "false", "false", "false", "false", "true"
        ]
    );
}

#[test]
fn workspace_compiler_preserves_unknown_types_without_claiming_vm_support() {
    let roots = nekoc::bcmkn_compiler::workspace_data_to_neko_blocks(&json!({
        "blocks":{"a":{"id":"a","type":"future_unknown_gap_block","fields":{"custom":"kept"}}}
    }))
    .unwrap();
    assert_eq!(roots[0]["type"], "future_unknown_gap_block");
    assert_eq!(roots[0]["fields"]["custom"], "kept");
    let mut project = fixture();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0]["next"] =
        roots[0].clone();
    let error = Program::compile(&project).unwrap_err();
    assert!(format!("{error:#}").contains("future_unknown_gap_block"));
}
