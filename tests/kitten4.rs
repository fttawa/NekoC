use nekoc::{
    engine::{Engine, Program},
    kitten4, runtime,
};
use serde_json::{Value, json};
use std::time::Duration;

fn fixture() -> Value {
    serde_json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap()
}

fn canonical_blank() -> Value {
    let mut value = nekoc::studio::document::Document::blank().value().clone();
    value["stageSize"] = json!({"width":1280,"height":720});
    value
}

fn workspace(project: &mut Value) -> &mut Value {
    &mut project["theatre"]["actors"]["nekoc-pen-actor"]["block_data_json"]
}

#[test]
fn native_fill_blocks_lower_only_for_vm_and_roundtrip_unchanged() {
    let mut native = fixture();
    let ws = workspace(&mut native);
    let blocks = ws["blocks"].as_object_mut().unwrap();
    blocks.clear();
    for (id, kind, fields) in [
        ("start", "on_running_group_activated", json!({})),
        ("begin", "set_pen_path", json!({"point":"start_point"})),
        ("color", "set_fill_style", json!({"color":"#777777"})),
        ("end", "set_pen_path", json!({"point":"end_point"})),
        ("old-begin", "pen_begin_path", json!({})),
        ("old-end", "pen_close_path", json!({})),
    ] {
        blocks.insert(
            id.into(),
            json!({"id":id,"type":kind,"fields":fields,"shadows":{},"mutation":""}),
        );
    }
    ws["connections"] = json!({"start":{"begin":{"type":"next"}},"begin":{"color":{"type":"next"}},"color":{"end":{"type":"next"}},"end":{"old-begin":{"type":"next"}},"old-begin":{"old-end":{"type":"next"}}});
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let lowered = kitten4::lower_for_vm(&canonical);
    let first = &lowered["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"][0]["next"];
    assert_eq!(first["type"], "pen_begin_path");
    assert_eq!(first["next"]["type"], "set_fill_style");
    assert_eq!(first["next"]["next"]["type"], "pen_close_path");
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.start();
    let f = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert!(f.pen_fills.is_empty()); // Degenerate one-point paths are invisible.
}

#[test]
fn official_native_pen_fixture_imports_and_runs_on_program() {
    let native = fixture();
    assert!(kitten4::is_kitten4(&native));
    let canonical = kitten4::to_neko(&native).unwrap();
    assert!(canonical.get("_nekocKitten4").is_some());
    let program = Program::compile(&canonical).unwrap();
    let mut engine = Engine::new(program);
    engine.start();
    let frame = engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(frame.active, 0);
    assert!(frame.clear);
    assert!(!frame.lines.is_empty());
    let snapshot = runtime::run_project(&canonical, 2).unwrap();
    let actor = &snapshot.actors["nekoc-pen-actor"];
    assert_eq!((actor.x, actor.y), (80.0, 40.0));
    assert_eq!(actor.pen.size, 8.0);
    assert_eq!(actor.pen.color, "#e84a5f");
    assert!(!actor.pen.down);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}

#[test]
fn official_download_without_editor_current_scene_uses_scene_order() {
    let mut native = fixture();
    native["theatre"]
        .as_object_mut()
        .unwrap()
        .remove("current_scene");
    native["theatre"]
        .as_object_mut()
        .unwrap()
        .remove("current_entity");
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(
        canonical["scenes"]["currentSceneId"],
        native["theatre"]["scenes_order"][0]
    );
    let snapshot = runtime::run_project(&canonical, 2).unwrap();
    assert_eq!(snapshot.actors["nekoc-pen-actor"].x, 80.0);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    native["theatre"]
        .as_object_mut()
        .unwrap()
        .remove("scenes_order");
    assert!(kitten4::to_neko(&native).unwrap()["scenes"]["currentSceneId"].is_string());
}

