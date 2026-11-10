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
    // Replace a populated deep source cache, including its Rc canonical owner.
    let shallow = nekoc::json::from_str(include_str!("../samples/kitten4-demo.bcm")).unwrap();
    kitten4::to_neko(&shallow).unwrap();
    // A failed import must safely clean moved subtrees and retain the old cache.
    let mut invalid = source.clone();
    invalid["compile_result"][0]["compiled_block_map"]["hat"]["type"] = json!(false);
    assert!(kitten4::to_neko(&invalid).is_err());
    assert!(kitten4::to_neko(&source).is_ok());
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
    let import_bench = std::process::Command::new(env!("CARGO_BIN_EXE_bench-import"))
        .args([
            dir.path().join("deep.bcm").to_str().unwrap(),
            "--snapshot",
            "--frames",
            "1",
        ])
        .output()
        .unwrap();
    assert!(
        import_bench.status.success(),
        "{}",
        String::from_utf8_lossy(&import_bench.stderr)
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
fn ten_thousand_nested_inputs_import_compile_and_run() {
    let mut input = json!({"id":"leaf","type":"get_timer","params":{}});
    for i in (0..9999).rev() {
        let mut block =
            json!({"id":format!("input-{i}"),"type":"math_arithmetic","params":{"OP":"ADD"}});
        block["params"]["A"] = input;
        block["params"]["B"] = json!({"type":"math_number","params":{"NUM":1}});
        input = block;
    }
    let mut set = json!({"id":"set","type":"self_set_position","params":{"coordinary":"x"}});
    set["params"]["value"] = input;
    let mut hat = json!({"id":"hat","type":"start_on_click","params":{}});
    hat["next_block"] = set;
    let source = published(hat);
    let loaded = json::from_slice(&json::to_vec(&source).unwrap()).unwrap();
    let canonical = kitten4::to_neko(&loaded).unwrap();
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&canonical).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        let frame = vm
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
            .unwrap();
        assert_eq!(
            frame
                .sprites
                .iter()
                .find(|s| s.id == "nekoc-pen-actor")
                .unwrap()
                .x,
            // The K4 stage timer is idle (0) until a timer block starts it.
            9999.0
        );
    }
    assert!(json::equal(
        &kitten4::from_neko(&canonical).unwrap(),
        &source
    ));
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
fn ten_thousand_statement_bodies_compile_and_run() {
    let mut body = json!({"id":"leaf","type":"self_pen_down"});
    for i in (0..9999).rev() {
        let mut node = json!({"id":format!("statement-{i}"),"type":"warp","statements":{}});
        node["statements"]["DO"] = body;
        body = node;
    }
    let mut canonical = json::from_str(include_str!("../samples/native-studio.bcmkn")).unwrap();
    let scene = canonical["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"] = json!([]);
    let mut hat = json!({"id":"hat","type":"on_running_group_activated"});
    hat["next"] = body;
    canonical["scenes"]["scenesDict"][&scene]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(hat);
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.start();
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
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
        error.contains(&format!(
            "path exceeds {} at block z{:05}",
            json::MAX_BLOCK_PATH,
            json::MAX_BLOCK_PATH + 1
        )),
        "{error}"
    );
}

