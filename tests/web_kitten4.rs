use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct Studio {
    process: Child,
    port: u16,
}

impl Drop for Studio {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

impl Studio {
    fn start(input: &str) -> Self {
        use sha2::{Digest, Sha256};
        let executable = env!("CARGO_BIN_EXE_web");
        let binary_hash = format!("{:x}", Sha256::digest(std::fs::read(executable).unwrap()));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let process = Command::new(executable)
            .args([input, "--port", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut studio = Self { process, port };
        let identity = format!(
            "phase=tcp-listen port={port} pid={} executable={executable} sha256={binary_hash} input={input}",
            studio.process.id()
        );
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            assert!(
                studio.process.try_wait().unwrap().is_none(),
                "Web Studio exited before becoming ready: {identity}"
            );
            if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return studio;
            }
            assert!(
                Instant::now() < deadline,
                "Web Studio did not start: {identity}"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn request(&self, method: &str, path: &str, payload: &Value) -> (u16, Vec<u8>) {
        self.request_origin(method, path, payload, None)
    }

    fn request_origin(
        &self,
        method: &str,
        path: &str,
        payload: &Value,
        origin: Option<&str>,
    ) -> (u16, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .unwrap();
        let body = nekoc::json::to_vec(payload).unwrap();
        let origin = origin.map_or(String::new(), |v| format!("Origin: {v}\r\n"));
        write!(stream, "{method} {path} HTTP/1.0\r\nHost: 127.0.0.1:{}\r\n{origin}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", self.port, body.len()).unwrap();
        stream.write_all(&body).unwrap();
        let mut bytes = vec![];
        stream.read_to_end(&mut bytes).unwrap();
        let split = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
        let head = std::str::from_utf8(&bytes[..split]).unwrap();
        let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, bytes[split + 4..].to_vec())
    }

    fn json(&self, method: &str, path: &str, payload: &Value, expected: u16) -> Value {
        let (status, bytes) = self.request(method, path, payload);
        assert_eq!(
            status,
            expected,
            "{path}: {}",
            String::from_utf8_lossy(&bytes)
        );
        serde_json::from_slice(&bytes).unwrap()
    }

    fn project(&self) -> Value {
        self.json("GET", "/api/project", &Value::Null, 200)
    }
}

#[test]
fn extension_schema_handshake_completes_through_real_private_socket() {
    use tungstenite::{Message, client::IntoClientRequest};
    let studio = Studio::start("samples/native-studio.bcmkn");
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"]["output"] =
        json!({"id":"output","name":"output","value":0,"type":"number"});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{
            "type":"nekoc_extension_call","fields":{"opcode":"example.json.parse","result":"output"},
            "inputs":{"text":{"type":"text","fields":{"TEXT":"[2,true]"}}}
        }
    }]);
    let payload = json!({"nekoc_extension_handshake":1,"project":project,"extensions":[nekoc::extensions::JsonParse::schema(true)]});
    studio.json("POST", "/api/extension-check", &payload, 200);
    assert_eq!(studio.request("GET", "/extensions.js", &Value::Null).0, 200);
    let request = format!("ws://127.0.0.1:{}/api/player-private", studio.port)
        .into_client_request()
        .unwrap();
    let stream = TcpStream::connect(("127.0.0.1", studio.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    let (mut socket, _) = tungstenite::client(request, stream).unwrap();
    socket.send(Message::Text(payload.to_string())).unwrap();
    let ready: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(ready["ready"], true);
    socket.send(Message::Text("{}".into())).unwrap();
    let bytes = socket.read().unwrap().into_data();
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let metadata: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    let request = &metadata["extension_requests"][0];
    assert_eq!(request["arguments"], json!(["[2,true]"]));
    socket
        .send(Message::Text(
            json!({"events":[{"kind":"extension_result","id":request["id"],"value":[2,true]}]})
                .to_string(),
        ))
        .unwrap();
    assert!(socket.read().unwrap().is_binary());
    socket
        .send(Message::Text(json!({"debug_snapshot":true}).to_string()))
        .unwrap();
    let snapshot: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(
        snapshot["snapshot"]["variables"]["output"],
        json!([2.0, true])
    );
    socket.close(None).unwrap();
    let mut denied = payload;
    denied["extensions"][0]["network"] = json!(true);
    studio.json("POST", "/api/extension-check", &denied, 400);
}

#[test]
fn extension_v2_reporter_hat_errors_and_negotiation_use_real_socket() {
    use tungstenite::{Message, client::IntoClientRequest};
    let studio = Studio::start("samples/native-studio.bcmkn");
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"]["output"] =
        json!({"id":"output","name":"output","value":0,"type":"number"});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{
            "type":"variables_set","fields":{"variable":"output"},"inputs":{"value":{
                "type":"nekoc_extension_reporter","fields":{"opcode":"test.double"},
                "inputs":{"n":{"type":"math_number","fields":{"NUM":3}}}
            }}
        }},
        {"type":"nekoc_extension_hat","fields":{"opcode":"test.event"},"next":{
            "type":"variables_set","fields":{"variable":"output"},
            "inputs":{"value":{"type":"self_listen_value"}}
        }}
    ]);
    let payload = json!({"nekoc_extension_handshake":1,"extension_api_versions":[2,1],
    "project":project,"extensions":[
        {"api_version":2,"opcode":"test.double","kind":"reporter","parameters":[{"name":"n","value_type":"number"}],"returns":"number","blocking":true},
        {"api_version":2,"opcode":"test.event","kind":"hat","parameters":[],"returns":null,"blocking":false}
    ]});
    studio.json("POST", "/api/extension-check", &payload, 200);
    let connect = || {
        let request = format!("ws://127.0.0.1:{}/api/player-private", studio.port)
            .into_client_request()
            .unwrap();
        let stream = TcpStream::connect(("127.0.0.1", studio.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .unwrap();
        tungstenite::client(request, stream).unwrap().0
    };
    let frame = |socket: &mut tungstenite::WebSocket<TcpStream>, payload: Value| {
        socket.send(Message::Text(payload.to_string())).unwrap();
        let bytes = socket.read().unwrap().into_data();
        let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        serde_json::from_slice::<Value>(&bytes[4..4 + length]).unwrap()
    };
    let mut socket = connect();
    socket.send(Message::Text(payload.to_string())).unwrap();
    let ready: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(ready["extension_api_version"], 2);
    let first = frame(&mut socket, json!({}));
    let request = &first["extension_requests"][0];
    assert_eq!(request["arguments"], json!([3.0]));
    frame(
        &mut socket,
        json!({"events":[{"kind":"extension_result","id":request["id"],"value":6}]}),
    );
    socket
        .send(Message::Text(json!({"debug_snapshot":true}).to_string()))
        .unwrap();
    let snapshot: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(snapshot["snapshot"]["variables"]["output"], 6.0);
    frame(
        &mut socket,
        json!({"events":[{"kind":"extension_event","opcode":"test.event","value":"hat"}]}),
    );
    socket
        .send(Message::Text(json!({"debug_snapshot":true}).to_string()))
        .unwrap();
    let snapshot: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(snapshot["snapshot"]["variables"]["output"], "hat");
    socket.close(None).unwrap();

    let mut socket = connect();
    socket.send(Message::Text(payload.to_string())).unwrap();
    assert!(socket.read().unwrap().is_text());
    let first = frame(&mut socket, json!({}));
    let failed = frame(
        &mut socket,
        json!({"events":[{"kind":"extension_result","id":first["extension_requests"][0]["id"],"error":"plugin failed"}]}),
    );
    assert!(
        failed["logs"][0]
            .as_str()
            .unwrap()
            .contains("plugin failed")
    );
    // v2 reports/stops only the failed caller; the connection and event hats live on.
    frame(
        &mut socket,
        json!({"events":[{"kind":"extension_event","opcode":"test.event","value":8}]}),
    );
    socket.close(None).unwrap();

    for versions in [json!([1]), json!([9])] {
        let mut denied = payload.clone();
        denied["extension_api_versions"] = versions;
        let mut socket = connect();
        socket.send(Message::Text(denied.to_string())).unwrap();
        let error: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        assert!(error["error"].is_string());
    }
}

#[test]
fn fill_delta_uses_existing_binary_envelope_and_legacy_frames_omit_extension() {
    let studio = Studio::start("samples/native-studio.bcmkn");
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "id":"start","type":"on_running_group_activated","next":{
            "type":"pen_begin_path","next":{
                "type":"self_move_to","inputs":{"x":{"type":"math_number","fields":{"NUM":20}},"y":{"type":"math_number","fields":{"NUM":0}}},"next":{
                    "type":"self_move_to","inputs":{"x":{"type":"math_number","fields":{"NUM":20}},"y":{"type":"math_number","fields":{"NUM":20}}},"next":{
                        "type":"pen_close_path","next":{"type":"self_pen_down"}
                    }
                }
            }
        }
    }]);
    studio.json("POST", "/api/import", &project, 200);
    studio.json("POST", "/api/start", &json!({}), 200);
    let (status, bytes) = studio.request("POST", "/api/frame", &json!({"dt":0.016}));
    assert_eq!(status, 200);
    let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    assert_eq!(len % 4, 0);
    let header: Value = serde_json::from_slice(&bytes[4..4 + len]).unwrap();
    assert_eq!(
        header["pen_fills"][0]["points"],
        json!([[0.0, 0.0], [20.0, 0.0], [20.0, 20.0]])
    );
    assert_eq!(header["pen_fills"][0]["before_line"], 0);
    assert_eq!(bytes.len() - 4 - len, 9 * 4); // Existing float32 line instance, no new trailer.
    let (_, idle) = studio.request("POST", "/api/frame", &json!({"dt":0.016}));
    let len = u32::from_le_bytes(idle[..4].try_into().unwrap()) as usize;
    let header: Value = serde_json::from_slice(&idle[4..4 + len]).unwrap();
    assert!(header.get("pen_fills").is_none());
}

