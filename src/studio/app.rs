use super::{
    document::{Document, escape_pointer, palette},
    player::{Player, PreviewSnapshot},
};
use crate::runtime::RuntimeEvent;
use base64::Engine;
use eframe::egui::{self, Color32, RichText, Vec2};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::{Duration, Instant},
};

pub struct Studio {
    document: Document,
    path: String,
    saved_path: Option<PathBuf>,
    owner: String,
    selected: String,
    status: String,
    player: Option<Player>,
    snapshot: Option<PreviewSnapshot>,
    running: bool,
    events: Vec<RuntimeEvent>,
    next_tick: Instant,
    json_buffer: String,
    json_open: bool,
    search: String,
    image_sources: BTreeMap<String, egui::ImageSource<'static>>,
    measured_costumes: BTreeMap<String, [f64; 2]>,
    pending_open: Option<PathBuf>,
    resource_path: String,
    screenshot: Option<PathBuf>,
    frames: usize,
    last_mouse: Option<(f64, f64, bool)>,
}

impl Studio {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        document: Document,
        path: Option<PathBuf>,
        screenshot: Option<PathBuf>,
    ) -> Self {
        egui_extras::install_image_loaders(&cc.egui_ctx);
        let mut fonts = egui::FontDefinitions::default();
        // Use the user's installed CJK font; no proprietary font is distributed.
        for path in [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        ] {
            if let Ok(bytes) = std::fs::read(path) {
                fonts
                    .font_data
                    .insert("cjk".into(), egui::FontData::from_owned(bytes).into());
                fonts
                    .families
                    .entry(egui::FontFamily::Proportional)
                    .or_default()
                    .push("cjk".into());
                break;
            }
        }
        cc.egui_ctx.set_fonts(fonts);
        cc.egui_ctx.set_visuals(egui::Visuals::dark());
        let mut app = Self {
            document,
            path: path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "untitled.bcmkn".into()),
            saved_path: path,
            owner: String::new(),
            selected: String::new(),
            status: "Native Rust editor · development preview".into(),
            player: None,
            snapshot: None,
            running: false,
            events: vec![],
            next_tick: Instant::now(),
            json_buffer: String::new(),
            json_open: false,
            search: String::new(),
            image_sources: BTreeMap::new(),
            measured_costumes: BTreeMap::new(),
            pending_open: None,
            resource_path: String::new(),
            screenshot,
            frames: 0,
            last_mouse: None,
        };
        app.select_first_owner();
        app.refresh_preview();
        app
    }

    fn select_first_owner(&mut self) {
        self.owner = self
            .document
            .value()
            .pointer("/actors/actorsDict")
            .and_then(Value::as_object)
            .and_then(|m| m.keys().next())
            .map(|id| format!("/actors/actorsDict/{}", escape_pointer(id)))
            .or_else(|| {
                self.document
                    .value()
                    .pointer("/scenes/scenesDict")
                    .and_then(Value::as_object)
                    .and_then(|m| m.keys().next())
                    .map(|id| format!("/scenes/scenesDict/{}", escape_pointer(id)))
            })
            .unwrap_or_default();
        self.selected.clear();
    }

    fn refresh_preview(&mut self) {
        if self.player.is_none() {
            match Player::preview(self.document.value()) {
                Ok(snapshot) => self.snapshot = Some(snapshot),
                Err(error) => {
                    self.snapshot = None;
                    self.status = error.to_string();
                }
            }
        }
    }

    fn result(&mut self, result: anyhow::Result<()>) {
        if let Err(error) = result {
            self.status = error.to_string();
        } else {
            self.refresh_preview();
        }
    }

    fn stop(&mut self) {
        self.running = false;
        self.player = None;
        self.events.clear();
        self.last_mouse = None;
    }

    fn tick(&mut self) {
        if self.player.is_none() {
            self.measured_costumes.clear();
            match Player::start(self.document.value().clone()) {
                Ok(player) => self.player = Some(player),
                Err(error) => {
                    self.status = error.to_string();
                    self.running = false;
                    return;
                }
            }
        }
        if let Some(player) = &mut self.player {
            if player.is_pending() {
                return;
            }
            if let Err(error) = player.tick(std::mem::take(&mut self.events)) {
                self.status = error.to_string();
                self.running = false;
            }
        }
    }

    fn open(&mut self, path: PathBuf) {
        match crate::project::load_project(&path).and_then(|p| Document::new(p.value)) {
            Ok(document) => {
                self.stop();
                self.document = document;
                self.path = path.display().to_string();
                self.saved_path = Some(path.clone());
                self.select_first_owner();
                self.image_sources.clear();
                self.measured_costumes.clear();
                self.refresh_preview();
                self.status = format!("Opened {}", path.display());
            }
            Err(error) => self.status = error.to_string(),
        }
    }

    fn toolbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("toolbar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading(RichText::new("NEKO / STUDIO").color(Color32::from_rgb(123, 170, 255)));
                ui.separator();
                ui.label(if self.document.is_dirty() {
                    "● Modified"
                } else {
                    "Saved"
                });
                ui.add(egui::TextEdit::singleline(&mut self.path).desired_width(330.0));
                if ui.button("Open").clicked() {
                    self.pending_open = Some(PathBuf::from(&self.path));
                }
                if ui.button("Save").clicked() {
                    let result = self.document.save(&PathBuf::from(&self.path));
                    if result.is_ok() {
                        self.saved_path = Some(PathBuf::from(&self.path));
                    }
                    self.status = match result {
                        Ok(()) => "Project saved".into(),
                        Err(e) => e.to_string(),
                    };
                }
                if ui
                    .add_enabled(
                        self.player.is_none() && self.document.can_undo(),
                        egui::Button::new("Undo"),
                    )
                    .clicked()
                {
                    self.document.undo();
                    self.refresh_preview();
                }
                if ui
                    .add_enabled(
                        self.player.is_none() && self.document.can_redo(),
                        egui::Button::new("Redo"),
                    )
                    .clicked()
                {
                    self.document.redo();
                    self.refresh_preview();
                }
                ui.separator();
                if ui
                    .button(if self.running { "Pause" } else { "Run" })
                    .clicked()
                {
                    self.running = !self.running;
                    self.next_tick = Instant::now();
                }
                if ui.button("Step").clicked() {
                    self.running = false;
                    self.tick();
                }
                if ui.button("Stop").clicked() {
                    self.stop();
                    self.refresh_preview();
                }
            });
        });
        if let Some(path) = self.pending_open.clone() {
            if !self.document.is_dirty() {
                self.pending_open = None;
                self.open(path);
            } else {
                egui::Window::new("Unsaved project")
                    .collapsible(false)
                    .show(ctx, |ui| {
                        ui.label("Save changes before opening another project?");
                        ui.horizontal(|ui| {
                            if ui.button("Save and open").clicked() {
                                let save_path = self
                                    .saved_path
                                    .clone()
                                    .unwrap_or_else(|| PathBuf::from("untitled.bcmkn"));
                                match self.document.save(&save_path) {
                                    Ok(()) => {
                                        self.pending_open = None;
                                        self.open(path.clone());
                                    }
                                    Err(e) => self.status = e.to_string(),
                                }
                            }
                            if ui.button("Discard and open").clicked() {
                                self.pending_open = None;
                                self.open(path.clone());
                            }
                            if ui.button("Cancel").clicked() {
                                self.pending_open = None;
                            }
                        });
                    });
            }
        }
    }

    fn project_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("project")
            .default_width(205.0)
            .show(ctx, |ui| {
                ui.heading("Project");
                let value = self.document.value().clone();
                ui.label(value["projectName"].as_str().unwrap_or("Untitled"));
                ui.small(format!(
                    "Kitten N {}",
                    value["version"].as_str().unwrap_or("?")
                ));
                ui.separator();
                egui::ScrollArea::vertical()
                    .id_salt("owners")
                    .max_height(300.0)
                    .show(ui, |ui| {
                        for (label, prefix) in [
                            ("Scenes", "/scenes/scenesDict"),
                            ("Sprites", "/actors/actorsDict"),
                            ("Procedures", "/procedures/proceduresDict"),
                        ] {
                            ui.strong(label);
                            if let Some(owners) = value.pointer(prefix).and_then(Value::as_object) {
                                for (id, owner) in owners {
                                    let path = format!("{prefix}/{}", escape_pointer(id));
                                    let name = owner
                                        .get("screenName")
                                        .or_else(|| owner.get("name"))
                                        .and_then(Value::as_str)
                                        .unwrap_or(id);
                                    if ui.selectable_label(self.owner == path, name).clicked() {
                                        self.owner = path;
                                        self.selected.clear();
                                        if prefix == "/scenes/scenesDict" && self.player.is_none() {
                                            let result = self
                                                .document
                                                .set("/scenes/currentSceneId", json!(id));
                                            self.result(result);
                                        }
                                    }
                                }
                            }
                        }
                    });
                ui.add_enabled_ui(self.player.is_none(), |ui| {
                    ui.horizontal(|ui| {
                        if ui.button("+ Sprite").clicked() {
                            let scene = value["scenes"]["currentSceneId"].as_str().unwrap_or("");
                            match self.document.add_actor(scene) {
                                Ok(id) => {
                                    self.owner =
                                        format!("/actors/actorsDict/{}", escape_pointer(&id));
                                    self.refresh_preview();
                                }
                                Err(e) => self.status = e.to_string(),
                            }
                        }
                        if ui.button("+ Scene").clicked() {
                            match self.document.add_scene() {
                                Ok(id) => {
                                    self.owner =
                                        format!("/scenes/scenesDict/{}", escape_pointer(&id))
                                }
                                Err(e) => self.status = e.to_string(),
                            }
                        }
                    });
                });
                ui.separator();
                ui.heading("Blocks");
                ui.add(egui::TextEdit::singleline(&mut self.search).hint_text("Search"));
                ui.small("Select a block to append; otherwise add a new stack.");
                egui::ScrollArea::vertical()
                    .id_salt("palette")
                    .show(ui, |ui| {
                        ui.add_enabled_ui(self.player.is_none(), |ui| {
                            for (label, block) in palette() {
                                if !label.to_lowercase().contains(&self.search.to_lowercase()) {
                                    continue;
                                }
                                if ui.button(label).clicked() {
                                    let is_hat = matches!(
                                        block["type"].as_str(),
                                        Some("on_running_group_activated" | "on_keydown")
                                    );
                                    let result = if self.selected.is_empty() || is_hat {
                                        self.document.add_script(&self.owner, block)
                                    } else {
                                        self.document.append(&self.selected, block)
                                    };
                                    self.result(result);
                                }
                            }
                        });
                    });
            });
    }

    fn workspace(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Scripts");
                if ui.button("Deselect").clicked() {
                    self.selected.clear();
                }
                if ui
                    .add_enabled(
                        self.player.is_none() && !self.selected.is_empty(),
                        egui::Button::new("Delete selected"),
                    )
                    .clicked()
                {
                    let result = self.document.remove_block(&self.selected);
                    self.selected.clear();
                    self.result(result);
                }
                if ui.button("Workspace JSON").clicked() {
                    self.json_buffer = String::from_utf8(
                        crate::json::to_vec_pretty(
                            self.document
                                .value()
                                .pointer(&self.owner)
                                .and_then(|v| v.get("nekoBlockJsonList"))
                                .unwrap_or(&json!([])),
                        )
                        .unwrap(),
                    )
                    .unwrap();
                    self.json_open = true;
                }
            });
            ui.small(&self.owner);
            let owner = self
                .document
                .value()
                .pointer(&self.owner)
                .cloned()
                .unwrap_or(Value::Null);
            let mut edits = Vec::new();
            let mut moves = Vec::new();
            egui::ScrollArea::both().show(ui, |ui| {
                ui.add_enabled_ui(self.player.is_none(), |ui| {
                    if let Some(blocks) = owner["nekoBlockJsonList"].as_array() {
                        for (i, block) in blocks.iter().enumerate() {
                            block_ui(
                                ui,
                                block,
                                &format!("{}/nekoBlockJsonList/{i}", self.owner),
                                &mut self.selected,
                                &mut edits,
                                &mut moves,
                                0,
                            );
                            ui.add_space(18.0);
                        }
                        if blocks.is_empty() {
                            ui.label("Add a ‘When started’ block from the palette to begin.");
                        }
                    }
                });
            });
            for (path, value) in edits {
                let result = self.document.set(&path, value);
                self.result(result);
            }
            for (source, target) in moves {
                let result = self.document.move_stack_after(&source, &target);
                self.selected.clear();
                self.result(result);
            }
        });
        if self.json_open {
            let mut open = true;
            egui::Window::new("Workspace JSON · nested Kitten N blocks")
                .open(&mut open)
                .default_size([700.0, 500.0])
                .show(ctx, |ui| {
                    egui::ScrollArea::both().max_height(420.0).show(ui, |ui| {
                        ui.add(
                            egui::TextEdit::multiline(&mut self.json_buffer)
                                .code_editor()
                                .desired_width(f32::INFINITY),
                        );
                    });
                    if ui
                        .add_enabled(
                            self.player.is_none(),
                            egui::Button::new("Apply as one undoable edit"),
                        )
                        .clicked()
                    {
                        match crate::json::from_str(&self.json_buffer) {
                            Ok(value) if value.is_array() => {
                                let result = self.document.set(
                                    &format!("{}/nekoBlockJsonList", self.owner),
                                    value.into_value(),
                                );
                                if result.is_ok() {
                                    self.json_open = false;
                                    self.selected.clear();
                                }
                                self.result(result);
                            }
                            Ok(_) => self.status = "Expected an array of root blocks".into(),
                            Err(e) => self.status = e.to_string(),
                        }
                    }
                });
            self.json_open &= open;
        }
    }

    fn inspector(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("stage-inspector")
            .default_width(460.0)
            .min_width(320.0)
            .show(ctx, |ui| {
                ui.heading("Stage");
                self.stage(ui);
                ui.separator();
                egui::ScrollArea::vertical()
                    .id_salt("inspector")
                    .show(ui, |ui| {
                        ui.heading("Properties");
                        let owner = self
                            .document
                            .value()
                            .pointer(&self.owner)
                            .cloned()
                            .unwrap_or(Value::Null);
                        let mut edits = Vec::new();
                        ui.add_enabled_ui(self.player.is_none(), |ui| {
                            for key in ["name", "screenName", "scale", "rotation", "visible"] {
                                if let Some(value) = owner.get(key) {
                                    scalar_ui(
                                        ui,
                                        key,
                                        value,
                                        &format!("{}/{key}", self.owner),
                                        &mut edits,
                                    );
                                }
                            }
                            for key in ["x", "y"] {
                                if let Some(value) = owner["position"].get(key) {
                                    scalar_ui(
                                        ui,
                                        key,
                                        value,
                                        &format!("{}/position/{key}", self.owner),
                                        &mut edits,
                                    );
                                }
                            }
                        });
                        for (path, value) in edits {
                            let result = self.document.set(&path, value);
                            self.result(result);
                        }
                        ui.separator();
                        ui.heading("Resources");
                        ui.add_enabled_ui(self.player.is_none(), |ui| {
                            ui.add(
                                egui::TextEdit::singleline(&mut self.resource_path)
                                    .hint_text("Local PNG / JPG / SVG path"),
                            );
                            if ui.button("Import costume / backdrop").clicked() {
                                let path = PathBuf::from(&self.resource_path);
                                let mime = match path
                                    .extension()
                                    .and_then(|e| e.to_str())
                                    .unwrap_or("")
                                    .to_ascii_lowercase()
                                    .as_str()
                                {
                                    "png" => Some("image/png"),
                                    "jpg" | "jpeg" => Some("image/jpeg"),
                                    "svg" => Some("image/svg+xml"),
                                    "webp" => Some("image/webp"),
                                    _ => None,
                                };
                                let result = (|| -> anyhow::Result<()> {
                                    let mime = mime.ok_or_else(|| {
                                        anyhow::anyhow!("Supported images: PNG, JPG, SVG, WebP")
                                    })?;
                                    let bytes = std::fs::read(&path)?;
                                    let url = format!(
                                        "data:{mime};base64,{}",
                                        base64::engine::general_purpose::STANDARD.encode(bytes)
                                    );
                                    self.document.import_style(
                                        &self.owner,
                                        path.file_stem()
                                            .and_then(|s| s.to_str())
                                            .unwrap_or("Costume"),
                                        &url,
                                    )?;
                                    Ok(())
                                })();
                                self.result(result);
                            }
                        });
                        for (label, path) in [
                            ("Costumes", "/styles/stylesDict"),
                            ("Audio", "/audios/audiosDict"),
                        ] {
                            ui.collapsing(label, |ui| {
                                if let Some(resources) = self
                                    .document
                                    .value()
                                    .pointer(path)
                                    .and_then(Value::as_object)
                                {
                                    for (id, resource) in resources {
                                        ui.label(resource["name"].as_str().unwrap_or(id));
                                    }
                                }
                            });
                        }
                        ui.separator();
                        ui.heading("Runtime");
                        if let Some(snapshot) = &self.snapshot {
                            ui.label(format!(
                                "Tick {} · {} active scripts",
                                snapshot.ticks, snapshot.active_threads
                            ));
                            for (id, value) in &snapshot.variables {
                                let name = snapshot.variable_names.get(id).unwrap_or(id);
                                ui.label(format!(
                                    "{name}: {}",
                                    serde_json::to_string(value).unwrap_or_default()
                                ));
                            }
                            ui.collapsing("Console", |ui| {
                                for log in snapshot.logs.iter().rev().take(50) {
                                    ui.label(log);
                                }
                            });
                        }
                        if ui.button("Validate project").clicked() {
                            self.status = crate::validate::build_report(self.document.value())
                                .map(|r| r.to_string())
                                .unwrap_or_else(|e| e.to_string());
                        }
                    });
            });
    }

    fn image_source(&mut self, style: &str) -> Option<egui::ImageSource<'static>> {
        if let Some(source) = self.image_sources.get(style) {
            return Some(source.clone());
        }
        let url = self
            .document
            .value()
            .pointer("/styles/stylesDict")?
            .get(style)?
            .get("url")?
            .as_str()?;
        let source = if url.starts_with("data:") {
            let (metadata, data) = url.split_once(',')?;
            let bytes = if metadata.ends_with(";base64") {
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .ok()?
            } else {
                percent_encoding::percent_decode_str(data).collect()
            };
            let suffix = if metadata.contains("svg") {
                "svg"
            } else if metadata.contains("jpeg") {
                "jpg"
            } else {
                "png"
            };
            egui::ImageSource::Bytes {
                uri: format!("bytes://{style}.{suffix}").into(),
                bytes: bytes.into(),
            }
        } else {
            egui::ImageSource::Uri(url.to_owned().into())
        };
        self.image_sources.insert(style.into(), source.clone());
        Some(source)
    }

    fn stage(&mut self, ui: &mut egui::Ui) {
        let width = self.document.value()["stageSize"]["width"]
            .as_f64()
            .unwrap_or(900.0)
            .clamp(1.0, 10000.0) as f32;
        let height = self.document.value()["stageSize"]["height"]
            .as_f64()
            .unwrap_or(562.0)
            .clamp(1.0, 10000.0) as f32;
        let size = Vec2::new(ui.available_width(), ui.available_width() * height / width);
        let (rect, response) = ui.allocate_exact_size(size, egui::Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        let old_clip = ui.clip_rect();
        ui.set_clip_rect(rect.intersect(old_clip));
        painter.rect_filled(rect, 0.0, Color32::WHITE);
        let scale = size.x / width;
        let point = |x: f64, y: f64| {
            egui::pos2(
                rect.center().x + x as f32 * scale,
                rect.center().y - y as f32 * scale,
            )
        };
        if let Some(snapshot) = self.snapshot.clone() {
            let scene = snapshot
                .current_scene_id
                .as_deref()
                .and_then(|id| {
                    self.document
                        .value()
                        .pointer("/scenes/scenesDict")
                        .and_then(|m| m.get(id))
                })
                .cloned()
                .unwrap_or(Value::Null);
            if let Some(style) = scene["currentStyleId"].as_str()
                && let Some(source) = self.image_source(style)
            {
                egui::Image::new(source).paint_at(ui, rect);
            }
            if let Some(sprites) = &snapshot.native_sprites {
                self.paint_native_sprites(
                    ui,
                    rect,
                    scale,
                    sprites,
                    &snapshot.native_lines,
                    snapshot.pen_layer,
                );
            } else {
                let actor_ids = scene["actorIds"].as_array();
                for actor in snapshot.actors.values() {
                    if actor_ids
                        .is_some_and(|ids| !ids.iter().any(|id| id.as_str() == Some(&actor.id)))
                    {
                        continue;
                    }
                    for stroke in &actor.pen.strokes {
                        let color = parse_color(&stroke.color);
                        let radius = (stroke.size as f32 * scale / 2.0).max(0.1);
                        let a = point(stroke.x1, stroke.y1);
                        let b = point(stroke.x2, stroke.y2);
                        painter.line_segment([a, b], egui::Stroke::new(radius * 2.0, color));
                        painter.circle_filled(a, radius, color);
                        painter.circle_filled(b, radius, color);
                    }
                }
                // Preserve scene layer order rather than sorting sprites by identifier.
                let ordered: Vec<_> = if let Some(ids) = actor_ids {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .filter_map(|id| snapshot.actors.get(id))
                        .collect()
                } else {
                    snapshot.actors.values().collect()
                };
                for actor in ordered {
                    if !actor.visible {
                        continue;
                    }
                    let center = point(actor.x, actor.y);
                    if let Some(style) = actor.current_style_id.as_deref()
                        && let Some(source) = self.image_source(style)
                    {
                        let image = egui::Image::new(source)
                            .rotate(-(actor.rotation as f32).to_radians(), Vec2::splat(0.5));
                        let natural = image
                            .load_for_size(ui.ctx(), Vec2::splat(256.0))
                            .ok()
                            .and_then(|p| p.size())
                            .unwrap_or(Vec2::splat(40.0));
                        let actor_size = natural * (actor.scale as f32 / 100.0).abs() * scale;
                        image.paint_at(ui, egui::Rect::from_center_size(center, actor_size));
                    } else {
                        painter.circle_filled(
                            center,
                            18.0 * scale * actor.scale as f32 / 100.0,
                            Color32::from_rgb(96, 143, 238),
                        );
                    }
                    if let Some(dialog) = &actor.dialog {
                        painter.text(
                            center + egui::vec2(0.0, -30.0),
                            egui::Align2::CENTER_BOTTOM,
                            &dialog.text,
                            egui::FontId::proportional(16.0),
                            Color32::BLACK,
                        );
                    }
                }
            }
            if let Some(overlay) = &snapshot.native_overlay {
                super::overlay_renderer::paint(ui, rect, scale, overlay);
            }
        }
        if response.clicked() {
            response.request_focus();
        }
        if self.player.is_some() {
            if let Some(pos) = response.hover_pos() {
                let x = (pos.x - rect.center().x) / scale;
                let y = (rect.center().y - pos.y) / scale;
                let mouse = (x as f64, y as f64, ui.input(|i| i.pointer.primary_down()));
                if self.last_mouse != Some(mouse) {
                    self.events.push(RuntimeEvent::Mouse {
                        state: Some(if mouse.2 { "down" } else { "up" }.into()),
                        x: Some(mouse.0),
                        y: Some(mouse.1),
                    });
                    self.last_mouse = Some(mouse);
                }
                if response.clicked() {
                    self.events.push(RuntimeEvent::Click {
                        x: Some(x as f64),
                        y: Some(y as f64),
                    });
                }
            }
            if response.has_focus() {
                for event in ui.input(|i| i.events.clone()) {
                    if let egui::Event::Key {
                        key,
                        pressed,
                        repeat: false,
                        ..
                    } = event
                    {
                        self.events.push(RuntimeEvent::Key {
                            key: format!("{key:?}"),
                            state: if pressed { "down" } else { "up" }.into(),
                        });
                    }
                }
            }
        }
        ui.set_clip_rect(old_clip);
        ui.small("Preview: native costumes / soft meshes / pen (partial). Effects and audio are not yet rendered.");
    }

    fn paint_native_sprites(
        &mut self,
        ui: &egui::Ui,
        rect: egui::Rect,
        scale: f32,
        sprites: &[super::player::NativeSprite],
        lines: &[[f32; 9]],
        pen_layer: usize,
    ) {
        let painter = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
        let point = |x: f64, y: f64| {
            egui::pos2(
                rect.center().x + x as f32 * scale,
                rect.center().y - y as f32 * scale,
            )
        };
        for i in 0..=sprites.len() {
            if i == pen_layer.min(sprites.len()) {
                for &[x1, y1, x2, y2, width, r, g, b, a] in lines {
                    if ![x1, y1, x2, y2, width, r, g, b, a]
                        .iter()
                        .all(|n| n.is_finite())
                    {
                        continue;
                    }
                    let color = Color32::from_rgba_unmultiplied(
                        (r.clamp(0.0, 1.0) * 255.0) as u8,
                        (g.clamp(0.0, 1.0) * 255.0) as u8,
                        (b.clamp(0.0, 1.0) * 255.0) as u8,
                        (a.clamp(0.0, 1.0) * 255.0) as u8,
                    );
                    let radius = (width * scale / 2.0).max(0.0);
                    let a = point(x1 as f64, y1 as f64);
                    let b = point(x2 as f64, y2 as f64);
                    painter.line_segment([a, b], egui::Stroke::new(radius * 2.0, color));
                    painter.circle_filled(a, radius, color);
                    painter.circle_filled(b, radius, color);
                }
            }
            let Some(sprite) = sprites.get(i) else {
                continue;
            };
            if !sprite.visible {
                continue;
            }
            if let Some(style) = sprite.style.as_deref()
                && let Some(source) = self.image_source(style)
            {
                let image = egui::Image::new(source).fit_to_original_size(1.0);
                match image.load_for_size(ui.ctx(), rect.size()) {
                    Ok(egui::load::TexturePoll::Ready { texture }) => {
                        let style_value = &self.document.value()["styles"]["stylesDict"][style];
                        let width = style_value["width"]
                            .as_f64()
                            .unwrap_or(texture.size.x as f64);
                        let height = style_value["height"]
                            .as_f64()
                            .unwrap_or(texture.size.y as f64);
                        if width <= 0.0
                            || height <= 0.0
                            || !width.is_finite()
                            || !height.is_finite()
                        {
                            continue;
                        }
                        let pivot = crate::engine::Costume::center_point_from_json(
                            &style_value["centerPoint"],
                        );
                        if self.measured_costumes.get(style) != Some(&[width, height])
                            && let Some(player) = &self.player
                        {
                            // load_for_size registered inline bytes with the
                            // loaders above. Read their decoded pixels too, not
                            // just the GPU texture: soft physics requires alpha.
                            if let Some(uri) = image.uri() {
                                match ui
                                    .ctx()
                                    .try_load_image(uri, egui::load::SizeHint::default())
                                {
                                    Ok(egui::load::ImagePoll::Ready { image }) => {
                                        let costume = super::renderer::decoded_costume(
                                            &image, width, height, pivot,
                                        );
                                        if costume.mask.is_some()
                                            && player.set_costume(style.into(), costume).is_ok()
                                        {
                                            self.measured_costumes
                                                .insert(style.into(), [width, height]);
                                        }
                                    }
                                    Ok(egui::load::ImagePoll::Pending { .. }) => {
                                        ui.ctx().request_repaint()
                                    }
                                    Err(error) => {
                                        self.status = format!("Costume alpha {style}: {error}")
                                    }
                                }
                            }
                        }
                        let quad;
                        let source = if let Some(mesh) = &sprite.soft_mesh {
                            mesh
                        } else {
                            quad = super::renderer::costume_quad(sprite, width, height, pivot);
                            &quad
                        };
                        if let Some(mesh) = super::renderer::soft_mesh(
                            source,
                            texture.id,
                            rect.center(),
                            scale,
                            sprite.opacity,
                        ) {
                            painter.add(egui::Shape::mesh(mesh));
                        }
                    }
                    Ok(egui::load::TexturePoll::Pending { .. }) => ui.ctx().request_repaint(),
                    Err(error) => self.status = format!("Costume {style}: {error}"),
                }
            }
            if let Some(dialog) = &sprite.dialog {
                painter.text(
                    point(sprite.x, sprite.y) + egui::vec2(0.0, -30.0),
                    egui::Align2::CENTER_BOTTOM,
                    &dialog.text,
                    egui::FontId::proportional(16.0),
                    Color32::BLACK,
                );
            }
        }
    }
}