fn canonical_script(body: Value) -> Json {
    let mut project = json::from_str(include_str!("../samples/native-studio.bcmkn")).unwrap();
    for section in ["scenes", "actors", "procedures"] {
        let dict = format!("{section}Dict");
        for owner in project[section][&dict]
            .as_object_mut()
            .into_iter()
            .flat_map(|o| o.values_mut())
        {
            json::discard(owner["nekoBlockJsonList"].take());
            owner["nekoBlockJsonList"] = json!([]);
        }
    }
    let scene = project["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut hat = json!({"type":"on_running_group_activated","id":"hat"});
    hat["next"] = body;
    project["scenes"]["scenesDict"][scene]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(hat);
    project
}

#[test]
fn ten_thousand_mixed_value_edges_and_legacy_interpreter() {
    let mut value = json!({"type":"math_number","fields":{"NUM":7}});
    for i in 0..9999 {
        let mut node = if i % 2 == 0 {
            json!({"id":format!("mix{i}"),"type":"convert_type","fields":{"type":"string"},"inputs":{}})
        } else {
            json!({"id":format!("mix{i}"),"type":"convert_type","fields":{"type":"number"},"inputs":{}})
        };
        node["inputs"]["text"] = value;
        value = node;
    }
    let mut body = json!({"id":"log","type":"console_log","inputs":{}});
    body["inputs"]["console_log"] = value;
    let project = canonical_script(body);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.disable_jit();
    vm.start();
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert_eq!(
        nekoc::runtime::run_project(&project, 1).unwrap().logs,
        ["7"]
    );
}

#[test]
fn ten_thousand_branch_and_loop_frames_patch_correctly() {
    let mut body = json!({"id":"leaf","type":"console_log","inputs":{"console_log":{"type":"text","fields":{"TEXT":"deep"}}}});
    for i in 0..9999 {
        let mut node = match i % 3 {
            0 => {
                json!({"id":format!("branch{i}"),"type":"controls_if","inputs":{"IF0":{"type":"logic_boolean","fields":{"BOOL":"TRUE"}}},"statements":{}})
            }
            1 => {
                json!({"id":format!("loop{i}"),"type":"repeat_n_times","inputs":{"times":{"type":"math_number","fields":{"NUM":1}}},"statements":{}})
            }
            _ => json!({"id":format!("warp{i}"),"type":"warp","statements":{}}),
        };
        node["statements"][if i % 3 == 0 { "DO0" } else { "DO" }] = body;
        body = node;
    }
    let project = canonical_script(body);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.disable_jit();
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert_eq!(frame.logs, ["deep"]);
    let mut legacy = nekoc::runtime::Runtime::from_project(&project).unwrap();
    legacy.set_cooperative(true);
    legacy.start();
    legacy.run_ticks(100).unwrap();
    assert_eq!(legacy.snapshot().logs, ["deep"]);
}

#[test]
fn json_container_syntax_matches_serde() {
    for text in [
        "",
        "[",
        "{",
        "[0,]",
        "{\"a\":0,}",
        "[1 2]",
        "{\"a\" 1}",
        "{\"a\":}",
        "{0:1}",
        "[true,false,null,1.25e-4,\"汉字\\n\"]",
        "{\"a\":1,\"a\":2}",
        "[{} , []]",
        "[01]",
        "[-]",
        "[NaN]",
        "[truex]",
        "[0]\u{000b}",
    ] {
        for deep in [false, true] {
            let text = if deep {
                format!("{}{}{}", "[".repeat(70), text, "]".repeat(70))
            } else {
                text.to_owned()
            };
            let actual = json::from_str(&text);
            let expected = serde_json::from_str::<Value>(&text);
            assert_eq!(actual.is_ok(), expected.is_ok(), "{text:?}");
            if let (Ok(a), Ok(b)) = (actual, expected) {
                assert!(json::equal(&a, &b));
            }
        }
    }
}

#[test]
fn ten_thousand_flat_workspace_inputs_export_and_reimport() {
    let mut value = json!({"id":"leaf","type":"math_number","fields":{"NUM":1}});
    for i in 0..9999 {
        let mut block = json!({"id":format!("n{i}"),"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"B":{"id":format!("one{i}"),"type":"math_number","fields":{"NUM":1}}}});
        block["inputs"]["A"] = value;
        value = block;
    }
    let mut body = json!({"id":"set","type":"self_set_position_x","inputs":{}});
    body["inputs"]["value"] = value;
    let mut project = canonical_script(body);
    project["stageSize"] = json!({"width":1280,"height":720});
    let native = kitten4::from_neko(&project).unwrap();
    let loaded = json::from_slice(&json::to_vec(&native).unwrap()).unwrap();
    let canonical = kitten4::to_neko(&loaded).unwrap();
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.disable_jit();
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert!(frame.sprites.iter().any(|s| s.x == 10000.0));
}

#[test]
fn ten_thousand_next_links_and_explicit_block_budget() {
    let source = next_work(10000);
    let loaded = json::from_slice(&json::to_vec(&source).unwrap()).unwrap();
    let canonical = kitten4::to_neko(&loaded).unwrap();
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    vm.disable_jit();
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert_eq!(
        frame
            .sprites
            .iter()
            .find(|s| s.id == "nekoc-pen-actor")
            .unwrap()
            .x,
        10000.0
    );
    let mut block = json!({"id":"too-deep-leaf","type":"text","fields":{"TEXT":"end"}});
    for i in 0..=json::MAX_BLOCK_DEPTH {
        let mut parent = json!({"id":format!("limit{i}"),"type":"logic_negate","inputs":{}});
        parent["inputs"]["logic"] = block;
        block = parent;
    }
    let project = canonical_script(block);
    let error = Program::compile(&project).err().unwrap().to_string();
    assert!(error.contains("nesting exceeds 10000"), "{error}");
    assert!(error.contains("too-deep-leaf"), "{error}");
}

#[test]
fn deep_value_evaluation_preserves_random_order_and_count() {
    fn random() -> Value {
        json!({"type":"random_num","inputs":{"A":{"type":"math_number","fields":{"NUM":1}},"B":{"type":"math_number","fields":{"NUM":1000000}}}})
    }
    let mut value = Json::new(
        json!({"type":"math_arithmetic","fields":{"type":"minus"},"inputs":{"A":random(),"B":random()}}),
    );
    let mut results = Vec::new();
    for deep in [false, true] {
        if deep {
            for _ in 0..9996 {
                let mut parent =
                    json!({"type":"convert_type","fields":{"type":"number"},"inputs":{}});
                parent["inputs"]["text"] = value.into_value();
                value = parent.into();
            }
        }
        let mut body = json!({"type":"console_log","inputs":{},"next":{"type":"console_log","inputs":{"console_log":random()}}});
        body["inputs"]["console_log"] = json::clone_value(&value);
        let project = canonical_script(body);
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            vm.set_random_seed(12345);
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            results.push(
                vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
                    .unwrap()
                    .logs,
            );
        }
    }
    for result in &results[1..] {
        assert_eq!(result, &results[0]);
    }
}

#[test]
fn merged_private_statements_survive_ten_thousand_continuations() {
    let mut body = json!({"type":"variables_set","fields":{"variable":"private"},"inputs":{"value":{"type":"math_number","fields":{"NUM":40}}},
        "next":{"type":"change_variables","fields":{"variable":"private"},"inputs":{"value":{"type":"math_number","fields":{"NUM":2}}},
        "next":{"type":"show_hide_variables","fields":{"variable":"private","show_hide":"show"},
        "next":{"type":"variables_set","fields":{"variable":"result"},"inputs":{"value":{"type":"variables_get","fields":{"variable":"private"}}}}}}});
    for _ in 0..9999 {
        let mut parent = json!({"type":"warp","statements":{}});
        parent["statements"]["DO"] = body;
        body = parent;
    }
    let mut project = canonical_script(body);
    let scene = project["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    project["variables"]["variablesDict"]["private"] =
        json!({"id":"private","value":0,"isGlobal":false,"currentEntityId":scene});
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    let frame = vm
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert_eq!(vm.variable_text("result"), "42");
    assert!(!vm.program.variable_names.iter().any(|id| id == "private"));
    assert_eq!(frame.monitors[0].value, "42");
}

#[test]
fn merged_kitten4_calculate_and_typed_whole_follow_deep_value_edges() {
    for deep in [false, true] {
        let mut value = json!({"type":"text","params":{"TEXT":"7"}});
        for _ in 0..if deep { 4997 } else { 1 } {
            let mut calculate = json!({"type":"calculate","params":{}});
            calculate["params"]["input"] = value;
            value = json!({"type":"convert_type","params":{"type":"string"}});
            value["params"]["original_value"] = calculate;
        }
        let mut calculate = json!({"type":"calculate","params":{}});
        calculate["params"]["input"] = value;
        let mut whole = json!({"type":"math_number_property","params":{"PROPERTY":"WHOLE"}});
        whole["params"]["NUMBER_TO_CHECK"] = calculate;
        let mut arithmetic = json!({"type":"math_arithmetic","params":{"OP":"ADD","A":{"type":"math_number","params":{"NUM":10}}}});
        arithmetic["params"]["B"] = whole;
        let mut hat = json!({"id":"hat","type":"start_on_click","params":{},"next_block":{"type":"variables_set","params":{"VAR":"result"}}});
        hat["next_block"]["params"]["VALUE"] = arithmetic;
        let mut source = published(hat);
        source["variables"]["result"] =
            json!({"id":"result","value":0,"type":"any","is_global":true});
        let project = kitten4::to_neko(&source).unwrap();
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
                .unwrap();
            assert_eq!(vm.variable_text("result"), "11", "deep={deep}, jit={jit}");
        }
    }
}

#[test]
fn merged_private_clone_reporter_accepts_a_deep_numeric_index() {
    let mut index = json!({"type":"math_number","fields":{"NUM":0}});
    for _ in 0..9997 {
        let mut parent = json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"B":{"type":"math_number","fields":{"NUM":0}}}});
        parent["inputs"]["A"] = index;
        index = parent;
    }
    let mut body = json!({"type":"variables_set","fields":{"variable":"result"},"inputs":{"value":{"type":"get_clone_index_property","fields":{"sprite":"--self","attribute":"private"},"inputs":{}}}});
    body["inputs"]["value"]["inputs"]["index"] = index;
    let mut project = canonical_script(body);
    let scene = project["scenes"]["currentSceneId"]
        .as_str()
        .unwrap()
        .to_owned();
    project["variables"]["variablesDict"]["private"] =
        json!({"id":"private","value":42,"isGlobal":false,"currentEntityId":scene});
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
        .unwrap();
    assert_eq!(vm.variable_text("result"), "42");
}

