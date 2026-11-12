use super::overlay::{NativeOverlay, OverlayCatalog};
use crate::engine::{Costume, Dialog, Engine, Program, SoftMesh, Sprite};
use crate::runtime::{
    ActorState, DialogState, PenState, Runtime, RuntimeEvent, RuntimeSnapshot, RuntimeValue,
};
use anyhow::{Result, anyhow};
use serde_json::Value;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::{collections::BTreeMap, ops::Deref, time::Duration};

enum Command {
    Tick(Vec<RuntimeEvent>),
    Costume(String, Costume),
    Stop,
}

/// Studio-only transport: keep the legacy RuntimeSnapshot schema unchanged.
/// K4 sprites include the VM's world-space soft mesh and painter order; None
/// selects the existing non-K4 interpreter preview.
#[derive(Clone, Debug)]
pub struct PreviewSnapshot {
    pub state: RuntimeSnapshot,
    pub native_sprites: Option<Vec<NativeSprite>>,
    pub native_lines: Vec<[f32; 9]>,
    pub pen_layer: usize,
    pub native_overlay: Option<NativeOverlay>,
}

/// Detached rendering fields only: Engine Sprite contains private Rc-backed VM
/// cells and must not be sent across the worker channel.
#[derive(Clone, Debug)]
pub struct NativeSprite {
    pub id: String,
    pub name: String,
    pub style: Option<String>,
    pub x: f64,
    pub y: f64,
    pub direction: f64,
    pub scale: f64,
    pub size_x: f64,
    pub size_y: f64,
    pub rotation_type: u8,
    pub visible: bool,
    pub opacity: f64,
    pub draggable: bool,
    pub soft_mesh: Option<SoftMesh>,
    pub dialog: Option<Dialog>,
}

impl From<Sprite> for NativeSprite {
    fn from(sprite: Sprite) -> Self {
        Self {
            id: sprite.id,
            name: sprite.name,
            style: sprite.style,
            x: sprite.x,
            y: sprite.y,
            direction: sprite.direction,
            scale: sprite.scale,
            size_x: sprite.size_x,
            size_y: sprite.size_y,
            rotation_type: sprite.rotation_type,
            visible: sprite.visible,
            opacity: sprite.opacity,
            draggable: sprite.draggable,
            soft_mesh: sprite.soft_mesh,
            dialog: sprite.dialog,
        }
    }
}

impl Deref for PreviewSnapshot {
    type Target = RuntimeSnapshot;
    fn deref(&self) -> &Self::Target {
        &self.state
    }
}

impl From<RuntimeSnapshot> for PreviewSnapshot {
    fn from(state: RuntimeSnapshot) -> Self {
        Self {
            state,
            native_sprites: None,
            native_lines: vec![],
            pen_layer: 0,
            native_overlay: None,
        }
    }
}

/// K4 must use the same Engine that owns the particle solver. Running the old
/// Runtime alongside it would give two divergent actor/scheduler states.
struct NativePreview {
    engine: Engine,
    snapshot: PreviewSnapshot,
    mouse: [f64; 2],
    overlays: OverlayCatalog,
}

impl NativePreview {
    fn new(project: &Value) -> Result<Self> {
        let engine = Engine::new(Program::compile(project)?);
        let state = Runtime::from_project(project)?.snapshot();
        let overlays = OverlayCatalog::new(project);
        let initial_overlay = overlays.initial(&engine);
        let mut preview = Self {
            engine,
            snapshot: state.into(),
            mouse: [0.0; 2],
            overlays,
        };
        preview.snapshot.native_overlay = Some(initial_overlay);
        preview.observe();
        Ok(preview)
    }

