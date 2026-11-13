//! Synthetic legacy audio probes, not official browser playback tests.
//! Oracle: read-only player_v2.2d180c468559fbd29528.js.orig, module xQfl.
//! All offsets in docs/kitten4-audio-aliases.md are factory-relative UTF-16.
use nekoc::{
    engine::{Engine, Frame, Program},
    kitten4,
};
use serde_json::{Map, Value, json};
use std::time::Duration;

const ACTOR: &str = "nekoc-pen-actor";
const AUDIO: &str = "12345678-1234-1234-1234-123456789abc";

#[derive(Clone, Copy, Debug)]
enum Source {
    Workspace,
    Published,
}
const SOURCES: [Source; 2] = [Source::Workspace, Source::Published];

fn block(kind: &str, fields: Value, inputs: Value) -> Value {
    json!({"type":kind,"fields":fields,"inputs":inputs})
}
fn number(value: f64) -> Value {
    block("math_number", json!({"NUM":value}), json!({}))
}
fn text(value: &str) -> Value {
    block("text", json!({"TEXT":value}), json!({}))
}
fn audio_probe(kind: &str, dynamic: bool) -> Value {
    probe(
        kind,
        if dynamic {
            json!({})
        } else {
            json!({"audio":AUDIO})
        },
        if dynamic {
            json!({"audio":text(AUDIO)})
        } else {
            json!({})
        },
    )
}
fn probe(kind: &str, fields: Value, inputs: Value) -> Value {
    let mut node = block(kind, fields, inputs);
    node["id"] = json!("audio-probe");
    node
}
fn identify(node: &mut Value, serial: &mut usize) {
    if node.get("id").is_none() {
        node["id"] = json!(format!("audio-node-{serial}"));
        *serial += 1;
    }
    for child in node["inputs"]
        .as_object_mut()
        .into_iter()
        .flat_map(Map::values_mut)
    {
        identify(child, serial);
    }
    if let Some(next) = node.get_mut("next") {
        identify(next, serial);
    }
}
fn published(node: &Value) -> Value {
    let mut params = node["fields"].as_object().cloned().unwrap_or_default();
    for (name, child) in node["inputs"].as_object().into_iter().flatten() {
        params.insert(name.clone(), published(child));
    }
    let mut result = json!({"id":node["id"],"kind":"domain_block",
        "type":node["type"],"params":params,"child_block":[],
        "audio_fixture_metadata":{"preserve":true}});
    if let Some(next) = node.get("next") {
        result["next_block"] = published(next);
    }
    result
}
fn flatten(node: &Value, blocks: &mut Map<String, Value>, edges: &mut Map<String, Value>) {
    let id = node["id"].as_str().unwrap();
    let mut flat = node.clone();
    let object = flat.as_object_mut().unwrap();
    object.remove("inputs");
    object.remove("next");
    object.insert("shadows".into(), json!({}));
    object.insert("audio_fixture_metadata".into(), json!({"preserve":true}));
    blocks.insert(id.into(), flat);
    let mut connections = Map::new();
    for (name, child) in node["inputs"].as_object().into_iter().flatten() {
        connections.insert(
            child["id"].as_str().unwrap().into(),
            json!({"type":"input","input_name":name,"input_type":"value"}),
        );
        flatten(child, blocks, edges);
    }
    if let Some(next) = node.get("next") {
        connections.insert(next["id"].as_str().unwrap().into(), json!({"type":"next"}));
        flatten(next, blocks, edges);
    }
    if !connections.is_empty() {
        edges.insert(id.into(), Value::Object(connections));
    }
}
fn project(source: Source, statements: Vec<Value>) -> Value {
    let mut native: Value =
        serde_json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap();
    // Local synthetic duration is a NekoC headless fixture convention, not a
    // claim that the official player estimates media duration from this field.
    native["audio"] = json!({AUDIO:{"id":AUDIO,"name":"tone","duration":0.1,
        "volume":1,"playback_rate":1}});
    native["audio_order"] = json!([AUDIO]);
    native["variables"] = json!({"after":{"id":"after","name":"after",
        "type":"any","value":0,"is_global":true}});
    let mut next = block(
        "variables_set",
        json!({"VAR":"after"}),
        json!({"VALUE":number(1.0)}),
    );
    for mut statement in statements.into_iter().rev() {
        statement["next"] = next;
        next = statement;
    }
    let mut root = block("start_on_click", json!({}), json!({}));
    root["id"] = json!("audio-hat");
    root["next"] = next;
    identify(&mut root, &mut 0);
    match source {
        Source::Workspace => {
            let (mut blocks, mut connections) = (Map::new(), Map::new());
            flatten(&root, &mut blocks, &mut connections);
            native["theatre"]["actors"][ACTOR]["block_data_json"] =
                json!({"blocks":blocks,"connections":connections,"comments":{}});
        }
        Source::Published => {
            for section in ["actors", "scenes"] {
                for owner in native["theatre"][section]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                {
                    owner.as_object_mut().unwrap().remove("block_data_json");
                }
            }
            native["compile_result"] = json!([{"id":ACTOR,"procedures":{},
                "compiled_block_map":{"audio-hat":published(&root)}}]);
        }
    }
    native
}
fn find<'a>(value: &'a Value, id: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => {
            if object.get("id").and_then(Value::as_str) == Some(id) {
                return Some(value);
            }
            object.values().find_map(|child| find(child, id))
        }
        Value::Array(items) => items.iter().find_map(|child| find(child, id)),
        _ => None,
    }
}
fn imported(native: &Value, kind: &str) -> nekoc::json::Json {
    let canonical = kitten4::to_neko(native).unwrap();
    assert!(
        find(&canonical["actors"], "audio-probe").unwrap()["type"]
            .as_str()
            .unwrap()
            .starts_with("kitten4::")
    );
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *native);
    let saved = canonical.clone();
    let lowered = kitten4::lower_for_vm(&canonical);
    assert_eq!(
        find(&lowered["actors"], "audio-probe").unwrap()["type"],
        kind
    );
    assert_eq!(canonical, saved);
    canonical
}
fn engine(canonical: &Value, interpreted: bool, browser: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(canonical).unwrap());
    vm.use_virtual_clock();
    if interpreted {
        vm.disable_jit();
    }
    if browser {
        vm.use_browser_audio();
    }
    vm.start();
    vm
}
fn tick(vm: &mut Engine, dt: f64) -> Frame {
    vm.advance(dt, 100_000, Duration::from_secs(1)).unwrap()
}
fn roundtrip(canonical: &Value, saved: &Value, native: &Value) {
    assert_eq!(
        canonical, saved,
        "compilation must not edit the canonical AST"
    );
    assert_eq!(kitten4::from_neko(canonical).unwrap(), *native);
}