#[test]
fn edit_export_retains_unknown_project_owner_block_and_connection_metadata() {
    let mut native = fixture();
    native["future_project"] = json!({"revision":27});
    native["theatre"]["actors"]["nekoc-pen-actor"]["future_actor"] = json!([1, 2, 3]);
    let graph = workspace(&mut native);
    graph["future_workspace"] = json!("keep");
    graph["blocks"]["fixture-12"]["future_block"] = json!({"nested":true});
    graph["blocks"]["unsupported"] =
        json!({"id":"unsupported","type":"get_orientation","fields":{"axis":"X"},"future":9});
    graph["connections"]["fixture-7"]["fixture-12"]["future_edge"] = json!("keep");
    graph["comments"] = json!({"c":{"text":"comment","block_id":"unsupported"}});
    let mut canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let actor = &mut canonical["actors"]["actorsDict"]["nekoc-pen-actor"];
    actor["position"]["x"] = json!(23);
    let root = &mut actor["nekoBlockJsonList"];
    fn edit(block: &mut Value) {
        if block["id"] == "fixture-12" {
            block["fields"]["NUM"] = json!(110);
        }
        if let Some(next) = block.get_mut("next") {
            edit(next);
        }
        for key in ["inputs", "statements"] {
            if let Some(children) = block.get_mut(key).and_then(Value::as_object_mut) {
                for child in children.values_mut() {
                    edit(child);
                }
            }
        }
    }
    for block in root.as_array_mut().unwrap() {
        edit(block);
    }
    assert!(
        root.as_array()
            .unwrap()
            .iter()
            .any(|b| b["type"] == "kitten4::get_orientation")
    );
    let exported = kitten4::from_neko(&canonical).unwrap();
    let mut expected = native;
    expected["theatre"]["actors"]["nekoc-pen-actor"]["x"] = json!(23);
    workspace(&mut expected)["blocks"]["fixture-12"]["fields"]["NUM"] = json!(110);
    assert_eq!(exported, expected);
    let reimported = kitten4::to_neko(&exported).unwrap();
    assert_eq!(
        reimported["actors"]["actorsDict"]["nekoc-pen-actor"]["position"]["x"],
        23
    );
    let snapshot = runtime::run_project(&reimported, 2).unwrap();
    assert_eq!(snapshot.actors["nekoc-pen-actor"].x, 110.0);
}

#[test]
fn unsupported_native_enum_is_opaque_but_new_unsupported_kn_is_rejected() {
    let mut native = fixture();
    workspace(&mut native)["blocks"]["inverse"] =
        json!({"id":"inverse","type":"math_trig","fields":{"OP":"ASIN"}});
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let mut fresh = canonical;
    fresh["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"new","type":"console_log"}));
    let error = format!("{:#}", kitten4::from_neko(&fresh).unwrap_err());
    assert!(
        error.contains("unsupported new KN block console_log"),
        "{error}"
    );
}

#[test]
fn graph_cycles_missing_targets_and_multiple_parents_are_errors() {
    for (blocks, connections, expected) in [
        (
            json!({"a":{"type":"wait"},"b":{"type":"wait"}}),
            json!({"a":{"b":{"type":"next"}},"b":{"a":{"type":"next"}}}),
            "cycle",
        ),
        (
            json!({"a":{"type":"wait"}}),
            json!({"a":{"missing":{"type":"next"}}}),
            "missing block",
        ),
        (
            json!({"a":{"type":"wait"},"b":{"type":"wait"},"c":{"type":"wait"}}),
            json!({"a":{"c":{"type":"next"}},"b":{"c":{"type":"next"}}}),
            "multiple parents",
        ),
    ] {
        let mut native = fixture();
        *workspace(&mut native) = json!({"blocks":blocks,"connections":connections});
        let error = format!("{:#}", kitten4::to_neko(&native).unwrap_err());
        assert!(error.contains(expected), "{error}");
    }
}

#[test]
fn future_native_version_is_recognized_but_rejected_explicitly() {
    let mut native = fixture();
    native["version"] = json!(26);
    assert!(kitten4::is_kitten4(&native));
    assert!(
        kitten4::to_neko(&native)
            .unwrap_err()
            .to_string()
            .contains("unsupported Kitten 4 project version 26")
    );
}

#[test]
fn editor_direction_shadow_is_a_numeric_reporter() {
    let mut native = fixture();
    workspace(&mut native)["blocks"]["fixture-12"]["type"] = json!("controller_shadow");
    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 2).unwrap();
    assert_eq!(snapshot.actors["nekoc-pen-actor"].x, 80.0);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}

