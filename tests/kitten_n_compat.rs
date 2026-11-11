use nekoc::{bcmkn_compiler, project, validate};
use serde_json::{Value, json};
use std::fs;
use tempfile::tempdir;

fn template() -> Value {
    json!({
        "projectName": "compatibility", "version": "0.27.4", "toolType": "KN",
        "stageSize": {"width": 900, "height": 562},
        "scenes": {"currentSceneId": "scene", "sortList": ["scene"], "scenesDict": {
            "scene": {"id": "scene", "name": "Background", "screenName": "Screen",
                "styles": ["background"], "currentStyleId": "background", "actorIds": [],
                "nekoBlockJsonList": [], "comments": {}, "customSceneField": true}
        }},
        "actors": {"actorsDict": {}},
        "styles": {"stylesDict": {"background": {"id": "background", "url": "data:image/svg+xml,<svg/>", "customStyleField": 42}}},
        "variables": {"variablesDict": {}}, "broadcasts": {"broadcastsDict": {}},
        "procedures": {"proceduresDict": {}}, "customRootField": {"preserve": true}
    })
}

fn compile(source: &str) -> Value {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compat.ts");
    let base = dir.path().join("template.bcmkn");
    let output = dir.path().join("compiled.bcmkn");
    fs::write(&input, source).unwrap();
    fs::write(&base, template().to_string()).unwrap();
    bcmkn_compiler::compile_ts_bcmkn(input, base, &output).unwrap();
    project::load_project(output).unwrap().value.into_value()
}

fn blocks(value: &Value) -> Vec<&Value> {
    let mut result = Vec::new();
    match value {
        Value::Object(map) => {
            if map.contains_key("type") && map.contains_key("id") {
                result.push(value);
            }
            for child in map.values() {
                result.extend(blocks(child));
            }
        }
        Value::Array(items) => {
            for child in items {
                result.extend(blocks(child));
            }
        }
        _ => {}
    }
    result
}

#[test]
fn math_function_dropdowns_match_native_semantics() {
    let p = compile(
        r#"
onStart(() => {
    setVar("root", mathFunc("sqrt", 9));
    setVar("abs_input", -4);
    setVar("neg_input", 5);
    setVar("absolute", mathFunc("abs", getVar("abs_input")));
    setVar("negative", mathFunc("neg", getVar("neg_input")));
    setVar("logarithm", mathFunc("log", 100));
    setVar("power", mathFunc("pow10", 2));
});
"#,
    );
    let all = blocks(&p);
    let codes: Vec<_> = all
        .iter()
        .filter(|b| b["type"] == "math_function")
        .map(|b| b["fields"]["type"].as_str().unwrap())
        .collect();
    for code in ["0", "1", "2", "4", "6"] {
        assert!(codes.contains(&code));
    }
    let state = serde_json::to_value(nekoc::runtime::run_project(&p, 1).unwrap()).unwrap();
    for (name, expected) in [
        ("root", 3.0),
        ("absolute", 4.0),
        ("negative", -5.0),
        ("logarithm", 2.0),
        ("power", 100.0),
    ] {
        assert_eq!(state["variables"][format!("kn-var-{name}")], expected);
    }
}

#[test]
fn current_editor_events_and_dropdown_values() {
    let p = compile(
        r#"
sprite("cat", {}, self => {
    self.onClick(() => { setVar("clicked", 1); });
    onKey("space", () => { setVar("key", 1); });
    onStart(() => {
        setEffect("color", 25);
        changeEffect("ghost", 10);
        setVar("effect", effectOf("--self", "color"));
        setVar("pressed", keyPressed("ArrowLeft", "down"));
    });
});
"#,
    );
    let all = blocks(&p);
    assert!(all.iter().any(|b| b["type"] == "sprite_on_tap"
        && b["fields"] == json!({"type":"mouse_click","sprite":"--self"})));
    assert!(!all.iter().any(|b| b["type"] == "start_on_click"));
    assert!(
        all.iter()
            .any(|b| b["type"] == "on_keydown" && b["fields"] == json!({"key":"32","type":"down"}))
    );
    assert!(
        all.iter()
            .any(|b| b["type"] == "check_key" && b["fields"]["key"] == "37")
    );
    assert!(
        all.iter()
            .any(|b| b["type"] == "self_set_effect" && b["fields"]["scope"] == "0")
    );
    assert!(
        all.iter()
            .any(|b| b["type"] == "self_change_effect" && b["fields"]["scope"] == "1")
    );
    assert!(
        all.iter()
            .any(|b| b["type"] == "effect_of_sprite" && b["fields"]["effect"] == "0")
    );
}

#[test]
fn sprite_registration_preserves_background_and_unknown_fields() {
    let p = compile(r#"sprite("cat", {}, () => { onStart(() => { moveSteps(1); }); });"#);
    assert_eq!(
        p["styles"]["stylesDict"]["background"],
        template()["styles"]["stylesDict"]["background"]
    );
    assert_eq!(p["version"], "0.27.4");
    assert_eq!(p["customRootField"], template()["customRootField"]);
    assert_eq!(p["scenes"]["scenesDict"]["scene"]["customSceneField"], true);
    assert_eq!(validate::build_report(&p).unwrap()["ok"], true);
}

#[test]
fn empty_actor_template_accepts_global_scripts() {
    let p = compile("onStart(() => { setVar(\"score\", 7); });");
    assert!(
        !p["scenes"]["scenesDict"]["scene"]["nekoBlockJsonList"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn global_scripts_can_coexist_with_registered_sprites() {
    let p = compile(
        r#"
onStart(() => { setVar("global", 1); });
sprite("cat", {}, () => { onStart(() => { setVar("local", 2); }); });
"#,
    );
    assert_eq!(
        blocks(&p)
            .iter()
            .filter(|b| b["type"] == "on_running_group_activated")
            .count(),
        2
    );
}

#[test]
fn validation_catches_missing_background_resources() {
    let mut p = template();
    p["styles"]["stylesDict"] = json!({});
    assert_eq!(validate::build_report(&p).unwrap()["ok"], false);
}

#[test]
fn registered_screens_have_broadcast_dropdown_entries() {
    let p = compile(
        r#"
screen("game", {}, () => {
    sprite("cat", {}, () => {
        onStart(() => { broadcast("ready"); });
        onMessage("ready", () => { setVar("heard", 1); });
    });
});
"#,
    );
    assert_eq!(
        p["broadcasts"]["broadcastsDict"]["nekoc-screen-game"],
        json!(["ready"])
    );
}

#[test]
fn runtime_handles_editor_click_and_keyboard_codes() {
    use nekoc::runtime::{RuntimeEvent, run_project_with_events};
    let p = compile(
        r#"
sprite("cat", {}, () => {
    onClick(() => { setVar("clicked", 1); });
    onKey("space", () => { setVar("pressed", keyPressed("space", "down")); });
});
"#,
    );
    let snapshot = run_project_with_events(
        &p,
        &[
            RuntimeEvent::Click { x: None, y: None },
            RuntimeEvent::Key {
                key: "space".into(),
                state: "down".into(),
            },
        ],
        1,
    )
    .unwrap();
    let state = serde_json::to_value(snapshot).unwrap();
    assert_eq!(state["variables"]["kn-var-clicked"], 1.0);
    assert_eq!(state["variables"]["kn-var-pressed"], true);
}
