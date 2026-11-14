//! 播放器后端 SDK：与传输方式无关的播放会话。
//!
//! 浏览器播放器（`web/player.js`）和 `web` 后端之间的协议都在这里实现：
//! 握手（作品 + 可选的扩展积木协商）、每帧请求（输入事件 → 推进一帧）、
//! 二进制帧编码。宿主只负责搬运消息，WebSocket、HTTP、stdio、桌面 IPC 都行；
//! 进程内嵌入时也可以跳过 JSON，直接用 [`FrameInput`] 和 [`Player::step`]。
//!
//! 协议与用法见 `docs/player-sdk.md`。
use crate::device::DeviceInput;
use crate::engine::{Costume, Engine, Frame, Program};
use crate::extensions::{BlockSchema, CallPolicy, ErrorPolicy, ExtensionRegistry};
use crate::json::Json;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::time::Duration;

/// `/api/health` 报告的播放器协议版本。
pub const PROTOCOL_VERSION: u32 = 2;
/// 握手消息（含作品）的上限。
pub const MAX_PROJECT_BYTES: usize = 64 * 1024 * 1024;
/// 帧请求的上限。一般很小，只有首次发送的造型遮罩/RGB 可能到几 MB。
pub const MAX_FRAME_REQUEST_BYTES: usize = 32 * 1024 * 1024;
/// Kitten4 作品导入后保存原始数据的字段名。
pub const KITTEN4_METADATA: &str = "_nekocKitten4";
const MAX_EXTENSIONS: usize = 256;
const MAX_EXTENSION_API_VERSIONS: usize = 16;
const DEFAULT_DT: f64 = 1.0 / 60.0;
const DEFAULT_BUDGET_MS: f64 = 4.0;

pub fn is_kitten4_project(project: &Value) -> bool {
    project.get(KITTEN4_METADATA).is_some()
}

/// 把用户给的 .bcmkn / Kitten4 .bcm JSON 转成播放器可直接运行的规范 KN JSON。
/// 返回 `(作品, 导入报告)`；报告与编辑器 `/api/import` 的响应字段一致。
pub fn import(value: Json) -> Result<(Json, Json)> {
    let value = if crate::kitten4::is_kitten4(&value) {
        crate::kitten4::to_neko(&value)?
    } else {
        value
    };
    check_project_shape(&value)?;
    let (value, mut report) = crate::bcmkn::import(value)?;
    if is_kitten4_project(&value) {
        // Reject forged/incomplete provenance before it becomes the active project.
        crate::kitten4::from_neko(&value)?;
        report["format"] = json!("kitten4-json");
    }
    report["export_extension"] = json!(if is_kitten4_project(&value) {
        "bcm"
    } else {
        "bcmkn"
    });
    report["editor_format"] = json!("bcmkn-json");
    Ok((value, Json::new(report)))
}

/// 播放器 `/api/extension-check`：`{project, extensions}` 能否带这些远程扩展积木编译。
/// 返回 `{"ok":true,"stats":…}`。
pub fn check_extensions(payload: &Value) -> Result<Value> {
    check_project_shape(&payload["project"])?;
    let schemas: Vec<BlockSchema> = serde_json::from_value(payload["extensions"].clone())?;
    ensure!(
        schemas.len() <= MAX_EXTENSIONS,
        "too many remote extensions"
    );
    let mut registry = ExtensionRegistry::new();
    for schema in schemas {
        registry.register_remote(schema)?;
    }
    let compiled = Program::compile_with_extensions(&payload["project"], &registry)?;
    Ok(json!({"ok":true,"stats":compiled.stats()}))
}

