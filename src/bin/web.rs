use anyhow::{Context, Result, bail, ensure};
use clap::Parser;
use nekoc::engine::{Engine, Program};
use nekoc::json::Json;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use tungstenite::{
    Message, WebSocket,
    handshake::derive_accept_key,
    protocol::{Role, WebSocketConfig},
};

struct CachedImport {
    input_hash: [u8; 32],
    canonical_hash: [u8; 32],
    project: Json,
    response: Vec<u8>,
}

#[derive(serde::Serialize)]
struct ImportResponse<'a> {
    #[serde(flatten)]
    report: &'a Value,
    project: &'a Value,
}

// Content addressed, bounded to one work. Editor edits and independent private
// players never share mutable runtime state; cache hits only reuse import data.
#[derive(Default)]
struct ImportCache(Option<CachedImport>);

fn project_hash(value: &Value) -> [u8; 32] {
    let mut hash = Sha256::new();
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(object) => {
                hash.update(b"object");
                hash.update((object.len() as u64).to_le_bytes());
                for key in object.keys() {
                    hash.update((key.len() as u64).to_le_bytes());
                    hash.update(key.as_bytes());
                }
                pending.extend(object.values().rev());
            }
            Value::Array(items) => {
                hash.update(b"array");
                hash.update((items.len() as u64).to_le_bytes());
                pending.extend(items.iter().rev());
            }
            Value::Number(number) => {
                // Browser JSON round trips normalize 100.0 to 100 and -0 to 0.
                // Never merge distinct integers outside JS's exact range.
                let text = match number.as_f64() {
                    Some(n)
                        if number.is_f64()
                            && n.abs() <= 9_007_199_254_740_991.0
                            && n.fract() == 0.0 =>
                    {
                        (n as i64).to_string()
                    }
                    _ => number.to_string(),
                };
                hash.update(b"number");
                hash.update((text.len() as u64).to_le_bytes());
                hash.update(text.as_bytes());
            }
            Value::String(text) => {
                hash.update(b"string");
                hash.update((text.len() as u64).to_le_bytes());
                hash.update(text.as_bytes());
            }
            Value::Bool(value) => hash.update(if *value {
                b"true".as_slice()
            } else {
                b"false".as_slice()
            }),
            Value::Null => hash.update(b"null"),
        }
    }
    hash.finalize().into()
}

impl ImportCache {
    fn import(&mut self, value: impl Into<Json>) -> Result<&CachedImport> {
        let value = value.into();
        let hash = project_hash(&value);
        if !self
            .0
            .as_ref()
            .is_some_and(|c| c.input_hash == hash || c.canonical_hash == hash)
        {
            let (project, report) = import_project(value)?;
            let canonical_hash = project_hash(&project);
            let response = nekoc::json::to_vec(&ImportResponse {
                report: &report,
                project: &project,
            })?;
            self.0 = Some(CachedImport {
                input_hash: hash,
                canonical_hash,
                project,
                response,
            });
        }
        Ok(self.0.as_ref().unwrap())
    }
}

const EXTENSION_ORIGIN: &str = "chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj";
const MAX_PROJECT_BYTES: usize = 64 * 1024 * 1024;
const MAX_FRAME_REQUEST_BYTES: usize = 32 * 1024 * 1024;

