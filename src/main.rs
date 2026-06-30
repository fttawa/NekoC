use anyhow::{Result, bail};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(
    version,
    about = "Inspect and roundtrip JSON-based Kitten N .bcmkn files"
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
    },
    CompileTsBcmkn {
        input: PathBuf,
        #[arg(long)]
        template: PathBuf,
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
        #[arg(long, default_value_t = 1)]
        ticks: usize,
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
    Validate {
        input: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    AnalyzeIr {
        input: PathBuf,
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
            let project = nekoc::project::load_project(input)?;
            let report = nekoc::decompile::build_report(&project.value)?;
            let report = serde_json::to_vec_pretty(&report)?;
            std::fs::write(&out, report)?;
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
        } => {
            nekoc::ts_frontend::compile_ts_with_sidecars(input, out, emit_ir, emit_analysis)?;
        }
        Command::CompileTsBcmkn {
            input,
            template,
            out,
        } => {
            nekoc::bcmkn_compiler::compile_ts_bcmkn(input, template, out)?;
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
            events,
            out,
            expect,
        } => {
            let project = nekoc::project::load_project(input)?;
            let events = events
                .into_iter()
                .map(nekoc::runtime::RuntimeEvent::from)
                .collect::<Vec<_>>();
            let snapshot = if events.is_empty() {
                nekoc::runtime::run_project(&project.value, ticks)?
            } else {
                nekoc::runtime::run_project_with_events(&project.value, &events, ticks)?
            };
            let report = nekoc::runtime::snapshot_to_json(&snapshot);
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
    }

    Ok(())
}
