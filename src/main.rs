use anyhow::{Result, bail};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

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
    Test {
        input: PathBuf,
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
        Command::Test { input } => {
            nekoc::ts_frontend::test_ts(input)?;
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