#[derive(Parser)]
#[command(about = "NekoC Web Studio — Rust bytecode VM + incremental WebGL2 renderer")]
struct Args {
    input: Option<PathBuf>,
    #[arg(long, default_value_t = 4173)]
    port: u16,
    /// Package `input` as a standalone executable at this path instead of serving it.
    #[cfg(feature = "desktop")]
    #[arg(long)]
    export_exe: Option<PathBuf>,
}
fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).unwrap()
}
fn send(request: Request, status: u16, mime: &str, body: Vec<u8>) {
    let extension = request
        .headers()
        .iter()
        .any(|h| h.field.equiv("Origin") && h.value.as_str() == EXTENSION_ORIGIN);
    let mut response = Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", mime))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    if extension {
        response.add_header(header("Access-Control-Allow-Origin", EXTENSION_ORIGIN));
        response.add_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"));
        response.add_header(header("Access-Control-Allow-Headers", "Content-Type"));
        response.add_header(header("Access-Control-Allow-Private-Network", "true"));
    }
    let _ = request.respond(response);
}
fn body(request: &mut Request) -> Result<Json> {
    use std::io::Read;
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take(MAX_PROJECT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= MAX_PROJECT_BYTES, "project exceeds 64 MiB");
    nekoc::json::from_slice(&bytes)
}
const KITTEN4_METADATA: &str = "_nekocKitten4";

