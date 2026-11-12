//! Synthetic source-derived probes; no official projects, audio or source copied.
//! The main session wires k4_media into engine.rs before running these tests.
use nekoc::{
    engine::{Cell, Engine, Program},
    kitten4,
};
use serde_json::{Map, Value, json};
use std::time::Duration;

fn block(kind: &str, fields: Value, inputs: Value) -> Value {
    json!({"type":kind,"fields":fields,"inputs":inputs})
}
fn num(n: f64) -> Value {
    block("math_number", json!({"NUM":n}), json!({}))
}
fn text(s: &str) -> Value {
    block("text", json!({"TEXT":s}), json!({}))
}
fn set(value: Value) -> Value {
    block(
        "variables_set",
        json!({"VAR":"result"}),
        json!({"VALUE":value}),
    )
}
fn chain(nodes: Vec<Value>) -> Value {
    let mut next = Value::Null;
    for mut node in nodes.into_iter().rev() {
        if !next.is_null() {
            node["next"] = next;
        }
        next = node;
    }
    next
}
fn start(nodes: Vec<Value>) -> Value {
    let mut root = block("start_on_click", json!({}), json!({}));
    root["next"] = chain(nodes);
    root
}
fn ids(node: &mut Value, serial: &mut usize) {
    if node.get("id").is_none() {
        node["id"] = json!(format!("media-{serial}"));
        *serial += 1;
    }
    for key in ["inputs", "statements"] {
        for child in node[key]
            .as_object_mut()
            .into_iter()
            .flat_map(Map::values_mut)
        {
            ids(child, serial);
        }
    }
    if let Some(child) = node.get_mut("next") {
        ids(child, serial);
    }
}
fn published(node: &Value) -> Value {
    let mut params = node["fields"].as_object().cloned().unwrap_or_default();
    for (key, child) in node["inputs"].as_object().into_iter().flatten() {
        params.insert(key.clone(), published(child));
    }
    let mut result = json!({"id":node["id"],"kind":"domain_block","type":node["type"],
        "params":params,"child_block":node["statements"].as_object().into_iter().flat_map(Map::values).map(published).collect::<Vec<_>>()});
    if let Some(next) = node.get("next") {
        result["next_block"] = published(next);
    }
    result
}
fn flat(node: &Value, blocks: &mut Map<String, Value>, connections: &mut Map<String, Value>) {
    let id = node["id"].as_str().unwrap();
    let mut record = node.clone();
    for key in ["inputs", "statements", "next"] {
        record.as_object_mut().unwrap().remove(key);
    }
    record["shadows"] = json!({});
    record["media_metadata"] = json!({"keep":true});
    blocks.insert(id.into(), record);
    let mut edges = Map::new();
    for socket in ["inputs", "statements"] {
        for (key, child) in node[socket].as_object().into_iter().flatten() {
            edges.insert(
                child["id"].as_str().unwrap().into(),
                json!({"type":"input","input_name":key,
                "input_type":if socket == "inputs" {"value"} else {"statement"}}),
            );
            flat(child, blocks, connections);
        }
    }
    if let Some(next) = node.get("next") {
        edges.insert(next["id"].as_str().unwrap().into(), json!({"type":"next"}));
        flat(next, blocks, connections);
    }
    if !edges.is_empty() {
        connections.insert(id.into(), Value::Object(edges));
    }
}
fn project(publish: bool, mut roots: Vec<Value>) -> Value {
    let mut serial = 0;
    for node in &mut roots {
        ids(node, &mut serial);
    }
    let mut p = json!({"version":25,"work_type":"KITTEN","project_name":"Synthetic media probe",
        "size":{"width":640,"height":360},"variables":{"result":{"id":"result","name":"result","type":"any","value":0,"is_global":true}},
        "theatre":{"current_scene":"s","scenes_order":["s"],"styles":{},"groups":{},
            "actors":{"a":{"id":"a","name":"Synthetic actor","scene":"s","x":0,"y":0,"scale":100,"rotation":0,"visible":true,"styles":[]}},
            "scenes":{"s":{"id":"s","name":"Synthetic scene","actors":["a"],"styles":[]}}}});
    if publish {
        let compiled: Map<_, _> = roots
            .iter()
            .map(|n| (n["id"].as_str().unwrap().into(), published(n)))
            .collect();
        p["compile_result"] = json!([{"id":"a","procedures":{},"compiled_block_map":compiled}]);
    } else {
        let (mut blocks, mut connections) = (Map::new(), Map::new());
        for root in &roots {
            flat(root, &mut blocks, &mut connections);
        }
        p["theatre"]["actors"]["a"]["block_data_json"] =
            json!({"blocks":blocks,"connections":connections,"comments":{}});
        p["theatre"]["scenes"]["s"]["block_data_json"] =
            json!({"blocks":{},"connections":{},"comments":{}});
    }
    p
}
fn engine(publish: bool, interpreted: bool, roots: Vec<Value>) -> Engine {
    let native = project(publish, roots);
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let before = canonical.clone();
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    assert_eq!(canonical, before);
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    vm.use_virtual_clock();
    if interpreted {
        vm.disable_jit();
    }
    vm.start();
    vm
}
fn tick(vm: &mut Engine) -> nekoc::engine::Frame {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap()
}
fn result(vm: &Engine) -> Cell {
    vm.variable_value("result")
}
fn advance(vm: &mut Engine, n: usize) -> Vec<nekoc::engine::MediaOutput> {
    let mut output = Vec::new();
    for _ in 0..n {
        output.extend(tick(vm).k4_media_output);
    }
    output
}

