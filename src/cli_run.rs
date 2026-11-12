//! Headless CLI host for the same Engine used by the player and coverage tools.
use crate::{
    cloud::CloudOptions,
    engine::{Engine, Program},
    runtime::{RuntimeEvent, helpers::keyboard_code},
};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};

/// One requested tick is one 1/60-second update, including idle frames.
/// No wall-clock coalescing, implicit cloud connection or renderer is involved.
pub fn run(
    source: &Value,
    ticks: usize,
    events: &[RuntimeEvent],
    seed: u64,
    cloud: &CloudOptions,
) -> Result<Value> {
    run_with_input(source, ticks, events, seed, cloud, None)
}

pub fn run_with_input(
    source: &Value,
    ticks: usize,
    events: &[RuntimeEvent],
    seed: u64,
    cloud: &CloudOptions,
    input: Option<&crate::input::InputScript>,
) -> Result<Value> {
    if let Some(script) = input {
        script.validate(u32::try_from(ticks).context("input replay exceeds u32 frames")?)?;
    }
    let mut replay = crate::input::InputReplay::default();
    let canonical;
    let project = if crate::kitten4::is_kitten4(source) {
        canonical = crate::kitten4::to_neko(source)?;
        &canonical
    } else {
        source
    };
    let mut engine = Engine::new(Program::compile(project)?);
    engine.use_virtual_clock();
    engine.set_random_seed(seed);
    if let Some(backend) = cloud.backend() {
        engine.set_cloud_backend(
            backend,
            cloud
                .cloud_namespace
                .as_deref()
                .context("local cloud requires --cloud-namespace")?
                .to_owned(),
            cloud.cloud_user.clone(),
        )?;
    }
    engine.start();
    dispatch_events(&mut engine, events);
    let mut logs = Vec::new();
    let mut extension_requests = Vec::new();
    let mut device_output = Vec::new();
    let mut budget_yields = 0;
    let mut ask = Value::Null;
    let mut stage_dialog = Value::Null;
    for tick in 0..ticks {
        if let Some(script) = input {
            replay.before_frame(&mut engine, script, (tick + 1) as u32);
        }
        let frame = engine
            .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
            .with_context(|| format!("engine update {} failed", tick + 1))?;
        logs.extend(frame.logs);
        extension_requests.extend(frame.extension_requests);
        device_output.extend(
            frame
                .k4_media_output
                .into_iter()
                .map(|output| json!({"frame":tick + 1,"output":output})),
        );
        budget_yields += usize::from(frame.budget_yield);
        ask = serde_json::to_value(frame.ask)?;
        stage_dialog = serde_json::to_value(frame.stage_dialog)?;
    }
    let mut snapshot = engine.debug_snapshot();
    let names: BTreeMap<_, _> = project["variables"]["variablesDict"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, variable)| {
            (
                id.clone(),
                variable["name"].as_str().unwrap_or(id).to_owned(),
            )
        })
        .collect();
    snapshot["schema"] = json!("nekoc-engine-run-v1");
    snapshot["ticks"] = json!(ticks);
    snapshot["seed"] = json!(seed);
    snapshot["variable_names"] = json!(names);
    snapshot["logs"] = json!(logs);
    snapshot["active_threads"] = json!(engine.active_tasks());
    snapshot["budget_yields"] = json!(budget_yields);
    snapshot["ask"] = ask;
    snapshot["stage_dialog"] = stage_dialog;
    snapshot["extension_requests"] = json!(extension_requests);
    snapshot["k4_media_output"] = json!(device_output);
    Ok(snapshot)
}

fn dispatch_events(engine: &mut Engine, events: &[RuntimeEvent]) {
    let mut mouse = [0.0, 0.0];
    for event in events {
        match event {
            RuntimeEvent::Key { key, state } => {
                engine.key_event(&keyboard_code(key), state == "down");
            }
            RuntimeEvent::Click { x, y } | RuntimeEvent::Mouse { x, y, .. } => {
                mouse = [x.unwrap_or(mouse[0]), y.unwrap_or(mouse[1])];
                engine.set_mouse(mouse[0], mouse[1]);
                let state = match event {
                    RuntimeEvent::Click { .. } => "mouse_click",
                    RuntimeEvent::Mouse { state: Some(s), .. } if s == "down" => "mouse_down",
                    RuntimeEvent::Mouse { state: Some(s), .. } if s == "up" => "mouse_up",
                    _ => continue,
                };
                let target = engine.hit_test(mouse[0], mouse[1]).unwrap_or("").to_owned();
                engine.pointer_event(&target, state, mouse[0], mouse[1]);
            }
            RuntimeEvent::Drag { actor, x, y } => {
                mouse = [*x, *y];
                engine.pointer_event(actor, "mouse_down", *x, *y);
                engine.drag(actor, *x, *y);
            }
        }
    }
}
