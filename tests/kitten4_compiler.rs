use assert_cmd::Command;
use nekoc::{bcmkn_compiler, kitten4, kitten4_compiler, project, runtime};
use predicates::str::contains;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn demo() -> PathBuf {
    root().join("samples/kitten4-demo.ts")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn assert_native_workspace(value: &Value) {
    assert!(kitten4::is_kitten4(value));
    assert_eq!(value["work_type"], "KITTEN");
    assert!(value["version"].is_number());
    assert!(value["theatre"]["scenes"].is_object());
    assert!(value["theatre"]["actors"].is_object());
    assert!(value.get("toolType").is_none());

    let actors = value["theatre"]["actors"].as_object().unwrap();
    let scenes = value["theatre"]["scenes"].as_object().unwrap();
    let mut has_scripts = false;
    for owner in actors.values().chain(scenes.values()) {
        let workspace = &owner["block_data_json"];
        assert!(workspace["blocks"].is_object(), "{workspace}");
        assert!(workspace["connections"].is_object(), "{workspace}");
        assert!(owner.get("nekoBlockJsonList").is_none());
        has_scripts |= !workspace["blocks"].as_object().unwrap().is_empty();
    }
    assert!(has_scripts, "expected compiled native blocks");
}

fn assert_native_numeric_graph_schema(workspace: &Value) {
    let schema = read_json(&root().join("docs/kitten4-block-schema.json"));
    let blocks = workspace["blocks"].as_object().unwrap();
    for (id, block) in blocks {
        let kind = block["type"].as_str().unwrap();
        let definition = &schema["blocks"][kind];
        let inputs = definition["inputs"].as_array().unwrap_or_else(|| {
            panic!("generated block {id} has no verified official schema for {kind}")
        });
        for (child, edge) in workspace["connections"][id].as_object().unwrap() {
            assert!(
                blocks.contains_key(child),
                "native edge points to missing block {child}"
            );
            assert_eq!(blocks[child]["parent_id"], id.as_str());
            if edge["type"] == "input" {
                assert!(
                    inputs
                        .iter()
                        .any(|input| input["name"] == edge["input_name"]
                            && input["kind"] == edge["input_type"]),
                    "native {kind} socket is not in the official schema: {edge}"
                );
            }
        }
    }
}

fn variable(snapshot: &runtime::RuntimeSnapshot, name: &str) -> Value {
    let id = snapshot
        .variable_names
        .iter()
        .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
        .unwrap_or_else(|| panic!("missing variable {name}"));
    serde_json::to_value(&snapshot.variables[id]).unwrap()
}

fn key(code: &str) -> runtime::RuntimeStep {
    runtime::RuntimeStep::Event(runtime::RuntimeEvent::Key {
        key: code.to_owned(),
        state: "down".to_owned(),
    })
}

fn native_input<'a>(workspace: &'a Value, block: &Value, socket: &str) -> &'a Value {
    let id = block["id"].as_str().unwrap();
    let child = workspace["connections"][id]
        .as_object()
        .unwrap_or_else(|| panic!("missing native connections for {id}"))
        .iter()
        .find_map(|(child, connection)| {
            (connection["type"] == "input" && connection["input_name"] == socket).then_some(child)
        })
        .unwrap_or_else(|| panic!("missing native input {socket} on {id}"));
    &workspace["blocks"][child]
}