    fn observe(&mut self) {
        let (scene, scene_name, sprites) = self.engine.studio_render_snapshot();
        self.snapshot.state.current_scene_name = Some(scene_name);
        self.snapshot.state.current_scene_id = Some(scene);
        self.snapshot.state.active_threads = self.engine.active_tasks();
        self.snapshot.state.actors = sprites
            .iter()
            .map(|sprite| {
                let actor = ActorState {
                    id: sprite.id.clone(),
                    name: sprite.name.clone(),
                    current_style_id: sprite.style.clone(),
                    x: sprite.x,
                    y: sprite.y,
                    rotation: sprite.direction,
                    scale: sprite.scale,
                    visible: sprite.visible,
                    dialog: sprite.dialog.as_ref().map(|d| DialogState {
                        kind: if d.think { "think" } else { "say" }.into(),
                        text: d.text.clone(),
                        timeout_ticks: None,
                    }),
                    draggable: sprite.draggable,
                    effects: BTreeMap::new(),
                    pen: PenState {
                        down: false,
                        color: "#000000".into(),
                        size: 1.0,
                        hsv: [0.0; 3],
                        strokes: vec![],
                        stamps: vec![],
                    },
                };
                (actor.id.clone(), actor)
            })
            .collect();
        for id in self
            .engine
            .program
            .variable_names
            .iter()
            .chain(&self.engine.program.list_names)
        {
            let value = serde_json::to_value(self.engine.variable_value(id)).unwrap_or(Value::Null);
            self.snapshot
                .state
                .variables
                .insert(id.clone(), preview_value(&value));
        }
        self.snapshot.native_sprites = Some(sprites.into_iter().map(NativeSprite::from).collect());
    }

    fn event(&mut self, event: &RuntimeEvent) {
        match event {
            RuntimeEvent::Key { key, state } => {
                if let Some(key) = key_code(key) {
                    self.engine.key_event(&key, state != "up");
                }
            }
            RuntimeEvent::Mouse { x, y, state } => {
                if let Some(x) = x {
                    self.mouse[0] = *x;
                }
                if let Some(y) = y {
                    self.mouse[1] = *y;
                }
                self.engine.set_mouse(self.mouse[0], self.mouse[1]);
                if let Some(state) = state {
                    let target = self
                        .engine
                        .hit_test(self.mouse[0], self.mouse[1])
                        .unwrap_or("")
                        .to_owned();
                    self.engine.pointer_event(
                        &target,
                        if state == "down" {
                            "mouse_down"
                        } else {
                            "mouse_up"
                        },
                        self.mouse[0],
                        self.mouse[1],
                    );
                }
            }
            RuntimeEvent::Click { x, y } => {
                let [x, y] = [x.unwrap_or(self.mouse[0]), y.unwrap_or(self.mouse[1])];
                let target = self.engine.hit_test(x, y).unwrap_or("").to_owned();
                self.engine.pointer_event(&target, "mouse_click", x, y);
            }
            RuntimeEvent::Drag { actor, x, y } => self.engine.drag(actor, *x, *y),
        }
    }

    fn tick(&mut self, events: &[RuntimeEvent]) -> Result<PreviewSnapshot> {
        for event in events {
            self.event(event);
        }
        let frame = self
            .engine
            .advance(1.0 / 60.0, 200_000, Duration::from_millis(12))?;
        if frame.clear || frame.scene_changed {
            self.snapshot.native_lines.clear();
        }
        self.snapshot.native_lines.extend(
            frame
                .lines
                .chunks_exact(9)
                .map(|v| <[f32; 9]>::try_from(v).unwrap()),
        );
        self.snapshot.pen_layer = frame.pen_layer;
        self.snapshot.native_overlay = Some(self.overlays.frame(frame.monitors, &self.engine));
        self.snapshot.state.logs.extend(frame.logs);
        self.snapshot.state.ticks += 1;
        self.observe();
        Ok(self.snapshot.clone())
    }
}

fn preview_value(value: &Value) -> RuntimeValue {
    match value {
        Value::Null => RuntimeValue::Null,
        Value::Bool(v) => RuntimeValue::Bool(*v),
        Value::Number(v) => RuntimeValue::Number(v.as_f64().unwrap_or(f64::NAN)),
        Value::String(v) => RuntimeValue::String(v.clone()),
        Value::Array(v) => RuntimeValue::List(v.iter().map(preview_value).collect()),
        Value::Object(_) => RuntimeValue::String("[object Object]".into()),
    }
}

fn key_code(key: &str) -> Option<String> {
    let code = match key {
        "Enter" => 13,
        "Space" => 32,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        _ if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => {
            key.as_bytes()[0].to_ascii_uppercase() as u32
        }
        _ if key.starts_with("Num") && key.len() == 4 && key.as_bytes()[3].is_ascii_digit() => {
            key.as_bytes()[3] as u32
        }
        _ => key.parse().ok()?,
    };
    Some(code.to_string())
}

