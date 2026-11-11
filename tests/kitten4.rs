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

#[test]
fn initial_rotation_policy_is_imported_and_roundtrips() {
    let mut native = fixture();
    native["theatre"]["actors"]["nekoc-pen-actor"]["rotation_type"] = json!(2);
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(
        canonical["actors"]["actorsDict"]["nekoc-pen-actor"]["rotationType"],
        2
    );
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 2_000_000, Duration::from_secs(5))
        .unwrap();
    assert_eq!(
        frame
            .sprites
            .iter()
            .find(|a| a.id == "nekoc-pen-actor")
            .unwrap()
            .rotation_type,
        2
    );
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}

#[test]
fn rotate_center_is_an_unscaled_image_centre_offset_without_axis_conversion() {
    let mut native = fixture();
    let styles = native["theatre"]["styles"].as_object_mut().unwrap();
    let (id, style) = styles.iter_mut().next().unwrap();
    let id = id.clone();
    style["rotate_center"] = json!({"x":17,"y":-9});
    style["width"] = json!(40);
    style["height"] = json!(24);
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(
        canonical["styles"]["stylesDict"][&id]["centerPoint"],
        json!({"x":17,"y":-9})
    );
    let program = Program::compile(&canonical).unwrap();
    assert_eq!(program.costume_turn, 90.0);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
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
        assert_eq!(vm.variable_text("direction"), "60");
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

// Synthetic compile_result fixtures only: never embed downloaded corpus works.
#[test]
fn published_speech_is_an_explicit_headless_nonblocking_command() {
    for kind in ["play_words_audio", "play_words_audio_wait"] {
        let native = published_script(vec![
            compiled(
                kind,
                json!({"physics_body_type":"not_attend_physics_world","text":"hello"}),
            ),
            compiled_set("after", compiled_number(1.0)),
        ]);
        assert!(kitten4::coverage(&native, 1)["stubbed"].get(kind).is_none());
        assert_eq!(start_published(&native).variable_text("after"), "1");
    }
}

#[test]
fn fourth_round_calculate_clear_effects_and_camera_keep_native_source() {
    for jit in [false, true] {
        let mut native = published_script(vec![
            compiled(
                "self_set_effect_2",
                json!({"scope":"1","val":compiled_number(75.0)}),
            ),
            compiled(
                "self_set_effect_2",
                json!({"scope":"0","val":compiled_number(40.0)}),
            ),
            compiled("self_clear_effects", json!({})),
            compiled_set(
                "ghost",
                compiled("get_3", json!({"sprite":"__self","attribute":"8"})),
            ),
            compiled_set(
                "hue",
                compiled("get_3", json!({"sprite":"__self","attribute":"7"})),
            ),
            compiled_set(
                "light",
                compiled("get_3", json!({"sprite":"__self","attribute":"9"})),
            ),
            compiled("set_camera_status", json!({"status":"true"})),
            compiled("set_camera_status", json!({"status":"false"})),
            compiled_set(
                "math",
                compiled(
                    "calculate",
                    json!({"input":compiled("text",json!({"TEXT":"sin(30)+2^3^2"}))}),
                ),
            ),
            compiled_set("after", compiled_number(1.0)),
        ]);
        native["theatre"]["actors"]["nekoc-pen-actor"]["visible"] = json!(true);
        let canonical = kitten4::to_neko(&native).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
        let mut e = Engine::new(Program::compile(&canonical).unwrap());
        if !jit {
            e.disable_jit();
        }
        e.start();
        e.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        for (key, value) in [
            ("ghost", "0"),
            ("hue", "0"),
            ("light", "100"),
            ("math", "64.5"),
            ("after", "1"),
        ] {
            assert_eq!(e.variable_text(key), value, "{key}");
        }
        let report = kitten4::coverage(&native, 1);
        assert_eq!(report["stage"], "ran");
        assert_eq!(report["stubbed"]["set_camera_status"], 2);
    }
}

#[test]
fn fourth_round_bad_calculate_stops_before_the_next_statement() {
    for input in [
        compiled("text", json!({"TEXT":"1+"})),
        compiled_number(12.0),
    ] {
        let native = published_script(vec![
            compiled_set("math", compiled("calculate", json!({"input":input}))),
            compiled_set("after", compiled_number(1.0)),
        ]);
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut e = Engine::new(Program::compile(&canonical).unwrap());
        e.start();
        let error = e
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap_err();
        assert!(
            error.to_string().contains("block_bad_math_expression"),
            "{error}"
        );
        assert_eq!(e.variable_text("after"), "0");
    }
}

#[test]
fn fourth_round_whole_number_property_accepts_translated_integer_menu() {
    for (n, expected) in [(2.0, "true"), (2.5, "false"), (-3.0, "true")] {
        let native = published_script(vec![compiled_set(
            "whole",
            compiled(
                "math_number_property",
                json!({"PROPERTY":"WHOLE","NUMBER_TO_CHECK":compiled_number(n)}),
            ),
        )]);
        assert_eq!(start_published(&native).variable_text("whole"), expected);
    }
}

#[test]
fn fourth_round_legacy_physics_published_ast_and_disconnected_missing_target_hats() {
    let mut native = published_script(vec![
        compiled(
            "self_set_friction",
            json!({"friction":compiled("text",json!({"TEXT":"0.7"}))}),
        ),
        compiled(
            "self_set_restitution",
            json!({"restitution":compiled_number(0.6)}),
        ),
        compiled(
            "self_set_boundary",
            json!({"physics_bound_type":"all_bounds"}),
        ),
        compiled("self_enable_physics", json!({})),
        compiled_set(
            "friction",
            compiled(
                "get_physics_property",
                json!({"sprite":"__self","attribute":"friction"}),
            ),
        ),
        compiled_set(
            "bounce",
            compiled(
                "get_physics_property",
                json!({"sprite":"__self","attribute":"restitution"}),
            ),
        ),
        compiled(
            "set_velocity",
            json!({"value":compiled_number(2.0),"dir":compiled_number(0.0)}),
        ),
        compiled_set("after", compiled_number(1.0)),
    ]);
    native["compile_result"][0]["compiled_block_map"]["missing"] = json!({"id":"missing","type":"sprite_on_tap","kind":"responder_block","params":{"actor":"deleted","type":"mouse_click"},"child_block":[]});
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let mut e = Engine::new(Program::compile(&canonical).unwrap());
    e.start();
    e.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(e.variable_text("after"), "1");
    assert_eq!(e.variable_text("friction"), "0.7");
    assert_eq!(e.variable_text("bounce"), "0.6");
    assert_eq!(kitten4::coverage(&native, 60)["stage"], "ran");
}

#[test]
fn published_offline_voice_and_player_wood_stubs_continue_and_keep_return_types() {
    for jit in [false, true] {
        let native = published_script(vec![
            compiled("enable_voice_detection", json!({"state":"open"})),
            compiled_set("volume", compiled("get_voice_volume", json!({}))),
            compiled("enable_voice_detection", json!({"state":"close"})),
            compiled(
                "wood_block_set",
                json!({"NAME":"save","VAR0":compiled_number(7.0)}),
            ),
            compiled_set("wood", compiled("wood_block_get", json!({"NAME":"load"}))),
            compiled_set("after", compiled_number(1.0)),
        ]);
        let canonical = kitten4::to_neko(&native).unwrap();
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
        let report = kitten4::coverage(&native, 1);
        assert_eq!(report["stage"], "ran", "{report}");
        for kind in [
            "enable_voice_detection",
            "get_voice_volume",
            "wood_block_set",
            "wood_block_get",
        ] {
            assert!(report["stubbed"].get(kind).is_some(), "{kind}: {report}");
        }
        let mut e = Engine::new(Program::compile(&canonical).unwrap());
        if !jit {
            e.disable_jit();
        }
        e.start();
        e.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(e.variable_text("volume"), "0");
        assert_eq!(e.variable_text("wood"), "NaN");
        assert_eq!(e.variable_text("after"), "1");
    }
}

#[test]
fn workspace_voice_wood_and_legacy_velocity_roundtrip_without_rewriting_source() {
    let mut native = fixture();
    *workspace(&mut native) = json!({"blocks":{
        "hat":{"id":"hat","type":"start_on_click"},
        "open":{"id":"open","type":"enable_voice_detection","fields":{"state":"open"}},
        "wood":{"id":"wood","type":"wood_block_set","fields":{"NAME":"save"},"mutation":"<mutation items=\"0\"></mutation>"},
        "velocity":{"id":"velocity","type":"set_velocity"},
        "value":{"id":"value","type":"math_number","fields":{"NUM":99}},
        "dir":{"id":"dir","type":"controller_shadow","fields":{"NUM":90}}
    },"connections":{
        "hat":{"open":{"type":"next"}},"open":{"wood":{"type":"next"}},
        "wood":{"velocity":{"type":"next"}},"velocity":{
            "value":{"type":"input","input_type":"value","input_name":"value"},
            "dir":{"type":"input","input_type":"value","input_name":"dir"}}
    }});
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let report = kitten4::coverage(&native, 1);
    assert_eq!(report["stage"], "ran", "{report}");
    assert_eq!(report["stubbed"]["enable_voice_detection"], 1);
    assert_eq!(report["stubbed"]["wood_block_set"], 1);
    assert!(report["stubbed"].get("set_velocity").is_none());
}

#[test]
fn published_legacy_velocity_uses_existing_body_and_strict_finite_numbers() {
    for jit in [false, true] {
        for (value, dir, expected_speed, expected_dir) in [
            (compiled_number(99.0), compiled_number(0.0), "99", "0"),
            (compiled_number(-2.0), compiled_number(90.0), "2", "-90"),
            (compiled_number(20000.0), compiled_number(0.0), "10000", "0"),
            (
                compiled_number(-20000.0),
                compiled_number(0.0),
                "10000",
                "-180",
            ),
            (
                compiled("text", json!({"TEXT":"99"})),
                compiled_number(0.0),
                "1",
                "0",
            ),
            (
                compiled_number(99.0),
                compiled("text", json!({"TEXT":"90"})),
                "1",
                "0",
            ),
            (
                compiled("math_number", json!({"NUM":"NaN"})),
                compiled_number(0.0),
                "1",
                "0",
            ),
            (
                compiled("math_number", json!({"NUM":"Infinity"})),
                compiled_number(0.0),
                "1",
                "0",
            ),
            (
                compiled_number(99.0),
                compiled("math_number", json!({"NUM":"Infinity"})),
                "1",
                "0",
            ),
        ] {
            let native = published_script(vec![
                // A physics2 command deliberately creates the existing body.
                compiled(
                    "physics2_set_speed",
                    json!({"value":compiled_number(1.0),"dir":compiled_number(0.0)}),
                ),
                compiled("set_velocity", json!({"value":value,"dir":dir})),
                compiled_set(
                    "speed",
                    compiled("physics2_get_property", json!({"property":"speed"})),
                ),
                compiled_set(
                    "dir",
                    compiled("physics2_get_property", json!({"property":"speed_dir"})),
                ),
                compiled_set("after", compiled_number(1.0)),
            ]);
            let canonical = kitten4::to_neko(&native).unwrap();
            assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
            let mut e = Engine::new(Program::compile(&canonical).unwrap());
            if !jit {
                e.disable_jit();
            }
            e.start();
            e.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(e.variable_text("speed"), expected_speed);
            assert_eq!(e.variable_text("dir"), expected_dir);
            assert_eq!(e.variable_text("after"), "1");
        }
        let native = published_script(vec![
            compiled(
                "set_velocity",
                json!({"value":compiled_number(99.0),"dir":compiled_number(0.0)}),
            ),
            compiled_set(
                "speed",
                compiled("physics2_get_property", json!({"property":"speed"})),
            ),
        ]);
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut e = Engine::new(Program::compile(&canonical).unwrap());
        if !jit {
            e.disable_jit();
        }
        e.start();
        e.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert_eq!(
            e.variable_text("speed"),
            "0",
            "legacy setter must not create a body"
        );
    }
}

#[test]
fn published_audio_property_changes_emit_ordered_nonblocking_commands() {
    let native = published_script(vec![
        compiled(
            "set_volume_or_rate_2",
            json!({"audio":compiled("get_whole_audios",json!({"sound_id":"all"})),"audio_key":"volume","audio_value":compiled_number(50.0)}),
        ),
        compiled(
            "change_volume_or_rate_2",
            json!({"audio":compiled("get_audios",json!({"sound_id":"sound"})),"audio_key":"rate","increase":"decrease","audio_value":compiled_number(25.0)}),
        ),
        compiled_set("after", compiled_number(1.0)),
    ]);
    let canonical = kitten4::to_neko(&native).unwrap();
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    let frame = engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(engine.variable_text("after"), "1");
    assert_eq!(frame.audio_commands.len(), 2);
    let set = frame.audio_commands[0].property.as_ref().unwrap();
    assert!(!set.rate && !set.change);
    assert_eq!(set.value, 0.5);
    let change = frame.audio_commands[1].property.as_ref().unwrap();
    assert!(change.rate && change.change);
    assert_eq!(change.value, -0.25);
}

#[test]
fn published_audio_properties_do_not_coerce_text_or_boolean_values() {
    for value in [
        compiled("text", json!({"TEXT":"50"})),
        compiled("logic_boolean", json!({"BOOL":"TRUE"})),
    ] {
        let native = published_script(vec![compiled(
            "change_volume_or_rate_2",
            json!({"audio":compiled("get_whole_audios",json!({"sound_id":"all"})),"audio_key":"volume","audio_value":value}),
        )]);
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        assert!(
            engine
                .advance(0.02, 100_000, Duration::from_secs(1))
                .unwrap()
                .audio_commands
                .is_empty()
        );
    }
}

#[test]
fn published_swipe_and_terminate_stop_later_events() {
    let mut native = published_script(vec![]);
    native["compile_result"][0]["compiled_block_map"] = json!({
        "swipe":{"id":"swipe","type":"on_swipe","params":{"type":"up"},
            "child_block":[compiled_set("hit",compiled_number(1.0))]},
        "stop":{"id":"stop","type":"on_swipe","params":{"type":"down"},
            "child_block":[{"type":"terminate","params":{},"child_block":[],
                "next_block":compiled_set("after",compiled_number(1.0))}]}
    });
    let mut engine = start_published(&native);
    engine.swipe("left");
    engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(engine.variable_text("hit"), "0");
    engine.swipe("down");
    engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap();
    engine.swipe("up");
    engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(engine.variable_text("hit"), "0");
    assert_eq!(engine.variable_text("after"), "0");
    engine.start();
    engine.swipe("up");
    engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(engine.variable_text("hit"), "1");
}

#[test]
fn published_scene_backdrop_hat_runs_on_activation_not_costume_change() {
    let mut native = published_script(vec![]);
    let scene = native["theatre"]["scenes_order"][0]
        .as_str()
        .unwrap()
        .to_owned();
    native["compile_result"].as_array_mut().unwrap().push(
        json!({"id":scene,"procedures":{},"compiled_block_map":{
            "backdrop":{"id":"backdrop","type":"backdrop_on_change","params":{"sprite":scene},
                "child_block":[compiled_set("activated",compiled_number(7.0))]}
        }}),
    );
    assert_eq!(start_published(&native).variable_text("activated"), "7");
}

#[test]
fn published_backdrop_hat_dispatches_the_selected_scene_after_switching() {
    let mut native = published_script(vec![
        compiled("wait", json!({"time":compiled_number(0.0)})),
        compiled("switch_to_screen", json!({"screen":compiled_number(2.0)})),
    ]);
    let first = native["theatre"]["scenes_order"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let mut second = native["theatre"]["scenes"][&first].clone();
    second["id"] = json!("second-scene");
    second["actors"] = json!([]);
    second["group_order"] = json!([]);
    native["theatre"]["scenes"]["second-scene"] = second;
    native["theatre"]["scenes_order"] = json!([first, "second-scene"]);
    for (scene, variable) in [(&*first, "first"), ("second-scene", "second")] {
        native["compile_result"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id":scene,"procedures":{},"compiled_block_map":{
                    "hat":{"id":"hat","type":"backdrop_on_change","params":{"sprite":scene},
                        "child_block":[compiled_set(variable,compiled_number(1.0))]}
                }
            }));
    }
    let mut engine = start_published(&native);
    assert_eq!(engine.variable_text("first"), "1");
    assert_eq!(engine.variable_text("second"), "0");
    for _ in 0..3 {
        engine
            .advance(0.02, 100_000, Duration::from_secs(1))
            .unwrap();
    }
    assert_eq!(engine.variable_text("first"), "1");
    assert_eq!(engine.variable_text("second"), "1");
}