/// 在诊断或运行时遍历作品之前，先检查编辑器要求的结构。
/// 不支持的 opcode 不算错误，照样能导入、导出。
pub fn check_project_shape(project: &Value) -> Result<()> {
    ensure!(project.is_object(), "expected project object");
    if let Some(tool) = project.get("toolType") {
        ensure!(
            tool == "KN",
            "编辑器需要规范 KN JSON；Kitten4 .bcm 请使用导入"
        );
    }
    for path in ["/scenes/scenesDict", "/actors/actorsDict"] {
        ensure!(
            project.pointer(path).is_some_and(Value::is_object),
            "project requires object {path}"
        );
    }
    for path in [
        "/scenes/scenesDict",
        "/actors/actorsDict",
        "/procedures/proceduresDict",
    ] {
        if let Some(owners) = project.pointer(path) {
            let owners = owners
                .as_object()
                .with_context(|| format!("expected object {path}"))?;
            for (id, owner) in owners {
                ensure!(owner.is_object(), "expected object {path}/{id}");
                if let Some(blocks) = owner.get("nekoBlockJsonList") {
                    let blocks = blocks
                        .as_array()
                        .context("nekoBlockJsonList must be an array")?;
                    for block in blocks {
                        check_block_shape(block, 0)?;
                    }
                }
                if let Some(ids) = owner.get("actorIds") {
                    ensure!(
                        ids.as_array()
                            .is_some_and(|ids| ids.iter().all(Value::is_string)),
                        "actorIds must be an array of strings"
                    );
                }
            }
        }
    }
    if let Some(metadata) = project.get(KITTEN4_METADATA) {
        ensure!(
            metadata.is_object(),
            "Kitten4 保真元数据 {KITTEN4_METADATA} 必须是对象"
        );
    }
    Ok(())
}

fn check_block_shape(block: &Value, depth: usize) -> Result<()> {
    let mut pending = vec![(block, depth)];
    while let Some((block, depth)) = pending.pop() {
        ensure!(
            depth <= crate::json::MAX_BLOCK_DEPTH,
            "block nesting exceeds {} at block {} ({})",
            crate::json::MAX_BLOCK_DEPTH,
            block["id"],
            block["type"]
        );
        ensure!(
            block.is_object() && block["type"].is_string(),
            "block must be an object with a string type"
        );
        if let Some(fields) = block.get("fields") {
            ensure!(fields.is_object(), "block fields must be an object");
        }
        for key in ["inputs", "statements"] {
            if let Some(children) = block.get(key) {
                let children = children
                    .as_object()
                    .with_context(|| format!("block {key} must be an object"))?;
                for child in children.values() {
                    if key == "statements" && child.is_null() {
                        continue;
                    }
                    pending.push((child, depth + 1));
                }
            }
        }
        if let Some(next) = block.get("next").filter(|v| !v.is_null()) {
            pending.push((next, depth));
        }
    }
    Ok(())
}

/// 客户端在握手时提供的远程扩展积木。
#[derive(Clone, Debug)]
pub struct ExtensionOffer {
    pub schemas: Vec<BlockSchema>,
    /// 客户端支持的扩展 API 版本；旧客户端不发这个字段，按 `[1]` 处理。
    pub api_versions: Vec<u32>,
}

/// 会话的第一条消息：要运行的作品，以及可选的扩展积木协商。
pub struct Handshake {
    pub project: Json,
    pub extensions: Option<ExtensionOffer>,
}

impl Handshake {
    /// 不带扩展的握手，例如宿主自己持有作品快照时。
    pub fn new(project: Json) -> Self {
        Self {
            project,
            extensions: None,
        }
    }

    pub fn with_extensions(mut self, schemas: Vec<BlockSchema>, api_versions: Vec<u32>) -> Self {
        self.extensions = Some(ExtensionOffer {
            schemas,
            api_versions,
        });
        self
    }

    /// 解析线上的握手文本：要么直接是作品 JSON，要么是
    /// `{"nekoc_extension_handshake":1,"project":…,"extensions":[…],"extension_api_versions":[…]}`。
    pub fn parse(text: &str) -> Result<Self> {
        Self::from_json(crate::json::from_str(text)?)
    }

