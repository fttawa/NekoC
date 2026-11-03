use anyhow::{Context, Result, bail, ensure};
use clap::Parser;
use nekoc::engine::{Engine, Program};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use tungstenite::{
    Message, WebSocket,
    handshake::derive_accept_key,
    protocol::{Role, WebSocketConfig},
};

const EXTENSION_ORIGIN: &str = "chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj";
const MAX_PROJECT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Parser)]
#[command(about = "NekoC Web Studio — Rust bytecode VM + incremental WebGL2 renderer")]
struct Args {
    input: Option<PathBuf>,
    #[arg(long, default_value_t = 4173)]
    port: u16,
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
fn body(request: &mut Request) -> Result<Value> {
    use std::io::Read;
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take(MAX_PROJECT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= MAX_PROJECT_BYTES, "project exceeds 64 MiB");
    Ok(serde_json::from_slice(&bytes)?)
}
const KITTEN4_METADATA: &str = "_nekocKitten4";

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
    ensure!(depth < 128, "block nesting exceeds 128 levels");
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
                check_block_shape(child, depth + 1)?;
            }
        }
    }
    if let Some(next) = block.get("next").filter(|v| !v.is_null()) {
        check_block_shape(next, depth + 1)?;
    }
    Ok(())
}

fn import_project(value: Value) -> Result<(Value, Value)> {
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
    report["project"] = value.clone();
    Ok((value, report))
}

fn edited_project(value: Value, previous: &Value) -> Result<Value> {
    check_project_shape(&value)?;
    // Source metadata is an opaque adapter-owned snapshot, not editable JSON.
    // Changing formats is an explicit import, never an accidental source edit.
    ensure!(
        value.get(KITTEN4_METADATA) == previous.get(KITTEN4_METADATA),
        "请保留 Kitten4 保真元数据 {KITTEN4_METADATA} 原样；切换项目格式请使用导入"
    );
    Ok(value)
}

fn export_project(value: &Value) -> Result<Value> {
    if is_kitten4_project(value) {
        nekoc::kitten4::from_neko(value)
    } else {
        Ok(value.clone())
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
    let frame = vm.advance(
        payload["dt"].as_f64().unwrap_or(1.0 / 60.0),
        500_000,
        frame_budget(payload),
    )?;
    let bytes = nekoc::engine::encode_frame(&frame)?;
    vm.recycle_lines(frame.lines);
    Ok(bytes)
}
fn player_socket(request: Request, project: Option<Value>) -> Result<()> {
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
                let project: Value = serde_json::from_str(message.to_text()?)?;
                check_project_shape(&project)?;
                project
            };
            socket.set_config(|config| {
                config.max_message_size = Some(64 * 1024);
                config.max_frame_size = Some(64 * 1024);
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
                        let payload: Value = serde_json::from_str(&text)?;
                        socket.send(Message::Binary(frame_bytes(&mut vm, &payload)?))?;
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
fn main() -> Result<()> {
    let args = Args::parse();
    let initial = if let Some(path) = args.input {
        nekoc::project::load_project(path)?.value
    } else {
        serde_json::from_str(include_str!("../../samples/native-studio.bcmkn"))?
    };
    let (mut project, _) = import_project(initial)?;
    let server =
        Server::from_listener(listener(args.port)?, None).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!(
        "NekoC Web Studio: http://127.0.0.1:{}\nRust VM / binary frame transport / WebGL2 persistent pen surface",
        args.port
    );
    let mut engine: Option<Engine> = None;
    for mut request in server.incoming_requests() {
        let url = request.url().to_owned();
        // Same-origin local API. Do not expose filesystem operations to the page.
        let host = format!("127.0.0.1:{}", args.port);
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
            let asset = match url.as_str() {
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
            if url == "/api/project" {
                send(
                    request,
                    200,
                    "application/json",
                    serde_json::to_vec(&project)?,
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
            let json = match url.as_str() {
                "/api/project" => {
                    let value = edited_project(payload, &project)?;
                    engine = None;
                    project = value;
                    json!({"ok":true})
                }
                "/api/import" => {
                    let (value, report) = import_project(payload)?;
                    engine = None;
                    project = value;
                    report
                }
                "/api/import-player" => import_project(payload)?.1,
                "/api/export" => {
                    // Export the submitted editor snapshot without stopping a live VM
                    // or changing the server project. Edits are validated atomically.
                    let value = edited_project(payload, &project)?;
                    export_project(&value)?
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
            };
            Ok(("application/json".into(), serde_json::to_vec(&json)?))
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
}
