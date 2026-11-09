//! Release import benchmark; all input works stay at their original paths.
use crate::{
    self as nekoc,
    engine::{Engine, Program},
};
use anyhow::Result;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};

pub struct Args {
    pub files: Vec<PathBuf>,
    pub out: Option<PathBuf>,
    /// Record deterministic, instruction-budgeted VM states for before/after comparison.
    pub frames: u32,
    /// Skip expensive import diagnostics when only collecting behavior snapshots.
    pub snapshot: bool,
}

pub fn run(args: Args) -> Result<()> {
    let mut reports = vec![];
    for file in args.files {
        let (result, timings) = nekoc::import_perf::measure(|| -> Result<Value> {
            let _total = nekoc::import_perf::span("total");
            let bytes = {
                let _t = nekoc::import_perf::span("read");
                std::fs::read(&file)?
            };
            let source: Value = {
                let _t = nekoc::import_perf::span("json_parse");
                serde_json::from_str(std::str::from_utf8(&bytes)?.trim_start_matches('\u{feff}'))?
            };
            let k4 = nekoc::kitten4::is_kitten4(&source);
            let project = if k4 {
                nekoc::kitten4::to_neko(&source)?
            } else {
                source.clone()
            };
            let (project, diagnostics) = if args.snapshot {
                (project, Value::Null)
            } else {
                nekoc::bcmkn::import(project)?
            };
            // The web import boundary also verifies the round-trip provenance.
            let export_error = if k4 {
                let _t = nekoc::import_perf::span("export_validation");
                nekoc::kitten4::from_neko(&project)
                    .err()
                    .map(|e| format!("{e:#}"))
            } else {
                None
            };
            let mut report = json!({"file":file,"bytes":bytes.len(),"diagnostics":diagnostics,"export_error":export_error});
            let compiled = Program::compile(&project);
            match compiled {
                Err(e) => {
                    report["stage"] = json!("compile");
                    report["error"] = json!(format!("{e:#}"));
                }
                Ok(program) => {
                    report["stats"] = json!(program.stats());
                    let mut vm = Engine::new(program);
                    vm.set_random_seed(12345);
                    // Frame state regression uses deterministic instruction limits,
                    // not host speed or JIT warm-up timings.
                    if args.snapshot {
                        vm.disable_jit();
                    }
                    vm.start();
                    let mut states = vec![];
                    report["stage"] = json!("ran");
                    for _ in 0..args.frames {
                        match vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60)) {
                            Ok(frame) => {
                                let mut state = serde_json::to_value(&frame)?;
                                state.as_object_mut().unwrap().remove("execute_us");
                                states.push(json!({"frame":state,"variables":vm.numeric_variables(),"lists":vm.numeric_lists()}));
                            }
                            Err(e) => {
                                report["stage"] = json!("run");
                                report["error"] = json!(format!("{e:#}"));
                                break;
                            }
                        }
                    }
                    report["states"] = json!(states);
                }
            }
            {
                let _t = nekoc::import_perf::span("serialize_response");
                let _ = serde_json::to_vec(&json!({"project":project,"report":report}))?;
            }
            Ok(report)
        });
        let mut report = result?;
        report["timings_ms"] = json!(timings);
        println!("{}", serde_json::to_string(&report)?);
        reports.push(report);
    }
    if let Some(out) = args.out {
        std::fs::write(out, serde_json::to_vec_pretty(&reports)?)?;
    }
    Ok(())
}