#[test]
fn published_flip_keeps_absolute_reported_size_and_survives_scale_reset() {
    for (axis, sx, sy) in [("0", -100.0, 100.0), ("1", 100.0, -100.0)] {
        let native = published_script(vec![
            compiled("self_flip", json!({"options":axis})),
            compiled("set_scale", json!({"scale":compiled_number(80.0)})),
            compiled_set(
                "width",
                compiled("get_3", json!({"sprite":"__self","attribute":"16"})),
            ),
            compiled("image_stamp", json!({})),
        ]);
        let engine = start_published(&native);
        assert_eq!(engine.variable_text("width"), "80");
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        let frame = engine
            .advance(0.02, 100_000, Duration::from_secs(1))
            .unwrap();
        let actor = frame
            .sprites
            .iter()
            .find(|a| a.id == "nekoc-pen-actor")
            .unwrap();
        assert_eq!((actor.size_x, actor.size_y), (sx, sy));
        assert_eq!(actor.scale, 80.0);
        assert_eq!(
            (frame.image_stamps[0].size_x, frame.image_stamps[0].size_y),
            (sx, sy)
        );
    }
}

#[test]
fn published_color_collision_maps_self_and_missing_group_to_boolean() {
    for target in ["__self", "deleted-actor"] {
        let native = published_script(vec![compiled_set(
            "touch",
            compiled(
                "bump_into_color",
                json!({"sprite":target,"color":"#abcdef"}),
            ),
        )]);
        assert!(matches!(
            start_published(&native).variable_text("touch").as_str(),
            "0" | "false"
        ));
    }
}

