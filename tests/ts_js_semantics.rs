//! Batch frontend -> in-memory KN assembly -> bytecode (JIT disabled) -> Node.
use nekoc::{
    bcmkn_compiler,
    engine::{Engine, Program},
};
use serde_json::Value;
use std::{process::Command, time::Duration};

fn run(report: &Value) -> anyhow::Result<String> {
    let project = bcmkn_compiler::assemble_workspace_bcmkn(
        report,
        "synthetic TS semantics",
        bcmkn_compiler::default_template(),
    )?;
    let (project, _) = nekoc::bcmkn::import(project)?;
    let mut engine = Engine::new(Program::compile(&project)?);
    engine.disable_jit();
    engine.use_virtual_clock();
    engine.set_random_seed(1);
    engine.start();
    for _ in 0..60 {
        engine.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))?;
    }
    anyhow::ensure!(
        engine.active_tasks() == 0,
        "unfinished after 60 virtual ticks"
    );
    Ok(engine.variable_text("kn-var-out"))
}

fn same(actual: &str, expected: &str) -> bool {
    if actual == expected {
        return true;
    }
    // Preserve the old probe's tolerance only for finite, nonempty numbers.
    match (actual.parse::<f64>(), expected.parse::<f64>()) {
        (Ok(a), Ok(b)) if a.is_finite() && b.is_finite() => {
            (a - b).abs() <= 1e-9 * b.abs().max(1.0)
        }
        _ => false,
    }
}

#[test]
fn synthetic_ts_js_semantics() {
    // The corpus deliberately reaches the VM's 200-level reporter recursion
    // guard. Windows' small test-thread stack can overflow before that guard;
    // reserve a deterministic stack for the batch, not a timing allowance.
    stacker::grow(64 * 1024 * 1024, run_corpus);
}

fn run_corpus() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let temp = tempfile::tempdir().unwrap();
    let prepared = temp.path().join("prepared.json");
    let output = Command::new("node")
        .current_dir(root)
        .arg("tests/ts-js-semantics/prepare.mjs")
        .arg(&prepared)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(prepared).unwrap()).unwrap();
    assert_eq!(cases.len(), 271);
    let mut failures = Vec::new();
    for c in cases {
        let label = format!("{} {}", c["id"], c["name"]);
        let check = || -> anyhow::Result<()> {
            if c["status"] == "compile-error" {
                let error = c["compileError"]
                    .as_str()
                    .unwrap_or("<compilation succeeded>");
                let fragment = c["expectedError"].as_str().unwrap();
                anyhow::ensure!(
                    error.contains(fragment),
                    "expected compile error {fragment:?}, got {error:?}"
                );
                return Ok(());
            }
            let expected = c["node"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Node oracle failed: {}", c["nodeError"]))?;
            if let Some(baseline) = c["baselineNode"].as_str() {
                anyhow::ensure!(
                    expected == baseline,
                    "Node oracle changed: {expected:?} != {baseline:?}"
                );
            }
            anyhow::ensure!(
                c.get("compileError").is_none(),
                "compile failed: {}",
                c["compileError"]
            );
            let actual = run(&c["report"]);
            if c["status"] == "known-diff" {
                if let Some(fragment) = c["expectedError"].as_str() {
                    let error = actual
                        .err()
                        .map(|e| format!("{e:#}"))
                        .unwrap_or_else(|| "<VM succeeded>".into());
                    anyhow::ensure!(
                        error.contains(fragment),
                        "expected VM error {fragment:?}, got {error:?}"
                    );
                } else {
                    let actual = actual?;
                    anyhow::ensure!(
                        actual == c["expectedVm"].as_str().unwrap(),
                        "known difference changed: {actual:?}"
                    );
                    anyhow::ensure!(
                        !same(&actual, expected),
                        "difference now matches Node; reclassify"
                    );
                }
            } else {
                let actual = actual?;
                anyhow::ensure!(
                    same(&actual, expected),
                    "Node={expected:?}, bytecode={actual:?}"
                );
            }
            Ok(())
        };
        if let Err(error) = check() {
            failures.push(format!("{label}: {error:#}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