// Evaluate only native numeric reporters used by these regression fixtures.
// Names/sockets follow the extracted official schema, with no adapter or KN
// runtime calls: inverse-conversion bugs must not cancel export bugs in tests.
fn native_number(workspace: &Value, block: &Value, variables: &Value) -> f64 {
    let input = |name| native_number(workspace, native_input(workspace, block, name), variables);
    match block["type"].as_str().unwrap() {
        "math_number" => block["fields"]["NUM"]
            .as_f64()
            .unwrap_or_else(|| block["fields"]["NUM"].as_str().unwrap().parse().unwrap()),
        "variables_get" => {
            let id = block["fields"]["VAR"].as_str().unwrap();
            variables[id]
                .as_f64()
                .unwrap_or_else(|| panic!("missing variable {id}"))
        }
        "math_arithmetic" => {
            let (a, b) = (input("A"), input("B"));
            match block["fields"]["OP"].as_str().unwrap() {
                "ADD" => a + b,
                "MINUS" => a - b,
                "MULTIPLY" => a * b,
                "DIVIDE" => a / b,
                "POWER" => a.powf(b),
                op => panic!("unknown native arithmetic operation {op}"),
            }
        }
        "math_single" if block["fields"]["OP"] == "NEG" => -input("NUM"),
        kind => panic!("unexpected native numeric reporter {kind}"),
    }
}

#[test]
fn compiled_literal_headings_follow_official_kitten4_axes() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("headings.ts");
    let output = dir.path().join("headings.bcm");
    fs::write(
        &input,
        "onStart(() => { pointTowards(90); moveSteps(10); turn(90); moveSteps(5); });",
    )
    .unwrap();
    kitten4_compiler::compile_ts_kitten4(&input, None, &output).unwrap();
    let native = read_json(&output);
    let actor = native["theatre"]["actors"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap();
    let workspace = &actor["block_data_json"];
    assert_native_numeric_graph_schema(workspace);
    let blocks = workspace["blocks"].as_object().unwrap();
    let point = blocks
        .values()
        .find(|b| b["type"] == "self_point_towards")
        .unwrap();
    let turn = blocks
        .values()
        .find(|b| b["type"] == "self_rotate")
        .unwrap();
    let heading = native_number(
        workspace,
        native_input(workspace, point, "degrees"),
        &json!({}),
    );
    let delta = native_number(
        workspace,
        native_input(workspace, turn, "degrees"),
        &json!({}),
    );
    assert_eq!(heading, 0.0, "KN 90 degrees must face right in native K4");
    assert_eq!(
        delta, -90.0,
        "a clockwise quarter-turn is negative in native K4"
    );
    // Official K4 motion uses x += cos(angle)*steps, y += sin(angle)*steps.
    // This L-shaped route must go right then down, not up then left.
    let x = 10.0 * heading.to_radians().cos() + 5.0 * (heading + delta).to_radians().cos();
    let y = 10.0 * heading.to_radians().sin() + 5.0 * (heading + delta).to_radians().sin();
    assert!(
        (x - 10.0).abs() < 1e-8 && (y + 5.0).abs() < 1e-8,
        "native route ended at ({x}, {y})"
    );
    assert!(
        (actor["rotation"].as_f64().unwrap() - std::f64::consts::FRAC_PI_2).abs() < 1e-12,
        "native owner rotation is in radians; the default KN heading points up"
    );
}

#[test]
fn compiled_dynamic_headings_evaluate_correctly_in_native_arithmetic() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("dynamic-headings.ts");
    let output = dir.path().join("dynamic-headings.bcm");
    fs::write(
        &input,
        r#"onStart(() => {
        setVar("heading", 0);
        setVar("turnBy", 0);
        pointTowards((getVar("heading") as number) + 30);
        turn(getVar("turnBy") * 2);
    });"#,
    )
    .unwrap();
    kitten4_compiler::compile_ts_kitten4(&input, None, &output).unwrap();
    let native = read_json(&output);
    assert_dynamic_native_headings(&native);
    // Reusing the generated project as a template must replace the generated
    // conversion nodes too, without applying heading conversion a second time.
    let rebuilt = dir.path().join("rebuilt.bcm");
    kitten4_compiler::compile_ts_kitten4(&input, Some(&output), &rebuilt).unwrap();
    assert_dynamic_native_headings(&read_json(&rebuilt));
}