#[test]
fn published_color_collision_expands_groups_in_the_vm_copy_only() {
    let mut native = published_script(vec![compiled_set(
        "touch",
        compiled(
            "bump_into_color",
            json!({"sprite":"color-group","color":"#abcdef"}),
        ),
    )]);
    native["theatre"]["groups"]["color-group"] =
        json!({"id":"color-group","actors":["nekoc-pen-actor","deleted"]});
    let canonical = kitten4::to_neko(&native).unwrap();
    let lowered = kitten4::lower_for_vm(&canonical);
    let root = &lowered["actors"]["actorsDict"]["nekoc-pen-actor"]["nekoBlockJsonList"][0];
    assert_eq!(root["next"]["inputs"]["value"]["type"], "bump_into_color");
    assert_eq!(
        root["next"]["inputs"]["value"]["fields"]["sprite"],
        "nekoc-pen-actor"
    );
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
}

#[test]
fn published_costume_indices_wrap_names_trim_and_missing_names_preserve_style() {
    let mut native = published_script(vec![]);
    let actor = "nekoc-pen-actor";
    native["theatre"]["actors"][actor]["styles"] = json!(["one", "two"]);
    native["theatre"]["actors"][actor]["current_style_id"] = json!("one");
    native["theatre"]["styles"]["one"] =
        json!({"id":"one","name":"First","url":"","width":20,"height":20});
    native["theatre"]["styles"]["two"] =
        json!({"id":"two","name":"Second","url":"","width":20,"height":20});
    for (value, expected) in [
        (json!(0), "2"),
        (json!(3), "1"),
        (json!(1.5), "2"),
        (json!(" Second "), "2"),
        (json!("missing"), "1"),
    ] {
        let index = if value.is_string() {
            compiled("text", json!({"TEXT":value}))
        } else {
            compiled("math_number", json!({"NUM":value}))
        };
        let script = published_script(vec![
            compiled("set_costume", json!({"index":index})),
            compiled_set(
                "costume",
                compiled("get_3", json!({"sprite":"__self","attribute":"2"})),
            ),
        ]);
        native["compile_result"] = script["compile_result"].clone();
        assert_eq!(
            start_published(&native).variable_text("costume"),
            expected,
            "{value}"
        );
    }
}