#[test]
fn legacy_audio_play_static_and_dynamic_preserve_target_and_continuation() {
    // xQfl factory 31836: direct audio ID, not the _2 name/index resolver.
    for source in SOURCES {
        for dynamic in [false, true] {
            let native = project(source, vec![audio_probe("play_audio", dynamic)]);
            let canonical = imported(&native, "play_audio");
            let saved = canonical.clone();
            for interpreted in [false, true] {
                let mut vm = engine(&canonical, interpreted, false);
                let frame = tick(&mut vm, 0.0);
                assert_eq!(vm.variable_text("after"), "1");
                assert_eq!(frame.audio_commands.len(), 1);
                let command = &frame.audio_commands[0];
                assert_eq!(command.audio.text(), AUDIO, "{source:?}, dynamic={dynamic}");
                assert!(command.play && command.wait.is_none() && command.property.is_none());
                assert!(tick(&mut vm, 0.0).audio_commands.is_empty());
                roundtrip(&canonical, &saved, &native);
            }
        }
    }
}

#[test]
fn legacy_audio_wait_uses_headless_clock_or_explicit_browser_completion() {
    // xQfl factory 32000 forces lock, helper 24675 releases on completion.
    for source in SOURCES {
        for dynamic in [false, true] {
            let native = project(source, vec![audio_probe("play_audio_and_wait", dynamic)]);
            let canonical = imported(&native, "play_audio_and_wait");
            let saved = canonical.clone();
            for interpreted in [false, true] {
                for browser in [false, true] {
                    let mut vm = engine(&canonical, interpreted, browser);
                    let first = tick(&mut vm, 0.0);
                    assert_eq!(vm.variable_text("after"), "0");
                    assert_eq!(first.audio_commands.len(), 1);
                    assert_eq!(first.audio_commands[0].audio.text(), AUDIO);
                    let wait = first.audio_commands[0].wait.unwrap();
                    tick(&mut vm, 0.0);
                    assert_eq!(vm.variable_text("after"), "0");
                    tick(&mut vm, 0.05);
                    assert_eq!(vm.variable_text("after"), "0");
                    if browser {
                        tick(&mut vm, 1.0);
                        assert_eq!(vm.variable_text("after"), "0");
                        vm.audio_finished(wait + 1);
                        tick(&mut vm, 0.0);
                        assert_eq!(vm.variable_text("after"), "0");
                        vm.audio_finished(wait);
                        tick(&mut vm, 0.0);
                    } else {
                        tick(&mut vm, 0.05);
                    }
                    assert_eq!(vm.variable_text("after"), "1");
                    roundtrip(&canonical, &saved, &native);
                }
            }
        }
    }
}

