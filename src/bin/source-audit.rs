use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    about = "Inventory locally extracted Kitten N bundles, module evidence and block schemas"
)]
struct Args {
    directory: PathBuf,
    #[arg(long)]
    schemas: Option<PathBuf>,
    #[arg(long)]
    out: PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let report = nekoc::source_audit::audit(&args.directory, args.schemas.as_deref())?;
    std::fs::write(&args.out, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "{} bundles, {} schemas; report: {}",
        report["bundles"].as_array().unwrap().len(),
        report["schema_block_count"],
        args.out.display()
    );
    Ok(())
}