#[test]
fn published_negative_list_index_preserves_nested_list_identity() {
    let split = compiled(
        "text_split",
        json!({"TEXT_TO_SPLIT":compiled("text",json!({"TEXT":"10,20"})),"SPLIT_TEXT":compiled("text",json!({"TEXT":","}))}),
    );
    let last = compiled(
        "lists_get_value",
        json!({"VAR":compiled("lists_get",json!({"VAR":"outer"})),"INDEX":compiled_number(-1.0),"TYPE":"first"}),
    );
    let mut native = published_script(vec![
        compiled(
            "lists_append",
            json!({"VAR":compiled("lists_get",json!({"VAR":"outer"})),"VALUE":split}),
        ),
        compiled(
            "lists_append",
            json!({"VAR":last.clone(),"VALUE":compiled_number(30.0)}),
        ),
        compiled_set(
            "length",
            compiled("lists_length", json!({"VAR":last.clone()})),
        ),
        compiled_set(
            "last",
            compiled(
                "lists_get_value",
                json!({"VAR":last,"INDEX":compiled_number(-1.0),"TYPE":"first"}),
            ),
        ),
    ]);
    native["variables"]["outer"] =
        json!({"id":"outer","name":"outer","type":"list","value":[],"is_global":true});
    let engine = start_published(&native);
    assert_eq!(engine.variable_text("length"), "3");
    assert_eq!(engine.variable_text("last"), "30");
}