impl eframe::App for Studio {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.frames += 1;
        if let Some(path) = &self.screenshot {
            for event in ctx.input(|i| i.events.clone()) {
                if let egui::Event::Screenshot { image, .. } = event {
                    let bytes: Vec<u8> = image.pixels.iter().flat_map(|p| p.to_array()).collect();
                    match image::save_buffer(
                        path,
                        &bytes,
                        image.width() as u32,
                        image.height() as u32,
                        image::ColorType::Rgba8,
                    ) {
                        Ok(()) => println!("Screenshot saved: {}", path.display()),
                        Err(error) => eprintln!("Screenshot failed: {error}"),
                    }
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
            if self.frames == 12 {
                ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
            }
            ctx.request_repaint();
        }
        if let Some(player) = &mut self.player
            && let Some(reply) = player.poll()
        {
            match reply {
                Ok(snapshot) => self.snapshot = Some(snapshot),
                Err(error) => {
                    self.status = format!("Runtime: {error}");
                    self.stop();
                }
            }
        }
        if self.running && Instant::now() >= self.next_tick {
            self.tick();
            let fps = if self.document.value().get("_nekocKitten4").is_some() {
                60.0
            } else {
                30.0
            };
            self.next_tick = Instant::now() + Duration::from_secs_f64(1.0 / fps);
        }
        self.toolbar(ctx);
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.label(&self.status);
        });
        self.project_panel(ctx);
        self.inspector(ctx);
        self.workspace(ctx);
        if self.running || self.player.as_ref().is_some_and(Player::is_pending) {
            ctx.request_repaint_after(Duration::from_millis(8));
        }
    }
}

