use nekoc::{
    bcmkn_compiler,
    engine::{Engine, Program},
};
use serde_json::Value;
use std::{fs, time::Duration};
use tempfile::tempdir;

fn compile(source: &str) -> Value {
    compile_modules(source, &[])
}

fn compile_modules(source: &str, modules: &[(&str, &str)]) -> Value {
    let dir = tempdir().unwrap();
    let input = dir.path().join("objects.ts");
    let output = dir.path().join("objects.bcmkn");
    fs::write(&input, source).unwrap();
    for (name, contents) in modules {
        fs::write(dir.path().join(name), contents).unwrap();
    }
    bcmkn_compiler::compile_ts_bcmkn(&input, "samples/kitten-n-0.27.4.bcmkn", &output).unwrap();
    let project: Value = serde_json::from_slice(&fs::read(output).unwrap()).unwrap();
    fn inspect(value: &Value) {
        match value {
            Value::Object(map) => {
                if let Some(kind) = map.get("type").and_then(Value::as_str) {
                    assert!(!kind.starts_with("_object_"), "private block {kind}");
                }
                map.values().for_each(inspect);
            }
            Value::Array(items) => items.iter().for_each(inspect),
            _ => {}
        }
    }
    inspect(&project);
    project
}

fn logs(project: &Value, jit: bool) -> Vec<String> {
    let mut engine = Engine::new(Program::compile(project).unwrap());
    if !jit {
        engine.disable_jit();
    }
    engine.use_virtual_clock();
    engine.start();
    let mut logs = Vec::new();
    for _ in 0..120 {
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
            .unwrap();
        logs.extend(frame.logs);
    }
    logs
}

#[test]
fn shared_objects_match_independent_javascript_scalar_oracle_in_both_tiers() {
    let project = compile(include_str!("fixtures/ts-share-objects.ts"));
    let expected = [
        "alias",
        "12",
        "1",
        "true",
        "fresh objects and arguments",
        "8",
        "3",
        "false",
        "10",
        "1",
        "3",
        "13",
        "true",
        "7",
        "2",
        "4",
        "nested",
        "20",
        "20",
        "10",
        "4",
        "20",
        "array members",
        "22",
        "14",
        "7",
        "3",
        "23",
        "reference evaluated once",
        "12",
        "1",
        "1",
        "13",
        "1",
        "13",
        "5",
        "compound assignments",
        "15",
        "12",
        "24",
        "6",
        "2",
        "8",
        "ab",
        "ab2",
        "9",
        "10",
        "9",
        "8",
        "static keys",
        "9",
        "ok",
        "6",
        "4",
    ];
    for jit in [false, true] {
        assert_eq!(logs(&project, jit), expected, "jit={jit}");
    }
}

#[test]
fn interval_and_sprite_start_share_initialized_object_handles() {
    let project = compile(
        r#"
        const state = { value: 0 };
        const alias = state;
        const interval = setInterval(() => {
            alias.value++;
            if (state.value === 3) { clearInterval(interval); console.log(state.value); }
        }, 20);
        sprite("cat", {}, () => { onStart(() => { console.log(state.value); }); });
    "#,
    );
    for jit in [false, true] {
        assert_eq!(logs(&project, jit), ["0", "3"], "jit={jit}");
    }
}

#[test]
fn nested_objects_lists_and_booleans_in_interval_match_scalar_results() {
    let project = compile(include_str!("fixtures/ts-share-object-timer.ts"));
    for jit in [false, true] {
        assert_eq!(logs(&project, jit), ["3", "7", "5", "true"], "jit={jit}");
    }
}

#[test]
fn typed_object_callbacks_preserve_string_and_reference_values() {
    let project = compile(
        r#"
        const items = [{text: "a", value: 1}];
        const alias = items[0];
        items.forEach((item: {text: string, value: number}) => {
            item.text += 2;
            item.value++;
        });
        console.log(alias.text);
        console.log(alias.value);
        "#,
    );
    for jit in [false, true] {
        assert_eq!(logs(&project, jit), ["a2", "2"], "jit={jit}");
    }
}

#[test]
fn callback_type_aliases_keep_their_original_module_scope() {
    let project = compile_modules(
        r#"
        import {value} from "./helper";
        type Item = {text: string};
        const items = [{text: "a"}];
        items.forEach((item: Item) => { item.text += 2; });
        console.log(items[0].text);
        "#,
        &[("helper.ts", "export function value() { return 1; }")],
    );
    for jit in [false, true] {
        assert_eq!(logs(&project, jit), ["a2"], "jit={jit}");
    }
}