#[test]
fn midi_object_identity_serialization_and_numbered_key_boundaries() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            for (note, expected) in [
                (0.0, 0.0),
                (1.0, 0.0),
                (1.5, 1.0),
                (88.0, 87.0),
                (100.0, 87.0),
            ] {
                let mut vm = engine(
                    publish,
                    interpreted,
                    vec![start(vec![
                        block(
                            "midi_play_num_note",
                            json!({}),
                            json!({"num_note":num(note),"beats":num(1.0)}),
                        ),
                        set(num(7.0)),
                    ])],
                );
                let frame = tick(&mut vm);
                assert_eq!(result(&vm).number(), 0.0);
                let output = serde_json::to_value(frame.k4_media_output).unwrap();
                assert_eq!(output[0]["key"], expected);
                assert_eq!(output[0]["seconds"], 0.75);
                advance(&mut vm, 60);
                assert_eq!(result(&vm).number(), 7.0);
            }
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![set(block(
                    "midi_get",
                    json!({"midi":"12"}),
                    json!({}),
                ))])],
            );
            tick(&mut vm);
            let value = result(&vm);
            assert_eq!(serde_json::to_value(&value).unwrap(), json!({"id":"12"}));
            assert!(value.number().is_nan());
            assert!(value.truth());
            assert_eq!(value.text(), "[object Object]");
            assert!(value.equals(&value.clone()));
            assert!(!value.equals(&value.deep_clone()));
        }
    }
}

#[test]
fn midi_objects_bypass_numeric_key_conversion_and_invalid_beats_do_not_wait() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block(
                        "midi_play_num_note",
                        json!({}),
                        json!({"num_note":block("midi_get",json!({"midi":"5"}),json!({})),"beats":num(0.1)}),
                    ),
                    block(
                        "midi_play_num_note",
                        json!({}),
                        json!({"num_note":text("12"),"beats":num(1.0)}),
                    ),
                    block(
                        "midi_play_note",
                        json!({}),
                        json!({"note":text("12suffix"),"beats":text("1")}),
                    ),
                    set(num(9.0)),
                ])],
            );
            let output = serde_json::to_value(tick(&mut vm).k4_media_output).unwrap();
            assert_eq!(output[0]["key"], "5");
            assert_eq!(output[0]["fade_seconds"], 0.2);
            advance(&mut vm, 20);
            assert_eq!(result(&vm).number(), 9.0);
            assert!(vm.take_k4_media_output().is_empty());
        }
    }
}

#[test]
fn midi_wait_string_beats_is_zero_but_still_yields() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block("midi_wait", json!({}), json!({"beats":text("100")})),
                    set(num(2.0)),
                ])],
            );
            tick(&mut vm);
            assert_eq!(result(&vm).number(), 0.0);
            advance(&mut vm, 5);
            assert_eq!(result(&vm).number(), 2.0);
        }
    }
}