#[test]
fn deep_published_work_survives_http_import_echo_export_and_private_player() {
    use nekoc::json;
    use tungstenite::{Message, client::IntoClientRequest};
    let studio = Studio::start("samples/native-studio.bcmkn");
    let mut source = json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap();
    for section in ["actors", "scenes"] {
        for owner in source["theatre"][section]
            .as_object_mut()
            .unwrap()
            .values_mut()
        {
            owner.as_object_mut().unwrap().remove("block_data_json");
        }
    }
    let mut tail = None;
    for i in (0..=2000).rev() {
        let mut block = json!({"id":format!("deep-{i}"),"type":if i == 0 {"start_on_click"} else {"self_pen_down"},"params":{}});
        if let Some(next) = tail {
            block["next_block"] = next;
        }
        tail = Some(block);
    }
    source["compile_result"] = json!([{"id":"nekoc-pen-actor","compiled_block_map":{}}]);
    source["compile_result"][0]["compiled_block_map"]["hat"] = tail.unwrap();
    let (status, bytes) = studio.request("POST", "/api/import", &source);
    assert_eq!(status, 200, "{}", String::from_utf8_lossy(&bytes));
    let report = json::from_slice(&bytes).unwrap();
    assert_eq!(report["fast_runtime_ready"], true);
    let (status, bytes) = studio.request("GET", "/api/project", &Value::Null);
    assert_eq!(status, 200);
    let project = json::from_slice(&bytes).unwrap();
    assert!(json::equal(&project, &report["project"]));
    assert_eq!(studio.request("POST", "/api/project", &project).0, 200);
    let (status, bytes) = studio.request("POST", "/api/export", &project);
    assert_eq!(status, 200, "{}", String::from_utf8_lossy(&bytes));
    assert!(json::equal(&json::from_slice(&bytes).unwrap(), &source));
    let (status, bytes) = studio.request("POST", "/api/import-player", &source);
    assert_eq!(status, 200);
    assert_eq!(
        json::from_slice(&bytes).unwrap()["fast_runtime_ready"],
        true
    );
    let request = format!("ws://127.0.0.1:{}/api/player-private", studio.port)
        .into_client_request()
        .unwrap();
    let stream = TcpStream::connect(("127.0.0.1", studio.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    let (mut socket, _) = tungstenite::client(request, stream).unwrap();
    socket
        .send(Message::Text(
            String::from_utf8(json::to_vec(&project).unwrap()).unwrap(),
        ))
        .unwrap();
    let ready = json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(ready["ready"], true);
    socket.send(Message::Text("{}".into())).unwrap();
    assert!(socket.read().unwrap().is_binary());
    socket.close(None).unwrap();
}

#[test]
fn extension_origin_is_scoped_and_private_players_keep_independent_snapshots() {
    use tungstenite::{Message, client::IntoClientRequest};
    let studio = Studio::start("samples/native-studio.bcmkn");
    let original = studio.project();
    let extension = "chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj";
    for origin in [
        "https://pickcat.dao3.fun",
        "https://example.com",
        "chrome-extension://unlisted",
    ] {
        assert_eq!(
            studio
                .request_origin("GET", "/api/health", &Value::Null, Some(origin))
                .0,
            403
        );
    }
    assert_eq!(
        studio
            .request_origin("GET", "/api/health", &Value::Null, Some(extension))
            .0,
        200
    );
    assert_eq!(
        studio
            .request_origin(
                "OPTIONS",
                "/api/import-player",
                &Value::Null,
                Some(extension)
            )
            .0,
        204
    );
    assert_eq!(
        studio
            .request_origin("GET", "/api/project", &Value::Null, Some(extension))
            .0,
        403
    );
    let project = |x| {
        let mut p = nekoc::studio::document::Document::blank().value().clone();
        p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
            "type":"on_running_group_activated","next":{"type":"self_set_position_x","inputs":{"value":{"type":"math_number","fields":{"NUM":x}}}}
        }]);
        p
    };
    let a = project(17.0);
    let b = project(99.0);
    assert_eq!(
        studio
            .request_origin("POST", "/api/import-player", &a, Some(extension))
            .0,
        200
    );
    assert_eq!(studio.project(), original);
    let open = |project: &Value| {
        let mut request = format!("ws://127.0.0.1:{}/api/player-private", studio.port)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", extension.parse().unwrap());
        let (mut socket, _) = tungstenite::connect(request).unwrap();
        socket.send(Message::Text(project.to_string())).unwrap();
        let ready: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(ready["ready"], true);
        socket
    };
    let mut socket_a = open(&a);
    let mut socket_b = open(&b);
    // Global editor changes cannot change either private VM, even between frame requests.
    studio.json("POST", "/api/import", &b, 200);
    for (socket, expected) in [(&mut socket_a, 17.0), (&mut socket_b, 99.0)] {
        socket
            .send(Message::Text(json!({"dt":0.016}).to_string()))
            .unwrap();
        let bytes = socket.read().unwrap().into_data();
        let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let frame: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
        assert_eq!(frame["sprites"][1]["x"], expected);
        socket.close(None).unwrap();
    }
}