fn assert_dynamic_native_headings(native: &Value) {
    let workspace = &native["theatre"]["actors"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()["block_data_json"];
    assert_native_numeric_graph_schema(workspace);
    let blocks = workspace["blocks"].as_object().unwrap();
    let point = blocks
        .values()
        .find(|b| b["type"] == "self_point_towards")
        .unwrap();
    let turn = blocks
        .values()
        .find(|b| b["type"] == "self_rotate")
        .unwrap();
    let var_id = |name| {
        native["variables"]
            .as_object()
            .unwrap()
            .iter()
            .find_map(|(id, var)| (var["name"] == name).then_some(id.clone()))
            .unwrap()
    };
    let heading_id = var_id("heading");
    let turn_id = var_id("turnBy");
    // Several runtime assignments exercise the same exported expression trees;
    // this catches transforming only constants or negating a value twice.
    for (heading_value, turn_value, expected_heading, expected_delta) in [
        (0.0, 0.0, 60.0, 0.0),
        (60.0, 45.0, 0.0, -90.0),
        (-120.0, -45.0, 180.0, 90.0),
        (300.0, 90.0, -240.0, -180.0),
    ] {
        let variables = json!({&heading_id: heading_value, &turn_id: turn_value});
        let heading = native_number(
            workspace,
            native_input(workspace, point, "degrees"),
            &variables,
        );
        let delta = native_number(
            workspace,
            native_input(workspace, turn, "degrees"),
            &variables,
        );
        assert_eq!(
            (heading, delta),
            (expected_heading, expected_delta),
            "native arithmetic with heading={heading_value}, turnBy={turn_value}"
        );
    }
}

#[test]
fn cli_compiles_demo_outside_repository_and_emits_native_workspace() {
    let dir = tempdir().unwrap();
    let output = dir.path().join("demo.bcm");
    // A preexisting similarly named file must not be used as compiler scratch.
    let sidecar = output.with_extension("workspace.tmp.json");
    fs::write(&sidecar, "keep this file").unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .current_dir(dir.path())
        .arg("compile-ts-kitten4")
        .arg(demo())
        .arg("--out")
        .arg(&output)
        .assert()
        .success();

    let native = read_json(&output);
    assert_native_workspace(&native);
    assert_eq!(native["project_name"], "kitten4-demo");
    assert_eq!(native["size"], json!({"width": 1280, "height": 720}));
    assert_eq!(
        native["type"], 1,
        "Kitten's file type is independent of stage dimensions"
    );
    assert_eq!(fs::read_to_string(sidecar).unwrap(), "keep this file");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);

    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 20).unwrap();
    assert_eq!(variable(&snapshot, "sides"), json!(4.0));
    assert_eq!(variable(&snapshot, "ready"), json!(1.0));
    assert_eq!(variable(&snapshot, "keyCount"), json!(0.0));
    let actor = snapshot.actors.values().next().unwrap();
    assert!((actor.x + 40.0).abs() < 1e-8);
    assert!((actor.y + 40.0).abs() < 1e-8);
    assert!(!actor.pen.down);
    assert_eq!(actor.pen.strokes.len(), 4);
    assert!(
        actor
            .pen
            .strokes
            .iter()
            .all(|stroke| { stroke.color.eq_ignore_ascii_case("#2563eb") && stroke.size == 4.0 })
    );
}