#[test]
fn published_real_nonlist_inputs_still_fail_like_official_editor() {
    let native = published_script(vec![compiled(
        "lists_append",
        json!({"VAR":compiled_number(123.0),"VALUE":compiled_number(7.0)}),
    )]);
    let canonical = kitten4::to_neko(&native).unwrap();
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    let error = engine
        .advance(0.02, 100_000, Duration::from_secs(1))
        .unwrap_err();
    assert!(error.to_string().contains("non-list value"), "{error}");
}

#[test]
fn published_list_read_rejects_zero_fractional_and_out_of_range_indices() {
    for index in [0.0, 1.5, 4.0, -4.0] {
        let native = published_script(vec![compiled_set(
            "value",
            compiled(
                "lists_get_value",
                json!({
                    "VAR":compiled("text_split",json!({"TEXT_TO_SPLIT":compiled("text",json!({"TEXT":"a,b,c"})),"SPLIT_TEXT":compiled("text",json!({"TEXT":","}))})),
                    "INDEX":compiled_number(index),"TYPE":"first"
                }),
            ),
        )]);
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        let error = engine
            .advance(0.02, 100_000, Duration::from_secs(1))
            .unwrap_err();
        assert!(
            error.to_string().contains("lists_get_value_bad_index"),
            "{index}: {error}"
        );
    }
}

#[test]
fn published_cloud_list_reads_have_their_own_empty_and_truncation_semantics() {
    for (index, expected) in [
        (4.0, ""),
        (0.0, ""),
        (-1.0, ""),
        (1.9, "a"),
        (0.5, "a"),
        (2.0, "b"),
    ] {
        let mut blocks = vec![];
        for text in ["a", "b", "c"] {
            blocks.push(compiled(
                "cloud_lists_append",
                json!({"VAR":"cloud-items","POS":"last","VALUE":compiled("text",json!({"TEXT":text}))}),
            ));
        }
        blocks.push(compiled_set(
            "value",
            compiled(
                "cloud_lists_get_value",
                json!({
                    "VAR":"cloud-items","INDEX":compiled_number(index),"TYPE":"nth"
                }),
            ),
        ));
        let mut native = published_script(blocks);
        native["cloud_variables"]["cloud-items"] =
            json!({"id":"cloud-items","name":"cloud-items","type":"public_list"});
        assert_eq!(
            start_published(&native).variable_text("value"),
            expected,
            "{index}"
        );
    }
}

#[test]
fn published_list_mutations_use_js_splice_negative_and_fractional_indices() {
    for (kind, index, expected) in [
        ("lists_delete", -1.0, vec![10.0, 20.0]),
        ("lists_delete", 0.0, vec![10.0, 20.0, 30.0]),
        ("lists_delete", 1.5, vec![20.0, 30.0]),
        ("lists_insert_value", -1.5, vec![10.0, 20.0, 30.0, 99.0]),
        ("lists_insert_value", -2.0, vec![10.0, 20.0, 99.0, 30.0]),
        ("lists_replace", -99.0, vec![99.0, 20.0, 30.0]),
        ("lists_replace", 99.0, vec![10.0, 20.0, 30.0, 99.0]),
    ] {
        let mut native = published_script(vec![compiled(
            kind,
            json!({
                "VAR":compiled("lists_get",json!({"VAR":"items"})),"INDEX":compiled_number(index),
                "VALUE":compiled_number(99.0),"TYPE":"first"
            }),
        )]);
        native["variables"]["items"] =
            json!({"id":"items","name":"items","type":"list","value":[10,20,30],"is_global":true});
        assert_eq!(
            start_published(&native).numeric_lists()[0],
            expected,
            "{kind} {index}"
        );
    }
}

fn compiled(kind: &str, params: Value) -> Value {
    json!({"type":kind,"params":params,"child_block":[]})
}

fn compiled_number(n: f64) -> Value {
    compiled("math_number", json!({"NUM":n}))
}

fn published_script(blocks: Vec<Value>) -> Value {
    let mut native = published_fixture();
    let mut next = Value::Null;
    for mut block in blocks.into_iter().rev() {
        block["next_block"] = next;
        next = block;
    }
    native["compile_result"] = json!([{"id":"nekoc-pen-actor","procedures":{},
        "compiled_block_map":{"hat":{"id":"hat","type":"start_on_click","params":{},
            "child_block":[],"next_block":next}}}]);
    native
}