#[test]
fn legacy_audio_properties_keep_signed_percentage_and_ignore_increase_dropdown() {
    // xQfl factory 32165 / 32400: typeof number; legacy change ignores increase.
    for source in SOURCES {
        for kind in ["set_volume_or_rate", "change_volume_or_rate"] {
            for key in ["volume", "rate"] {
                for dynamic in [false, true] {
                    for value in [25.0, -25.0] {
                        let mut inputs = json!({"audio_value":number(value)});
                        if dynamic {
                            inputs["audio"] = text(AUDIO);
                        }
                        let native = project(
                            source,
                            vec![probe(
                                kind,
                                json!({"audio":AUDIO,"audio_key":key,"increase":"decrease"}),
                                inputs,
                            )],
                        );
                        let canonical = imported(&native, &format!("{kind}_2"));
                        let saved = canonical.clone();
                        for interpreted in [false, true] {
                            let mut vm = engine(&canonical, interpreted, false);
                            let frame = tick(&mut vm, 0.0);
                            assert_eq!(vm.variable_text("after"), "1");
                            assert_eq!(frame.audio_commands.len(), 1);
                            let command = &frame.audio_commands[0];
                            assert_eq!(command.audio.text(), AUDIO);
                            let property = command.property.as_ref().unwrap();
                            assert_eq!(property.rate, key == "rate");
                            assert_eq!(property.change, kind == "change_volume_or_rate");
                            assert_eq!(property.value, value / 100.0);
                            roundtrip(&canonical, &saved, &native);
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn legacy_audio_properties_reject_text_and_boolean_instead_of_coercing() {
    for source in SOURCES {
        for kind in ["set_volume_or_rate", "change_volume_or_rate"] {
            for value in [
                text("50"),
                block("logic_boolean", json!({"BOOL":"TRUE"}), json!({})),
            ] {
                let native = project(
                    source,
                    vec![probe(
                        kind,
                        json!({"audio":AUDIO,"audio_key":"volume"}),
                        json!({"audio_value":value}),
                    )],
                );
                let canonical = imported(&native, &format!("{kind}_2"));
                let saved = canonical.clone();
                for interpreted in [false, true] {
                    let mut vm = engine(&canonical, interpreted, false);
                    assert!(tick(&mut vm, 0.0).audio_commands.is_empty());
                    assert_eq!(vm.variable_text("after"), "1");
                    roundtrip(&canonical, &saved, &native);
                }
            }
        }
    }
}

#[test]
fn legacy_infinite_rate_changes_clamp_but_modern_changes_ignore_them() {
    for source in SOURCES {
        for (value, legacy_seconds) in [("Infinity", 0.025), ("-Infinity", 2.0)] {
            for modern in [false, true] {
                let kind = if modern {
                    "change_volume_or_rate_2"
                } else {
                    "change_volume_or_rate"
                };
                let native = project(
                    source,
                    vec![
                        probe(
                            kind,
                            json!({"audio":AUDIO,"audio_key":"rate"}),
                            json!({"audio":text(AUDIO),"audio_value":block("math_number",json!({"NUM":value}),json!({}))}),
                        ),
                        block("play_audio_and_wait", json!({"audio":AUDIO}), json!({})),
                    ],
                );
                let canonical = imported(&native, "change_volume_or_rate_2");
                for interpreted in [false, true] {
                    let mut vm = engine(&canonical, interpreted, false);
                    let frame = tick(&mut vm, 0.0);
                    assert_eq!(frame.audio_commands.len(), if modern { 1 } else { 2 });
                    let seconds = if modern { 0.1 } else { legacy_seconds };
                    for _ in 0..7 {
                        tick(&mut vm, seconds / 8.0);
                        assert_eq!(vm.variable_text("after"), "0");
                    }
                    tick(&mut vm, seconds / 8.0);
                    assert_eq!(vm.variable_text("after"), "1");
                }
            }
        }
    }
}

#[test]
fn legacy_rate_changes_affect_wait_duration_and_clamp_at_resource_boundary() {
    // It at factory 32879 clamps rate to .05..4. Signed legacy change is
    // applied to the existing rate (1 here), not a percentage of that rate.
    for source in SOURCES {
        for (kind, value, seconds) in [
            ("set_volume_or_rate", 200.0, 0.05),
            ("change_volume_or_rate", 100.0, 0.05),
            ("set_volume_or_rate", 900.0, 0.025),
            ("set_volume_or_rate", 0.0, 2.0),
        ] {
            let native = project(
                source,
                vec![
                    probe(
                        kind,
                        json!({"audio":AUDIO,"audio_key":"rate","increase":"decrease"}),
                        json!({"audio_value":number(value)}),
                    ),
                    block("play_audio_and_wait", json!({"audio":AUDIO}), json!({})),
                ],
            );
            let canonical = imported(&native, &format!("{kind}_2"));
            let saved = canonical.clone();
            for interpreted in [false, true] {
                let mut vm = engine(&canonical, interpreted, false);
                let first = tick(&mut vm, 0.0);
                assert_eq!(first.audio_commands.len(), 2);
                assert_eq!(vm.variable_text("after"), "0");
                // advance clamps each frame's dt to .25 seconds. In the
                // minimum-rate case the full wait is 2 seconds, so two
                // nominal 1-second frames would advance only .5 seconds.
                // Eight equal steps stay within that cap for every case.
                for step in 1..=8 {
                    tick(&mut vm, seconds / 8.0);
                    assert_eq!(
                        vm.variable_text("after"),
                        if step == 8 { "1" } else { "0" },
                        "{source:?} {kind} value={value} interpreted={interpreted} \
                         step={step}/8 duration={seconds}"
                    );
                }
                roundtrip(&canonical, &saved, &native);
            }
        }
    }
}

#[test]
fn legacy_stop_all_is_ordered_nonblocking_and_uses_global_stop_token() {
    // xQfl factory 32686: unconditional global stop, no audio parameter.
    for source in SOURCES {
        let native = project(
            source,
            vec![
                block("play_audio", json!({"audio":AUDIO}), json!({})),
                probe("stop_all_audios", json!({"audio":"ignored"}), json!({})),
            ],
        );
        let canonical = imported(&native, "stop_audio");
        let saved = canonical.clone();
        for interpreted in [false, true] {
            let mut vm = engine(&canonical, interpreted, false);
            let frame = tick(&mut vm, 0.0);
            assert_eq!(vm.variable_text("after"), "1");
            assert_eq!(frame.audio_commands.len(), 2);
            assert!(frame.audio_commands[0].play);
            let stop = &frame.audio_commands[1];
            assert_eq!(stop.audio.text(), "all");
            assert!(!stop.play && stop.wait.is_none() && stop.property.is_none());
            roundtrip(&canonical, &saved, &native);
        }
    }
}