#[test]
fn direct_note_uses_parse_int_and_rejects_out_of_range_numbered_inputs() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block(
                        "midi_play_num_note",
                        json!({}),
                        json!({"num_note":num(-1.0),"beats":num(1.0)}),
                    ),
                    block(
                        "midi_play_num_note",
                        json!({}),
                        json!({"num_note":num(101.0),"beats":num(1.0)}),
                    ),
                    block(
                        "midi_play_note",
                        json!({}),
                        json!({"note":text(" 0x10suffix"),"beats":num(0.1)}),
                    ),
                    set(num(3.0)),
                ])],
            );
            let output = serde_json::to_value(tick(&mut vm).k4_media_output).unwrap();
            assert_eq!(output.as_array().unwrap().len(), 1);
            assert_eq!(output[0]["key"], 16.0);
            advance(&mut vm, 20);
            assert_eq!(result(&vm).number(), 3.0);
        }
    }
}

#[test]
fn voice_dialogs_block_and_strict_results_are_not_text_answer_aliases() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            for answer in ["42", "-0", "01", "1e2", "", "猫"] {
                let mut vm = engine(
                    publish,
                    interpreted,
                    vec![start(vec![
                        block(
                            "self_ask_listen",
                            json!({"lang":"zh"}),
                            json!({"text":text("Synthetic question")}),
                        ),
                        set(block("get_voice_answer", json!({}), json!({}))),
                    ])],
                );
                tick(&mut vm);
                let requests = vm.pending_k4_media();
                assert_eq!(requests.len(), 1);
                assert_eq!(requests[0].text, "Synthetic question");
                assert_eq!(requests[0].language, "zh");
                assert!(vm.complete_k4_media(requests[0].id, answer));
                assert!(!vm.complete_k4_media(requests[0].id, "stale"));
                advance(&mut vm, 3);
                match answer {
                    "42" | "-0" => assert!(matches!(result(&vm), Cell::Number(_))),
                    _ => assert!(matches!(result(&vm), Cell::Text(_))),
                }
                assert_eq!(
                    result(&vm).text(),
                    if answer == "-0" { "0" } else { answer }
                );
            }
        }
    }
}

#[test]
fn recording_is_separate_and_play_is_nonblocking() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block("play_ask_record", json!({}), json!({})),
                    block(
                        "self_ask_record",
                        json!({"lang":"en"}),
                        json!({"TEXT":text("Record")}),
                    ),
                    block("play_ask_record", json!({}), json!({})),
                    set(block("get_voice_answer", json!({}), json!({}))),
                ])],
            );
            tick(&mut vm);
            assert!(vm.take_k4_media_output().is_empty());
            let request = vm.pending_k4_media().pop().unwrap();
            assert_eq!(request.text, "Record");
            assert!(vm.complete_k4_media(request.id, "synthetic-recording-token"));
            let output = serde_json::to_value(advance(&mut vm, 3)).unwrap();
            assert_eq!(output[0]["recording"], "synthetic-recording-token");
            assert_eq!(result(&vm).text(), "");
        }
    }
}

#[test]
fn camera_absence_does_not_block_and_success_requires_host_completion() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            for kind in ["turn_on_the_camera", "turn_on_the_qrcode_camera"] {
                let roots = vec![start(vec![
                    block(kind, json!({}), json!({})),
                    set(block("get_recognition_result", json!({}), json!({}))),
                ])];
                let mut absent = engine(publish, interpreted, roots.clone());
                tick(&mut absent);
                assert!(absent.pending_k4_media().is_empty());
                assert_eq!(result(&absent).text(), "");
                let mut vm = engine(publish, interpreted, roots);
                vm.set_k4_camera_available(true);
                tick(&mut vm);
                let request = vm.pending_k4_media().pop().unwrap();
                assert!(vm.complete_k4_media(request.id, "00123"));
                advance(&mut vm, 3);
                assert_eq!(result(&vm).text(), "00123");
                assert!(matches!(result(&vm), Cell::Text(_)));
            }
        }
    }
}