fn compiled_set(id: &str, value: Value) -> Value {
    compiled("variables_set", json!({"VAR":id,"VALUE":value}))
}

fn start_published(native: &Value) -> Engine {
    let canonical = kitten4::to_neko(native).unwrap();
    let original = canonical.clone();
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(canonical, original);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *native);
    engine
}

#[test]
fn published_conversions_preserve_types_and_official_number_fallback() {
    for (target, input, expected) in [
        ("number", json!("123.5"), json!(123.5)),
        ("number", json!("hello"), json!("hello")),
        ("number", json!("0xff"), json!(255.0)),
        ("number", json!("0b101"), json!(5.0)),
        ("number", json!("0o17"), json!(15.0)),
        ("number", json!(""), json!(0.0)),
        ("number", json!("NaN"), Value::Null),
        ("string", json!(123.0), json!("123")),
        ("boolean", json!("false"), json!(true)),
        ("boolean", json!(""), json!(false)),
        ("boolean", json!(0.0), json!(false)),
        ("boolean", json!(2.0), json!(true)),
    ] {
        let input = if input.is_string() {
            compiled("text", json!({"TEXT":input}))
        } else {
            compiled("math_number", json!({"NUM":input}))
        };
        let native = published_script(vec![compiled_set(
            "result",
            compiled(
                "convert_type",
                json!({"type":target,"original_value":input}),
            ),
        )]);
        let engine = start_published(&native);
        let text = if expected.is_string() {
            expected.as_str().unwrap().to_owned()
        } else if expected.is_null() {
            "NaN".into()
        } else {
            expected.to_string().trim_end_matches(".0").to_owned()
        };
        assert_eq!(engine.variable_text("result"), text, "{target}: {expected}");
    }
}

#[test]
fn published_stage_device_empty_logic_and_distance_reporters() {
    let mut blocks = vec![];
    for (id, kind, params) in [
        ("width", "get_stage_info", json!({"info":"width"})),
        ("height", "get_stage_info", json!({"info":"height"})),
        ("pc", "check_running_device", json!({"device":"computer"})),
        ("phone", "check_running_device", json!({"device":"mobile"})),
        ("tablet", "check_running_device", json!({"device":"tablet"})),
        ("empty", "logic_empty", json!({})),
        ("distance", "self_distance_to", json!({"sprite":"other"})),
        ("mouse", "self_distance_to", json!({"sprite":"__mouse"})),
    ] {
        blocks.push(compiled_set(id, compiled(kind, params)));
    }
    let mut native = published_script(blocks);
    native["theatre"]["actors"]["nekoc-pen-actor"]["x"] = json!(3);
    native["theatre"]["actors"]["nekoc-pen-actor"]["y"] = json!(4);
    native["theatre"]["actors"]["other"] = native["theatre"]["actors"]["nekoc-pen-actor"].clone();
    native["theatre"]["actors"]["other"]["id"] = json!("other");
    native["theatre"]["actors"]["other"]["x"] = json!(6);
    native["theatre"]["actors"]["other"]["y"] = json!(8);
    let scene = native["theatre"]["scenes_order"][0]
        .as_str()
        .unwrap()
        .to_owned();
    native["theatre"]["scenes"][&scene]["actors"]
        .as_array_mut()
        .unwrap()
        .push(json!("other"));
    let engine = start_published(&native);
    for (id, expected) in [
        ("width", "620"),
        ("height", "900"),
        ("pc", "true"),
        ("phone", "false"),
        ("tablet", "false"),
        ("empty", "false"),
        ("distance", "5"),
        // Official mouse data is NaN until a pointer event: Math.hypot(NaN) = NaN.
        ("mouse", "NaN"),
    ] {
        assert_eq!(engine.variable_text(id), expected, "{id}");
    }
}

#[test]
fn published_rotation_modes_and_signed_dynamic_layer_moves() {
    for mode in ["0", "1", "2"] {
        for (steps, expected) in [
            // K4 native scene.actors (unlike KN actorIds) is back to front.
            (2.0, vec!["b", "c", "nekoc-pen-actor"]),
            (-2.0, vec!["nekoc-pen-actor", "b", "c"]),
            (999.0, vec!["b", "c", "nekoc-pen-actor"]),
        ] {
            let mut native = published_script(vec![
                compiled("self_set_rotation_type", json!({"rotation_type":mode})),
                compiled(
                    "self_change_layer",
                    json!({"n":compiled("math_arithmetic",json!({
                    "OP":"ADD","A":compiled_number(steps),"B":compiled_number(0.0)}))}),
                ),
            ]);
            let scene = native["theatre"]["scenes_order"][0]
                .as_str()
                .unwrap()
                .to_owned();
            for id in ["b", "c"] {
                native["theatre"]["actors"][id] =
                    native["theatre"]["actors"]["nekoc-pen-actor"].clone();
                native["theatre"]["actors"][id]["id"] = json!(id);
                native["theatre"]["scenes"][&scene]["actors"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(id));
            }
            let canonical = kitten4::to_neko(&native).unwrap();
            let mut engine = Engine::new(Program::compile(&canonical).unwrap());
            engine.start();
            let frame = engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap();
            assert_eq!(
                frame
                    .sprites
                    .iter()
                    .find(|a| a.id == "nekoc-pen-actor")
                    .unwrap()
                    .rotation_type,
                mode.parse::<u8>().unwrap()
            );
            assert_eq!(frame.order.unwrap(), expected);
            assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
        }
    }
}