mod base64_mask {
    /// Standard base64 (no line breaks); None on any invalid character.
    pub fn decode(text: &str) -> Option<Vec<u8>> {
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
}

fn is_kitten4_project(project: &Value) -> bool {
    project.get(KITTEN4_METADATA).is_some()
}

// Check the editor's structural requirements before diagnostics or runtime code
// traverses the document. Unsupported opcodes remain importable and exportable.
fn check_project_shape(project: &Value) -> Result<()> {
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
            depth <= 64,
            "block nesting exceeds 64 at block {} ({})",
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

fn import_project(value: Json) -> Result<(Json, Json)> {
    let value = if nekoc::kitten4::is_kitten4(&value) {
        nekoc::kitten4::to_neko(&value)?
    } else {
        value
    };
    check_project_shape(&value)?;
    let (value, mut report) = nekoc::bcmkn::import(value)?;
    if is_kitten4_project(&value) {
        // Reject forged/incomplete provenance before it becomes the active project.
        nekoc::kitten4::from_neko(&value)?;
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

fn edited_project(value: Json, previous: &Value) -> Result<Json> {
    check_project_shape(&value)?;
    // Source metadata is an opaque adapter-owned snapshot, not editable JSON.
    // Changing formats is an explicit import, never an accidental source edit.
    ensure!(
        match (value.get(KITTEN4_METADATA), previous.get(KITTEN4_METADATA)) {
            (Some(a), Some(b)) => nekoc::json::equal(a, b),
            (None, None) => true,
            _ => false,
        },
        "请保留 Kitten4 保真元数据 {KITTEN4_METADATA} 原样；切换项目格式请使用导入"
    );
    Ok(value)
}

fn export_project(value: &Value) -> Result<Json> {
    if is_kitten4_project(value) {
        nekoc::kitten4::from_neko(value)
    } else {
        let mut exported = Json::new(nekoc::json::clone_value(value));
        nekoc::key_buttons::annotate(&mut exported, None);
        Ok(exported)
    }
}
fn frame_budget(payload: &Value) -> Duration {
    // Playback settings are per request/connection; existing editor requests use 4ms.
    Duration::from_secs_f64(
        payload["budget_ms"]
            .as_f64()
            .filter(|value| value.is_finite())
            .unwrap_or(4.0)
            .clamp(1.0, 16.0)
            / 1000.0,
    )
}

fn frame_bytes(vm: &mut Engine, payload: &Value) -> Result<Vec<u8>> {
    if let Some(pressed) = payload["pressed"].as_array() {
        vm.set_pressed_keys(
            pressed
                .iter()
                .take(256)
                .filter_map(Value::as_str)
                .map(str::to_owned),
        );
    }
    if let Some(keys) = payload["keys"].as_array() {
        for key in keys.iter().take(64).filter_map(Value::as_str) {
            vm.key(key);
        }
    }
    // Costume sizes and opacity masks, measured once by the viewer after decoding.
    if let Some(costumes) = payload["costumes"].as_array() {
        for costume in costumes.iter().take(4096) {
            let (Some(id), Some(width), Some(height)) = (
                costume["id"].as_str(),
                costume["width"].as_f64(),
                costume["height"].as_f64(),
            ) else {
                continue;
            };
            let mask = (|| {
                use base64_mask::decode;
                let (w, h) = (
                    costume["mask_width"].as_u64()?,
                    costume["mask_height"].as_u64()?,
                );
                let bits = decode(costume["mask"].as_str()?)?;
                (w * h <= 512 * 512 && bits.len() as u64 >= (w * h).div_ceil(8))
                    .then_some((w as usize, h as usize, bits))
            })();
            // RGB per mask cell, only sent when the project senses colours.
            let rgb = mask.as_ref().and_then(|(w, h, _)| {
                let rgb = base64_mask::decode(costume["rgb"].as_str()?)?;
                (rgb.len() == w * h * 3).then_some(rgb)
            });
            vm.set_costume(
                id,
                nekoc::engine::Costume {
                    width,
                    height,
                    center_point: nekoc::engine::Costume::center_point_from_json(
                        &costume["centerPoint"],
                    ),
                    mask,
                    rgb,
                },
            );
        }
    }
    if let Some(offset) = payload["utc_offset"].as_f64() {
        vm.set_utc_offset(offset);
    }
    if let (Some(x), Some(y)) = (
        payload["mouse"]["x"].as_f64(),
        payload["mouse"]["y"].as_f64(),
    ) {
        vm.set_mouse(x, y);
    }
    if let Some(events) = payload["events"].as_array() {
        for event in events.iter().take(256) {
            match event["kind"].as_str() {
                Some("key") => {
                    if let (Some(key), Some(down)) =
                        (event["key"].as_str(), event["down"].as_bool())
                    {
                        vm.key_event(key, down);
                    }
                }
                Some("audio_done") => {
                    if let Some(id) = event["id"].as_u64() {
                        vm.audio_finished(id);
                    }
                }
                Some("drag") => {
                    if let (Some(target), Some(x), Some(y)) = (
                        event["target"].as_str(),
                        event["x"].as_f64(),
                        event["y"].as_f64(),
                    ) {
                        vm.drag(target, x, y);
                    }
                }
                Some("swipe") => {
                    if let Some(direction) = event["direction"].as_str() {
                        vm.swipe(direction);
                    }
                }
                Some("answer") => {
                    if let Some(id) = event["id"].as_u64() {
                        vm.answer(
                            id,
                            event["text"].as_str().unwrap_or(""),
                            event["choice"].as_u64().map(|c| c as usize),
                        );
                    }
                }
                Some("pointer") => {
                    if let (Some(state), Some(x), Some(y)) = (
                        event["state"].as_str(),
                        event["x"].as_f64(),
                        event["y"].as_f64(),
                    ) {
                        vm.pointer_event(event["target"].as_str().unwrap_or(""), state, x, y);
                    }
                }
                _ => {}
            }
        }
    }
    // Opt-in: keep running ticks that produced no visible change (max 16 per frame).
    let ticks = if payload["coalesce"].as_bool() == Some(true) {
        16
    } else {
        1
    };
    let frame = vm.advance_with(
        payload["dt"].as_f64().unwrap_or(1.0 / 60.0),
        usize::MAX,
        frame_budget(payload),
        ticks,
    )?;
    let bytes = nekoc::engine::encode_frame(&frame)?;
    vm.recycle_lines(frame.lines);
    Ok(bytes)
}
fn player_socket(request: Request, project: Option<Json>) -> Result<()> {
    let key = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Sec-WebSocket-Key"))
        .context("missing WebSocket key")?
        .value
        .as_str();
    let response = Response::empty(101).with_header(header(
        "Sec-WebSocket-Accept",
        &derive_accept_key(key.as_bytes()),
    ));
    let stream = request.upgrade("websocket", response);
    // Each socket owns its VM. A closed/imported project cannot feed an old frame into a new session.
    std::thread::spawn(move || {
        let config = WebSocketConfig {
            max_message_size: Some(MAX_PROJECT_BYTES),
            max_frame_size: Some(MAX_PROJECT_BYTES),
            ..Default::default()
        };
        let mut socket = WebSocket::from_raw_socket(stream, Role::Server, Some(config));
        let result = (|| -> Result<()> {
            // Private players supply their own snapshot on this connection; no global import race.
            let project = if let Some(project) = project {
                project
            } else {
                let message = socket.read()?;
                ensure!(message.is_text(), "expected project JSON handshake");
                let project = nekoc::json::from_str(message.to_text()?)?;
                check_project_shape(&project)?;
                project
            };
            // Frame requests are small, except the one-time costume info (opacity
            // masks, plus per-cell RGB for colour sensing) which can reach megabytes.
            socket.set_config(|config| {
                config.max_message_size = Some(MAX_FRAME_REQUEST_BYTES);
                config.max_frame_size = Some(MAX_FRAME_REQUEST_BYTES);
            });
            let program = Program::compile(&project)?;
            let stats = program.stats();
            let mut vm = Engine::new(program);
            vm.start();
            socket.send(Message::Text(
                json!({"ready":true,"stats":stats}).to_string(),
            ))?;
            loop {
                match socket.read()? {
                    Message::Text(text) => {
                        let payload = nekoc::json::from_str(&text)?;
                        if payload["debug_snapshot"] == true {
                            socket.send(Message::Text(
                                json!({"snapshot":vm.debug_snapshot()}).to_string(),
                            ))?;
                        } else {
                            socket.send(Message::Binary(frame_bytes(&mut vm, &payload)?))?;
                        }
                    }
                    Message::Close(_) => {
                        let _ = socket.flush();
                        return Ok(());
                    }
                    Message::Ping(_) => socket.flush()?,
                    _ => {}
                }
            }
        })();
        if let Err(error) = result {
            let _ = socket.send(Message::Text(
                json!({"error":format!("{error:#}")}).to_string(),
            ));
            let _ = socket.close(None);
        }
    });
    Ok(())
}
/// Frames are request/response: Nagle would hold each response's trailing partial
/// segment until the browser's delayed ACK (40-200ms) for multi-segment pen frames.
/// Accepted sockets inherit TCP_NODELAY from the listener (Linux, Windows).
fn listener(port: u16) -> Result<std::net::TcpListener> {
    use socket2::{Domain, Protocol, Socket, Type};
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    #[cfg(unix)]
    socket.set_reuse_address(true)?;
    socket.set_tcp_nodelay(true)?;
    socket
        .bind(&address.into())
        .with_context(|| format!("cannot listen on {address}"))?;
    socket.listen(128)?;
    Ok(socket.into())
}
#[cfg(feature = "desktop")]
mod desktop {
    //! A standalone executable is this binary with a project appended:
    //! `<exe><project json><length: u64 LE><MAGIC>`.
    use super::*;
    use std::io::{Read, Seek, SeekFrom, Write};
    use tao::{
        dpi::LogicalSize,
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        window::WindowBuilder,
    };
    use wry::{WebContext, WebViewBuilder};

    const MAGIC: &[u8; 8] = b"NEKOCAPP";

    fn stub_end(file: &mut std::fs::File) -> Result<Option<(u64, u64)>> {
        let size = file.metadata()?.len();
        if size < 16 {
            return Ok(None);
        }
        file.seek(SeekFrom::Start(size - 16))?;
        let mut trailer = [0; 16];
        file.read_exact(&mut trailer)?;
        if &trailer[8..] != MAGIC {
            return Ok(None);
        }
        let length = u64::from_le_bytes(trailer[..8].try_into()?);
        let start = (size - 16)
            .checked_sub(length)
            .context("corrupt embedded project")?;
        Ok(Some((start, length)))
    }

    pub fn embedded_project() -> Result<Option<Json>> {
        let mut file = std::fs::File::open(std::env::current_exe()?)?;
        let Some((start, length)) = stub_end(&mut file)? else {
            return Ok(None);
        };
        file.seek(SeekFrom::Start(start))?;
        ensure!(
            length <= MAX_PROJECT_BYTES as u64,
            "embedded project exceeds 64 MiB"
        );
        let mut bytes = vec![0; length as usize];
        file.read_exact(&mut bytes)?;
        Ok(Some(nekoc::json::from_slice(&bytes)?))
    }

    /// Marks a PE image as a GUI program so double-clicking opens no console.
    fn set_gui_subsystem(image: &mut [u8]) {
        if image.len() < 0x40 || &image[..2] != b"MZ" {
            return;
        }
        let pe = u32::from_le_bytes(image[0x3c..0x40].try_into().unwrap()) as usize;
        if image.get(pe..pe + 4) == Some(b"PE\0\0".as_slice()) && image.len() > pe + 0x5d {
            image[pe + 0x5c] = 2;
        }
    }

    pub fn export(input: &Value, output: &std::path::Path) -> Result<()> {
        let payload = nekoc::json::to_vec(input)?;
        ensure!(
            payload.len() <= MAX_PROJECT_BYTES,
            "project exceeds {MAX_PROJECT_BYTES} bytes"
        );
        let source = std::env::current_exe()?;
        let mut file = std::fs::File::open(&source)?;
        let stub_size = match stub_end(&mut file)? {
            Some((start, _)) => start,
            None => file.metadata()?.len(),
        };
        let mut image = vec![0; stub_size as usize];
        file.seek(SeekFrom::Start(0))?;
        file.read_exact(&mut image)?;
        set_gui_subsystem(&mut image);
        let mut out = std::fs::File::create(output)
            .with_context(|| format!("cannot write {}", output.display()))?;
        out.write_all(&image)?;
        out.write_all(&payload)?;
        out.write_all(&(payload.len() as u64).to_le_bytes())?;
        out.write_all(MAGIC)?;
        Ok(())
    }

    /// Same project, same port when free, so performance settings persist per work.
    fn app_port(project: &Value) -> Result<u16> {
        let name = project
            .get("projectName")
            .and_then(Value::as_str)
            .unwrap_or("");
        let hash = name
            .bytes()
            .fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
        let preferred = 49152 + (hash % 10000) as u16;
        if listener(preferred).is_ok() {
            return Ok(preferred);
        }
        Ok(listener(0)?.local_addr()?.port())
    }

    pub fn run(project: Json) -> Result<()> {
        let title = project
            .get("projectName")
            .and_then(Value::as_str)
            .unwrap_or("NekoC")
            .to_owned();
        let port = app_port(&project)?;
        std::thread::spawn(move || {
            let _ = serve(project, port);
        });
        let event_loop = EventLoop::new();
        let window = WindowBuilder::new()
            .with_title(title)
            .with_inner_size(LogicalSize::new(1200.0, 750.0))
            .build(&event_loop)?;
        let data = std::env::temp_dir().join("NekoC-app");
        let mut context = WebContext::new(Some(data));
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_url(format!("http://127.0.0.1:{port}/play?app=1"))
            .with_autoplay(true)
            .with_devtools(false)
            .build(&window)
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        event_loop.run(move |event, _, flow| {
            *flow = ControlFlow::Wait;
            let _ = &webview;
            if let Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } = event
            {
                std::process::exit(0);
            }
        })
    }
}
fn main() -> Result<()> {
    #[cfg(feature = "desktop")]
    if let Some(project) = desktop::embedded_project()? {
        return desktop::run(project);
    }
    let args = Args::parse();
    let initial = if let Some(path) = args.input {
        nekoc::project::load_project(path)?.value
    } else {
        nekoc::json::from_str(include_str!("../../samples/native-studio.bcmkn"))?
    };
    #[cfg(feature = "desktop")]
    if let Some(output) = &args.export_exe {
        desktop::export(&initial, output)?;
        println!("{}", output.display());
        return Ok(());
    }
    serve(initial, args.port)
}
fn serve(initial: Json, port: u16) -> Result<()> {
    let mut imports = ImportCache::default();
    let mut project = imports.import(initial)?.project.clone();
    let server =
        Server::from_listener(listener(port)?, None).map_err(|e| anyhow::anyhow!("{e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .context("expected TCP listener")?
        .port();
    println!(
        "NekoC Web Studio: http://127.0.0.1:{port}\nRust VM / binary frame transport / WebGL2 persistent pen surface"
    );
    let mut engine: Option<Engine> = None;
    for mut request in server.incoming_requests() {
        let url = request.url().to_owned();
        // Same-origin local API. Do not expose filesystem operations to the page.
        let host = format!("127.0.0.1:{port}");
        let valid_host = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .is_some_and(|h| h.value.as_str() == host);
        let origin = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Origin"))
            .map(|h| h.value.as_str());
        let extension_endpoint = matches!(
            url.as_str(),
            "/api/health" | "/api/import-player" | "/api/player-private"
        );
        let valid_origin = origin.is_none_or(|origin| {
            origin == format!("http://{host}") || (origin == EXTENSION_ORIGIN && extension_endpoint)
        });
        if !valid_host || !valid_origin {
            send(
                request,
                403,
                "text/plain",
                b"Local same-origin requests only".to_vec(),
            );
            continue;
        }
        if request.method() == &Method::Options && extension_endpoint {
            send(request, 204, "text/plain", vec![]);
            continue;
        }
        if request.method() == &Method::Get {
            if url == "/api/health" {
                send(
                    request,
                    200,
                    "application/json",
                    br#"{"ok":true,"player_protocol":2}"#.to_vec(),
                );
                continue;
            }
            if url == "/api/player" || url == "/api/player-private" {
                if request.headers().iter().any(|h| {
                    h.field.equiv("Upgrade") && h.value.as_str().eq_ignore_ascii_case("websocket")
                }) {
                    let snapshot = (url == "/api/player").then(|| project.clone());
                    if let Err(error) = player_socket(request, snapshot) {
                        eprintln!("player socket: {error:#}");
                    }
                } else {
                    send(
                        request,
                        400,
                        "text/plain",
                        b"WebSocket upgrade required".to_vec(),
                    );
                }
                continue;
            }
            let asset = match url.split('?').next().unwrap_or_default() {
                "/play" | "/play/" => Some((
                    "text/html; charset=utf-8",
                    include_bytes!("../../web/play.html").as_slice(),
                )),
                "/play.css" => Some(("text/css", include_bytes!("../../web/play.css").as_slice())),
                "/play.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/play.js").as_slice(),
                )),
                "/" => Some((
                    "text/html; charset=utf-8",
                    include_bytes!("../../web/index.html").as_slice(),
                )),
                "/style.css" => {
                    Some(("text/css", include_bytes!("../../web/style.css").as_slice()))
                }
                "/app.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/app.js").as_slice(),
                )),
                "/renderer.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/renderer.js").as_slice(),
                )),
                "/player.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/player.js").as_slice(),
                )),
                "/audio.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/audio.js").as_slice(),
                )),
                "/overlay.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/overlay.js").as_slice(),
                )),
                "/input.js" => Some((
                    "text/javascript",
                    include_bytes!("../../web/input.js").as_slice(),
                )),
                _ => None,
            };
            if let Some((mime, bytes)) = asset {
                send(request, 200, mime, bytes.to_vec());
                continue;
            }
            if url == "/api/key-buttons" {
                let buttons = nekoc::key_buttons::manifest(&project, None);
                send(
                    request,
                    200,
                    "application/json",
                    serde_json::to_vec(&nekoc::key_buttons::to_json(&buttons))?,
                );
                continue;
            }
            if url == "/api/project" {
                send(
                    request,
                    200,
                    "application/json",
                    nekoc::json::to_vec(&project)?,
                );
                continue;
            }
            send(request, 404, "text/plain", b"Not found".to_vec());
            continue;
        }
        if request.method() != &Method::Post {
            send(request, 405, "text/plain", b"Method not allowed".to_vec());
            continue;
        }
        let result = (|| -> Result<(String, Vec<u8>)> {
            let payload = body(&mut request)?;
            let json = Json::new(match url.as_str() {
                "/api/project" => {
                    let value = edited_project(payload, &project)?;
                    engine = None;
                    project = value;
                    json!({"ok":true})
                }
                "/api/import" => {
                    let cached = imports.import(payload)?;
                    engine = None;
                    project = cached.project.clone();
                    return Ok(("application/json".into(), cached.response.clone()));
                }
                "/api/import-player" => {
                    let cached = imports.import(payload)?;
                    return Ok(("application/json".into(), cached.response.clone()));
                }
                "/api/export" => {
                    // Export the submitted editor snapshot without stopping a live VM
                    // or changing the server project. Edits are validated atomically.
                    let value = edited_project(payload, &project)?;
                    export_project(&value)?.into_value()
                }
                "/api/export-packed" => {
                    // Self-extracting export: large text lists shrink and are restored
                    // by blocks when the project starts (also in the official player).
                    let value = edited_project(payload, &project)?;
                    ensure!(
                        !is_kitten4_project(&value),
                        "压缩导出目前只支持 Kitten N（.bcmkn）作品"
                    );
                    let (packed, report) = nekoc::pack::pack(&value, &Default::default())?;
                    json!({"project":packed,"report":report})
                }
                "/api/validate" => nekoc::validate::build_report(&project)?,
                "/api/compile" | "/api/start" => {
                    let compiled = Program::compile(&project)?;
                    let stats = compiled.stats();
                    if url == "/api/start" {
                        let mut vm = Engine::new(compiled);
                        vm.start();
                        engine = Some(vm);
                    }
                    json!({"ok":true,"stats":stats})
                }
                "/api/stop" => {
                    engine = None;
                    json!({"ok":true})
                }
                "/api/frame" => {
                    let vm = engine.as_mut().context("runtime is not started")?;
                    let bytes = frame_bytes(vm, &payload)?;
                    return Ok(("application/octet-stream".into(), bytes));
                }
                _ => bail!("unknown endpoint {url}"),
            });
            Ok(("application/json".into(), nekoc::json::to_vec(&json)?))
        })();
        match result {
            Ok((mime, bytes)) => send(request, 200, &mime, bytes),
            Err(error) => send(
                request,
                400,
                "application/json",
                serde_json::to_vec(&json!({"error":format!("{error:#}")}))?,
            ),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_registers_pivot_with_costume_mask() {
        for (pivot, expected) in [
            (json!({"x":10,"y":6}), [10.0, 6.0]),
            (json!({"x":"bad","y":6}), [0.0, 6.0]),
            (Value::Null, [0.0, 0.0]),
        ] {
            let mut project = nekoc::studio::document::Document::blank().value().clone();
            project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
                "type":"on_running_group_activated","next":{
                    "type":"console_log","inputs":{"console_log":{
                        "type":"bump_into","fields":{"sprite":"__self","sprite1":"--mouse"}
                    }}
                }
            }]);
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            vm.start();
            let bytes = frame_bytes(
                &mut vm,
                &json!({"mouse":{"x":-expected[0]-5.0,"y":expected[1]+3.0},"costumes":[{
                    "id":"nekoc-costume","width":20,"height":12,"centerPoint":pivot,
                    "mask_width":2,"mask_height":1,"mask":"AQ=="
                }]}),
            )
            .unwrap();
            let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
            let frame: Value = serde_json::from_slice(&bytes[4..4 + len]).unwrap();
            assert_eq!(frame["logs"], json!(["1"]));
        }
    }

    #[test]
    fn deep_project_import_edit_export_response_and_private_handshake() {
        let mut project =
            nekoc::json::from_str(include_str!("../../samples/native-studio.bcmkn")).unwrap();
        project["stageSize"] = json!({"width":1280,"height":720});
        let scene = project["scenes"]["currentSceneId"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut tail = None;
        for i in (0..=2000).rev() {
            let mut block = json!({"id":format!("deep-{i}"),"type":if i == 0 {"on_running_group_activated"} else {"self_set_position_x"},
                "inputs":{"value":{"id":format!("n-{i}"),"type":"math_number","fields":{"NUM":i}}}});
            if let Some(next) = tail {
                block["next"] = next;
            }
            tail = Some(block);
        }
        project["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"] = json!([]);
        project["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"]
            .as_array_mut()
            .unwrap()
            .push(tail.unwrap());
        let mut cache = ImportCache::default();
        let cached = cache.import(project).unwrap();
        let response = cached.response.clone();
        let project = cached.project.clone();
        assert_eq!(cache.import(project.clone()).unwrap().response, response);
        let report = nekoc::json::from_slice(&response).unwrap();
        assert_eq!(report["project"], project);
        assert_eq!(report["fast_runtime_ready"], true);
        let response = nekoc::json::to_vec(&project).unwrap();
        let handshake = nekoc::json::from_slice(&response).unwrap();
        check_project_shape(&handshake).unwrap();
        Program::compile(&handshake).unwrap();
        let edited = edited_project(handshake, &project).unwrap();
        let exported = export_project(&edited).unwrap();
        assert!(nekoc::json::equal(&exported, &project));
        // Evict the deep cached work on the default test thread stack.
        cache
            .import(nekoc::studio::document::Document::blank().value().clone())
            .unwrap();
    }

    #[test]
    fn content_hash_matches_browser_number_normalization_without_integer_aliases() {
        assert_eq!(
            project_hash(&json!([100.0, -0.0])),
            project_hash(&json!([100, 0]))
        );
        assert_ne!(
            project_hash(&json!(9_007_199_254_740_992_u64)),
            project_hash(&json!(9_007_199_254_740_993_u64))
        );
        assert_ne!(
            project_hash(&json!({"a":"bc"})),
            project_hash(&json!({"ab":"c"}))
        );
    }

    #[test]
    fn import_cache_reuses_native_and_canonical_hashes_and_invalidates_on_edits() {
        let source: Value =
            serde_json::from_str(include_str!("../../samples/kitten4-demo.bcm")).unwrap();
        let mut cache = ImportCache::default();
        let canonical = cache.import(source.clone()).unwrap().project.clone();
        let expected = cache.0.as_ref().unwrap().response.clone();
        let ((), timings) = nekoc::import_perf::measure(|| {
            assert_eq!(cache.import(source).unwrap().response, expected);
            assert_eq!(cache.import(canonical.clone()).unwrap().response, expected);
        });
        assert!(!timings.contains_key("diagnostics_coverage"));
        let mut edited = canonical;
        edited["projectName"] = json!("edited");
        assert_eq!(
            cache.import(edited).unwrap().project["projectName"],
            "edited"
        );
        let previous = cache.0.as_ref().unwrap().response.clone();
        assert!(cache.import(json!({"toolType":"wrong"})).is_err());
        assert_eq!(cache.0.as_ref().unwrap().response, previous);
    }

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
            assert_eq!(frame_budget(&payload), Duration::from_millis(millis));
        }
    }

    #[test]
    fn listener_is_loopback_only_even_with_an_ephemeral_port() {
        let socket = listener(0).unwrap();
        assert_eq!(
            socket.local_addr().unwrap().ip(),
            std::net::Ipv4Addr::LOCALHOST
        );
        assert_ne!(socket.local_addr().unwrap().port(), 0);
    }
}