#[test]
fn ten_thousand_kitten4_add_values_preserve_types_in_both_directions() {
    for right_deep in [false, true] {
        for text in [false, true] {
            let mut value = if text {
                json!({"type":"text","params":{"TEXT":"x"}})
            } else {
                json!({"type":"math_number","params":{"NUM":1}})
            };
            for _ in 0..9999 {
                let mut parent = json!({"type":"math_arithmetic","params":{"OP":"ADD"}});
                parent["params"][if right_deep { "B" } else { "A" }] = value;
                parent["params"][if right_deep { "A" } else { "B" }] =
                    json!({"type":"math_number","params":{"NUM":1}});
                value = parent;
            }
            let mut hat = json!({"id":"hat","type":"start_on_click","params":{},
                "next_block":{"id":"set","type":"variables_set","params":{"VAR":"result"},
                "next_block":{"type":"change_variable","params":{"valname":"result","method":"increase","n":{"type":"text","params":{"TEXT":"!"}}}}}});
            hat["next_block"]["params"]["VALUE"] = value;
            let mut source = published(hat);
            source["variables"]["result"] =
                json!({"id":"result","value":0,"type":"any","is_global":true});
            let project = kitten4::to_neko(&source).unwrap();
            for jit in [false, true] {
                let mut vm = Engine::new(Program::compile(&project).unwrap());
                if !jit {
                    vm.disable_jit();
                }
                vm.start();
                vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
                    .unwrap();
                let expected = if !text {
                    "10000!".to_owned()
                } else if right_deep {
                    format!("{}x!", "1".repeat(9999))
                } else {
                    format!("x{}!", "1".repeat(9999))
                };
                assert_eq!(
                    vm.variable_text("result"),
                    expected,
                    "right={right_deep}, text={text}, jit={jit}"
                );
            }
        }
    }
}

