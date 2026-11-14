use nekoc::engine::{Engine, Program};
use serde_json::Value;
use std::time::Duration;

#[test]
fn named_tell_targets_use_allocated_actor_ids() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("tell.ts");
    let output = dir.path().join("tell.bcmkn");
    std::fs::write(
        &input,
        r#"sprite("receiver", {}, self => {});
onStart(() => {
  tell("receiver", () => { setVar("asyncSeen", 1); });
  tellAndWait("receiver", () => { setVar("syncSeen", 2); });
});"#,
    )
    .unwrap();
    nekoc::bcmkn_compiler::compile_ts_bcmkn(&input, "samples/kitten-n-0.27.4.bcmkn", &output)
        .unwrap();
    let project: Value = serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
    let actors = project["actors"]["actorsDict"].as_object().unwrap();
    let target = actors
        .iter()
        .find(|(_, a)| a["name"] == "receiver")
        .unwrap()
        .0;
    let mut pending = vec![&project];
    let mut calls = 0;
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(object) => {
                if matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("tell" | "sync_tell")
                ) {
                    assert_eq!(object["fields"]["sprite"], target.as_str());
                    calls += 1;
                }
                pending.extend(object.values());
            }
            Value::Array(items) => pending.extend(items),
            _ => {}
        }
    }
    assert_eq!(calls, 2);
    let mut engine = Engine::new(Program::compile(&project).unwrap());
    engine.use_virtual_clock();
    engine.start();
    engine
        .advance(1.0, 100_000, Duration::from_secs(2))
        .unwrap();
    assert_eq!(engine.variable_value("kn-var-asyncSeen").text(), "1");
    assert_eq!(engine.variable_value("kn-var-syncSeen").text(), "2");
}

#[test]
fn tsfeat_compiler_results_match_javascript_in_both_vm_tiers() {
    let source = r#"
let block = 0, chain = 0, comma = 0, nested = 0, expression = 0;
let arrow = 0, hoisted = 0, parameter = 0, higher = 0;
let nullish = false, uninitialized = false, kind = "", fixed = "";
let decimal = "", nan = false, code = 0, character = "", last = "", sliced = "", serialized = "";
let count = 0, discarded = 0, initializedSequence = 0;
function inc() { count++; return count; }
function sequenceReturn() { return (inc(), 42); }
function sequenceInitializer() { const x = (inc(), 43); return x; }
function numberText(n: number) { return n.toString(); }
onStart(() => {
  let x = 1; { let x = 2; block = x; } block = block * 10 + x;
  let a = 0, b = 0; a = b = 3; chain = a + b;
  let c = (a = 2, a + 3); comma = c;
  function outer(n: number) { function inner(x: number) { return x + n; } return inner(3); }
  nested = outer(2);
  const f = function(n: number) { return n * 2; }; expression = f(3);
  const g = (n: number) => n + 2; arrow = g(3);
  hoisted = late(3); function late(n: number) { return n + 4; }
  function increment(n: number) { n = n + 1; return n; } parameter = increment(3);
  function apply(f, n: number) { return f(n); } higher = apply(g, 5);
  let nil = null; nullish = nil === null;
  let missing; uninitialized = missing === undefined;
  let value = 1; kind = typeof value;
  fixed = (1.005).toFixed(2); decimal = numberText(12.5);
  nan = isNaN("bad") && Number.isNaN(NaN);
  code = "猫".charCodeAt(0); character = String.fromCharCode(65);
  last = "abc".at(-1); let text = "abcdef"; sliced = text.slice(-3, -1);
  serialized = JSON.stringify([1, 2, 3]);
  discarded = sequenceReturn();
  initializedSequence = sequenceInitializer();
});
"#;
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("tsfeat.ts");
    let output = dir.path().join("tsfeat.bcmkn");
    std::fs::write(&input, source).unwrap();
    nekoc::bcmkn_compiler::compile_ts_bcmkn(&input, "samples/kitten-n-0.27.4.bcmkn", &output)
        .unwrap();
    let project: Value = serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
    for jit in [false, true] {
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        if !jit {
            engine.disable_jit();
        }
        engine.use_virtual_clock();
        engine.start();
        for _ in 0..60 {
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
                .unwrap();
        }
        for (name, expected) in [
            ("block", "21"),
            ("chain", "6"),
            ("comma", "5"),
            ("nested", "5"),
            ("expression", "6"),
            ("arrow", "5"),
            ("hoisted", "7"),
            ("parameter", "4"),
            ("higher", "7"),
            ("nullish", "true"),
            ("uninitialized", "true"),
            ("kind", "number"),
            ("fixed", "1.00"),
            ("decimal", "12.5"),
            ("nan", "true"),
            ("code", "29483"),
            ("character", "A"),
            ("last", "c"),
            ("sliced", "de"),
            ("serialized", "[1,2,3]"),
            ("count", "2"),
            ("discarded", "42"),
            ("initializedSequence", "43"),
        ] {
            assert_eq!(
                engine.variable_value(&format!("kn-var-{name}")).text(),
                expected,
                "{name} jit={jit}"
            );
        }
    }
}