#[test]
fn adding_actor_to_imported_project_registers_a_native_group() {
    let native = fixture();
    let mut canonical = kitten4::to_neko(&native).unwrap();
    let mut actor = canonical["actors"]["actorsDict"]["nekoc-pen-actor"].clone();
    actor["id"] = json!("new-actor");
    actor["nekoBlockJsonList"] = json!([]);
    canonical["actors"]["actorsDict"]["new-actor"] = actor;
    let scene_id = canonical["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    canonical["scenes"]["scenesDict"][&scene_id]["actorIds"]
        .as_array_mut()
        .unwrap()
        .push(json!("new-actor"));
    let exported = kitten4::from_neko(&canonical).unwrap();
    let groups = &exported["theatre"]["groups"];
    assert_eq!(
        groups["nekoc-pen-group"],
        native["theatre"]["groups"]["nekoc-pen-group"]
    );
    assert_eq!(
        groups["nekoc-k4-group-new-actor"]["actors"],
        json!(["new-actor"])
    );
    assert!(
        exported["theatre"]["scenes"][&scene_id]["group_order"]
            .as_array()
            .unwrap()
            .contains(&json!("nekoc-k4-group-new-actor"))
    );
}

#[test]
fn deleting_selected_native_actor_falls_back_to_a_surviving_scene() {
    let mut native = fixture();
    native["theatre"]["current_entity"] = json!("nekoc-pen-actor");
    let mut canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    canonical["actors"]["actorsDict"]
        .as_object_mut()
        .unwrap()
        .remove("nekoc-pen-actor");
    let scene_id = canonical["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    canonical["scenes"]["scenesDict"][&scene_id]["actorIds"] = json!([]);
    let exported = kitten4::from_neko(&canonical).unwrap();
    assert_eq!(exported["theatre"]["current_entity"], scene_id);
    assert_eq!(exported["theatre"]["current_scene"], scene_id);
    assert!(
        exported["theatre"]["actors"]
            .as_object()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn coordinate_decrease_has_matching_reference_and_fast_vm_semantics() {
    for selector in ["increase", "method"] {
        let mut canonical = canonical_blank();
        let mut movement =
            json!({"type":"self_change_coordinate_y","fields":{},"inputs":{"value":num(7.0)}});
        movement["fields"][selector] = json!("decrease");
        canonical["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":movement}
        ]);
        let native = kitten4::from_neko(&canonical).unwrap();
        let imported = kitten4::to_neko(&native).unwrap();
        let snapshot = runtime::run_project(&imported, 2).unwrap();
        assert_eq!(snapshot.actors["nekoc-default-actor"].y, -7.0);
        let mut vm = Engine::new(Program::compile(&imported).unwrap());
        vm.start();
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert!(frame.sprites.iter().any(|s| s.y == -7.0));
        assert_eq!(kitten4::from_neko(&imported).unwrap(), native);
    }
}

#[test]
fn message_when_split_and_signed_pen_sockets_follow_the_canonical_schema() {
    let mut canonical = canonical_blank();
    canonical["variables"]["variablesDict"] = json!({
        "parts":{"id":"parts","name":"parts","type":"any","value":0},
        "seen":{"id":"seen","name":"seen","type":"any","value":0}
    });
    let message = json!({"type":"broadcast_input","fields":{"message":"go"}});
    canonical["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{
            "type":"self_set_pen_size","inputs":{"size":num(10.0)},"next":{
                "type":"self_change_pen_size","fields":{"increase":"decrease"},"inputs":{"steps":num(3.0)},"next":{
                    "type":"self_set_pen_color_property","fields":{"scope":"brightness"},"inputs":{"val":num(100.0)},"next":{
                        "type":"self_change_pen_color_property","fields":{"scope":"brightness","increase":"decrease"},"inputs":{"steps":num(25.0)},"next":{
                            "type":"self_broadcast","inputs":{"message":message}
                        }
                    }
                }
            }
        }},
        {"type":"self_listen","inputs":{"message":message},"statements":{"DO":{
            "type":"variables_set","fields":{"variable":"parts"},"inputs":{"value":{
                "type":"text_split","inputs":{"TEXT_TO_SPLIT":{"type":"text","fields":{"TEXT":"a,b"}},"SPLIT_TEXT":{"type":"text","fields":{"TEXT":","}}}
            }}
        }}},
        {"type":"when","inputs":{"condition":{"type":"logic_boolean","fields":{"BOOL":"TRUE"}}},"statements":{"DO":{
            "type":"variables_set","fields":{"variable":"seen"},"inputs":{"value":num(1.0)}
        }}}
    ]);
    let native = kitten4::from_neko(&canonical).unwrap();
    let imported = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&imported, 3).unwrap();
    assert_eq!(
        serde_json::to_value(&snapshot.variables["parts"]).unwrap(),
        json!(["a", "b"])
    );
    assert_eq!(
        serde_json::to_value(&snapshot.variables["seen"]).unwrap(),
        json!(1.0)
    );
    assert_eq!(snapshot.actors["nekoc-default-actor"].pen.size, 7.0);
    assert_eq!(snapshot.actors["nekoc-default-actor"].pen.hsv[2], 75.0);
    assert_eq!(kitten4::from_neko(&imported).unwrap(), native);
}

