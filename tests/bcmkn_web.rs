use nekoc::{bcmkn, studio::document::Document};
use serde_json::json;

#[test]
fn repeated_shared_failures_are_grouped_without_losing_script_counts() {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["bad"] = json!({"value":{"unsupported":true}});
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","id":"one"},
        {"type":"on_keydown","id":"two","fields":{"key":"32"}},
        {"type":"on_keydown","id":"three","fields":{"key":"65"}}
    ]);
    let (_, report) = bcmkn::import(p).unwrap();
    assert_eq!(report["script_diagnostics"].as_array().unwrap().len(), 1);
    assert_eq!(report["script_diagnostics"][0]["affected_scripts"], 3);
    assert_eq!(report["fast_runtime_ready"], false);
}

#[test]
fn real_pencraft_import_has_no_numeric_list_error_or_duplicate_diagnostics() {
    let p = nekoc::project::load_project("projects/pencraft/pencraft.bcmkn").unwrap();
    let (_, report) = bcmkn::import(p.value).unwrap();
    assert_eq!(report["fast_runtime_ready"], true, "{report}");
    assert_eq!(report["script_diagnostics"], json!([]));
    assert!(report["stats"]["instructions"].as_u64().unwrap() > 100);
}

#[test]
fn import_preserves_extensions_mutations_and_all_resources() {
    let mut value = Document::blank().value().clone();
    value["futureExtension"] = json!({"unknown":[1,{"data":null}]});
    value["audios"]["audiosDict"]["a"] = json!({"id":"a","url":"data:audio/wav;base64,AAAA"});
    value["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "type":"on_running_group_activated","id":"hat","next":{"id":"audio-block","type":"play_audio","mutation":"<mutation keep=\"1\"/>"}
    }]);
    let original = value.clone();
    let (imported, report) = bcmkn::import(value).unwrap();
    assert_eq!(imported, original);
    assert_eq!(report["fast_runtime_ready"], false);
    assert!(
        report["script_diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("audio-block")
    );
    assert_eq!(report["inspection"]["counts"]["audios"], 1);
}

#[test]
fn collects_multiple_script_diagnostics_and_accepts_supported_project() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../samples/native-studio.bcmkn")).unwrap();
    let (_, report) = bcmkn::import(value).unwrap();
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(report["validation"]["ok"], true);
    let mut bad = Document::blank().value().clone();
    bad["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","id":"first","next":{"type":"unsupported-one","id":"a"}},
        {"type":"on_running_group_activated","id":"second","next":{"type":"unsupported-two","id":"b"}}
    ]);
    let (_, report) = bcmkn::import(bad).unwrap();
    assert_eq!(report["script_diagnostics"].as_array().unwrap().len(), 2);
}

#[test]
fn wrong_format_is_rejected_and_utf8_bom_is_accepted() {
    assert!(bcmkn::import(json!({"toolType":"COCO"})).is_err());
    assert!(bcmkn::import(json!([])).is_err());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("中文.bcmkn");
    std::fs::write(&path, format!("\u{feff}{}", Document::blank().value())).unwrap();
    let project = nekoc::project::load_project(&path).unwrap();
    assert_eq!(project.version.as_deref(), Some("0.27.4"));
}

#[test]
fn existing_large_pen_project_imports_losslessly_and_compiles() {
    let project = nekoc::project::load_project("samples/pen_display_fast.bcmkn").unwrap();
    let original = project.value.clone();
    let (value, report) = bcmkn::import(project.value).unwrap();
    assert_eq!(value, original);
    assert_eq!(report["inspection"]["version"], "0.27.4");
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(report["script_diagnostics"], json!([]));
    assert!(report["block_types"].as_object().unwrap().len() > 20);
}

#[test]
fn broadcast_project_imports_without_diagnostics() {
    let project = nekoc::project::load_project("samples/pen_display_columns.bcmkn").unwrap();
    let (_, report) = bcmkn::import(project.value).unwrap();
    assert_eq!(report["fast_runtime_ready"], true, "{report}");
    assert_eq!(report["script_diagnostics"], json!([]));
}

#[test]
fn loose_workspace_blocks_are_preserved_but_unknown_event_hats_are_diagnosed() {
    let mut p = Document::blank().value().clone();
    let roots = &mut p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"];
    *roots = json!([
        {"type":"on_running_group_activated"},
        {"type":"variables_set","next":{"type":"ask_and_choose"}},
        {"type":"traverse_number_value","is_output":true},
        {"type":"custom_reporter","is_output":true}
    ]);
    let (original, report) = bcmkn::import(p.clone()).unwrap();
    assert_eq!(original, p);
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(report["script_diagnostics"], json!([]));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"on_unknown_event","id":"unsupported-event"}));
    let (_, report) = bcmkn::import(p).unwrap();
    assert_eq!(report["fast_runtime_ready"], false);
    assert_eq!(
        report["script_diagnostics"][0]["block"],
        "unsupported-event"
    );
}