#[test]
fn kitten4_deep_add_evaluates_random_operands_once_in_order() {
    fn random(a: f64, b: f64) -> Value {
        json!({"type":"random","params":{"a":{"type":"math_number","params":{"NUM":a}},"b":{"type":"math_number","params":{"NUM":b}}}})
    }
    let mut results = Vec::new();
    for deep in [false, true] {
        let mut value = json!({"type":"math_arithmetic","params":{"OP":"ADD","A":random(0.25, 10.75),"B":random(100.5, 10000.25)}});
        for _ in 0..if deep { 9997 } else { 0 } {
            let mut parent = json!({"type":"math_arithmetic","params":{"OP":"ADD","B":{"type":"math_number","params":{"NUM":0}}}});
            parent["params"]["A"] = value;
            value = parent;
        }
        let mut hat = json!({"id":"hat","type":"start_on_click","params":{},"next_block":{"type":"variables_set","params":{"VAR":"first"},"next_block":{"type":"variables_set","params":{"VAR":"second","VALUE":random(0.25, 10.75)}}}});
        hat["next_block"]["params"]["VALUE"] = value;
        let mut source = published(hat);
        for id in ["first", "second"] {
            source["variables"][id] = json!({"id":id,"value":0,"type":"any","is_global":true});
        }
        let project = kitten4::to_neko(&source).unwrap();
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            vm.set_random_seed(42);
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(60))
                .unwrap();
            results.push([vm.variable_text("first"), vm.variable_text("second")]);
        }
    }
    for result in &results[1..] {
        assert_eq!(result, &results[0]);
    }
}