    pub fn from_json(mut value: Json) -> Result<Self> {
        if value["nekoc_extension_handshake"] != 1 {
            return Ok(Self::new(value));
        }
        let schemas = serde_json::from_value(value["extensions"].take())?;
        let api_versions = if value.get("extension_api_versions").is_some() {
            serde_json::from_value(value["extension_api_versions"].take())?
        } else {
            vec![1]
        };
        Ok(Self {
            project: Json::new(value["project"].take()),
            extensions: Some(ExtensionOffer {
                schemas,
                api_versions,
            }),
        })
    }
}

/// 一条消息的回复。帧是二进制，其他（调试快照等）是 JSON 文本。
#[derive(Debug)]
pub enum Reply {
    Text(String),
    Binary(Vec<u8>),
}

/// 会话出错时发给客户端的最后一条文本消息。
pub fn error_message(error: &anyhow::Error) -> String {
    json!({ "error": format!("{error:#}") }).to_string()
}

/// 一个正在运行的作品。每个连接（每个播放器页面）各持有一个，互不共享状态。
pub struct Player {
    engine: Engine,
    ready: Value,
}

impl Player {
    /// 编译握手里的作品并开始运行。
    pub fn load(handshake: Handshake) -> Result<Self> {
        Self::load_with(handshake, |_| Ok(()))
    }

    /// 同 [`Player::load`]，但在作品开始运行之前先调用 `setup`，
    /// 宿主可以在这里接云变量后端之类的能力。
    pub fn load_with(
        handshake: Handshake,
        setup: impl FnOnce(&mut Engine) -> Result<()>,
    ) -> Result<Self> {
        let mut registry = ExtensionRegistry::new();
        let mut extension_api_version = None;
        if let Some(offer) = handshake.extensions {
            ensure!(
                offer.schemas.len() <= MAX_EXTENSIONS,
                "too many remote extensions"
            );
            ensure!(
                offer.api_versions.len() <= MAX_EXTENSION_API_VERSIONS,
                "too many extension API versions"
            );
            let version = crate::extensions::negotiate_version(&offer.api_versions)?;
            ensure!(
                offer
                    .schemas
                    .iter()
                    .all(|schema| schema.api_version <= version),
                "extension schema exceeds negotiated API version"
            );
            extension_api_version = Some(version);
            if version == 2 {
                registry.set_call_policy(CallPolicy {
                    errors: ErrorPolicy::Report,
                    ..Default::default()
                })?;
            }
            // No network opt-in on the wire: project data cannot grant capabilities.
            for schema in offer.schemas {
                registry.register_remote(schema)?;
            }
        }
        check_project_shape(&handshake.project)?;
        let program = Program::compile_with_extensions(&handshake.project, &registry)?;
        Self::start_with(program, extension_api_version, setup)
    }

    /// 从已经编译好的程序开始运行（宿主自己负责检查和编译时用）。
    pub fn start(program: Program, setup: impl FnOnce(&mut Engine) -> Result<()>) -> Result<Self> {
        Self::start_with(program, None, setup)
    }

    fn start_with(
        program: Program,
        extension_api_version: Option<u32>,
        setup: impl FnOnce(&mut Engine) -> Result<()>,
    ) -> Result<Self> {
        let stats = program.stats();
        let mut engine = Engine::new(program);
        // Audio, speech and device output go to the client inside each frame.
        engine.use_browser_audio();
        setup(&mut engine)?;
        engine.start();
        Ok(Self {
            engine,
            ready: json!({
                "ready": true,
                "stats": stats,
                "extension_api_version": extension_api_version,
            }),
        })
    }

    /// 握手成功后发给客户端的第一条消息：`{"ready":true,"stats":…,"extension_api_version":…}`。
    pub fn ready(&self) -> &Value {
        &self.ready
    }

    pub fn ready_message(&self) -> String {
        self.ready.to_string()
    }

