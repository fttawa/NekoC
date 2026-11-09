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
        let body = serde_json::to_vec(payload).unwrap();
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
        native.clone(),
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