#[test]
fn kitten4_cli_import_edit_run_export_and_validation_boundaries() {
    // Cargo builds this binary, so the test never accidentally uses an old server.
    let studio = Studio::start("samples/kitten4-demo.bcm");
    let initial = studio.project();
    assert_eq!(initial["toolType"], "KN");
    assert!(initial["_nekocKitten4"].is_object());
    let mut native = nekoc::project::load_project("samples/kitten4-demo.bcm")
        .unwrap()
        .value;
    native["webOpaqueExtension"] = json!({"future":[null,17,{"xml":"<opaque keep=\"yes\"/>"}]});
    let report = studio.json("POST", "/api/import", &native, 200);
    assert_eq!(report["format"], "kitten4-json");
    assert_eq!(report["export_extension"], "bcm");
    assert_eq!(report["fast_runtime_ready"], true, "{report}");
    let canonical = report["project"].clone();
    assert_eq!(canonical, studio.project());

    // Rejected requests are atomic and cannot reset the current project or strip provenance.
    let mut missing = canonical.clone();
    missing.as_object_mut().unwrap().remove("_nekocKitten4");
    let mut altered = canonical.clone();
    altered["_nekocKitten4"]["tampered"] = json!(true);
    let mut malformed_owner = canonical.clone();
    malformed_owner["actors"]["actorsDict"]["bad-owner"] = Value::Null;
    let mut malformed_block = canonical.clone();
    malformed_block["actors"]["actorsDict"]["bad-owner"] =
        json!({"nekoBlockJsonList":[{"type":2}]});
    for invalid in [
        json!([]),
        json!({}),
        native.clone().into_value(),
        missing,
        altered,
        malformed_owner,
        malformed_block,
    ] {
        studio.json("POST", "/api/project", &invalid, 400);
        studio.json("POST", "/api/export", &invalid, 400);
        assert_eq!(studio.project(), canonical);
    }
    let mut corrupt = canonical.clone();
    corrupt["_nekocKitten4"] = Value::Null;
    studio.json("POST", "/api/import", &corrupt, 400);
    studio.json("POST", "/api/import", &json!({"toolType":"COCO"}), 400);
    assert_eq!(studio.project(), canonical);

    let mut edited = canonical.clone();
    edited["projectName"] = json!("Kitten4 Web edited");
    studio.json("POST", "/api/project", &edited, 200);
    studio.json("POST", "/api/start", &json!({}), 200);
    let (status, bytes) = studio.request("POST", "/api/frame", &json!({"dt":1.0 / 60.0}));
    assert_eq!(status, 200);
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let frame: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    assert!(frame["instructions"].as_u64().unwrap() > 0);
    studio.json("POST", "/api/stop", &json!({}), 200);
    let exported = studio.json("POST", "/api/export", &edited, 200);
    assert!(nekoc::kitten4::is_kitten4(&exported));
    assert!(exported.get("_nekocKitten4").is_none());
    assert_eq!(exported["webOpaqueExtension"], native["webOpaqueExtension"]);
    let again = studio.json("POST", "/api/import", &exported, 200);
    assert_eq!(again["project"]["projectName"], edited["projectName"]);

    // Switching via import is explicit; plain KN still exports byte-for-value JSON.
    let mut kn = nekoc::project::load_project("samples/native-studio.bcmkn")
        .unwrap()
        .value;
    kn["unknownExtension"] = json!([1,{"preserved":true}]);
    let report = studio.json("POST", "/api/import", &kn, 200);
    assert_eq!(report["format"], "bcmkn-json");
    assert_eq!(report["project"], kn);
    assert_eq!(studio.json("POST", "/api/export", &kn, 200), kn);
}