    /// 处理握手之后的一条文本消息：调试快照请求或帧请求。
    pub fn handle(&mut self, text: &str) -> Result<Reply> {
        let payload = crate::json::from_str(text)?;
        if payload["debug_snapshot"] == true {
            return Ok(Reply::Text(
                json!({ "snapshot": self.engine.debug_snapshot() }).to_string(),
            ));
        }
        self.frame_json(&payload).map(Reply::Binary)
    }

    /// 按线上的帧请求 JSON 推进一帧，返回编码好的帧。
    pub fn frame_json(&mut self, payload: &Value) -> Result<Vec<u8>> {
        self.frame(&FrameInput::from_json(payload)?)
    }

    /// 应用输入、推进一帧，返回编码好的帧（格式见 [`decode_frame`]）。
    pub fn frame(&mut self, input: &FrameInput) -> Result<Vec<u8>> {
        let frame = self.step(input)?;
        let bytes = crate::engine::encode_frame(&frame)?;
        self.recycle(frame);
        Ok(bytes)
    }

    /// 应用输入、推进一帧，返回未编码的帧。用完交给 [`Player::recycle`]
    /// 可以复用画笔线段缓冲区。
    pub fn step(&mut self, input: &FrameInput) -> Result<Frame> {
        input.apply(&mut self.engine)?;
        // Opt-in: keep running ticks that produced no visible change (max 16 per frame).
        let ticks = if input.coalesce { 16 } else { 1 };
        self.engine
            .advance_with(input.dt, usize::MAX, input.budget, ticks)
    }

    pub fn recycle(&mut self, frame: Frame) {
        self.engine.recycle_lines(frame.lines);
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn engine_mut(&mut self) -> &mut Engine {
        &mut self.engine
    }
}

/// 麦克风音量采样的状态（KN「麦克风音量」积木）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Microphone {
    Ready(f64),
    /// 还在等用户授权。
    Pending,
    /// 被拒绝或设备不可用，按音量 0 处理。
    Unavailable,
}

/// 视频解码后报告的时长和尺寸。
#[derive(Clone, Debug, PartialEq)]
pub struct VideoInfo {
    pub id: String,
    pub duration: f64,
    pub size: Option<(f64, f64)>,
}

/// 一帧内按顺序送达的离散输入事件。
#[derive(Clone, Debug)]
pub enum InputEvent {
    /// `key` 是 keyCode 字符串，例如空格 `"32"`、A `"65"`。
    Key {
        key: String,
        down: bool,
    },
    AudioDone {
        id: u64,
    },
    ExtensionResult {
        id: u64,
        result: Result<Value, String>,
    },
    ExtensionEvent {
        opcode: String,
        value: Value,
    },
    Drag {
        target: String,
        x: f64,
        y: f64,
    },
    Swipe {
        direction: String,
    },
    Answer {
        id: u64,
        text: String,
        choice: Option<usize>,
    },
    StageDialogClick {
        id: u64,
    },
    RankingClose,
    Pointer {
        target: String,
        state: String,
        x: f64,
        y: f64,
    },
    Device(DeviceInput),
}

/// 一帧的全部输入。字段与线上帧请求 JSON 一一对应，见 `docs/player-sdk.md`。
#[derive(Clone, Debug)]
pub struct FrameInput {
    /// 距上一帧的秒数，引擎内部夹在 0..=0.25。
    pub dt: f64,
    /// 本帧的执行时间预算，1..=16 ms。
    pub budget: Duration,
    /// 没有可见变化时在同一帧里多跑几拍（最多 16 拍），不是官方行为，默认关闭。
    pub coalesce: bool,
    pub microphone: Option<Microphone>,
    /// 当前按住的全部键；`None` 表示不更新。
    pub pressed: Option<Vec<String>>,
    /// 本帧按下过的键（旧接口，只触发「按下」）。
    pub keys: Vec<String>,
    /// 造型尺寸、中心点和遮罩，一般只在解码后发一次。
    pub costumes: Vec<(String, Costume)>,
    pub videos: Vec<VideoInfo>,
    /// 本地时区相对 UTC 的分钟数。
    pub utc_offset: Option<f64>,
    /// 舞台坐标（y 向上）。
    pub mouse: Option<(f64, f64)>,
    pub events: Vec<InputEvent>,
}

