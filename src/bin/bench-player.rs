//! Native end-to-end player benchmark: real project -> compiled VM -> encoded frame.
//! Measures the same per-request work as the WebSocket player without the browser.
use anyhow::Result;
use clap::Parser;
use nekoc::engine::{Engine, Program};
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Parser)]
struct Args {
    files: Vec<PathBuf>,
    /// Frames to run per project.
    #[arg(long, default_value_t = 600)]
    frames: usize,
    /// Per-frame VM budget in milliseconds (the player default is 4).
    #[arg(long, default_value_t = 4.0)]
    budget_ms: f64,
    /// Comma separated keys held for the whole run (e.g. w,ArrowRight).
    #[arg(long, default_value = "")]
    hold: String,
    /// Project variable counting completed project frames, reported per second.
    #[arg(long)]
    frame_var: Option<String>,
    #[arg(long)]
    out: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let mut reports = vec![];
    for file in &args.files {
        let project = nekoc::project::load_project(file)?.value;
        let project = if nekoc::kitten4::is_kitten4(&project) {
            nekoc::kitten4::to_neko(&project)?
        } else {
            project
        };
        let (project, _) = nekoc::bcmkn::import(project)?;
        let started = Instant::now();
        let program = Program::compile(&project)?;
        let compile_ms = started.elapsed().as_secs_f64() * 1000.0;
        let frame_slot = args
            .frame_var
            .as_ref()
            .and_then(|name| program.variable_names.iter().position(|n| n == name));
        let mut vm = Engine::new(program);
        vm.start();
        let held: Vec<String> = args
            .hold
            .split(',')
            .filter(|k| !k.is_empty())
            .map(str::to_owned)
            .collect();
        let budget = Duration::from_secs_f64(args.budget_ms / 1000.0);
        let (mut vm_us, mut encode_us, mut bytes, mut instructions, mut lines) =
            (0u128, 0u128, 0usize, 0usize, 0usize);
        let mut frame_times = Vec::with_capacity(args.frames);
        let run = Instant::now();
        for i in 0..args.frames {
            if i == 1 {
                vm.set_pressed_keys(held.iter().cloned());
                for key in &held {
                    vm.key(key);
                }
            }
            let t = Instant::now();
            let frame = vm.advance(1.0 / 60.0, 500_000, budget)?;
            let after_vm = Instant::now();
            let encoded = nekoc::engine::encode_frame(&frame)?;
            let done = Instant::now();
            vm_us += (after_vm - t).as_micros();
            encode_us += (done - after_vm).as_micros();
            frame_times.push((done - t).as_secs_f64() * 1000.0);
            bytes += encoded.len();
            instructions += frame.instructions;
            lines += frame.lines.len() / 9;
            vm.recycle_lines(frame.lines);
        }
        let wall = run.elapsed().as_secs_f64();
        frame_times.sort_by(f64::total_cmp);
        let n = args.frames as f64;
        let project_frames = frame_slot.map(|s| vm.numeric_variables()[s]);
        let report = json!({
            "file": file.display().to_string(),
            "compile_ms": compile_ms,
            "frames": args.frames,
            "budget_ms": args.budget_ms,
            "mean_vm_ms": vm_us as f64 / n / 1000.0,
            "mean_encode_ms": encode_us as f64 / n / 1000.0,
            "p50_frame_ms": frame_times[frame_times.len() / 2],
            "p95_frame_ms": frame_times[frame_times.len() * 95 / 100],
            "mean_bytes": bytes as f64 / n,
            "instructions_per_frame": instructions as f64 / n,
            "million_instructions_per_s": instructions as f64 / (vm_us as f64).max(1.0),
            "lines_per_frame": lines as f64 / n,
            "project_frames": project_frames,
            "project_frames_per_update": project_frames.map(|f| f / n),
            "wall_s": wall,
        });
        println!("{}", serde_json::to_string_pretty(&report)?);
        reports.push(report);
    }
    if let Some(path) = args.out {
        std::fs::write(path, serde_json::to_string_pretty(&reports)?)?;
    }
    Ok(())
}
