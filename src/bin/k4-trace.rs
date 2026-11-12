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
    /// Replay nekoc-input-v1 DOM events before each numbered update.
    #[arg(long)]
    input_script: Option<PathBuf>,
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
    /// Record only these source block IDs (task boundaries are always retained).
    #[arg(long, value_delimiter = ',', requires = "blocks")]
    block_filter: Vec<String>,
    #[arg(long)]
    interpreter: bool,
    /// Include live soft particle diagnostics; never used to drive simulation.
    #[arg(long)]
    soft: bool,
    /// Include the canonical project and actual web renderer frame deltas.
    #[arg(long)]
    render: bool,
    /// Omit duplicate full variable snapshots in render output (large lists can
    /// otherwise exceed the browser harness's maximum JSON string size).
    #[arg(long, requires = "render", conflicts_with = "blocks")]
    render_only: bool,
    /// Costume measurements supplied by the browser, as in the web player.
    #[arg(long)]
    costumes: Option<PathBuf>,
    /// Decoded video durations; no wall-clock or network probing in the VM.
    #[arg(long)]
    videos: Option<PathBuf>,
    /// Browser-decoded audio durations in seconds: [{"id": ..., "duration": ...}].
    /// Applied only to the in-memory canonical project, never to the input file.
    #[arg(long)]
    audios: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let input_script = args
        .input_script
        .as_ref()
        .map(|file| -> Result<nekoc::input::InputScript> {
            let text = std::fs::read_to_string(file)?;
            let script: nekoc::input::InputScript =
                serde_json::from_str(text.trim_start_matches('\u{feff}'))?;
            script.validate(args.frames)?;
            Ok(script)
        })
        .transpose()?;
    let mut input_replay = nekoc::input::InputReplay::default();
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
    let mut project = kitten4::to_neko(&source)?;
    if let Some(file) = &args.audios {
        let audios: serde_json::Value = serde_json::from_slice(&std::fs::read(file)?)?;
        let entries = audios.as_array().context("expected audio metadata array")?;
        let mut seen = std::collections::BTreeSet::new();
        for audio in entries {
            let id = audio["id"].as_str().context("missing audio id")?;
            ensure!(!id.is_empty(), "empty audio id");
            ensure!(seen.insert(id), "duplicate audio metadata id {id}");
            let duration = audio["duration"]
                .as_f64()
                .filter(|n| n.is_finite() && *n > 0.0)
                .context("audio duration must be positive finite seconds")?;
            let resource = project
                .pointer_mut("/audios/audiosDict")
                .and_then(serde_json::Value::as_object_mut)
                .and_then(|dict| dict.get_mut(id))
                .with_context(|| format!("unknown audio metadata id {id}"))?;
            let resource = resource
                .as_object_mut()
                .with_context(|| format!("audio resource {id} must be an object"))?;
            resource.insert("duration".into(), json!(duration));
        }
    }
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
    engine.use_virtual_clock();
    if let Some(file) = &args.videos {
        let videos: serde_json::Value = serde_json::from_slice(&std::fs::read(file)?)?;
        for video in videos.as_array().context("expected video metadata array")? {
            engine.set_video_duration(
                video["id"].as_str().context("missing video id")?,
                video["duration"]
                    .as_f64()
                    .context("missing video duration")?,
            );
            if let (Some(width), Some(height)) = (video["width"].as_f64(), video["height"].as_f64())
            {
                engine.set_video_metadata(
                    video["id"].as_str().unwrap(),
                    video["duration"].as_f64().unwrap(),
                    width,
                    height,
                );
            }
        }
    }
    if let Some(file) = &args.costumes {
        let costumes: serde_json::Value = serde_json::from_slice(&std::fs::read(file)?)?;
        for costume in costumes.as_array().context("expected costume array")? {
            let mask = match (
                costume["mask_width"].as_u64(),
                costume["mask_height"].as_u64(),
                costume["mask_bytes"].as_array(),
            ) {
                (Some(w), Some(h), Some(bytes)) => {
                    ensure!(w > 0 && h > 0 && w <= 128 && h <= 128, "invalid mask size");
                    let bits = bytes
                        .iter()
                        .map(|v| {
                            v.as_u64()
                                .filter(|n| *n <= 255)
                                .map(|n| n as u8)
                                .context("invalid mask byte")
                        })
                        .collect::<Result<Vec<_>>>()?;
                    ensure!(
                        bits.len() as u64 == (w * h).div_ceil(8),
                        "invalid mask length"
                    );
                    Some((w as usize, h as usize, bits))
                }
                _ => None,
            };
            let rgb = costume["rgb_bytes"]
                .as_array()
                .map(|bytes| {
                    bytes
                        .iter()
                        .map(|v| {
                            v.as_u64()
                                .filter(|n| *n <= 255)
                                .map(|n| n as u8)
                                .context("invalid RGB byte")
                        })
                        .collect::<Result<Vec<_>>>()
                })
                .transpose()?;
            if let (Some(rgb), Some((w, h, _))) = (&rgb, &mask) {
                ensure!(rgb.len() == w * h * 3, "invalid RGB length");
            }
            engine.set_costume(
                costume["id"].as_str().context("missing costume id")?,
                nekoc::engine::Costume {
                    width: costume["width"].as_f64().context("missing width")?,
                    height: costume["height"].as_f64().context("missing height")?,
                    center_point: nekoc::engine::Costume::center_point_from_json(
                        &costume["centerPoint"],
                    ),
                    mask,
                    rgb,
                },
            );
        }
    }
    if let Some(backend) = args.cloud.backend() {
        engine.set_cloud_backend(
            backend,
            args.cloud.cloud_namespace.clone().unwrap(),
            args.cloud.cloud_user.clone(),
        )?;
    }
    if args.blocks {
        engine.trace_blocks();
        if !args.block_filter.is_empty() {
            engine.trace_block_filter(args.block_filter);
        }
    } else if args.interpreter {
        engine.disable_jit();
    }
    engine.set_random_seed(args.seed);
    engine.start();
    let mut frames = Vec::new();
    let mut render_frames = Vec::new();
    for frame in 1..=args.frames {
        if let Some(script) = &input_script {
            input_replay.before_frame(&mut engine, script, frame);
        }
        let update = match engine.advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5)) {
            Ok(update) => update,
            Err(error) if args.blocks => {
                println!(
                    "{}",
                    json!({"schema":"nekoc-k4-trace-v1", "fps":60, "seed":args.seed, "frames":frames,
                    "traceTruncated":engine.oracle_trace_truncated(),
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
        if !args.render_only {
            let mut snapshot = engine.oracle_snapshot(frame);
            if args.soft {
                let soft: Vec<_> = (0..engine.program.sprites.len())
                    .filter_map(|actor| {
                        engine
                            .physics_soft_snapshot(actor)
                            .map(|state| (actor.to_string(), state))
                    })
                    .collect();
                snapshot["soft"] =
                    serde_json::to_value(soft.into_iter().collect::<serde_json::Map<_, _>>())?;
            }
            frames.push(snapshot);
        }
        if args.render {
            render_frames.push(json!({"frame": update, "lines": update.lines}));
        }
    }
    if args.render {
        println!(
            "{}",
            json!({"schema":"nekoc-k4-render-v1", "project":project,
            "frames":render_frames, "trace":{"schema":"nekoc-k4-trace-v1", "frames":frames}})
        );
        return Ok(());
    }
    println!(
        "{}",
        json!({"schema":"nekoc-k4-trace-v1", "fps":60, "seed":args.seed, "frames":frames,
            "traceTruncated":engine.oracle_trace_truncated(),
            "events":engine.take_oracle_events()})
    );
    Ok(())
}