fn num(value: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":value}})
}
fn list() -> Value {
    json!({"type":"pure_list_get","fields":{"list":"items"}})
}

#[test]
fn fresh_canonical_variables_math_control_lists_motion_and_keys_roundtrip() {
    let mut canonical = canonical_blank();
    canonical["variables"]["variablesDict"] = json!({
        "score":{"id":"score","name":"score","type":"any","value":0},
        "items":{"id":"items","name":"items","type":"list","value":[]}
    });
    canonical["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{"type":"warp","statements":{"DO":{
            "type":"repeat_n_times","inputs":{"times":num(3.0)},"statements":{"DO":{
                "type":"change_variables","fields":{"variable":"score","method":"increase"},"inputs":{"value":num(2.0)},"next":{
                    "type":"list_append","inputs":{"list":list(),"list_item_value":{"type":"variables_get","fields":{"variable":"score"}}}
                }
            }},"next":{"type":"self_set_position_x","inputs":{"value":{"type":"math_arithmetic","fields":{"type":"multiply"},"inputs":{"A":{"type":"list_length","inputs":{"list":list()}},"B":num(10.0)}}}}
        }}}},
        {"type":"on_keydown","fields":{"type":"down","key":"32"},"next":{"type":"self_change_coordinate_y","fields":{"method":"decrease"},"inputs":{"value":num(5.0)}}}
    ]);
    let native = kitten4::from_neko(&canonical).unwrap();
    assert_eq!(
        native["variables"]["score"]["position"],
        json!({"x":0,"y":0})
    );
    let imported = kitten4::to_neko(&native).unwrap();
    let mut vm = Engine::new(Program::compile(&imported).unwrap());
    vm.start();
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    let snapshot = runtime::run_project(&imported, 2).unwrap();
    assert_eq!(
        serde_json::to_value(&snapshot.variables["score"]).unwrap(),
        json!(6.0)
    );
    assert_eq!(
        serde_json::to_value(&snapshot.variables["items"]).unwrap(),
        json!([2.0, 4.0, 6.0])
    );
    assert_eq!(snapshot.actors["nekoc-default-actor"].x, 30.0);
    assert_eq!(kitten4::from_neko(&imported).unwrap(), native);
}

// Evaluate the emitted native expression sockets using the official generator's
// operators, independently of the adapter's inverse conversion.
fn native_expr(graph: &Value, id: &str, variable: f64, heading: f64) -> f64 {
    let block = &graph["blocks"][id];
    let socket = |name: &str| {
        let child = graph["connections"][id]
            .as_object()
            .unwrap()
            .iter()
            .find(|(_, e)| e["type"] == "input" && e["input_name"] == name)
            .unwrap()
            .0;
        native_expr(graph, child, variable, heading)
    };
    match block["type"].as_str().unwrap() {
        "math_number" | "controller_shadow" => block["fields"]["NUM"]
            .as_f64()
            .unwrap_or_else(|| block["fields"]["NUM"].as_str().unwrap().parse().unwrap()),
        "variables_get" => {
            assert_eq!(block["fields"]["VAR"], "angle");
            variable
        }
        "get_2" => {
            assert_eq!(block["fields"]["attribute"], "3");
            heading
        }
        "math_arithmetic" => match block["fields"]["OP"].as_str().unwrap() {
            "MINUS" => socket("A") - socket("B"),
            "ADD" => socket("A") + socket("B"),
            _ => panic!("unexpected native operator {block}"),
        },
        _ => panic!("unexpected native expression {block}"),
    }
}