#[test]
fn display_result_waits_even_without_camera_and_restart_rejects_stale_reply() {
    let mut vm = engine(
        false,
        true,
        vec![start(vec![
            block("display_recognition_result", json!({}), json!({})),
            set(num(1.0)),
        ])],
    );
    tick(&mut vm);
    let old = vm.pending_k4_media()[0].id;
    advance(&mut vm, 3);
    assert_eq!(result(&vm).number(), 0.0);
    vm.start();
    tick(&mut vm);
    let new = vm.pending_k4_media()[0].id;
    assert!(new > old);
    assert!(!vm.complete_k4_media(old, ""));
    assert!(vm.complete_k4_media(new, ""));
    advance(&mut vm, 3);
    assert_eq!(result(&vm).number(), 1.0);
}

#[test]
fn each_device_hat_is_dormant_until_matching_explicit_event() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            for kind in [
                "on_mobile_slide",
                "on_mobile_slope",
                "on_mobile_shake",
                "on_shake",
                "on_tilt",
            ] {
                let mut hat = block(kind, json!({"mobile":"phone-a","type":"left"}), json!({}));
                hat["next"] = set(num(8.0));
                let mut vm = engine(publish, interpreted, vec![hat]);
                tick(&mut vm);
                assert_eq!(result(&vm).number(), 0.0);
                if kind.starts_with("on_mobile_") {
                    vm.k4_device_event(kind, "phone-b", "left");
                    tick(&mut vm);
                    assert_eq!(result(&vm).number(), 0.0);
                }
                vm.k4_device_event(kind, "phone-a", "left");
                tick(&mut vm);
                assert_eq!(result(&vm).number(), 8.0);
            }
        }
    }
}

#[test]
fn mobile_button_matches_casefolded_type_but_exact_device_and_event() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let button = block(
                "on_mobile_click_btn",
                json!({"mobile":"phone-a","btn_event_type":"down","type":"a"}),
                json!({}),
            );
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block("wait", json!({}), json!({"time":num(0.05)})),
                    set(button),
                ])],
            );
            tick(&mut vm);
            // Wait expires after several ticks; submit before every tick so exactly
            // the tick that reads the reporter sees the one-frame state.
            for _ in 0..10 {
                vm.k4_mobile_button("phone-a", "down", "A");
                tick(&mut vm);
            }
            assert!(matches!(result(&vm), Cell::Bool(true)));
        }
    }
}

#[test]
fn speaking_language_reaches_serialized_speech_commands() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            for (language, expected) in [
                ("japanese", "ja"),
                ("french", "fr"),
                ("spanish", "es-ES"),
                ("english", "en-UK"),
                ("chinese", "zh-CN"),
                ("unknown", "en-UK"),
            ] {
                let mut vm = engine(
                    publish,
                    interpreted,
                    vec![start(vec![
                        block(
                            "set_speaking_language",
                            json!({"language":language}),
                            json!({}),
                        ),
                        block("play_words_audio", json!({}), json!({"text":text("中文")})),
                    ])],
                );
                let frame = vm
                    .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                    .unwrap();
                assert_eq!(frame.speech_commands.len(), 1);
                assert_eq!(frame.speech_commands[0].language.as_deref(), Some(expected));
                assert_eq!(
                    serde_json::to_value(&frame).unwrap()["speech_commands"][0]["language"],
                    expected
                );
            }
        }
    }
}

#[test]
fn offline_translation_fallback_and_language_selection_and_vibration() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let long = "猫".repeat(220);
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block(
                        "set_speaking_language",
                        json!({"language":"japanese"}),
                        json!({}),
                    ),
                    block("shock_for_n_times", json!({}), json!({"times":num(1.2)})),
                    block("shock_duration", json!({}), json!({"duration":num(0.3)})),
                    block(
                        "translate",
                        json!({"language":"english"}),
                        json!({"text":text("hello")}),
                    ),
                    set(block(
                        "translate_result",
                        json!({"language":"english"}),
                        json!({"text":text(&long)}),
                    )),
                ])],
            );
            let frame = tick(&mut vm);
            assert_eq!(result(&vm).text(), "猫".repeat(200));
            assert_eq!(vm.k4_speech_language("test"), "ja");
            let output = serde_json::to_value(frame.k4_media_output).unwrap();
            assert_eq!(output[0]["pattern_ms"], json!([100.0, 100.0, 100.0, 100.0]));
            assert_eq!(output[1]["pattern_ms"], json!([300.0]));
            assert!(vm.pending_k4_media().is_empty());
        }
    }
}

