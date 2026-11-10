//! Read-only corpus benchmark: only aggregate diagnostics, never copies projects.
use anyhow::{Context, Result};
use clap::Parser;
use nekoc::engine::{Engine, Program, encode_frame};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Parser)]
struct Args {
    corpus: PathBuf,
    #[arg(long)]
    out: PathBuf,
    #[arg(long, default_value_t = 60)]
    frames: u32,
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Measure without profiling overhead (compare with a saved baseline binary).
    #[arg(long)]
    timing_only: bool,
    /// Per-frame VM budget, identical for the interpreter and native tier.
    #[arg(long, default_value_t = 2_000_000)]
    instructions: usize,
    /// Restrict diagnostics to exact file stems without copying corpus inputs.
    #[arg(long, value_delimiter = ',')]
    only: Vec<String>,
}

fn normalized(bytes: &[u8]) -> Result<(Value, Vec<u8>)> {
    let header = bytes.get(..4).context("missing frame length")?;
    let size = u32::from_le_bytes(header.try_into()?) as usize;
    let payload = bytes.get(4..).context("missing frame payload")?;
    let mut meta: Value =
        serde_json::from_slice(payload.get(..size).context("short frame metadata")?)?;
    for key in ["execute_us", "budget_yield"] {
        meta.as_object_mut().context("frame object")?.remove(key);
    }
    Ok((meta, payload[size..].to_vec()))
}

fn measure(project: &Value, args: &Args) -> Result<Value> {
    let mut reference = Engine::new(Program::compile(project)?);
    reference.disable_jit();
    let mut native = Engine::new(Program::compile(project)?);
    for vm in [&mut reference, &mut native] {
        vm.use_virtual_clock();
        vm.set_random_seed(args.seed);
        vm.start();
    }
    if !args.timing_only {
        native.enable_jit_profile();
    }
    let mut reference_us = 0;
    let mut native_us = 0;
    let mut completed = 0;
    let mut error = None;
    let mut difference = None;
    for frame in 1..=args.frames {
        let started = Instant::now();
        let a = reference.advance(1.0 / 60.0, args.instructions, Duration::from_secs(5));
        reference_us += started.elapsed().as_micros();
        let started = Instant::now();
        let b = native.advance(1.0 / 60.0, args.instructions, Duration::from_secs(5));
        native_us += started.elapsed().as_micros();
        match (a, b) {
            (Ok(a), Ok(b)) => {
                if normalized(&encode_frame(&a)?)? != normalized(&encode_frame(&b)?)?
                    || reference.debug_snapshot() != native.debug_snapshot()
                    || reference.jit_debug_snapshot() != native.jit_debug_snapshot()
                    || a.budget_yield != b.budget_yield
                {
                    difference = Some(format!("frame {frame}"));
                    break;
                }
                completed += 1;
                reference.recycle_lines(a.lines);
                native.recycle_lines(b.lines);
            }
            (Err(a), Err(b)) => {
                error = Some(format!("{a:#}"));
                if a.to_string() != b.to_string()
                    || reference.debug_snapshot() != native.debug_snapshot()
                    || reference.jit_debug_snapshot() != native.jit_debug_snapshot()
                {
                    difference = Some(format!("error frame {frame}: {a:#} <> {b:#}"));
                }
                break;
            }
            (a, b) => {
                difference = Some(format!("frame {frame}: {:?} <> {:?}", a.err(), b.err()));
                break;
            }
        }
    }
    Ok(
        json!({"completed":completed,"error":error,"difference":difference,
        "interpreter_us":reference_us,"jit_us":native_us,"profile":native.jit_profile()}),
    )
}

fn main() -> Result<()> {
    let args = Args::parse();
    anyhow::ensure!(
        args.frames > 0 && args.instructions > 0,
        "frames and instructions must be positive"
    );
    let mut files = std::fs::read_dir(&args.corpus)?
        .map(|e| Ok(e?.path()))
        .collect::<Result<Vec<_>>>()?;
    files.retain(|p| p.extension().is_some_and(|e| e == "bcm"));
    if !args.only.is_empty() {
        files.retain(|p| {
            p.file_stem()
                .is_some_and(|s| args.only.iter().any(|id| s == id.as_str()))
        });
        for id in &args.only {
            anyhow::ensure!(
                files
                    .iter()
                    .any(|p| p.file_stem().is_some_and(|s| s == id.as_str())),
                "requested corpus work not found: {id}"
            );
        }
    }
    files.sort();
    anyhow::ensure!(!files.is_empty(), "empty corpus");
    let mut works = Vec::new();
    for file in files {
        let id = file.file_stem().unwrap().to_string_lossy().into_owned();
        let result = (|| {
            let loaded = nekoc::project::load_project(&file)?;
            let project = nekoc::kitten4::to_neko(&loaded.value)?;
            measure(&project, &args)
        })();
        let report = match result {
            Ok(report) => report,
            Err(error) => json!({"load_compile_error":format!("{error:#}")}),
        };
        eprintln!(
            "{id}: {} frames, difference={}",
            report["completed"], report["difference"]
        );
        works.push(json!({"id":id,"report":report}));
    }
    if let Some(parent) = args.out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        &args.out,
        serde_json::to_vec_pretty(&json!({
            "frames":args.frames,"seed":args.seed,"instructions":args.instructions,"only":args.only,
            "build":if cfg!(debug_assertions) {"debug"} else {"release"},
            "arch":std::env::consts::ARCH,"os":std::env::consts::OS,"works":works
        }))?,
    )?;
    anyhow::ensure!(
        works
            .iter()
            .all(|w| w["report"]["difference"].is_null()
                && w["report"]["load_compile_error"].is_null()),
        "JIT differences or load/compile errors found"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_ignores_only_wall_clock_fields_and_keeps_drawing_bytes() {
        let meta = br#"{"execute_us":12,"budget_yield":true,"instructions":9}"#;
        let mut bytes = (meta.len() as u32).to_le_bytes().to_vec();
        bytes.extend(meta);
        bytes.extend([0, 1, 255]);
        assert_eq!(
            normalized(&bytes).unwrap(),
            (json!({"instructions":9}), vec![0, 1, 255])
        );
        assert!(normalized(&[]).is_err());
        assert!(normalized(&100u32.to_le_bytes()).is_err());
    }

    #[test]
    fn only_accepts_exact_comma_separated_work_ids() {
        let args = Args::try_parse_from([
            "jit-corpus",
            "corpus",
            "--out",
            "result.json",
            "--only",
            "123,456",
        ])
        .unwrap();
        assert_eq!(args.only, ["123", "456"]);
        assert!(args.instructions > 0);
    }
}