fn native_socket<'a>(graph: &'a Value, id: &str, name: &str) -> &'a str {
    graph["connections"][id]
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, e)| e["type"] == "input" && e["input_name"] == name)
        .unwrap()
        .0
}

#[test]
fn heading_turn_and_reporter_expressions_use_native_coordinates() {
    for expression in [
        num(30.0),
        json!({"type":"variables_get","fields":{"variable":"angle"}}),
    ] {
        let mut canonical = canonical_blank();
        canonical["variables"]["variablesDict"] = json!({"angle":{"id":"angle","name":"angle","type":"any","value":30},"direction":{"id":"direction","name":"direction","type":"any","value":0}});
        canonical["actors"]["actorsDict"]["nekoc-default-actor"]["rotation"] = json!(0.4);
        canonical["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
            {"id":"hat","type":"on_running_group_activated","next":{
                "id":"heading","type":"self_point_towards","inputs":{"degrees":expression},"next":{
                    "id":"turn","type":"self_rotate","inputs":{"degrees":expression},"next":{
                        "id":"read","type":"variables_set","fields":{"variable":"direction"},"inputs":{"value":{"id":"reporter","type":"get_orientation","fields":{"target":"--self"}}},"next":{
                            "id":"move","type":"self_go_forward","inputs":{"steps":num(10.0)}
                        }
                    }
                }
            }}
        ]);
        let native = kitten4::from_neko(&canonical).unwrap();
        assert!(
            (native["theatre"]["actors"]["nekoc-default-actor"]["rotation"]
                .as_f64()
                .unwrap()
                - (std::f64::consts::FRAC_PI_2 - 0.4))
                .abs()
                < 1e-12
        );
        let graph = &native["theatre"]["actors"]["nekoc-default-actor"]["block_data_json"];
        assert_eq!(
            native_expr(graph, native_socket(graph, "heading", "degrees"), 30.0, 0.0),
            60.0
        );
        assert_eq!(
            native_expr(graph, native_socket(graph, "turn", "degrees"), 30.0, 0.0),
            -30.0
        );
        assert_eq!(
            native_expr(graph, native_socket(graph, "read", "VALUE"), 30.0, 30.0),
            60.0
        );
        assert!(
            !serde_json::to_string(&native)
                .unwrap()
                .contains("_nekocKitten4Angle")
        );
        let imported = kitten4::to_neko(&native).unwrap();
        assert_eq!(kitten4::from_neko(&imported).unwrap(), native);
        fn check_parent(
            block: &Value,
            parent: Option<&str>,
            ids: &mut std::collections::BTreeSet<String>,
        ) {
            let id = block["id"].as_str().unwrap();
            assert!(ids.insert(id.to_owned()), "duplicate {id}");
            assert_eq!(block["parent_id"].as_str(), parent);
            if let Some(next) = block.get("next") {
                check_parent(next, Some(id), ids);
            }
            for key in ["inputs", "statements"] {
                if let Some(children) = block.get(key).and_then(Value::as_object) {
                    for child in children.values() {
                        check_parent(child, Some(id), ids);
                    }
                }
            }
        }
        let mut ids = std::collections::BTreeSet::new();
        for root in imported["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
            .as_array()
            .unwrap()
        {
            check_parent(root, None, &mut ids);
        }
        let mut repeated = native.clone();
        for _ in 0..5 {
            repeated = kitten4::from_neko(&kitten4::to_neko(&repeated).unwrap()).unwrap();
            assert_eq!(repeated, native);
        }
        let mut vm = Engine::new(Program::compile(&imported).unwrap());
        vm.start();
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        let actor = frame
            .sprites
            .iter()
            .find(|s| s.id == "nekoc-default-actor")
            .unwrap();
        assert!((actor.x - 5.0 * 3.0_f64.sqrt()).abs() < 1e-9);
        assert!((actor.y - 5.0).abs() < 1e-9);
        let snapshot = runtime::run_project(&imported, 2).unwrap();
        assert_eq!(
            serde_json::to_value(&snapshot.variables["direction"]).unwrap(),
            json!(60.0)
        );
    }
}