#[test]
fn debug_snapshot_is_read_only_complete_and_same_origin_protected() {
    use tungstenite::{Message, client::IntoClientRequest};
    let studio = Studio::start("samples/kitten4-demo.bcm");
    let url = format!("ws://127.0.0.1:{}/api/player", studio.port);
    let mut forbidden = url.clone().into_client_request().unwrap();
    forbidden
        .headers_mut()
        .insert("Origin", "https://example.com".parse().unwrap());
    assert!(tungstenite::connect(forbidden).is_err());
    let (mut socket, _) = tungstenite::connect(&url).unwrap();
    let ready: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(ready["ready"], true);
    let read = |socket: &mut tungstenite::WebSocket<
        tungstenite::stream::MaybeTlsStream<TcpStream>,
    >| {
        socket
            .send(Message::Text(json!({"debug_snapshot":true,"dt":100,"events":[{"kind":"key","key":"32","down":true}]}).to_string()))
            .unwrap();
        let value: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        value["snapshot"].clone()
    };
    let before = read(&mut socket);
    assert_eq!(before["sequence"], 0);
    assert_eq!(before["time"].as_f64(), Some(0.0));
    assert!(before["actors"].as_object().unwrap().values().all(|a| {
        a["x"].is_number()
            && a["direction"].is_number()
            && a["visible"].is_boolean()
            && a.get("costume").is_some()
    }));
    assert_eq!(read(&mut socket), before);
    socket
        .send(Message::Text(json!({"dt":0.016}).to_string()))
        .unwrap();
    let bytes = socket.read().unwrap().into_data();
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let frame: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    // Reads have not consumed dirty sprites, reset flags, or sequence numbers.
    assert_eq!(frame["sequence"], 1);
    assert_eq!(frame["reset"], true);
    assert!(!frame["sprites"].as_array().unwrap().is_empty());
    let after = read(&mut socket);
    assert_eq!(after["sequence"], 1);
    assert_eq!(read(&mut socket), after);
}