#[test]
fn published_get_3_and_clone_properties_keep_costume_names_and_axes() {
    let attributes = [
        ("0", "3"),
        ("1", "4"),
        ("2", "1"),
        ("3", "57.3"),
        ("4", "test costume"),
        ("5", "100"),
        ("7", "0"),
        ("8", "0"),
        ("9", "100"),
        ("10", "0"),
        ("11", "0"),
        ("12", "0"),
        ("13", "0"),
        ("16", "100"),
        ("17", "100"),
    ];
    let mut blocks = vec![];
    for (attribute, _) in attributes {
        blocks.push(compiled_set(
            &format!("a{attribute}"),
            compiled("get_3", json!({"sprite":"__self","attribute":attribute})),
        ));
        blocks.push(compiled_set(
            &format!("c{attribute}"),
            compiled(
                "get_clone_index_property",
                json!({"sprite":"__self","attribute":attribute,"index":compiled_number(0.0)}),
            ),
        ));
    }
    blocks.push(compiled("mirror", json!({"sprite":"__self"})));
    blocks.push(compiled_set(
        "count",
        compiled("get_clone_num", json!({"sprite":"__self"})),
    ));
    blocks.push(compiled_set(
        "clone_x",
        compiled(
            "get_clone_index_property",
            json!({"sprite":"__self","attribute":"0","index":compiled_number(1.0)}),
        ),
    ));
    let mut native = published_script(blocks);
    let actor = &mut native["theatre"]["actors"]["nekoc-pen-actor"];
    actor["x"] = json!(3);
    actor["y"] = json!(4);
    actor["rotation"] = json!(1.0);
    actor["visible"] = json!(true);
    actor["styles"] = json!(["style"]);
    actor["current_style_id"] = json!("style");
    native["theatre"]["styles"]["style"] = json!({"id":"style","name":"test costume"});
    let engine = start_published(&native);
    for (attribute, expected) in attributes {
        assert_eq!(
            engine.variable_text(&format!("a{attribute}")),
            expected,
            "get_3 {attribute}"
        );
        assert_eq!(
            engine.variable_text(&format!("c{attribute}")),
            expected,
            "clone {attribute}"
        );
    }
    assert_eq!(engine.variable_text("count"), "1");
    assert_eq!(engine.variable_text("clone_x"), "3");
}

#[test]
fn published_indexed_and_last_list_items_preserve_text_values() {
    for selector in ["first", "last", "nth", ""] {
        let mut native = published_script(vec![compiled_set(
            "result",
            compiled(
                "lists_get_value",
                json!({
                    "VAR":compiled("lists_get",json!({"VAR":"items"})),"TYPE":selector,"INDEX":compiled_number(1.0)
                }),
            ),
        )]);
        native["variables"]["items"] =
            json!({"id":"items","name":"items","type":"list","value":["first","last"]});
        assert_eq!(
            start_published(&native).variable_text("result"),
            if selector == "last" { "last" } else { "first" }
        );
    }
}

#[test]
fn published_list_and_variable_monitors_show_and_hide() {
    for (kind, cloud, list) in [
        ("show_hide_variable", false, false),
        ("show_hide_list", false, true),
        ("show_hide_cloud_variable", true, false),
        ("show_hide_cloud_list", true, true),
    ] {
        let mut native =
            published_script(vec![compiled(kind, json!({"VAR":"data","FUNC":"show"}))]);
        if cloud {
            native["cloud_variables"] = json!({"data":{"name":"data","type":if list {"public_list"} else {"public_variable"}}});
        } else {
            native["variables"]["data"] = json!({"id":"data","name":"data","type":if list {"list"} else {"any"},"value":if list {json!([])} else {json!(1)}});
        }
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        let frame = engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        assert!(
            frame
                .monitors
                .iter()
                .any(|m| m.id == "data" && m.list == list),
            "{kind}"
        );
        native["compile_result"][0]["compiled_block_map"]["hat"]["next_block"]["params"]["FUNC"] =
            json!("hide");
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        assert!(
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap()
                .monitors
                .is_empty()
        );
    }
}

#[test]
fn published_scene_pointer_dispatches_and_missing_videos_continue_without_stubs() {
    let videos = [
        "play_video",
        "play_video_until_end",
        "continue_pause_video",
        "show_hide_video",
    ];
    for stub in videos {
        let native = published_script(vec![
            compiled(stub, json!({})),
            compiled_set("after", compiled_number(7.0)),
        ]);
        assert_eq!(start_published(&native).variable_text("after"), "7");
        let report = kitten4::coverage(&native, 1);
        assert_eq!(report["stubbed"][stub], Value::Null);
        assert_eq!(report["stage"], "ran");
    }
    for (state, expected) in [("show", "false"), ("hide", "true")] {
        let native = published_script(vec![compiled_set(
            "ranking",
            compiled("is_ranking_show_hide", json!({"VAL":state})),
        )]);
        assert_eq!(start_published(&native).variable_text("ranking"), expected);
        assert_eq!(
            kitten4::coverage(&native, 1)["stubbed"]["is_ranking_show_hide"],
            Value::Null
        );
    }
    let mut native = published_script(vec![compiled_set("clicked", compiled_number(1.0))]);
    let root = &mut native["compile_result"][0]["compiled_block_map"]["hat"];
    root["type"] = json!("sprite_on_tap");
    root["params"] = json!({"actor":"__scene","type":"mouse_click"});
    root["child_block"] = json!([root["next_block"].take()]);
    let mut engine = start_published(&native);
    engine.pointer_event("--screen", "mouse_click", 0.0, 0.0);
    engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap();
    assert_eq!(engine.variable_text("clicked"), "1");
}

