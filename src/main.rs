use anyhow::{Result, bail};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(
    version,
    about = "Compile TypeScript and inspect Kitten N .bcmkn and Kitten 4 .bcm projects"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Inspect {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Roundtrip {
        input: PathBuf,
        output: PathBuf,
    },
    Diff {
        left: PathBuf,
        right: PathBuf,
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    Decompile {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Workspace {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    CompileTs {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        emit_ir: Option<PathBuf>,
        #[arg(long)]
        emit_analysis: Option<PathBuf>,
        #[arg(long)]
        optimize: bool,
    },
    CompileTsBcmkn {
        input: PathBuf,
        #[arg(long)]
        template: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        optimize: bool,
    },
    /// Compile TypeScript to a native Kitten 4 .bcm project.
    CompileTsKitten4 {
        input: PathBuf,
        /// Optional native Kitten 4 .bcm project whose resources should be reused.
        #[arg(long)]
        template: Option<PathBuf>,
        #[arg(long)]
        out: PathBuf,
    },
    CompileTsScenario {
        input: PathBuf,
        #[arg(long)]
        template: PathBuf,
        #[arg(long)]
        scenario: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Test {
        input: PathBuf,
    },
    Run {
        input: PathBuf,
        /// Headless 60 Hz updates (also accepted as --frames).
        #[arg(long, alias = "frames", default_value_t = 1)]
        ticks: usize,
        /// Use the old KN JSON interpreter and its original snapshot/trace.
        #[arg(long)]
        legacy_runtime: bool,
        /// Fixed Engine PRNG seed (default: 1).
        #[arg(long, conflicts_with = "legacy_runtime")]
        seed: Option<u64>,
        #[command(flatten)]
        cloud: nekoc::cloud::CloudOptions,
        #[arg(long = "event")]
        events: Vec<CliRuntimeEvent>,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long)]
        expect: Option<PathBuf>,
    },
    RunScenario {
        input: PathBuf,
        scenario: PathBuf,
    },
    /// Report which Kitten 4 blocks each work uses that cannot run yet
    Coverage {
        inputs: Vec<PathBuf>,
        /// Frames to run after a successful compile
        #[arg(long, default_value_t = 120)]
        frames: u32,
        /// Fixed PRNG seed (omitted: use the clock).
        #[arg(long)]
        seed: Option<u64>,
    },
    /// Measure import phases (use a release build).
    BenchImport {
        inputs: Vec<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, default_value_t = 0)]
        frames: u32,
        #[arg(long)]
        snapshot: bool,
    },
    Validate {
        input: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Shrink large text lists into a self-extracting .bcmkn that restores them
    /// with blocks when it starts (works in the official player).
    Pack {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Pack lists whose JSON is at least this many KiB.
        #[arg(long, default_value_t = 64)]
        min_kb: usize,
        /// Previous items a copy may reference.
        #[arg(long, default_value_t = 8)]
        window: usize,
        /// Shortest copy; larger means faster unpacking, slightly larger file.
        #[arg(long, default_value_t = 12)]
        min_match: usize,
    },
    /// Restore a packed .bcmkn to its original form.
    Unpack {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    AnalyzeIr {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Watch {
        input: PathBuf,
        #[arg(long)]
        template: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
}

#[derive(Debug, Clone)]
enum CliRuntimeEvent {
    Click {
        x: Option<f64>,
        y: Option<f64>,
    },
    Key {
        key: String,
        state: String,
    },
    Mouse {
        state: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
    },
    Drag {
        actor: String,
        x: f64,
        y: f64,
    },
}

impl FromStr for CliRuntimeEvent {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        if value == "click" {
            return Ok(Self::Click { x: None, y: None });
        }
        if let Some(coordinates) = value.strip_prefix("click:") {
            let (x, y) = parse_mouse_coordinates(coordinates)?;
            return Ok(Self::Click {
                x: Some(x),
                y: Some(y),
            });
        }
        if let Some(key) = value.strip_prefix("key-down:") {
            return Ok(Self::Key {
                key: key.to_owned(),
                state: "down".to_owned(),
            });
        }
        if let Some(key) = value.strip_prefix("key-up:") {
            return Ok(Self::Key {
                key: key.to_owned(),
                state: "up".to_owned(),
            });
        }
        if let Some((state, coordinates)) = value
            .strip_prefix("mouse-down:")
            .map(|coordinates| (Some("down"), coordinates))
            .or_else(|| {
                value
                    .strip_prefix("mouse-up:")
                    .map(|coordinates| (Some("up"), coordinates))
            })
            .or_else(|| {
                value
                    .strip_prefix("mouse-move:")
                    .map(|coordinates| (None, coordinates))
            })
        {
            let (x, y) = parse_mouse_coordinates(coordinates)?;
            return Ok(Self::Mouse {
                state: state.map(ToOwned::to_owned),
                x: Some(x),
                y: Some(y),
            });
        }
        if let Some(args) = value.strip_prefix("drag:") {
            let parts: Vec<&str> = args.split(',').collect();
            if parts.len() == 3 {
                let x = parts[1]
                    .parse::<f64>()
                    .map_err(|e| format!("invalid drag x: {e}"))?;
                let y = parts[2]
                    .parse::<f64>()
                    .map_err(|e| format!("invalid drag y: {e}"))?;
                return Ok(Self::Drag {
                    actor: parts[0].to_owned(),
                    x,
                    y,
                });
            }
        }
        Err(
            "expected click, click:<x>,<y>, key-down:<key>, key-up:<key>, mouse-down:<x>,<y>, mouse-up:<x>,<y>, mouse-move:<x>,<y>, or drag:<actor>,<x>,<y>"
                .to_owned(),
        )
    }
}

impl From<CliRuntimeEvent> for nekoc::runtime::RuntimeEvent {
    fn from(value: CliRuntimeEvent) -> Self {
        match value {
            CliRuntimeEvent::Click { x, y } => nekoc::runtime::RuntimeEvent::Click { x, y },
            CliRuntimeEvent::Key { key, state } => nekoc::runtime::RuntimeEvent::Key { key, state },
            CliRuntimeEvent::Mouse { state, x, y } => {
                nekoc::runtime::RuntimeEvent::Mouse { state, x, y }
            }
            CliRuntimeEvent::Drag { actor, x, y } => {
                nekoc::runtime::RuntimeEvent::Drag { actor, x, y }
            }
        }
    }
}

fn parse_mouse_coordinates(value: &str) -> std::result::Result<(f64, f64), String> {
    let (x, y) = value
        .split_once(',')
        .ok_or_else(|| "expected mouse coordinates as <x>,<y>".to_owned())?;
    let x = x
        .parse::<f64>()
        .map_err(|_| format!("invalid mouse x coordinate: {x}"))?;
    let y = y
        .parse::<f64>()
        .map_err(|_| format!("invalid mouse y coordinate: {y}"))?;
    Ok((x, y))
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Inspect { input, out } => {
            let project = nekoc::project::load_project(input)?;
            let report = nekoc::inspect::build_report(&project.value, project.byte_len)?;
            let report = serde_json::to_vec_pretty(&report)?;
            std::fs::write(&out, report)?;
        }
        Command::Roundtrip { input, output } => {
            nekoc::project::roundtrip_project(input, output)?;
        }
        Command::Diff { left, right, limit } => {
            let left = nekoc::project::load_project(left)?;
            let right = nekoc::project::load_project(right)?;
            let differences = nekoc::diff::diff_values(&left.value, &right.value, limit);
            if differences.is_empty() {
                println!("No structural differences");
            } else {
                println!("{}", nekoc::diff::format_differences(&differences));
                bail!("{} structural differences found", differences.len());
            }
        }
        Command::Decompile { input, out } => {
            let project = nekoc::project::load_project(&input)?;
            let ts_code = nekoc::decompile::decompile_to_ts(&project.value)?;
            std::fs::write(&out, &ts_code)?;
            eprintln!("Decompiled {} -> {}", input.display(), out.display());
        }
        Command::Workspace { input, out } => {
            let project = nekoc::project::load_project(input)?;
            let report = nekoc::workspace::build_report(&project.value)?;
            let report = serde_json::to_vec_pretty(&report)?;
            std::fs::write(&out, report)?;
        }
        Command::CompileTs {
            input,
            out,
            emit_ir,
            emit_analysis,
            optimize,
        } => {
            if optimize {
                let report_path = out.with_extension("workspace.json");
                nekoc::ts_frontend::compile_ts_with_sidecars(
                    &input,
                    &report_path,
                    emit_ir,
                    emit_analysis,
                )?;
                let report = std::fs::read_to_string(&report_path)?;
                let report: serde_json::Value = serde_json::from_str(&report)?;
                let optimized = nekoc::optimizer::optimize_report(&report);
                let bytes = serde_json::to_vec_pretty(&optimized)?;
                std::fs::write(&out, bytes)?;
                if let Some(stats) = optimized.get("optimization") {
                    eprintln!(
                        "Optimized: folded={}, removed={}, simplified={}",
                        stats["constantFolded"], stats["deadRemoved"], stats["simplified"]
                    );
                }
            } else {
                nekoc::ts_frontend::compile_ts_with_sidecars(input, out, emit_ir, emit_analysis)?;
            }
        }
        Command::CompileTsBcmkn {
            input,
            template,
            out,
            optimize,
        } => {
            if optimize {
                let workspace_file = tempfile::NamedTempFile::new()?;
                let workspace_path = workspace_file.path();
                nekoc::ts_frontend::compile_ts(&input, workspace_path)?;
                let report = std::fs::read_to_string(workspace_path)?;
                let report: serde_json::Value = serde_json::from_str(&report)?;
                let optimized = nekoc::optimizer::optimize_report(&report);
                nekoc::bcmkn_compiler::compile_workspace_bcmkn(
                    &optimized, &input, &template, &out,
                )?;
                if let Some(stats) = optimized.get("optimization") {
                    eprintln!(
                        "Optimized: folded={}, removed={}, simplified={}",
                        stats["constantFolded"], stats["deadRemoved"], stats["simplified"]
                    );
                }
            } else {
                nekoc::bcmkn_compiler::compile_ts_bcmkn(input, template, out)?;
            }
        }
        Command::CompileTsKitten4 {
            input,
            template,
            out,
        } => {
            nekoc::kitten4_compiler::compile_ts_kitten4(&input, template.as_deref(), &out)?;
            eprintln!("Compiled {} -> {}", input.display(), out.display());
        }
        Command::CompileTsScenario {
            input,
            template,
            scenario,
            out,
        } => {
            nekoc::bcmkn_compiler::compile_ts_bcmkn(input, template, &out)?;
            let project = nekoc::project::load_project(&out)?;
            let scenario = nekoc::scenario::load_runtime_scenario(scenario)?;
            let snapshot = nekoc::scenario::run_runtime_scenario(&project.value, &scenario)?;
            let differences = nekoc::scenario::check_runtime_scenario(&snapshot, &scenario);
            nekoc::scenario::ensure_scenario_matches(&differences)?;
            println!("Runtime scenario matches");
        }
        Command::Test { input } => {
            nekoc::ts_frontend::test_ts(input)?;
        }
        Command::Run {
            input,
            ticks,
            legacy_runtime,
            seed,
            cloud,
            events,
            out,
            expect,
        } => {
            if legacy_runtime
                && (cloud.cloud_file.is_some()
                    || cloud.cloud_memory
                    || cloud.cloud_namespace.is_some()
                    || cloud.cloud_user != "anonymous")
            {
                bail!("--legacy-runtime does not support local cloud options");
            }
            let project = nekoc::project::load_project(input)?;
            let events = events
                .into_iter()
                .map(nekoc::runtime::RuntimeEvent::from)
                .collect::<Vec<_>>();
            let report = if legacy_runtime {
                let snapshot =
                    nekoc::runtime::run_project_with_events(&project.value, &events, ticks)?;
                nekoc::runtime::snapshot_to_json(&snapshot)
            } else {
                nekoc::cli_run::run(&project.value, ticks, &events, seed.unwrap_or(1), &cloud)?
            };
            if let Some(expect) = expect {
                let expected: serde_json::Value = serde_json::from_slice(&std::fs::read(&expect)?)?;
                let differences = nekoc::diff::diff_values(&expected, &report, 200);
                if differences.is_empty() {
                    println!("Runtime snapshot matches expectation");
                } else {
                    println!("{}", nekoc::diff::format_differences(&differences));
                    bail!(
                        "{} runtime expectation differences found",
                        differences.len()
                    );
                }
            }
            let report = serde_json::to_vec_pretty(&report)?;
            if let Some(out) = out {
                std::fs::write(out, report)?;
            } else {
                println!("{}", String::from_utf8(report)?);
            }
        }
        Command::RunScenario { input, scenario } => {
            let project = nekoc::project::load_project(input)?;
            let scenario = nekoc::scenario::load_runtime_scenario(scenario)?;
            let snapshot = nekoc::scenario::run_runtime_scenario(&project.value, &scenario)?;
            let differences = nekoc::scenario::check_runtime_scenario(&snapshot, &scenario);
            nekoc::scenario::ensure_scenario_matches(&differences)?;
            println!("Runtime scenario matches");
        }
        Command::Pack {
            input,
            out,
            min_kb,
            window,
            min_match,
        } => {
            let project = nekoc::project::load_project(&input)?.value;
            let options = nekoc::pack::PackOptions {
                min_list_bytes: min_kb * 1024,
                window,
                min_match,
            };
            let (packed, report) = nekoc::pack::pack(&project, &options)?;
            std::fs::write(&out, nekoc::json::to_vec(&packed)?)?;
            for list in &report.lists {
                println!(
                    "{}: {} items, {} -> {} bytes ({} tokens)",
                    list.name, list.items, list.original_bytes, list.packed_bytes, list.tokens
                );
            }
            for (name, reason) in &report.skipped {
                println!("skipped {name}: {reason}");
            }
            println!(
                "project: {} -> {} bytes ({:.1}%), {} start scripts wait for the decoder",
                report.original_bytes,
                report.packed_bytes,
                report.packed_bytes as f64 * 100.0 / report.original_bytes.max(1) as f64,
                report.gated_scripts
            );
        }
        Command::Unpack { input, out } => {
            let project = nekoc::project::load_project(&input)?.value;
            std::fs::write(&out, nekoc::json::to_vec(&nekoc::pack::unpack(&project)?)?)?;
        }
        Command::BenchImport {
            inputs,
            out,
            frames,
            snapshot,
        } => {
            nekoc::import_bench::run(nekoc::import_bench::Args {
                files: inputs,
                out,
                frames,
                snapshot,
            })?;
        }
        Command::Coverage {
            inputs,
            frames,
            seed,
        } => {
            for input in inputs {
                let project = nekoc::project::load_project(&input)?;
                let report = nekoc::kitten4::coverage_with_seed(&project.value, frames, seed);
                println!("{}", serde_json::json!({"file": input, "report": report}));
            }
        }
        Command::Validate { input, out } => {
            let project = nekoc::project::load_project(input)?;
            let report = nekoc::validate::build_report(&project.value)?;
            if let Some(out) = out {
                let bytes = serde_json::to_vec_pretty(&report)?;
                std::fs::write(out, bytes)?;
            }
            if report["ok"].as_bool().unwrap_or(false) {
                println!("No validation issues");
            } else {
                println!("{}", serde_json::to_string_pretty(&report)?);
                bail!("validation issues found");
            }
        }
        Command::AnalyzeIr { input, out } => {
            let bytes = std::fs::read(input)?;
            let ir: serde_json::Value = serde_json::from_slice(&bytes)?;
            let report = nekoc::analysis::build_report(&ir);
            let report = serde_json::to_vec_pretty(&report)?;
            std::fs::write(out, report)?;
        }
        Command::Watch {
            input,
            template,
            out,
        } => {
            use notify_debouncer_mini::new_debouncer;
            use std::sync::mpsc;
            use std::time::Duration;

            fn do_compile(
                input: &std::path::Path,
                template: &std::path::Path,
                out: &std::path::Path,
            ) {
                match nekoc::bcmkn_compiler::compile_ts_bcmkn(input, template, out) {
                    Ok(()) => eprintln!("[watch] Compiled {}", out.display()),
                    Err(err) => eprintln!("[watch] Error: {err}"),
                }
            }

            eprintln!("[watch] Watching {} for changes...", input.display());
            do_compile(&input, &template, &out);

            let (tx, rx) = mpsc::channel();
            let mut debouncer = new_debouncer(Duration::from_millis(300), tx)
                .map_err(|e| anyhow::anyhow!("Failed to create file watcher: {e}"))?;

            let watch_path = input.parent().unwrap_or(&input);
            debouncer
                .watcher()
                .watch(watch_path, notify::RecursiveMode::NonRecursive)
                .map_err(|e| anyhow::anyhow!("Failed to watch directory: {e}"))?;

            for result in rx {
                match result {
                    Ok(events) => {
                        let ts_changed = events.iter().any(|e| {
                            e.path.extension().is_some_and(|ext| ext == "ts")
                                || e.path.extension().is_some_and(|ext| ext == "tsx")
                        });
                        if ts_changed {
                            do_compile(&input, &template, &out);
                        }
                    }
                    Err(errors) => {
                        eprintln!("[watch] Watch error: {errors:?}");
                    }
                }
            }
        }
    }

    Ok(())
}