fn block_ui(
    ui: &mut egui::Ui,
    block: &Value,
    path: &str,
    selected: &mut String,
    edits: &mut Vec<(String, Value)>,
    moves: &mut Vec<(String, String)>,
    depth: usize,
) {
    if depth > 128 {
        ui.label("Nesting too deep to display");
        return;
    }
    let kind = block["type"].as_str().unwrap_or("unknown");
    let color = if kind.starts_with("self_") {
        Color32::from_rgb(42, 68, 105)
    } else if kind.starts_with("repeat") || kind == "wait" {
        Color32::from_rgb(107, 71, 29)
    } else {
        Color32::from_rgb(68, 51, 98)
    };
    ui.push_id(path, |ui| {
        egui::Frame::new()
            .fill(color)
            .corner_radius(6)
            .inner_margin(9.0)
            .stroke(egui::Stroke::new(
                if selected == path { 2.0 } else { 0.0 },
                Color32::from_rgb(135, 192, 255),
            ))
            .show(ui, |ui| {
                let response = ui
                    .dnd_drag_source(egui::Id::new((path, "drag")), path.to_owned(), |ui| {
                        if ui
                            .selectable_label(selected == path, RichText::new(kind).strong())
                            .clicked()
                        {
                            *selected = path.into();
                        }
                    })
                    .response;
                if let Some(source) = response.dnd_release_payload::<String>()
                    && let Some(target) = block["id"].as_str()
                {
                    moves.push(((*source).clone(), target.into()));
                }
                if let Some(fields) = block["fields"].as_object() {
                    for (key, value) in fields {
                        scalar_ui(
                            ui,
                            key,
                            value,
                            &format!("{path}/fields/{}", escape_pointer(key)),
                            edits,
                        );
                    }
                }
                if let Some(inputs) = block["inputs"].as_object() {
                    for (name, input) in inputs {
                        ui.horizontal(|ui| {
                            ui.label(name);
                            if matches!(input["type"].as_str(), Some("math_number" | "text")) {
                                if let Some(fields) = input["fields"].as_object() {
                                    for (key, value) in fields {
                                        scalar_ui(
                                            ui,
                                            "",
                                            value,
                                            &format!(
                                                "{path}/inputs/{}/fields/{}",
                                                escape_pointer(name),
                                                escape_pointer(key)
                                            ),
                                            edits,
                                        );
                                    }
                                }
                            } else {
                                block_ui(
                                    ui,
                                    input,
                                    &format!("{path}/inputs/{}", escape_pointer(name)),
                                    selected,
                                    edits,
                                    moves,
                                    depth + 1,
                                );
                            }
                        });
                    }
                }
                if let Some(statements) = block["statements"].as_object() {
                    for (name, child) in statements {
                        ui.label(RichText::new(name).small());
                        ui.indent(name, |ui| {
                            block_ui(
                                ui,
                                child,
                                &format!("{path}/statements/{}", escape_pointer(name)),
                                selected,
                                edits,
                                moves,
                                depth + 1,
                            )
                        });
                    }
                }
            });
        if let Some(next) = block.get("next").filter(|v| v.is_object()) {
            ui.add_space(2.0);
            block_ui(
                ui,
                next,
                &format!("{path}/next"),
                selected,
                edits,
                moves,
                depth + 1,
            );
        }
    });
}

fn scalar_ui(
    ui: &mut egui::Ui,
    label: &str,
    value: &Value,
    path: &str,
    edits: &mut Vec<(String, Value)>,
) {
    ui.push_id(path, |ui| {
        ui.horizontal(|ui| {
            if !label.is_empty() {
                ui.label(label);
            }
            match value {
                Value::String(text) => {
                    let mut text = text.clone();
                    if ui
                        .add(egui::TextEdit::singleline(&mut text).desired_width(130.0))
                        .changed()
                    {
                        edits.push((path.into(), json!(text)));
                    }
                }
                Value::Number(number) => {
                    let mut n = number.as_f64().unwrap_or(0.0);
                    if ui.add(egui::DragValue::new(&mut n).speed(0.5)).changed() {
                        edits.push((path.into(), json!(n)));
                    }
                }
                Value::Bool(value) => {
                    let mut value = *value;
                    if ui.checkbox(&mut value, "").changed() {
                        edits.push((path.into(), json!(value)));
                    }
                }
                _ => {
                    ui.label(value.to_string());
                }
            }
        });
    });
}

fn parse_color(color: &str) -> Color32 {
    let rgb = u32::from_str_radix(color.trim_start_matches('#'), 16).unwrap_or(0);
    Color32::from_rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
}
