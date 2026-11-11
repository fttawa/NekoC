use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Release import phase timings and deterministic behavior snapshots")]
struct Args {
    files: Vec<PathBuf>,
    #[arg(long)]
    out: Option<PathBuf>,
    #[arg(long, default_value_t = 0)]
    frames: u32,
    #[arg(long)]
    snapshot: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    nekoc::import_bench::run(nekoc::import_bench::Args {
        files: args.files,
        out: args.out,
        frames: args.frames,
        snapshot: args.snapshot,
    })
}
