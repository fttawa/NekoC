//! These tests deliberately use the test harness's default thread stack.
use nekoc::{
    engine::{Engine, Program},
    json::{self, Json},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn published(root: Value) -> Json {
    let mut source = json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap();
    for section in ["scenes", "actors"] {
        for owner in source["theatre"][section]
            .as_object_mut()
            .unwrap()
            .values_mut()
        {
            owner.as_object_mut().unwrap().remove("block_data_json");
        }
    }
    source["compile_result"] =
        json!([{"id":"nekoc-pen-actor", "compiled_block_map":{}, "procedures":{}}]);
    source["compile_result"][0]["compiled_block_map"]["hat"] = root;
    source
}

fn next_work(count: usize) -> Json {
    let mut tail = None;
    for i in (0..=count).rev() {
        let mut block = json!({"id":format!("b{i}"),"type":if i == 0 {"start_on_click"} else {"self_set_position"},
            "params": if i == 0 {json!({})} else {json!({"coordinary":"x","value":{"id":format!("n{i}"),"type":"math_number","params":{"NUM":i}}})}});
        if let Some(next) = tail {
            block["next_block"] = next;
        }
        tail = Some(block);
    }
    published(tail.unwrap())
}

#[test]
fn two_thousand_next_blocks_import_compile_run_export_and_drop() {
    let source = next_work(2000);
    let bytes = json::to_vec(&source).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("deep.bcm");
    std::fs::write(&path, &bytes).unwrap();
    let loaded = nekoc::project::load_project(&path).unwrap();
    let canonical = kitten4::to_neko(&loaded.value).unwrap();
    let workspace = nekoc::workspace::build_report(&canonical).unwrap();
    assert!(workspace["summary"]["blocks"].as_u64().unwrap() >= 4001);
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
        .unwrap();
    assert_eq!(
        frame
            .sprites
            .iter()
            .find(|s| s.id == "nekoc-pen-actor")
            .unwrap()
            .x,
        2000.0
    );
    let exported = kitten4::from_neko(&canonical).unwrap();
    assert!(json::equal(&source, &exported));
    assert!(json::equal(
        &json::from_slice(&json::to_vec(&exported).unwrap()).unwrap(),
        &source
    ));
    let roundtrip = dir.path().join("roundtrip.bcm");
    nekoc::project::roundtrip_project(path, roundtrip).unwrap();
    // Browser echo, including deep provenance and canonical next links.
    let echoed = json::from_slice(&json::to_vec(&canonical).unwrap()).unwrap();
    let (_, report) = nekoc::bcmkn::import(echoed).unwrap();
    assert_eq!(report["fast_runtime_ready"], true);
    assert_eq!(kitten4::coverage(&source, 1)["stage"], "ran");
    let bench = std::process::Command::new(env!("CARGO_BIN_EXE_bench-player"))
        .args([
            dir.path().join("deep.bcm").to_str().unwrap(),
            "--frames",
            "1",
        ])
        .output()
        .unwrap();
    assert!(
        bench.status.success(),
        "{}",
        String::from_utf8_lossy(&bench.stderr)
    );
}

#[test]
fn flat_workspace_with_two_thousand_next_links_roundtrips() {
    let source = next_work(2000);
    let mut canonical = kitten4::to_neko(&source).unwrap();
    json::discard(
        canonical
            .as_object_mut()
            .unwrap()
            .remove("_nekocKitten4")
            .unwrap(),
    );
    canonical["stageSize"] = json!({"width":1280,"height":720});
    let native = kitten4::from_neko(&canonical).unwrap();
    let imported = kitten4::to_neko(&native).unwrap();
    assert!(Program::compile(&imported).is_ok());
    assert!(json::equal(
        &kitten4::from_neko(&imported).unwrap(),
        &native
    ));
    // Detached cycles must still be detected with an iterative graph walk.
    let mut cyclic = native.clone();
    let ws = &mut cyclic["theatre"]["actors"]["nekoc-pen-actor"]["block_data_json"];
    ws["connections"]["b2000"] = json!({"b0":{"type":"next"}});
    assert!(format!("{:#}", kitten4::to_neko(&cyclic).unwrap_err()).contains("cycle"));
}

#[test]
fn three_hundred_nested_inputs_fail_with_a_block_not_a_stack_overflow() {
    let mut input = json!({"id":"leaf","type":"math_number","params":{"NUM":1}});
    for i in (0..300).rev() {
        let mut block =
            json!({"id":format!("input-{i}"),"type":"math_arithmetic","params":{"OP":"ADD"}});
        block["params"]["A"] = input;
        input = block;
    }
    let source = published(input);
    let loaded = json::from_slice(&json::to_vec(&source).unwrap()).unwrap();
    let error = format!("{:#}", kitten4::to_neko(&loaded).unwrap_err());
    assert!(error.contains("nesting exceeds 64"), "{error}");
    assert!(error.contains("input-65"), "{error}");

    let mut canonical = json::from_str(include_str!("../samples/native-studio.bcmkn")).unwrap();
    canonical["stageSize"] = json!({"width":1280,"height":720});
    let mut input = json!({"id":"leaf","type":"math_number","fields":{"NUM":1}});
    for i in (0..300).rev() {
        let mut block = json!({"id":format!("input-{i}"),"type":"math_arithmetic","fields":{"type":"add"},"inputs":{}});
        block["inputs"]["A"] = input;
        input = block;
    }
    let scene = canonical["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"] = json!([]);
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(input);
    let error = format!("{:#}", Program::compile(&canonical).err().unwrap());
    assert!(error.contains("input-65"), "{error}");
    let error = format!("{:#}", kitten4::from_neko(&canonical).unwrap_err());
    assert!(error.contains("input-65"), "{error}");
    // Plain JSON export remains valid even when executable nesting is refused.
    assert!(json::from_slice(&json::to_vec(&canonical).unwrap()).is_ok());
}

#[test]
fn bounded_json_handles_malformed_deep_input_and_string_brackets() {
    let mut text = "[".repeat(json::MAX_DEPTH);
    text.push('0');
    text.push_str(&"]".repeat(json::MAX_DEPTH));
    let deepest = json::from_str(&text).unwrap();
    assert_eq!(json::to_vec(&deepest).unwrap(), text.as_bytes());
    drop(deepest);
    assert!(
        json::from_str(&format!("[{text}]"))
            .unwrap_err()
            .to_string()
            .contains("nesting exceeds")
    );
    text.pop();
    assert!(json::from_str(&text).is_err());
    assert!(json::from_str(&format!("\"{}\\\"[]\"", "[".repeat(5000))).is_ok());
    assert!(json::from_str("{} {}").is_err());
    let malformed = format!("{}0{}", "{\"next\":".repeat(3000), "}".repeat(2999));
    assert!(json::from_str(&malformed).is_err());
    let text = format!("[{}0]", "0,".repeat(json::MAX_TOKENS));
    assert!(
        json::from_str(&text)
            .unwrap_err()
            .to_string()
            .contains("token limit")
    );
    let too_large = vec![b' '; json::MAX_BYTES + 1];
    assert!(
        json::from_slice(&too_large)
            .unwrap_err()
            .to_string()
            .contains("64 MiB")
    );
}

#[test]
fn three_hundred_statement_bodies_are_rejected_before_compilation() {
    let mut body = json!({"id":"leaf","type":"self_pen_down"});
    for i in (0..300).rev() {
        let mut node =
            json!({"id":format!("statement-{i}"),"type":"repeat_forever","statements":{}});
        node["statements"]["DO"] = body;
        body = node;
    }
    let mut canonical = json::from_str(include_str!("../samples/native-studio.bcmkn")).unwrap();
    let scene = canonical["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"] = json!([]);
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(body);
    let error = format!("{:#}", Program::compile(&canonical).err().unwrap());
    assert!(error.contains("statement-65"), "{error}");
}

#[test]
fn shallow_json_cannot_hide_an_unbounded_flat_graph_path() {
    let mut source = json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap();
    let workspace = &mut source["theatre"]["actors"]["nekoc-pen-actor"]["block_data_json"];
    *workspace = json!({"blocks":{},"connections":{},"comments":{}});
    for i in 0..=json::MAX_BLOCK_PATH + 1 {
        let id = format!("z{i:05}");
        workspace["blocks"][&id] =
            json!({"id":id,"type":if i == 0 {"start_on_click"} else {"self_pen_down"}});
        if i != 0 {
            workspace["connections"][format!("z{:05}", i - 1)] = json!({id:{"type":"next"}});
        }
    }
    let error = format!("{:#}", kitten4::to_neko(&source).unwrap_err());
    assert!(
        error.contains("path exceeds 4000 at block z04001"),
        "{error}"
    );
}