/// The worker owns immutable project storage, avoiding self-referential structs,
/// unsafe lifetime extensions and full replay on each UI frame.
pub struct Player {
    commands: SyncSender<Command>,
    replies: Receiver<Result<PreviewSnapshot, String>>,
    worker: Option<JoinHandle<()>>,
    pending: bool,
}

impl Player {
    pub fn preview(project: &Value) -> Result<PreviewSnapshot> {
        if project.get("_nekocKitten4").is_some() {
            Ok(NativePreview::new(project)?.snapshot)
        } else {
            Ok(Runtime::from_project(project)?.snapshot().into())
        }
    }

    pub fn start(project: Value) -> Result<Self> {
        let (commands, inbox) = mpsc::sync_channel(1);
        let (outbox, replies) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("nekoc-runtime".into())
            .spawn(move || {
                if project.get("_nekocKitten4").is_some() {
                    let mut preview = match NativePreview::new(&project) {
                        Ok(preview) => preview,
                        Err(error) => {
                            let _ = outbox.send(Err(error.to_string()));
                            return;
                        }
                    };
                    preview.engine.start();
                    while let Ok(command) = inbox.recv() {
                        match command {
                            Command::Tick(events) => {
                                let result = preview.tick(&events).map_err(|e| e.to_string());
                                let failed = result.is_err();
                                if outbox.send(result).is_err() || failed {
                                    break;
                                }
                            }
                            Command::Costume(id, costume) => {
                                preview.engine.set_costume(&id, costume)
                            }
                            Command::Stop => break,
                        }
                    }
                    return;
                }
                let mut runtime = match Runtime::from_project(&project) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = outbox.send(Err(error.to_string()));
                        return;
                    }
                };
                runtime.set_cooperative(true);
                runtime.start();
                while let Ok(command) = inbox.recv() {
                    let events = match command {
                        Command::Tick(events) => events,
                        Command::Costume(..) => continue,
                        Command::Stop => break,
                    };
                    for event in events {
                        runtime.dispatch_event(&event);
                    }
                    let result = runtime
                        .run_ticks(1)
                        .map(|()| runtime.snapshot().into())
                        .map_err(|e| e.to_string());
                    let failed = result.is_err();
                    if outbox.send(result).is_err() || failed {
                        break;
                    }
                }
            })?;
        Ok(Self {
            commands,
            replies,
            worker: Some(worker),
            pending: false,
        })
    }

    pub fn tick(&mut self, events: Vec<RuntimeEvent>) -> Result<bool> {
        if self.pending {
            return Ok(false);
        }
        self.commands
            .send(Command::Tick(events))
            .map_err(|_| anyhow!("runtime worker stopped"))?;
        self.pending = true;
        Ok(true)
    }

    pub fn poll(&mut self) -> Option<Result<PreviewSnapshot, String>> {
        match self.replies.try_recv() {
            Ok(reply) => {
                self.pending = false;
                Some(reply)
            }
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) if self.pending => {
                self.pending = false;
                Some(Err("runtime worker disconnected".into()))
            }
            Err(_) => None,
        }
    }

    pub fn is_pending(&self) -> bool {
        self.pending
    }

    pub fn set_costume(&self, id: String, costume: Costume) -> Result<()> {
        self.commands
            .send(Command::Costume(id, costume))
            .map_err(|_| anyhow!("runtime worker stopped"))
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_transport_is_send_and_kn_keeps_legacy_snapshot() {
        fn assert_send<T: Send>() {}
        assert_send::<PreviewSnapshot>();
        let document = super::super::document::Document::blank();
        let snapshot = Player::preview(document.value()).unwrap();
        assert!(snapshot.native_sprites.is_none());
        assert_eq!(snapshot.ticks, 0);
    }

    #[test]
    fn k4_preview_uses_vm_and_detached_painter_order() {
        let source: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/kitten4/physics-soft.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        let mut preview = NativePreview::new(&project).unwrap();
        let before = preview.engine.debug_snapshot();
        preview.observe();
        assert_eq!(
            before,
            preview.engine.debug_snapshot(),
            "observation must not step or drain the VM"
        );
        assert_eq!(preview.snapshot.native_sprites.as_ref().unwrap().len(), 1);
        preview.engine.start();
        let snapshot = preview.tick(&[]).unwrap();
        assert_eq!(snapshot.ticks, 1);
        assert_eq!(snapshot.actors.len(), 1);
        assert!(snapshot.native_sprites.is_some());
    }

    #[test]
    fn native_cloud_widgets_follow_official_frames_without_stepping_to_observe() {
        let evidence: Value =
            serde_json::from_str(include_str!("../../docs/k4cloudui-evidence.json")).unwrap();
        for name in ["monitors", "ranking", "ui-empty-rows", "ui-ranking-values"] {
            let source = crate::json::from_str(
                &std::fs::read_to_string(format!("tests/fixtures/kitten4/k4cloud-{name}.bcm"))
                    .unwrap(),
            )
            .unwrap();
            let project = crate::kitten4::to_neko(&source).unwrap();
            let mut preview = NativePreview::new(&project).unwrap();
            preview.engine.start();
            for expected in evidence["cases"][name]["frames"].as_array().unwrap() {
                let snapshot = preview.tick(&[]).unwrap();
                let overlay = snapshot.native_overlay.unwrap();
                let official = &expected["official"];
                let ids: Vec<_> = overlay
                    .monitors
                    .iter()
                    .map(|m| m.monitor.id.as_str())
                    .collect();
                let wanted: Vec<_> = official["widgets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|w| w["visible"] == true)
                    .map(|w| w["id"].as_str().unwrap())
                    .collect();
                assert_eq!(ids, wanted, "{name} frame {}", expected["frame"]);
                assert_eq!(
                    overlay.ranking.is_some(),
                    official["ranking"]["show"] == true
                );
                if let Some(ranking) = overlay.ranking {
                    assert_eq!(ranking.score, official["ranking"]["value"].as_f64());
                }
                for monitor in overlay.monitors.iter().filter(|m| m.monitor.list) {
                    let wanted: Vec<_> = official["items"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            _ => v.to_string(),
                        })
                        .collect();
                    assert_eq!(monitor.items.as_ref().unwrap(), &wanted);
                }
            }
        }
    }

    #[cfg(feature = "studio")]
    #[test]
    fn native_decoded_alpha_reaches_physics_and_produces_real_soft_mesh() {
        let source: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/kitten4/physics-soft.bcm"
        ))
        .unwrap();
        let project = crate::kitten4::to_neko(&source).unwrap();
        let mut preview = NativePreview::new(&project).unwrap();
        preview.engine.start();
        // Actual UI can finish decoding after the first VM update. Verify a
        // late Costume upload rebuilds the soft body, not just pre-start setup.
        let initial = preview.tick(&[]).unwrap();
        assert!(
            initial
                .native_sprites
                .unwrap()
                .iter()
                .all(|s| s.soft_mesh.is_none())
        );
        // Same alpha->Costume function used by the UI after PNG/SVG decoding.
        let pixels =
            eframe::egui::ColorImage::new([20, 20], vec![eframe::egui::Color32::WHITE; 400]);
        let costume = super::super::renderer::decoded_costume(&pixels, 20.0, 20.0, [0.0; 2]);
        assert!(costume.mask.is_some());
        preview.engine.set_costume("probe-style", costume);
        let mut mesh = None;
        for _ in 0..8 {
            let snapshot = preview.tick(&[]).unwrap();
            mesh = snapshot
                .native_sprites
                .unwrap()
                .into_iter()
                .find_map(|s| s.soft_mesh);
            if mesh.is_some() {
                break;
            }
        }
        let mesh = mesh.expect("Studio must not remain a mask-less rigid fallback");
        assert!(!mesh.vertices.is_empty());
        assert!(!mesh.triangles.is_empty());
        assert!(mesh.vertices.iter().flatten().all(|v| v.is_finite()));
        let native = super::super::renderer::soft_mesh(
            &mesh,
            eframe::egui::TextureId::User(73),
            eframe::egui::Pos2::ZERO,
            1.0,
            1.0,
        )
        .unwrap();
        assert!(!native.indices.is_empty());
    }
}
