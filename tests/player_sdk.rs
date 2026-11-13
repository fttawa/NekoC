use nekoc::engine::Costume;
use nekoc::json::Json;
use nekoc::player::{
    FrameInput, Handshake, Player, Reply, decode_frame, error_message, import, is_kitten4_project,
};
use serde_json::{Value, json};

/// Logs `bump_into(__self, --mouse)` once when the project starts.
fn collision_project() -> Json {
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","next":{
            "type":"console_log","inputs":{"console_log":{
                "type":"bump_into","fields":{"sprite":"__self","sprite1":"--mouse"}
            }}
        }
    }]);
    Json::new(project)
}

/// The frame budget is wall-clock; a slow runner may need more than one frame
/// to reach the log, so collect a few frames' worth.
fn first_logs(player: &mut Player, input: &FrameInput) -> Vec<Value> {
    let mut logs = Vec::new();
    for _ in 0..10 {
        let (frame, _) = decode_frame(&player.frame(input).unwrap()).unwrap();
        logs.extend(frame["logs"].as_array().unwrap().iter().cloned());
        if !logs.is_empty() {
            break;
        }
    }
    logs
}

#[test]
fn frame_registers_pivot_with_costume_mask() {
    for (pivot, expected) in [
        (json!({"x":10,"y":6}), [10.0, 6.0]),
        (json!({"x":"bad","y":6}), [0.0, 6.0]),
        (Value::Null, [0.0, 0.0]),
    ] {
        let mut player = Player::load(Handshake::new(collision_project())).unwrap();
        let input = FrameInput::from_json(&json!({
            "mouse":{"x":-expected[0]-5.0,"y":expected[1]+3.0},
            "costumes":[{
                "id":"nekoc-costume","width":20,"height":12,"centerPoint":pivot,
                "mask_width":2,"mask_height":1,"mask":"AQ=="
            }]
        }))
        .unwrap();
        assert_eq!(first_logs(&mut player, &input), [json!("1")]);
    }
}

#[test]
fn typed_input_matches_the_wire_request() {
    let mut player = Player::load(Handshake::new(collision_project())).unwrap();
    let input = FrameInput {
        mouse: Some((-15.0, 9.0)),
        costumes: vec![(
            "nekoc-costume".into(),
            Costume {
                width: 20.0,
                height: 12.0,
                center_point: [10.0, 6.0],
                mask: Some((2, 1, vec![1])),
                rgb: None,
            },
        )],
        ..Default::default()
    };
    assert_eq!(first_logs(&mut player, &input), [json!("1")]);
}

#[test]
fn handle_serves_frames_and_debug_snapshots() {
    let mut player = Player::load(Handshake::new(collision_project())).unwrap();
    assert_eq!(player.ready()["ready"], true);
    assert!(player.ready()["stats"].is_object());
    assert_eq!(player.ready()["extension_api_version"], Value::Null);
    let Reply::Binary(bytes) = player.handle("{}").unwrap() else {
        panic!("frame request must answer with a binary frame");
    };
    let (frame, lines) = decode_frame(&bytes).unwrap();
    assert_eq!(frame["sequence"], 1);
    assert!(lines.is_empty());
    let Reply::Text(text) = player.handle(r#"{"debug_snapshot":true}"#).unwrap() else {
        panic!("debug snapshot must answer with text");
    };
    assert!(serde_json::from_str::<Value>(&text).unwrap()["snapshot"].is_object());
}

#[test]
fn a_malformed_request_applies_none_of_its_input() {
    let mut player = Player::load(Handshake::new(collision_project())).unwrap();
    let error = player
        .handle(r#"{"mouse":{"x":1,"y":2},"events":[{"kind":"extension_event","value":1}]}"#)
        .unwrap_err();
    assert!(error.to_string().contains("missing opcode"), "{error:#}");
    assert_eq!(
        serde_json::from_str::<Value>(&error_message(&error)).unwrap()["error"],
        "extension event missing opcode"
    );
    assert!(
        player
            .handle(r#"{"kn_microphone":{"status":"loud"}}"#)
            .is_err()
    );
    // Neither failed request advanced the runtime.
    let (frame, _) = decode_frame(&player.frame(&FrameInput::default()).unwrap()).unwrap();
    assert_eq!(frame["sequence"], 1);
}

fn double_schema(api_version: u32) -> Value {
    json!({
        "api_version": api_version,
        "opcode": "demo.double",
        "parameters": [{"name": "n", "value_type": "number"}],
        "returns": "number",
        "blocking": true,
        "network": false
    })
}

#[test]
fn extension_handshake_negotiates_the_api_version() {
    let project = collision_project();
    let message = |extra: Value| {
        let mut message = json!({
            "nekoc_extension_handshake": 1,
            "project": *project,
            "extensions": [double_schema(1)],
        });
        message
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().cloned().unwrap_or_default());
        message.to_string()
    };
    // Old clients send no version list and get v1.
    let handshake = Handshake::parse(&message(json!({}))).unwrap();
    assert_eq!(handshake.extensions.as_ref().unwrap().api_versions, [1]);
    assert_eq!(handshake.project, *project);
    let player = Player::load(handshake).unwrap();
    assert_eq!(player.ready()["extension_api_version"], 1);

    let handshake = Handshake::parse(&message(json!({"extension_api_versions":[2, 1]}))).unwrap();
    assert_eq!(
        Player::load(handshake).unwrap().ready()["extension_api_version"],
        2
    );

    // A plain project is not an extension handshake.
    assert!(
        Handshake::parse(&project.to_string())
            .unwrap()
            .extensions
            .is_none()
    );

    let too_many =
        Handshake::parse(&message(json!({"extension_api_versions": vec![1; 17]}))).unwrap();
    assert!(Player::load(too_many).is_err());

    let schema: nekoc::extensions::BlockSchema = serde_json::from_value(double_schema(2)).unwrap();
    let ahead = Handshake::new(project.clone()).with_extensions(vec![schema], vec![1]);
    let error = Player::load(ahead).err().unwrap();
    assert!(
        error.to_string().contains("exceeds negotiated"),
        "{error:#}"
    );
}

#[test]
fn load_rejects_malformed_projects_before_compiling() {
    for project in [
        json!([]),
        json!({"toolType":"K4"}),
        json!({"scenes":{"scenesDict":{}}}),
    ] {
        assert!(Player::load(Handshake::new(Json::new(project))).is_err());
    }
}

#[test]
fn import_converts_kitten4_works_into_playable_projects() {
    let source = nekoc::json::from_str(include_str!("../samples/kitten4-demo.bcm")).unwrap();
    let (project, report) = import(source).unwrap();
    assert!(is_kitten4_project(&project));
    assert_eq!(report["export_extension"], "bcm");
    assert_eq!(report["editor_format"], "bcmkn-json");
    let mut player = Player::load(Handshake::new(project)).unwrap();
    player.frame(&FrameInput::default()).unwrap();
}

#[test]
fn decode_frame_rejects_truncated_frames() {
    assert!(decode_frame(&[]).is_err());
    assert!(decode_frame(&[8, 0, 0, 0, b'{', b'}']).is_err());
    let (metadata, lines) =
        decode_frame(&[4, 0, 0, 0, b'{', b'}', b' ', b' ', 0, 0, 0x80, 0x3f]).unwrap();
    assert_eq!(metadata, json!({}));
    assert_eq!(lines, [1.0]);
}