#[test]
fn native_initial_rotation_is_radians_and_native_dynamic_turns_import_correctly() {
    let mut native = fixture();
    native["theatre"]["actors"]["nekoc-pen-actor"]["rotation"] = json!(0.0);
    native["variables"] = json!({"angle":{"id":"angle","name":"angle","type":"any","value":90},"direction":{"id":"direction","name":"direction","type":"any","value":0}});
    *workspace(&mut native) = json!({"blocks":{
        "hat":{"id":"hat","type":"start_on_click"},
        "right":{"id":"right","type":"self_go_forward"},"ten":{"id":"ten","type":"math_number","fields":{"NUM":10}},
        "turn":{"id":"turn","type":"self_rotate"},"angle":{"id":"angle","type":"variables_get","fields":{"VAR":"angle"}},
        "up":{"id":"up","type":"self_go_forward"},"five":{"id":"five","type":"math_number","fields":{"NUM":5}},
        "set":{"id":"set","type":"variables_set","fields":{"VAR":"direction"}},"get":{"id":"get","type":"get_2","fields":{"sprite":"__self","attribute":"3"}}
    },"connections":{
        "hat":{"right":{"type":"next"}},"right":{"ten":{"type":"input","input_name":"steps","input_type":"value"},"turn":{"type":"next"}},
        "turn":{"angle":{"type":"input","input_name":"degrees","input_type":"value"},"up":{"type":"next"}},
        "up":{"five":{"type":"input","input_name":"steps","input_type":"value"},"set":{"type":"next"}},
        "set":{"get":{"type":"input","input_name":"VALUE","input_type":"value"}}
    },"comments":{}});
    let mut canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(
        canonical["actors"]["actorsDict"]["nekoc-pen-actor"]["rotation"],
        std::f64::consts::FRAC_PI_2
    );
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    let actor = frame
        .sprites
        .iter()
        .find(|s| s.id == "nekoc-pen-actor")
        .unwrap();
    assert!((actor.x - 10.0).abs() < 1e-9);
    assert!((actor.y - 5.0).abs() < 1e-9);
    let reference = runtime::run_project(&canonical, 2).unwrap();
    let reference_actor = &reference.actors["nekoc-pen-actor"];
    assert!((reference_actor.x - actor.x).abs() < 1e-9);
    assert!((reference_actor.y - actor.y).abs() < 1e-9);
    // Frames carry the drawn angle; a Kitten 4 costume is unrotated at heading 90.
    assert!((reference_actor.rotation - 90.0 - actor.direction).abs() < 1e-9);
    canonical["variables"]["variablesDict"]["angle"]["value"] = json!(45);
    let edited = kitten4::from_neko(&canonical).unwrap();
    assert_eq!(edited["theatre"], native["theatre"]);
    assert_eq!(edited["variables"]["angle"]["value"], 45);
}

#[test]
fn stage_types_are_exact_and_legacy_dimensions_only_survive_unchanged() {
    for (width, height) in [(620, 900), (960, 720), (1280, 720)] {
        let mut canonical = canonical_blank();
        canonical["stageSize"] = json!({"width":width,"height":height});
        let native = kitten4::from_neko(&canonical).unwrap();
        assert_eq!(native["type"], 1);
        assert_eq!(native["size"], canonical["stageSize"]);
    }
    let mut canonical = canonical_blank();
    canonical["stageSize"] = json!({"width":640,"height":360});
    assert!(
        kitten4::from_neko(&canonical)
            .unwrap_err()
            .to_string()
            .contains("unsupported Kitten 4 stage size")
    );
    let mut native = fixture();
    native["size"] = json!({"width":777,"height":555});
    native["type"] = json!(2);
    let mut canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    canonical["stageSize"] = json!({"width":888,"height":555});
    assert!(kitten4::from_neko(&canonical).is_err());
    canonical["stageSize"] = json!({"width":1280,"height":720});
    let exported = kitten4::from_neko(&canonical).unwrap();
    assert_eq!(exported["type"], 2); // Preserve the imported file-type metadata.
}