#[test]
fn recognize_without_question_and_dialog_queue_fifo() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let roots = (0..2)
                .map(|_| {
                    start(vec![
                        block("voice_recognition", json!({"lang":"en"}), json!({})),
                        set(block("get_voice_answer", json!({}), json!({}))),
                    ])
                })
                .collect();
            let mut vm = engine(publish, interpreted, roots);
            tick(&mut vm);
            let first = vm.pending_k4_media()[0].id;
            assert!(vm.complete_k4_media(first, "12"));
            let second = vm.pending_k4_media()[0].id;
            assert!(second > first);
            assert!(vm.complete_k4_media(second, "13"));
            advance(&mut vm, 3);
            assert_eq!(result(&vm).number(), 13.0);
        }
    }
}

#[test]
fn button_root_restarts_only_after_body_and_one_frame_state_is_cleared() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut root = block(
                "on_mobile_click_btn",
                json!({"mobile":"phone-a","btn_event_type":"down","type":"a"}),
                json!({}),
            );
            root["next"] = set(num(6.0));
            let mut vm = engine(publish, interpreted, vec![root]);
            advance(&mut vm, 3);
            assert_eq!(result(&vm).number(), 0.0);
            vm.k4_mobile_button("phone-a", "down", "A");
            tick(&mut vm);
            assert_eq!(result(&vm).number(), 6.0);
        }
    }
}

#[test]
fn raw_motion_is_not_a_fabricated_mobile_service_event_and_restart_clears_it() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut hat = block("on_shake", json!({}), json!({}));
            hat["next"] = set(num(1.0));
            let mut vm = engine(publish, interpreted, vec![hat]);
            assert!(vm.k4_device_motion_sample().is_none());
            vm.inject_k4_device(nekoc::device::DeviceInput::Motion {
                x: 100.0,
                y: -100.0,
                z: 9.8,
            });
            tick(&mut vm);
            assert_eq!(vm.k4_device_motion_sample(), Some([100.0, -100.0, 9.8]));
            assert_eq!(result(&vm).number(), 0.0);
            vm.k4_device_motion(f64::NAN, 0.0, 0.0);
            assert_eq!(vm.k4_device_motion_sample(), Some([100.0, -100.0, 9.8]));
            vm.inject_k4_device(nekoc::device::DeviceInput::Event {
                action: "on_shake".into(),
                device: String::new(),
                value: String::new(),
            });
            tick(&mut vm);
            assert_eq!(result(&vm).number(), 1.0);
            vm.start();
            assert!(vm.k4_device_motion_sample().is_none());
        }
    }
}

#[test]
fn frame_drains_nonblocking_vibration_once_and_preserves_raw_duration() {
    for publish in [false, true] {
        for interpreted in [false, true] {
            let mut vm = engine(
                publish,
                interpreted,
                vec![start(vec![
                    block("shock_for_n_times", json!({}), json!({"times":num(-1.0)})),
                    block("shock_for_n_times", json!({}), json!({"times":num(1.01)})),
                    block("shock_duration", json!({}), json!({"duration":num(-0.5)})),
                    set(num(7.0)),
                ])],
            );
            let first = tick(&mut vm);
            assert_eq!(result(&vm).number(), 7.0);
            let output = serde_json::to_value(&first.k4_media_output).unwrap();
            assert_eq!(
                output,
                json!([
                    {"kind":"vibrate","pattern_ms":[]},
                    {"kind":"vibrate","pattern_ms":[100.0,100.0,100.0,100.0]},
                    {"kind":"vibrate","pattern_ms":[-500.0]}
                ])
            );
            assert!(vm.take_k4_media_output().is_empty());
            assert!(tick(&mut vm).k4_media_output.is_empty());
        }
    }
}
