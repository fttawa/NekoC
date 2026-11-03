use nekoc::{
    runtime::{Runtime, RuntimeValue},
    studio::{
        document::{Document, escape_pointer, palette},
        player::Player,
    },
};
use serde_json::{Value, json};

fn owner() -> &'static str {
    "/actors/actorsDict/nekoc-default-actor"
}
fn first() -> String {
    format!("{}/nekoBlockJsonList/0", owner())
}
fn movement(steps: i32) -> Value {
    json!({"type":"self_go_forward", "inputs":{"steps":{"type":"math_number", "fields":{"NUM":steps}}}})
}

#[test]
fn editing_roundtrip_preserves_unknown_fields_and_undo_savepoint() {
    let mut original = Document::blank().value().clone();
    original["futureExtension"] = json!({"opaque":[1,"two", {"x":null}]});
    let mut doc = Document::new(original.clone()).unwrap();
    doc.add_script(
        owner(),
        json!({"type":"on_running_group_activated", "next":movement(12)}),
    )
    .unwrap();
    let edited = doc.value().clone();
    assert!(doc.is_dirty());
    assert_eq!(edited["futureExtension"], original["futureExtension"]);
    doc.undo();
    assert_eq!(doc.value(), &original);
    assert!(!doc.is_dirty());
    doc.redo();
    assert_eq!(doc.value(), &edited);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("native.bcmkn");
    doc.save(&path).unwrap();
    assert!(!doc.is_dirty());
    assert_eq!(nekoc::project::load_project(path).unwrap().value, edited);
    doc.undo();
    assert!(doc.is_dirty());
}

#[test]
fn failed_edit_is_atomic_and_does_not_erase_redo() {
    let mut doc = Document::blank();
    doc.set("/projectName", json!("edited")).unwrap();
    doc.undo();
    let before = doc.value().clone();
    assert!(
        doc.edit(|v| {
            v["projectName"] = json!("oops");
            anyhow::bail!("abort")
        })
        .is_err()
    );
    assert_eq!(doc.value(), &before);
    assert!(doc.can_redo());
    doc.redo();
    assert_eq!(doc.value()["projectName"], "edited");
}

#[test]
fn block_splice_and_fresh_ids_survive_reopening() {
    let mut doc = Document::blank();
    doc.add_script(owner(), json!({"type":"on_running_group_activated"}))
        .unwrap();
    doc.append(&first(), movement(10)).unwrap();
    doc.append(&first(), movement(20)).unwrap();
    let mut doc = Document::new(doc.value().clone()).unwrap();
    doc.append(&first(), movement(30)).unwrap();
    let report = nekoc::validate::build_report(doc.value()).unwrap();
    assert_eq!(report["ok"], true, "{report}");
    doc.remove_block(&format!("{}/next", first())).unwrap();
    assert_eq!(
        doc.value()
            .pointer(&format!("{}/next/inputs/steps/fields/NUM", first()))
            .unwrap(),
        20
    );
    assert_eq!(escape_pointer("a~/b"), "a~0~1b");
}

#[test]
fn new_scenes_and_actors_keep_reference_integrity() {
    let mut doc = Document::blank();
    let scene = doc.add_scene().unwrap();
    let actor = doc.add_actor(&scene).unwrap();
    let report = nekoc::validate::build_report(doc.value()).unwrap();
    assert_eq!(report["ok"], true, "{report}");
    assert_eq!(
        doc.value()["scenes"]["scenesDict"][scene]["actorIds"][0],
        actor
    );
}

#[test]
fn incremental_runtime_retains_state_and_yields_forever() {
    let mut doc = Document::blank();
    doc.add_script(
        owner(),
        json!({"type":"on_running_group_activated", "next":{
            "type":"repeat_forever", "statements":{"DO":movement(7)}
        }}),
    )
    .unwrap();
    let mut runtime = Runtime::from_project(doc.value()).unwrap();
    runtime.set_cooperative(true);
    runtime.start();
    runtime.run_ticks(3).unwrap();
    let snapshot = runtime.snapshot();
    assert_eq!(snapshot.actors["nekoc-default-actor"].y, 21.0);
    assert_eq!(snapshot.active_threads, 1);
    runtime.run_ticks(2).unwrap();
    assert_eq!(runtime.snapshot().actors["nekoc-default-actor"].y, 35.0);
}

#[test]
fn palette_can_form_executable_project_without_node() {
    let mut doc = Document::blank();
    for (label, block) in palette() {
        if label.starts_with("When space") || label == "Forever" {
            continue;
        }
        if label == "When started" {
            doc.add_script(owner(), block).unwrap();
        } else {
            doc.append(&first(), block).unwrap();
        }
    }
    let mut runtime = Runtime::from_project(doc.value()).unwrap();
    runtime.set_cooperative(true);
    runtime.start();
    runtime.run_ticks(50).unwrap();
    let snapshot = runtime.snapshot();
    assert_eq!(snapshot.logs, ["Hello!"]);
    assert_eq!(snapshot.actors["nekoc-default-actor"].rotation, 15.0);
    assert_eq!(snapshot.active_threads, 0);
}