#[test]
fn stamp_rotation_is_not_silently_treated_as_compatible() {
    let mut native = fixture();
    workspace(&mut native)["blocks"]["stamp"] =
        json!({"id":"stamp","type":"stamp","fields":{"align":"right"}});
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    assert!(
        canonical["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["type"] == "kitten4::stamp")
    );
    let mut canonical = canonical_blank();
    canonical["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] =
        json!([{"type":"stamp"}]);
    assert!(
        format!("{:#}", kitten4::from_neko(&canonical).unwrap_err())
            .contains("unsupported new KN block stamp")
    );
}

#[test]
fn native_orientation_reporter_normalizes_and_rounds_degrees() {
    for (radians, expected) in [
        (1.0, 57.3),
        (4.0, -130.82),
        (-4.0, 130.82),
        (std::f64::consts::PI, 180.0),
    ] {
        let mut native = fixture();
        native["theatre"]["actors"]["nekoc-pen-actor"]["rotation"] = json!(radians);
        native["variables"] =
            json!({"direction":{"id":"direction","name":"direction","type":"any","value":0}});
        *workspace(&mut native) = json!({"blocks":{
            "hat":{"id":"hat","type":"start_on_click"},
            "set":{"id":"set","type":"variables_set","fields":{"VAR":"direction"}},
            "get":{"id":"get","type":"get_2","fields":{"sprite":"__self","attribute":"3"}}
        },"connections":{"hat":{"set":{"type":"next"}},"set":{"get":{"type":"input","input_name":"VALUE","input_type":"value"}}},"comments":{}});
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut vm = Engine::new(Program::compile(&canonical).unwrap());
        vm.start();
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert!(
            (frame.variables[0] - expected).abs() < 1e-10,
            "radians={radians}, got {}",
            frame.variables[0]
        );
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    }
}

#[test]
fn editing_converted_heading_updates_native_input_without_growing_the_graph() {
    let mut native = fixture();
    *workspace(&mut native) = json!({"blocks":{
        "hat":{"id":"hat","type":"start_on_click"},
        "heading":{"id":"heading","type":"self_point_towards"},
        "angle":{"id":"angle","type":"controller_shadow","fields":{"NUM":"30"},"extension":"preserve"}
    },"connections":{"hat":{"heading":{"type":"next"}},"heading":{"angle":{"type":"input","input_type":"value","input_name":"degrees"}}},"comments":{}});
    let mut canonical = kitten4::to_neko(&native).unwrap();
    let angle = &mut canonical["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"][0]["next"]
        ["inputs"]["degrees"]["inputs"]["B"];
    assert_eq!(angle["id"], "angle");
    angle["fields"]["NUM"] = json!(60);
    let edited = kitten4::from_neko(&canonical).unwrap();
    let mut expected = native;
    workspace(&mut expected)["blocks"]["angle"]["fields"]["NUM"] = json!(60);
    assert_eq!(edited, expected);
    let mut repeated = edited.clone();
    for _ in 0..5 {
        repeated = kitten4::from_neko(&kitten4::to_neko(&repeated).unwrap()).unwrap();
        assert_eq!(repeated, edited);
    }
}

#[test]
fn published_work_runs_from_compile_result() {
    let number = |n: &str| json!({"kind":"domain_block","type":"math_number","id":n,"params":{"NUM":n},"child_block":[]});
    let mut native = fixture();
    let actor = "nekoc-pen-actor";
    native["theatre"]["actors"][actor]
        .as_object_mut()
        .unwrap()
        .remove("block_data_json");
    for scene in native["theatre"]["scenes"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        scene.as_object_mut().unwrap().remove("block_data_json");
    }
    let parameter = json!({"kind":"procedures_2_parameter","type":"procedures_2_parameter","id":"p","params":{"param_name":"步长"},"child_block":[]});
    native["compile_result"] = json!([{
        "id": actor,
        "procedures": {"走": {
            "kind":"procedures_2_defnoreturn","type":"procedures_2_defnoreturn","id":"def",
            "params":{"步长":"x"},"procedure_name":"走",
            "child_block":[{"kind":"domain_block","type":"self_move_to","id":"move",
                "params":{"x":parameter,"y":number("7")},"child_block":[]}]
        }},
        "compiled_block_map": {"hat": {
            "kind":"domain_block","type":"start_on_click","id":"hat","params":{},"child_block":[],
            "next_block":{"kind":"controls_if","type":"controls_if","id":"if","params":{},
                "conditions":[{"kind":"domain_block","type":"logic_compare","id":"c",
                    "params":{"A":number("1"),"B":number("2"),"OP":"EQ"},"child_block":[]}],
                "child_block":[null,{"kind":"procedures_2_callnoreturn","type":"procedures_2_callnoreturn",
                    "id":"call","procedure_name":"走","params":{"步长":number("5")},"child_block":[]}]}
        }}
    }]);
    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 2).unwrap();
    assert_eq!(
        (snapshot.actors[actor].x, snapshot.actors[actor].y),
        (5.0, 7.0)
    );
    let program = Program::compile(&canonical).unwrap();
    let mut engine = Engine::new(program);
    engine.start();
    engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}

fn published_fixture() -> Value {
    let mut native = fixture();
    native["theatre"]["actors"]["nekoc-pen-actor"]
        .as_object_mut()
        .unwrap()
        .remove("block_data_json");
    for scene in native["theatre"]["scenes"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        scene.as_object_mut().unwrap().remove("block_data_json");
    }
    native["compile_result"] = json!([]);
    native
}

#[test]
fn published_work_survives_browser_number_round_trip() {
    let native = published_fixture();
    let canonical = kitten4::to_neko(&native).unwrap();
    // JavaScript serializes 100.0 as 100, so a float can come back as an integer.
    let mut echoed = canonical.clone();
    echoed["actors"]["actorsDict"]["nekoc-pen-actor"]["scale"] = json!(100.0);
    let text = serde_json::to_string(&echoed).unwrap().replace(".0,", ",");
    let echoed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(kitten4::from_neko(&echoed).unwrap(), native);
}

#[test]
fn costume_is_drawn_unrotated_at_the_native_zero_heading() {
    let canonical = kitten4::to_neko(&published_fixture()).unwrap();
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    let frame = engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    let actor = frame
        .sprites
        .iter()
        .find(|a| a.id == "nekoc-pen-actor")
        .unwrap();
    assert!(actor.direction.abs() < 1e-9, "{}", actor.direction);
}

#[test]
fn accepts_version_24_works() {
    let mut native = fixture();
    native["version"] = json!(24);
    assert!(kitten4::to_neko(&native).is_ok());
}

#[test]
fn published_work_refuses_to_export_edits() {
    let mut native = fixture();
    native["theatre"]["actors"]["nekoc-pen-actor"]
        .as_object_mut()
        .unwrap()
        .remove("block_data_json");
    for scene in native["theatre"]["scenes"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        scene.as_object_mut().unwrap().remove("block_data_json");
    }
    native["compile_result"] = json!([]);
    let mut canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    canonical["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"] =
        json!([{"id":"new","type":"start_on_click"}]);
    assert!(kitten4::from_neko(&canonical).is_err());
}

#[test]
fn lowering_rewrites_only_the_vm_copy() {
    let mut native = fixture();
    let actor = "nekoc-pen-actor";
    native["theatre"]["actors"][actor]
        .as_object_mut()
        .unwrap()
        .remove("block_data_json");
    for scene in native["theatre"]["scenes"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        scene.as_object_mut().unwrap().remove("block_data_json");
    }
    let bump = json!({"kind":"domain_block","type":"bump","id":"b",
        "params":{"sprite1":"__self","sprite2":"deleted-actor"},"child_block":[]});
    native["compile_result"] = json!([{"id": actor, "procedures": {}, "compiled_block_map": {
        "w": {"kind":"event_block","type":"when","id":"w","params":{"condition":bump},
            "child_block":[{"kind":"domain_block","type":"self_prev_next_style","id":"n",
                "params":{"prev_or_next":"next"},"child_block":[]}]}
    }}]);
    let canonical = kitten4::to_neko(&native).unwrap();
    assert!(canonical.to_string().contains("kitten4::bump"));
    let lowered = kitten4::lower_for_vm(&canonical);
    let script = &lowered["actors"]["actorsDict"][actor]["nekoBlockJsonList"][0];
    assert_eq!(script["type"], "on_running_group_activated");
    assert_eq!(script["next"]["type"], "repeat_forever");
    let trigger = &script["next"]["statements"]["DO"];
    assert_eq!(trigger["inputs"]["condition"]["type"], "math_number");
    assert_eq!(trigger["next"]["fields"]["prev_next"], "next");
    Program::compile(&canonical).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}
