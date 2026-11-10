//! Local oracle trace helper. The browser harness consumes this JSON contract.
use anyhow::{Context, Result, ensure};
use clap::Parser;
use nekoc::{engine::Engine, engine::Program, kitten4};
use serde_json::json;
use std::{path::PathBuf, time::Duration};

#[derive(Parser)]
struct Args {
    #[command(flatten)]
    cloud: nekoc::cloud::CloudOptions,
    input: PathBuf,
    #[arg(long, default_value_t = 60)]
    frames: u32,
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Force the official AST importer, even if editable workspaces exist.
    #[arg(long)]
    compiled: bool,
    /// Emit the lowered VM input for structural comparison (not a bytecode proof).
    #[arg(long)]
    lowered: bool,
    /// Dump the complete VM program (including diagnostic source IDs).
    #[arg(long)]
    program: bool,
    #[arg(long)]
    blocks: bool,
    #[arg(long)]
    interpreter: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let text = std::fs::read_to_string(&args.input)?;
    let mut source = nekoc::json::from_str(text.trim_start_matches('\u{feff}'))?;
    if args.compiled {
        ensure!(
            source["compile_result"].is_array(),
            "missing compile_result"
        );
        for section in ["scenes", "actors"] {
            for entity in source["theatre"][section]
                .as_object_mut()
                .context("missing theatre section")?
                .values_mut()
            {
                entity
                    .as_object_mut()
                    .context("invalid entity")?
                    .remove("block_data_json");
            }
        }
    }
    let project = kitten4::to_neko(&source)?;
    if args.lowered {
        println!(
            "{}",
            String::from_utf8(nekoc::json::to_vec(&kitten4::lower_for_vm(&project))?)?
        );
        return Ok(());
    }
    let program = Program::compile(&project)?;
    if args.program {
        println!("{}", json!({"program": program.oracle_program()}));
        return Ok(());
    }
    let mut engine = Engine::new(program);
    if let Some(backend) = args.cloud.backend() {
        engine.set_cloud_backend(
            backend,
            args.cloud.cloud_namespace.clone().unwrap(),
            args.cloud.cloud_user.clone(),
        )?;
    }
    if args.blocks {
        engine.trace_blocks();
    } else if args.interpreter {
        engine.disable_jit();
    }
    engine.set_random_seed(args.seed);
    engine.start();
    let mut frames = Vec::new();
    for frame in 1..=args.frames {
        let update = match engine.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5)) {
            Ok(update) => update,
            Err(error) if args.blocks => {
                println!(
                    "{}",
                    json!({"schema":"nekoc-k4-trace-v1", "frames":frames,
                    "events":engine.take_oracle_events(), "error":format!("{error:#}"),
                    "failedFrame":engine.oracle_snapshot(frame)})
                );
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        ensure!(
            !update.budget_yield,
            "frame {frame} exceeded execution budget"
        );
        frames.push(engine.oracle_snapshot(frame));
    }
    println!(
        "{}",
        json!({"schema":"nekoc-k4-trace-v1", "fps":60, "seed":args.seed, "frames":frames,
            "events":engine.take_oracle_events()})
    );
    Ok(())
}