#[test]
fn demo_adapter_roundtrip_preserves_keyboard_movement_and_pen_execution() {
    let dir = tempdir().unwrap();
    let native_path = dir.path().join("demo.bcm");
    kitten4_compiler::compile_ts_kitten4(demo(), None, &native_path).unwrap();
    let native = read_json(&native_path);
    let canonical = kitten4::to_neko(&native).unwrap();

    let expected_path = dir.path().join("expected.bcmkn");
    bcmkn_compiler::compile_ts_bcmkn(
        demo(),
        root().join("samples/kitten-n-0.27.4.bcmkn"),
        &expected_path,
    )
    .unwrap();
    let expected = project::load_project(expected_path).unwrap().value;
    let steps = [
        runtime::RuntimeStep::Run(20),
        key("39"),
        runtime::RuntimeStep::Run(1),
        key("38"),
        runtime::RuntimeStep::Run(1),
        key("32"),
        runtime::RuntimeStep::Run(1),
    ];
    let actual = runtime::run_project_steps(&canonical, &steps).unwrap();
    let expected = runtime::run_project_steps(&expected, &steps).unwrap();
    for name in ["edge", "step", "sides", "ready", "keyCount"] {
        assert_eq!(variable(&actual, name), variable(&expected, name), "{name}");
    }
    assert_eq!(variable(&actual, "keyCount"), json!(3.0));
    let actor = actual.actors.values().next().unwrap();
    let expected_actor = expected.actors.values().next().unwrap();
    assert!((actor.x - expected_actor.x).abs() < 1e-8);
    assert!((actor.y - expected_actor.y).abs() < 1e-8);
    assert_eq!(actor.pen, expected_actor.pen);
    assert_eq!(actor.pen.strokes.len(), 5);
    assert!(actor.pen.strokes[4].color.eq_ignore_ascii_case("#16a34a"));

    let mut clearing = steps.to_vec();
    clearing.extend([key("67"), runtime::RuntimeStep::Run(1)]);
    let cleared = runtime::run_project_steps(&canonical, &clearing).unwrap();
    assert_eq!(variable(&cleared, "keyCount"), json!(4.0));
    assert!(
        cleared
            .actors
            .values()
            .next()
            .unwrap()
            .pen
            .strokes
            .is_empty()
    );
}