impl Default for FrameInput {
    fn default() -> Self {
        Self {
            dt: DEFAULT_DT,
            budget: budget_from_ms(DEFAULT_BUDGET_MS),
            coalesce: false,
            microphone: None,
            pressed: None,
            keys: Vec::new(),
            costumes: Vec::new(),
            videos: Vec::new(),
            utc_offset: None,
            mouse: None,
            events: Vec::new(),
        }
    }
}

fn budget_from_ms(millis: f64) -> Duration {
    Duration::from_secs_f64(millis.clamp(1.0, 16.0) / 1000.0)
}

impl FrameInput {
    /// 解析线上的帧请求。和旧后端一样宽松：类型不对的单个字段或事件直接忽略，
    /// 只有麦克风状态非法、扩展结果/事件缺字段时报错。整个请求先解析完再应用，
    /// 出错时这一帧的输入一个都不生效。
    pub fn from_json(payload: &Value) -> Result<Self> {
        let microphone = match payload.get("kn_microphone") {
            None => None,
            Some(microphone) => Some(match microphone["status"].as_str() {
                Some("ready") => Microphone::Ready(
                    microphone["value"]
                        .as_f64()
                        .context("ready KN microphone sample requires a number")?,
                ),
                Some("pending") => Microphone::Pending,
                Some("denied" | "unavailable") => Microphone::Unavailable,
                _ => bail!("invalid KN microphone status"),
            }),
        };
        let strings = |value: &Value, limit| -> Vec<String> {
            value
                .as_array()
                .into_iter()
                .flatten()
                .take(limit)
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        };
        let mouse = match (
            payload["mouse"]["x"].as_f64(),
            payload["mouse"]["y"].as_f64(),
        ) {
            (Some(x), Some(y)) => Some((x, y)),
            _ => None,
        };
        let mut events = Vec::new();
        for event in payload["events"].as_array().into_iter().flatten().take(256) {
            if let Some(event) = parse_event(event)? {
                events.push(event);
            }
        }
        Ok(Self {
            dt: payload["dt"].as_f64().unwrap_or(DEFAULT_DT),
            budget: budget_from_ms(
                payload["budget_ms"]
                    .as_f64()
                    .filter(|value| value.is_finite())
                    .unwrap_or(DEFAULT_BUDGET_MS),
            ),
            coalesce: payload["coalesce"].as_bool() == Some(true),
            microphone,
            pressed: payload["pressed"]
                .is_array()
                .then(|| strings(&payload["pressed"], 256)),
            keys: strings(&payload["keys"], 64),
            costumes: payload["costumes"]
                .as_array()
                .into_iter()
                .flatten()
                .take(4096)
                .filter_map(parse_costume)
                .collect(),
            videos: payload["videos"]
                .as_array()
                .into_iter()
                .flatten()
                .take(4096)
                .filter_map(|video| {
                    Some(VideoInfo {
                        id: video["id"].as_str()?.to_owned(),
                        duration: video["duration"].as_f64()?,
                        size: video["width"].as_f64().zip(video["height"].as_f64()),
                    })
                })
                .collect(),
            utc_offset: payload["utc_offset"].as_f64(),
            mouse,
            events,
        })
    }