#[test]
fn debug_snapshot_keeps_text_lists_and_detaches_values() {
    use nekoc::engine::{Engine, Program};
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"] = json!({
        "text":{"id":"text","name":"text","type":"variable","value":"hello"},
        "list":{"id":"list","name":"list","type":"list","value":[1,"two"]}
    });
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let before = vm.debug_snapshot();
    assert_eq!(before["variables"]["text"], "hello");
    assert_eq!(before["lists"]["list"], json!([1.0, "two"]));
    let mut detached = before.clone();
    detached["lists"]["list"][0] = json!(99);
    assert_eq!(vm.debug_snapshot(), before);
}

#[test]
fn ephemeral_port_is_advertised_and_passes_host_validation() {
    use std::io::BufRead;
    let mut process = Command::new(env!("CARGO_BIN_EXE_web"))
        .args(["samples/kitten4-demo.bcm", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let stdout = process.stdout.take().unwrap();
    let mut studio = Studio { process, port: 0 };
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        std::io::BufReader::new(stdout)
            .read_line(&mut line)
            .unwrap();
        let _ = send.send(line);
    });
    let line = receive.recv_timeout(Duration::from_secs(15)).unwrap();
    studio.port = line
        .trim()
        .strip_prefix("NekoC Web Studio: http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    assert_ne!(studio.port, 0);
    assert_eq!(
        studio.json("GET", "/api/health", &Value::Null, 200)["ok"],
        true
    );
}
