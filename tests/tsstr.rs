use nekoc::engine::{Engine, Program};
use nekoc::{bcmkn_compiler, project, runtime};
use serde_json::{Value, json};
use std::{fs, time::Duration};
use tempfile::tempdir;

#[test]
fn typescript_string_operations_match_in_both_runtimes() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("tsstr.ts");
    let template = dir.path().join("template.bcmkn");
    let output = dir.path().join("tsstr.bcmkn");
    fs::write(
        &input,
        r#"
function g(): string { return "a"; }

onStart(() => {
    let sequential = "";
    sequential += 1;
    sequential += 2;
    setVar("out_sequential", sequential);

    let nonempty = "x";
    nonempty += 0;
    setVar("out_nonempty", nonempty);

    let unbraced = "";
    for (let unbracedIndex = 0; unbracedIndex < 4; unbracedIndex++)
        unbraced += unbracedIndex;
    setVar("out_unbraced", unbraced);

    let braced = "";
    for (let bracedIndex = 0; bracedIndex < 4; bracedIndex++) {
        braced += bracedIndex;
    }
    setVar("out_braced", braced);

    let prefixed = "x";
    for (let prefixedIndex = 0; prefixedIndex < 3; prefixedIndex++) {
        prefixed += prefixedIndex;
    }
    setVar("out_prefixed", prefixed);

    let a = 1, s = "";
    s += a;
    s += 2;
    setVar("out_multiple", s);

    let typed: string = g();
    setVar("out_typed", typed + typed);
    setVar("out_calls", g() + g());

    const tuple: [number, string] = [1, "a"];
    setVar("out_tuple", tuple[1] + tuple[0]);

    const strings: string[] = ["x", "y"];
    setVar("out_array", strings[0] + strings[1]);

    setVar("out_loose_equal", "5" == 5);
    setVar("out_numeric", Number("12") + parseInt("42px") + parseFloat("3.5"));
});
"#,
    )
    .unwrap();
    fs::write(&template, bcmkn_compiler::DEFAULT_TEMPLATE).unwrap();
    bcmkn_compiler::compile_ts_bcmkn(&input, &template, &output).unwrap();
    let compiled = project::load_project(&output).unwrap().value;
    let value = compiled.clone().into_value();

    let expected: [(&str, Value); 12] = [
        ("out_sequential", json!("12")),
        ("out_nonempty", json!("x0")),
        ("out_unbraced", json!("0123")),
        ("out_braced", json!("0123")),
        ("out_prefixed", json!("x012")),
        ("out_multiple", json!("12")),
        ("out_typed", json!("aa")),
        ("out_calls", json!("aa")),
        ("out_tuple", json!("a1")),
        ("out_array", json!("xy")),
        ("out_loose_equal", json!(true)),
        ("out_numeric", json!(57.5)),
    ];

    let snapshot = runtime::run_project(&value, 120).unwrap();
    let state = serde_json::to_value(snapshot).unwrap();
    for (name, wanted) in &expected {
        // The legacy interpreter's list_item still resolves only named list
        // IDs (src/runtime/eval.rs), not array values from variables_get.
        // Check these frontend cases in the value-capable engine below; the
        // same generated blocks are also exercised in the official KN player.
        if matches!(*name, "out_tuple" | "out_array") {
            continue;
        }
        let id = format!("kn-var-{name}");
        assert_eq!(state["variables"][&id], *wanted, "runtime: {name}");
    }

    let (imported, _) = nekoc::bcmkn::import(compiled).unwrap();
    let mut vm = Engine::new(Program::compile(&imported).unwrap());
    vm.use_virtual_clock();
    vm.start();
    for _ in 0..120 {
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_millis(200))
            .unwrap();
        vm.recycle_lines(frame.lines);
    }
    for (name, wanted) in &expected {
        let id = format!("kn-var-{name}");
        let wanted_text = wanted
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| wanted.to_string());
        assert_eq!(vm.variable_text(&id), wanted_text, "engine: {name}");
    }
}

#[test]
fn typed_callbacks_and_property_addition_match_in_engine() {
    // These object-backed helpers need the Engine; the legacy interpreter
    // rejects _object_set. The same cases also run in the official KN player.
    let dir = tempdir().unwrap();
    let input = dir.path().join("callbacks.ts");
    let template = dir.path().join("template.bcmkn");
    let output = dir.path().join("callbacks.bcmkn");
    fs::write(
        &input,
        r#"
function g(): string { return "a"; }
onStart(() => {
    const strings: string[] = ["x", "y"];
    setVar("out_map", strings.map(x => { return x + x; }).join(""));
    setVar("out_from", Array.from({length: 1}, () => {
        const pair: [number, string] = [1, "a"];
        return pair[1] + pair[0];
    }).join(""));
    setTimeout(() => { setVar("out_timer", g() + g()); }, 0);
    const object = {s: "10"};
    object.s += 1;
    setVar("out_property", object.s);
    const counter = {s: 10};
    counter.s++;
    setVar("out_increment", counter.s);
    setVar("out_unary", Number(+"42") === 42);
});
"#,
    )
    .unwrap();
    fs::write(&template, bcmkn_compiler::DEFAULT_TEMPLATE).unwrap();
    bcmkn_compiler::compile_ts_bcmkn(&input, &template, &output).unwrap();
    let compiled = project::load_project(&output).unwrap().value;
    let (imported, _) = nekoc::bcmkn::import(compiled).unwrap();
    let mut vm = Engine::new(Program::compile(&imported).unwrap());
    vm.use_virtual_clock();
    vm.start();
    for _ in 0..120 {
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_millis(200))
            .unwrap();
        vm.recycle_lines(frame.lines);
    }
    for (name, wanted) in [
        ("out_map", "xxyy"),
        ("out_from", "a1"),
        ("out_timer", "aa"),
        ("out_property", "101"),
        ("out_increment", "11"),
        ("out_unary", "true"),
    ] {
        assert_eq!(
            vm.variable_text(&format!("kn-var-{name}")),
            wanted,
            "{name}"
        );
    }
}