    /// 按固定顺序把输入交给引擎：麦克风、按住的键、按键、造型、视频、时区、鼠标、事件。
    fn apply(&self, vm: &mut Engine) -> Result<()> {
        match self.microphone {
            Some(Microphone::Ready(value)) => vm.set_kn_voice_volume(Some(value))?,
            Some(Microphone::Pending) => vm.set_kn_voice_pending(),
            Some(Microphone::Unavailable) => vm.set_kn_voice_volume(Some(0.0))?,
            None => {}
        }
        if let Some(pressed) = &self.pressed {
            vm.set_pressed_keys(pressed.iter().cloned());
        }
        for key in &self.keys {
            vm.key(key);
        }
        for (id, costume) in &self.costumes {
            vm.set_costume(id, costume.clone());
        }
        for video in &self.videos {
            vm.set_video_duration(&video.id, video.duration);
            if let Some((width, height)) = video.size {
                vm.set_video_metadata(&video.id, video.duration, width, height);
            }
        }
        if let Some(offset) = self.utc_offset {
            vm.set_utc_offset(offset);
        }
        if let Some((x, y)) = self.mouse {
            vm.set_mouse(x, y);
        }
        for event in &self.events {
            match event {
                InputEvent::Key { key, down } => vm.key_event(key, *down),
                InputEvent::AudioDone { id } => vm.audio_finished(*id),
                InputEvent::ExtensionResult { id, result } => {
                    vm.complete_extension(*id, result.clone())?;
                }
                InputEvent::ExtensionEvent { opcode, value } => {
                    vm.emit_extension_event(opcode, value.clone())?;
                }
                InputEvent::Drag { target, x, y } => vm.drag(target, *x, *y),
                InputEvent::Swipe { direction } => vm.swipe(direction),
                InputEvent::Answer { id, text, choice } => vm.answer(*id, text, *choice),
                InputEvent::StageDialogClick { id } => vm.stage_dialog_click(*id),
                InputEvent::RankingClose => vm.close_cloud_ranking(),
                InputEvent::Pointer {
                    target,
                    state,
                    x,
                    y,
                } => vm.pointer_event(target, state, *x, *y),
                InputEvent::Device(input) => vm.inject_k4_device(input.clone()),
            }
        }
        Ok(())
    }
}

fn parse_event(event: &Value) -> Result<Option<InputEvent>> {
    let text = |key: &str| event[key].as_str().map(str::to_owned);
    let number = |key: &str| event[key].as_f64();
    Ok(match event["kind"].as_str() {
        Some("key") => (|| {
            Some(InputEvent::Key {
                key: text("key")?,
                down: event["down"].as_bool()?,
            })
        })(),
        Some("audio_done") => event["id"].as_u64().map(|id| InputEvent::AudioDone { id }),
        Some("extension_result") => match event["id"].as_u64() {
            Some(id) => Some(InputEvent::ExtensionResult {
                id,
                result: if let Some(error) = event["error"].as_str() {
                    Err(error.to_owned())
                } else {
                    Ok(event
                        .get("value")
                        .context("extension result missing value")?
                        .clone())
                },
            }),
            None => None,
        },
        Some("extension_event") => Some(InputEvent::ExtensionEvent {
            opcode: text("opcode").context("extension event missing opcode")?,
            value: event
                .get("value")
                .context("extension event missing value")?
                .clone(),
        }),
        Some("drag") => (|| {
            Some(InputEvent::Drag {
                target: text("target")?,
                x: number("x")?,
                y: number("y")?,
            })
        })(),
        Some("swipe") => text("direction").map(|direction| InputEvent::Swipe { direction }),
        Some("answer") => event["id"].as_u64().map(|id| InputEvent::Answer {
            id,
            text: text("text").unwrap_or_default(),
            choice: event["choice"].as_u64().map(|c| c as usize),
        }),
        Some("stage_dialog_click") => event["id"]
            .as_u64()
            .map(|id| InputEvent::StageDialogClick { id }),
        Some("ranking_close") => Some(InputEvent::RankingClose),
        Some("pointer") => (|| {
            Some(InputEvent::Pointer {
                target: text("target").unwrap_or_default(),
                state: text("state")?,
                x: number("x")?,
                y: number("y")?,
            })
        })(),
        Some("device_motion") => (|| {
            Some(InputEvent::Device(DeviceInput::Motion {
                x: number("x")?,
                y: number("y")?,
                z: number("z")?,
            }))
        })(),
        Some("device_orientation") => (|| {
            Some(InputEvent::Device(DeviceInput::Orientation {
                beta: number("beta")?,
                gamma: number("gamma")?,
                portrait: event["portrait"].as_bool()?,
            }))
        })(),
        Some("device_event") => (|| {
            Some(InputEvent::Device(DeviceInput::Event {
                action: text("action")?,
                device: text("device")?,
                value: text("value")?,
            }))
        })(),
        Some("mobile_button") => (|| {
            Some(InputEvent::Device(DeviceInput::Button {
                device: text("device")?,
                event: text("event")?,
                button: text("button")?,
            }))
        })(),
        _ => None,
    })
}

