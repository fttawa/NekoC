use nekoc::{bcmkn, engine::Program, kitten4, studio::document::Document};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn synthetic_kn(scripts: usize, list_items: usize) -> Value {
    let mut project = Document::blank().value().clone();
    project["variables"]["variablesDict"]["large-list"] = json!({
        "id":"large-list", "name":"large list", "type":"list",
        "value":(0..list_items).collect::<Vec<_>>()
    });
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!(
        (0..scripts)
            .map(
                |i| json!({"type":"on_running_group_activated","id":format!("root-{i}"),
            "next":{"type":"self_set_position_x","id":format!("set-{i}"),
                "inputs":{"value":{"type":"math_number","fields":{"NUM":"1"}}}}})
            )
            .collect::<Vec<_>>()
    );
    project
}

#[test]
fn large_kn_import_has_a_generous_regression_budget() {
    // A large list makes per-root whole-project compilation especially costly.
    // This test runs in debug too: the ceiling is a regression alarm, not the
    // release product target (<2s for the supplied 7.6MB work).
    let project = synthetic_kn(1_200, 500_000);
    let started = Instant::now();
    let (_, report) = bcmkn::import(project).unwrap();
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(report["script_diagnostics"], json!([]));
    assert!(started.elapsed() < Duration::from_secs(20), "{report}");
}

#[test]
fn published_k4_many_scripts_remain_runnable() {
    let roots: serde_json::Map<String, Value> = (0..160)
        .map(|i| {
            (
                format!("r{i}"),
                json!({"type":"start_on_click","id":format!("r{i}"),
            "next_block":{"type":"self_set_position","id":format!("m{i}"),
                "params":{"coordinary":"x","value":{"type":"math_number","params":{"NUM":"1"}}}}}),
            )
        })
        .collect();
    let source = json!({"version":25,"work_type":"KITTEN","size":{"width":640,"height":360},
        "theatre":{"current_scene":"s","scenes_order":["s"],
            "scenes":{"s":{"id":"s","actors":["a"]}},"actors":{"a":{"id":"a"}}},
        "compile_result":[{"id":"a","compiled_block_map":roots}]});
    let started = Instant::now();
    let project = kitten4::to_neko(&source).unwrap();
    let (project, report) = bcmkn::import(project).unwrap();
    assert_eq!(report["fast_runtime_ready"], true, "{report}");
    assert_eq!(Program::compile(&project).unwrap().stats().scripts, 160);
    assert!(started.elapsed() < Duration::from_secs(20));
}

#[test]
fn large_unsupported_k4_still_groups_every_script() {
    let roots: serde_json::Map<String, Value> = (0..200)
        .map(|i| {
            (
                format!("r{i}"),
                json!({"type":"start_on_click","id":format!("r{i}"),
            "next_block":{"type":"future_unsupported","id":"shared-error"}}),
            )
        })
        .collect();
    let source = json!({"version":25,"work_type":"KITTEN",
        "theatre":{"current_scene":"s","scenes_order":["s"],
            "scenes":{"s":{"id":"s","actors":["a"]}},"actors":{"a":{"id":"a"}}},
        "compile_result":[{"id":"a","compiled_block_map":roots}]});
    let started = Instant::now();
    let (_, report) = bcmkn::import(kitten4::to_neko(&source).unwrap()).unwrap();
    assert_eq!(report["fast_runtime_ready"], false);
    assert_eq!(report["script_diagnostics"].as_array().unwrap().len(), 1);
    assert_eq!(report["script_diagnostics"][0]["affected_scripts"], 200);
    assert!(started.elapsed() < Duration::from_secs(20));
}

#[test]
fn cached_source_does_not_hide_changed_or_malformed_provenance() {
    let source = nekoc::project::load_project("samples/kitten4-demo.bcm")
        .unwrap()
        .value;
    let canonical = kitten4::to_neko(&source).unwrap();
    Program::compile(&canonical).unwrap();
    let mut broken = canonical.clone();
    broken["_nekocKitten4"]["source"]["theatre"]["actors"] = json!([]);
    assert!(Program::compile(&broken).is_err());
    // A failed source must not poison the preceding successful entry.
    Program::compile(&canonical).unwrap();
    let mut changed = source;
    changed["project_name"] = json!("changed source");
    assert_eq!(
        kitten4::to_neko(&changed).unwrap()["projectName"],
        "changed source"
    );
}
