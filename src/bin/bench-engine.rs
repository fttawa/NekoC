use anyhow::{Result, ensure};
use clap::Parser;
use nekoc::{
    engine::{Engine, Program},
    runtime::{Runtime, RuntimeValue},
    studio::document::Document,
};
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 100_000)]
    iterations: usize,
    #[arg(long, default_value_t = 9)]
    rounds: usize,
    #[arg(long)]
    out: Option<PathBuf>,
}
fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.rounds > 0 && args.iterations > 0 && args.iterations <= 10_000_000,
        "invalid benchmark size"
    );
    let mut project = Document::blank().value().clone();
    project["variables"]["variablesDict"]["score"] = json!({"id":"score","value":0});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":{"type":"math_number","fields":{"NUM":args.iterations}}},
            "statements":{"DO":{"type":"variables_set","fields":{"variable":"score"},"inputs":{"value":{
                "type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":{"type":"variables_get","fields":{"variable":"score"}},"B":{"type":"math_number","fields":{"NUM":3}}}
            }}}
        }}}}
    }]);
    let mut old_times = vec![];
    let mut new_times = vec![];
    let mut compile_times = vec![];
    for round in 0..=args.rounds {
        let mut old = Runtime::from_project(&project)?;
        old.set_cooperative(true);
        old.start();
        let start = Instant::now();
        while old.active_threads() > 0 {
            old.run_ticks(1)?;
        }
        let old_ms = start.elapsed().as_secs_f64() * 1000.0;
        ensure!(
            old.snapshot().variables["score"] == RuntimeValue::Number((args.iterations * 3) as f64),
            "reference result mismatch"
        );
        let start = Instant::now();
        let program = Program::compile(&project)?;
        let compile_us = start.elapsed().as_micros();
        let mut new = Engine::new(program);
        new.start();
        let start = Instant::now();
        while new.active_tasks() > 0 {
            let frame = new.advance(1.0 / 60.0, 500_000, Duration::from_millis(4))?;
            new.recycle_lines(frame.lines);
        }
        let new_ms = start.elapsed().as_secs_f64() * 1000.0;
        ensure!(
            new.numeric_variables()[0] == (args.iterations * 3) as f64,
            "compiled result mismatch"
        );
        if round > 0 {
            old_times.push(old_ms);
            new_times.push(new_ms);
            compile_times.push(compile_us);
        }
    }
    let median = |v: &[f64]| {
        let mut v = v.to_vec();
        v.sort_by(f64::total_cmp);
        v[v.len() / 2]
    };
    let report = json!({"benchmark":"numeric-slot-loop-v1","profile":if cfg!(debug_assertions){"debug"}else{"release"},"iterations":args.iterations,"rounds":args.rounds,
        "reference_ms":old_times,"compiled_ms":new_times,"compile_us":compile_times,"median_reference_ms":median(&old_times),"median_compiled_ms":median(&new_times),"median_speedup":median(&old_times)/median(&new_times),
        "result_verified":true,"scope":"Numeric loop microbenchmark. Does not measure full-project compatibility, HTTP, GPU, or all workloads."});
    let text = serde_json::to_string_pretty(&report)?;
    println!("{text}");
    if let Some(path) = args.out {
        std::fs::write(path, text)?;
    }
    Ok(())
}