#[test]
fn player_worker_maintains_session_and_reports_errors() {
    let mut doc = Document::blank();
    doc.add_script(
        owner(),
        json!({"type":"on_running_group_activated", "next":{
            "type":"repeat_forever", "statements":{"DO":movement(2)}
        }}),
    )
    .unwrap();
    let mut player = Player::start(doc.value().clone()).unwrap();
    for tick in 1..=3 {
        assert!(player.tick(vec![]).unwrap());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let snapshot = loop {
            if let Some(reply) = player.poll() {
                break reply.unwrap();
            }
            assert!(std::time::Instant::now() < deadline, "worker timed out");
            std::thread::yield_now();
        };
        assert_eq!(snapshot.ticks, tick);
        assert_eq!(snapshot.actors["nekoc-default-actor"].y, tick as f64 * 2.0);
    }
    drop(player); // Stops an active forever loop and joins the worker.
    assert_eq!(
        serde_json::to_value(RuntimeValue::Number(2.0)).unwrap(),
        json!(2.0)
    );
}

#[test]
fn source_audit_hashes_evidence_without_executing_javascript() {
    let dir = tempfile::tempdir().unwrap();
    let source = "throw new Error('must not execute');\ngetPenDomainFunctions get_brush";
    std::fs::write(dir.path().join("bundle.js"), source).unwrap();
    std::fs::write(dir.path().join("pretty-1.js"), source).unwrap();
    std::fs::write(dir.path().join("manifest.json"), json!([{"name":"bundle.js","bytes":source.len(),"url":"https://example.invalid/bundle.js"}]).to_string()).unwrap();
    let report = nekoc::source_audit::audit(dir.path(), None).unwrap();
    assert_eq!(report["bundles"][0]["manifest_size_matches"], true);
    assert_eq!(report["bundles"][0]["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(report["domain_functions"][0], "getPenDomainFunctions");
    assert_eq!(report["evidence"][0]["line"], 2);
}

#[test]
fn drag_stack_reconnects_target_and_rejects_cycles_atomically() {
    let mut doc = Document::blank();
    doc.add_script(
        owner(),
        json!({"type":"on_running_group_activated", "next":movement(10)}),
    )
    .unwrap();
    doc.add_script(owner(), movement(20)).unwrap();
    let target = doc.value().pointer(&first()).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    doc.move_stack_after(&format!("{}/nekoBlockJsonList/1", owner()), &target)
        .unwrap();
    assert_eq!(
        doc.value()
            .pointer(&format!("{}/next/inputs/steps/fields/NUM", first()))
            .unwrap(),
        20
    );
    assert_eq!(
        doc.value()
            .pointer(&format!("{}/next/next/inputs/steps/fields/NUM", first()))
            .unwrap(),
        10
    );
    let before = doc.value().clone();
    let child = before.pointer(&format!("{}/next", first())).unwrap()["id"]
        .as_str()
        .unwrap();
    assert!(doc.move_stack_after(&first(), child).is_err());
    assert_eq!(doc.value(), &before);
    doc.undo();
    assert_eq!(
        doc.value()
            .pointer(&format!("{}/nekoBlockJsonList", owner()))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn imported_style_is_self_contained_and_referenced() {
    let mut doc = Document::blank();
    let url = "data:image/svg+xml,%3Csvg/%3E";
    let id = doc.import_style(owner(), "Local image", url).unwrap();
    assert_eq!(doc.value().pointer(owner()).unwrap()["currentStyleId"], id);
    assert_eq!(doc.value()["styles"]["stylesDict"][&id]["url"], url);
    assert_eq!(
        nekoc::validate::build_report(doc.value()).unwrap()["ok"],
        true
    );
}

#[test]
fn warp_runs_loop_without_per_iteration_yield_and_restores_outer_mode() {
    let mut doc = Document::blank();
    doc.add_script(owner(), json!({"type":"on_running_group_activated", "next":{
        "type":"warp", "statements":{"DO":{
            "type":"repeat_n_times", "inputs":{"times":{"type":"math_number","fields":{"NUM":4}}},
            "statements":{"DO":movement(3)}
        }}, "next":{"type":"repeat_forever", "statements":{"DO":movement(1)}}
    }})).unwrap();
    let mut runtime = Runtime::from_project(doc.value()).unwrap();
    runtime.set_cooperative(true);
    runtime.start();
    runtime.run_ticks(1).unwrap();
    assert_eq!(runtime.snapshot().actors["nekoc-default-actor"].y, 13.0);
    runtime.run_ticks(1).unwrap();
    assert_eq!(runtime.snapshot().actors["nekoc-default-actor"].y, 14.0);
}

#[test]
fn break_inside_warp_keeps_outer_continuation() {
    let mut doc = Document::blank();
    doc.add_script(owner(), json!({"type":"on_running_group_activated", "next":{
        "type":"warp", "statements":{"DO":{
            "type":"repeat_n_times", "inputs":{"times":{"type":"math_number","fields":{"NUM":4}}},
            "statements":{"DO":{"type":"break"}}
        }}, "next":{"type":"repeat_forever", "statements":{"DO":movement(1)}}
    }})).unwrap();
    let mut runtime = Runtime::from_project(doc.value()).unwrap();
    runtime.set_cooperative(true);
    runtime.start();
    runtime.run_ticks(2).unwrap();
    assert_eq!(runtime.snapshot().actors["nekoc-default-actor"].y, 2.0);
}