// Costume sizes and opacity masks, measured once by the viewer after decoding.
fn parse_costume(costume: &Value) -> Option<(String, Costume)> {
    let (id, width, height) = (
        costume["id"].as_str()?,
        costume["width"].as_f64()?,
        costume["height"].as_f64()?,
    );
    let mask = (|| {
        let (w, h) = (
            costume["mask_width"].as_u64()?,
            costume["mask_height"].as_u64()?,
        );
        let bits = base64_decode(costume["mask"].as_str()?)?;
        (w * h <= 512 * 512 && bits.len() as u64 >= (w * h).div_ceil(8))
            .then_some((w as usize, h as usize, bits))
    })();
    // RGB per mask cell, only sent when the project senses colours.
    let rgb = mask.as_ref().and_then(|(w, h, _)| {
        let rgb = base64_decode(costume["rgb"].as_str()?)?;
        (rgb.len() == w * h * 3).then_some(rgb)
    });
    Some((
        id.to_owned(),
        Costume {
            width,
            height,
            center_point: Costume::center_point_from_json(&costume["centerPoint"]),
            mask,
            rgb,
        },
    ))
}

/// Standard base64 (no line breaks); None on any invalid character.
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut n = 0;
        for (i, &c) in chunk.iter().enumerate() {
            n |= value(c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// 拆开 [`Player::frame`] 返回的二进制帧：`u32` LE 元数据长度（按 4 字节对齐），
/// JSON 元数据，然后是 `f32` LE 的画笔线段数据。
pub fn decode_frame(bytes: &[u8]) -> Result<(Value, Vec<f32>)> {
    let header: [u8; 4] = bytes
        .get(..4)
        .context("frame shorter than its header")?
        .try_into()?;
    let length = u32::from_le_bytes(header) as usize;
    let body = &bytes[4..];
    ensure!(
        length <= body.len() && length.is_multiple_of(4) && (body.len() - length).is_multiple_of(4),
        "malformed frame lengths"
    );
    let metadata = serde_json::from_slice(&body[..length])?;
    let lines = body[length..]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&chunk| f32::from_le_bytes(chunk))
        .collect();
    Ok((metadata, lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_budget_is_bounded_and_editor_default_is_preserved() {
        for (payload, millis) in [
            (json!({}), 4),
            (json!({"budget_ms":"bad"}), 4),
            (json!({"budget_ms":0}), 1),
            (json!({"budget_ms":-100}), 1),
            (json!({"budget_ms":8}), 8),
            (json!({"budget_ms":1e100}), 16),
        ] {
            let input = FrameInput::from_json(&payload).unwrap();
            assert_eq!(input.budget, Duration::from_millis(millis));
        }
        assert_eq!(FrameInput::default().budget, Duration::from_millis(4));
    }

    #[test]
    fn base64_decodes_padded_and_rejects_invalid_text() {
        assert_eq!(base64_decode("AQ==").unwrap(), [1]);
        assert_eq!(base64_decode("TWFu").unwrap(), b"Man");
        assert_eq!(base64_decode("TWE=").unwrap(), b"Ma");
        assert!(base64_decode("A*").is_none());
    }
}