#[test]
fn published_monitor_hide_reuses_the_shown_monitor() {
    for kind in ["show_hide_list", "show_hide_variable"] {
        let mut native = published_script(vec![
            compiled(kind, json!({"VAR":"data","FUNC":"show"})),
            compiled(kind, json!({"VAR":"data","FUNC":"hide"})),
        ]);
        native["variables"]["data"] = json!({"id":"data","name":"data","type":if kind=="show_hide_list" {"list"} else {"any"},"value":if kind=="show_hide_list" {json!([])} else {json!(1)}});
        let canonical = kitten4::to_neko(&native).unwrap();
        let mut engine = Engine::new(Program::compile(&canonical).unwrap());
        engine.start();
        assert!(
            engine
                .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                .unwrap()
                .monitors
                .is_empty()
        );
    }
}

#[test]
fn published_unknown_selectors_keep_domain_specific_error_or_nan_behavior() {
    let mut native = published_script(vec![compiled_set(
        "value",
        compiled(
            "lists_get_value",
            json!({
                "TYPE":"unsupported","VAR":compiled("lists_get",json!({"VAR":"items"}))
            }),
        ),
    )]);
    native["variables"]["items"] = json!({"id":"items","name":"items","type":"list","value":[]});
    assert!(Program::compile(&kitten4::to_neko(&native).unwrap()).is_err());
    for kind in ["get_3", "get_clone_index_property"] {
        let native = published_script(vec![compiled_set(
            "value",
            compiled(
                kind,
                json!({"sprite":"__self",
            "attribute":"00000000-0000-4000-8000-000000000001","index":compiled_number(0.0)}),
            ),
        )]);
        // Tn6a routes UUID attributes to O8fc/get_var_or_list, whose
        // unknown-global default is 0; clone index 0 selects the prototype.
        // Non-UUID unknown attributes remain NaN (official partial probes).
        assert_eq!(
            start_published(&native).variable_text("value"),
            "0",
            "{kind}"
        );
    }
}

#[test]
fn published_clone_self_properties_and_nonuniform_scale_use_the_running_instance() {
    let read = |id: &str, attribute: &str| {
        compiled_set(
            id,
            compiled("get_3", json!({"sprite":"__self","attribute":attribute})),
        )
    };
    let mut native = published_script(vec![compiled("mirror", json!({"sprite":"__self"}))]);
    let actor = &mut native["theatre"]["actors"]["nekoc-pen-actor"];
    actor["visible"] = json!(true);
    actor["scale"] = json!(200);
    let mut body = compiled(
        "set_width_height_scale",
        json!({"type":"width","value":compiled_number(150.0)}),
    );
    body["next_block"] = compiled(
        "set_width_height_scale",
        json!({"type":"height","value":compiled_number(75.0)}),
    );
    body["next_block"]["next_block"] = read("width", "16");
    body["next_block"]["next_block"]["next_block"] = read("height", "17");
    body["next_block"]["next_block"]["next_block"]["next_block"] = read("size", "5");
    native["compile_result"][0]["compiled_block_map"]["clone"] =
        json!({"type":"start_as_a_mirror","params":{},"child_block":[body]});
    let mut engine = start_published(&native);
    // Mirror scripts start at the next update (official scheduling-clone probe).
    engine
        .advance(1.0 / 60.0, 2_000_000, std::time::Duration::from_secs(5))
        .unwrap();
    // K4 setters are absolute axis percentages; size is the current X scale.
    assert_eq!(engine.variable_text("width"), "150");
    assert_eq!(engine.variable_text("height"), "75");
    assert_eq!(engine.variable_text("size"), "150");
}

#[test]
fn published_size_changes_after_axis_setters_keep_k4_absolute_percentages() {
    let read = |id: &str, attribute: &str| {
        compiled_set(
            id,
            compiled("get_3", json!({"sprite":"__self","attribute":attribute})),
        )
    };
    let native = published_script(vec![
        compiled("set_scale", json!({"scale":compiled_number(200.0)})),
        compiled(
            "set_width_height_scale",
            json!({"type":"width","value":compiled_number(150.0)}),
        ),
        compiled(
            "self_change_scale_2",
            json!({"increase":"increase","scale":compiled_number(10.0)}),
        ),
        read("width", "16"),
        read("height", "17"),
        compiled("set_scale", json!({"scale":compiled_number(80.0)})),
        read("reset_width", "16"),
        read("reset_height", "17"),
    ]);
    let engine = start_published(&native);
    for (id, expected) in [
        ("width", "160"),
        ("height", "210"),
        ("reset_width", "80"),
        ("reset_height", "80"),
    ] {
        assert_eq!(engine.variable_text(id), expected);
    }
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