#[test]
fn cli_accepts_native_template_and_preserves_its_resources() {
    let dir = tempdir().unwrap();
    let template_path = dir.path().join("template.bcm");
    kitten4_compiler::compile_ts_kitten4(demo(), None, &template_path).unwrap();
    let mut template = read_json(&template_path);
    template["size"] = json!({"width": 960, "height": 720});
    template["type"] = json!(1);
    template["theatre"]["actors"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap()["name"] = json!("Template cursor");
    template["theatre"]["actors"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap()["rotation"] = json!(1.23);
    fs::write(&template_path, serde_json::to_vec(&template).unwrap()).unwrap();

    let input = dir.path().join("replacement.ts");
    let output = dir.path().join("replacement.bcm");
    fs::write(
        &input,
        "onStart(() => { setVar(\"replacement\", 7); moveTo(12, 34); });",
    )
    .unwrap();
    Command::cargo_bin("nekoc")
        .unwrap()
        .arg("compile-ts-kitten4")
        .arg(&input)
        .arg("--template")
        .arg(&template_path)
        .arg("--out")
        .arg(&output)
        .assert()
        .success();

    let native = read_json(&output);
    assert_native_workspace(&native);
    assert_eq!(native["size"], template["size"]);
    assert_eq!(
        native["type"], 1,
        "landscape templates are still Kitten file type 1"
    );
    assert_eq!(native["theatre"]["styles"], template["theatre"]["styles"]);
    assert_eq!(native["project_name"], "replacement");
    assert!(
        (native["theatre"]["actors"]
            .as_object()
            .unwrap()
            .values()
            .next()
            .unwrap()["rotation"]
            .as_f64()
            .unwrap()
            - 1.23)
            .abs()
            < 1e-12,
        "template's native heading must not be converted twice"
    );
    assert_eq!(read_json(&template_path), template);
    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 1).unwrap();
    assert_eq!(variable(&snapshot, "replacement"), json!(7.0));
    let actor = snapshot.actors.values().next().unwrap();
    assert_eq!(actor.name, "Template cursor");
    assert_eq!((actor.x, actor.y), (12.0, 34.0));
    assert!(
        actor.pen.strokes.is_empty(),
        "template scripts must be replaced"
    );
}

#[test]
fn cli_rejects_non_native_template_without_overwriting_output() {
    let dir = tempdir().unwrap();
    let output = dir.path().join("keep.bcm");
    fs::write(&output, "existing output").unwrap();
    Command::cargo_bin("nekoc")
        .unwrap()
        .arg("compile-ts-kitten4")
        .arg(demo())
        .arg("--template")
        .arg(root().join("samples/kitten-n-0.27.4.bcmkn"))
        .arg("--out")
        .arg(&output)
        .assert()
        .failure()
        .stderr(contains("must be a native Kitten 4"));
    assert_eq!(fs::read_to_string(output).unwrap(), "existing output");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn recompiling_native_template_keeps_extensions_but_removes_all_old_scripts() {
    let dir = tempdir().unwrap();
    let template_path = dir.path().join("template.bcm");
    kitten4_compiler::compile_ts_kitten4(demo(), None, &template_path).unwrap();
    let mut template = read_json(&template_path);
    template["future_extension"] = json!({"enabled": true, "payload": [1, null, "keep"]});
    let actor_id = template["theatre"]["actors"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let scene_id = template["theatre"]["current_scene"]
        .as_str()
        .unwrap()
        .to_owned();
    let actor = &mut template["theatre"]["actors"][&actor_id];
    actor["future_actor_setting"] = json!({"preserve": "actor metadata"});
    // The new frontend also generates b1. Old execution flags must not survive
    // merely because the adapter keeps a native source snapshot for roundtrips.
    actor["block_data_json"]["blocks"]["b1"]["disabled"] = json!(true);
    actor["block_data_json"]["blocks"]["b1"]["old_block_extension"] = json!("stale");
    actor["block_data_json"]["comments"] = json!({"old-comment": {"text": "old script"}});

    // Unknown native blocks are legal imported template data. Compilation must
    // replace them too, rather than resurrecting them from adapter metadata.
    template["theatre"]["scenes"][&scene_id]["block_data_json"] = json!({
        "blocks": {
            "old-hat": {"id": "old-hat", "type": "start_on_click", "parent_id": null},
            "old-extension": {"id": "old-extension", "type": "future_native_block", "parent_id": "old-hat"}
        },
        "connections": {"old-hat": {"old-extension": {"type": "input", "input_name": "DO", "input_type": "statement"}}},
        "comments": {"old-scene-comment": {"text": "remove with script"}},
        "future_workspace_setting": {"zoom": 1.5}
    });
    fs::write(&template_path, serde_json::to_vec(&template).unwrap()).unwrap();
    let input = dir.path().join("replacement.ts");
    let output = dir.path().join("replacement.bcm");
    fs::write(
        &input,
        "onStart(() => { setVar(\"replacement\", 42); moveTo(3, 5); });",
    )
    .unwrap();
    kitten4_compiler::compile_ts_kitten4(&input, Some(&template_path), &output).unwrap();
    let native = read_json(&output);
    assert_native_workspace(&native);
    assert_eq!(native["future_extension"], template["future_extension"]);
    assert_eq!(
        native["theatre"]["actors"][&actor_id]["future_actor_setting"],
        template["theatre"]["actors"][&actor_id]["future_actor_setting"]
    );
    assert_eq!(native["theatre"]["styles"], template["theatre"]["styles"]);
    let actor_workspace = &native["theatre"]["actors"][&actor_id]["block_data_json"];
    assert_ne!(actor_workspace["blocks"]["b1"]["disabled"], true);
    assert!(
        actor_workspace["blocks"]["b1"]
            .get("old_block_extension")
            .is_none()
    );
    assert_eq!(actor_workspace["comments"], json!({}));
    let scene_workspace = &native["theatre"]["scenes"][&scene_id]["block_data_json"];
    assert_eq!(scene_workspace["blocks"], json!({}));
    assert_eq!(scene_workspace["connections"], json!({}));
    assert_eq!(scene_workspace["comments"], json!({}));
    assert_eq!(
        scene_workspace["future_workspace_setting"],
        json!({"zoom": 1.5})
    );
    assert!(native.get("_nekocKitten4").is_none());
    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 1).unwrap();
    assert_eq!(variable(&snapshot, "replacement"), json!(42.0));
    assert_eq!(
        (snapshot.actors[&actor_id].x, snapshot.actors[&actor_id].y),
        (3.0, 5.0)
    );
}

#[test]
fn unsupported_kitten_n_features_fail_instead_of_silently_changing_program() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("unsupported.ts");
    let output = dir.path().join("keep.bcm");
    fs::write(&output, "existing output").unwrap();
    let template_path = dir.path().join("template.bcm");
    kitten4_compiler::compile_ts_kitten4(demo(), None, &template_path).unwrap();
    for (source, diagnostic) in [
        (
            "onStart(() => { forRange(\"i\", 1, 3, 1, () => { moveSteps(1); }); });",
            "traverse_number",
        ),
        (
            "onStart(() => { scriptVars(\"local\"); setVar(\"copy\", scriptVar(\"local\")); });",
            "script_variables",
        ),
    ] {
        fs::write(&input, source).unwrap();
        for template in [None, Some(template_path.as_path())] {
            let error =
                kitten4_compiler::compile_ts_kitten4(&input, template, &output).unwrap_err();
            let message = format!("{error:#}");
            assert!(
                message.contains("native Kitten 4") && message.contains(diagnostic),
                "expected a specific Kitten 4 conversion diagnostic: {error:#}"
            );
            assert_eq!(fs::read_to_string(&output).unwrap(), "existing output");
        }
    }
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
}

#[test]
fn declared_sprite_replaces_native_template_actor_without_dangling_editor_references() {
    let dir = tempdir().unwrap();
    let template_path = dir.path().join("template.bcm");
    kitten4_compiler::compile_ts_kitten4(demo(), None, &template_path).unwrap();
    let mut template = read_json(&template_path);
    let old_actor = template["theatre"]["actors"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    template["theatre"]["current_entity"] = json!(old_actor);
    fs::write(&template_path, serde_json::to_vec(&template).unwrap()).unwrap();
    let input = dir.path().join("sprite.ts");
    let output = dir.path().join("sprite.bcm");
    fs::write(
        &input,
        "sprite(\"Replacement\", {}, () => { onStart(() => { moveTo(3, 5); }); });",
    )
    .unwrap();
    kitten4_compiler::compile_ts_kitten4(&input, Some(&template_path), &output).unwrap();
    let native = read_json(&output);
    let theatre = &native["theatre"];
    let actors = theatre["actors"].as_object().unwrap();
    let scenes = theatre["scenes"].as_object().unwrap();
    let groups = theatre["groups"].as_object().unwrap();
    assert!(!actors.contains_key(&old_actor));
    let current = theatre["current_entity"].as_str().unwrap();
    assert!(
        actors.contains_key(current) || scenes.contains_key(current),
        "current_entity points to removed owner {current}"
    );
    for scene in scenes.values() {
        let mut grouped_actors = std::collections::BTreeSet::new();
        for group in scene["group_order"].as_array().unwrap() {
            let id = group.as_str().unwrap();
            assert!(
                groups.contains_key(id),
                "group_order points to removed group {id}"
            );
            grouped_actors.extend(
                groups[id]["actors"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str),
            );
        }
        for actor in scene["actors"].as_array().unwrap() {
            assert!(
                grouped_actors.contains(actor.as_str().unwrap()),
                "replacement actor {actor} is missing from editor group_order"
            );
        }
    }
    for group in groups.values() {
        for actor in group["actors"].as_array().unwrap() {
            assert!(
                actors.contains_key(actor.as_str().unwrap()),
                "group points to removed actor {actor}"
            );
        }
    }
    let canonical = kitten4::to_neko(&native).unwrap();
    let snapshot = runtime::run_project(&canonical, 1).unwrap();
    let actor = snapshot.actors.values().next().unwrap();
    assert_eq!((actor.x, actor.y), (3.0, 5.0));
}
