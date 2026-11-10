//! Headless release benchmark. Input stays in place; no per-frame serialization.
use anyhow::{Result, ensure};
use clap::Parser;
use nekoc::engine::{Engine, Program};
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Parser)]
struct Args {
    input: PathBuf,
    #[arg(long, default_value_t = 180)]
    frames: usize,
    #[arg(long, default_value_t = 30)]
    warmup: usize,
    #[arg(long, default_value_t = 1)]
    seed: u64,
    #[arg(long)]
    interpreter: bool,
}

#[cfg(windows)]
fn peak_rss_bytes() -> Option<usize> {
    #[repr(C)]
    struct Counters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    #[link(name = "psapi")]
    unsafe extern "system" {
        fn GetProcessMemoryInfo(process: isize, counters: *mut Counters, size: u32) -> i32;
    }
    let size = std::mem::size_of::<Counters>() as u32;
    // SAFETY: Counters is a C-layout integer-only PROCESS_MEMORY_COUNTERS;
    // -1 is Windows' current-process pseudo-handle and the buffer is writable.
    unsafe {
        let mut counters: Counters = std::mem::zeroed();
        counters.cb = size;
        (GetProcessMemoryInfo(-1, &mut counters, size) != 0)
            .then_some(counters.peak_working_set_size)
    }
}

#[cfg(not(windows))]
fn peak_rss_bytes() -> Option<usize> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|s| s.starts_with("VmHWM:"))?;
    line.split_whitespace()
        .nth(1)?
        .parse::<usize>()
        .ok()?
        .checked_mul(1024)
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.frames > 0 && args.frames <= 100_000 && args.warmup <= 100_000 - args.frames,
        "invalid frame count"
    );
    let started = Instant::now();
    let source = nekoc::project::load_project(&args.input)?.value;
    let project = if nekoc::kitten4::is_kitten4(&source) {
        nekoc::kitten4::to_neko(&source)?
    } else {
        source
    };
    let mut engine = Engine::new(Program::compile(&project)?);
    let import_ms = started.elapsed().as_secs_f64() * 1000.0;
    if args.interpreter {
        engine.disable_jit();
    }
    engine.set_random_seed(args.seed);
    let start = Instant::now();
    engine.start();
    let start_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut frame_ms = Vec::with_capacity(args.frames);
    let mut instructions = 0usize;
    let mut lines = 0usize;
    let mut active_frames = 0usize;
    let mut warmup_ms = Vec::with_capacity(args.warmup);
    for frame in 0..args.warmup + args.frames {
        let start = Instant::now();
        let update = engine.advance(1.0 / 60.0, 200_000_000, Duration::from_secs(10))?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        ensure!(
            !update.budget_yield,
            "frame {} hit budget (not a valid performance sample)",
            frame + 1
        );
        if frame >= args.warmup {
            frame_ms.push(ms);
            instructions += update.instructions;
            lines += update.lines.len() / 9;
            active_frames += usize::from(update.instructions > 0);
        } else {
            warmup_ms.push(ms);
        }
        engine.recycle_lines(update.lines);
    }
    // Read before the diagnostic snapshot allocates. Each invocation is a fresh process.
    let peak_rss = peak_rss_bytes();
    let final_state = engine.oracle_snapshot((args.warmup + args.frames) as u32);
    println!(
        "{}",
        json!({"schema":"nekoc-performance-v1", "runtime":"nekoc",
        "input":args.input,"seed":args.seed,"warmup":args.warmup,"frames":args.frames,
        "import_ms":import_ms,"start_ms":start_ms,"frame_ms":frame_ms,"warmup_ms":warmup_ms,
        "peak_rss_bytes":peak_rss,"instructions":instructions,"pen_lines":lines,
        "active_frames":active_frames,"final_state":final_state})
    );
    Ok(())
}
