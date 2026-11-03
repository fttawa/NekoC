use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "NekoC native Rust project editor (early development)")]
struct Args {
    /// Open a local .bcmkn project.
    input: Option<PathBuf>,
    /// Exercise document loading and incremental execution without a display.
    #[arg(long)]
    smoke: bool,
    #[arg(long, default_value_t = 3)]
    ticks: usize,
    /// Render a native window, save a PNG, and exit (GUI smoke verification).
    #[arg(long)]
    screenshot: Option<PathBuf>,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let document = if let Some(path) = &args.input {
        nekoc::studio::document::Document::new(nekoc::project::load_project(path)?.value)?
    } else {
        nekoc::studio::document::Document::blank()
    };
    if args.smoke {
        let mut runtime = nekoc::runtime::Runtime::from_project(document.value())?;
        runtime.set_cooperative(true);
        runtime.start();
        runtime.run_ticks(args.ticks)?;
        println!("{}", serde_json::to_string_pretty(&runtime.snapshot())?);
        return Ok(());
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1440.0, 900.0])
            .with_min_inner_size([1000.0, 650.0]),
        ..Default::default()
    };
    eframe::run_native(
        "NekoC Studio · Rust",
        options,
        Box::new(move |cc| {
            Ok(Box::new(nekoc::studio::app::Studio::new(
                cc,
                document,
                args.input,
                args.screenshot,
            )))
        }),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))
}
