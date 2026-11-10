//! Source-derived no-device probes, not physical-device/browser parity tests.
//! Official metadata and every ls7Z property offset: docs/kitten4-devices.md.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Map, Value, json};
use std::time::Duration;

const NAN: &[&str] = &[
    "is_get_sound",
    "get_sound_intensity",
    "is_get_light",
    "get_light_sensor_intensity",
    "is_switch_on",
    "is_button_pressed",
    "infrared_sensor_switch",
    "is_sensor_get_line",
    "is_get_sport",
    "is_get_high_temp",
    "is_get_magnetic",
    "hcsr04_get_distance",
    "dht11_get_temp_humi",
    "get_press_intensity",
    "soil_sensor_get_humi",
    "grayscale_sensor_get",
    "get_potentiometer_turn_angle",
    "get_resistance_intensity",
    "joystick_get_x_value",
    "joystick_get_y_value",
    "is_joystick_pressed",
    "get_distance",
    "sensor_get_light_intensity",
    "sensor_get_sound_intensity",
    "get_temp_humi",
    "weeemake_get_potentiometer_angle",
    "weeemake_get_double_line",
    "weeemake_joystick_get_x_value",
    "weeemake_joystick_get_y_value",
    "is_touch_sensor_switch",
    "is_infrared_control",
    "weeemake_is_get_sport",
    "microbit_is_press_key",
    "microbit_is_incline",
    "microbit_get_incline_angle",
    "microbit_get_acceleration",
    "microbit_get_light_intensity",
    "microbit_get_temperature",
    "microbit_get_compass_heading",
    "microbit_get_compass_field_strength",
    "microbit_is_pin_level",
];
const NOTICE: &[&str] = &[
    "set_digital_port_status",
    "set_pwm_port_value",
    "is_digital_port_status",
    "get_analog_port_value",
    "servo_motor_angle",
    "led_light",
    "led_light_intensity",
    "dc_single_motor_turn",
    "dc_single_motor_speed",
    "dc_both_motor_turn",
    "dc_both_motor_speed",
    "buzzer_sound",
    "shake_sensor",
    "shake_sensor_intensity",
    "led_light_on",
    "car_light_on",
    "digital_show",
    "buzzer_play_midi",
    "fan_speed",
    "steering_angle",
    "rgb_light_color",
    "rgb_light_color_digital",
    "weeemake_motor_turn_speed",
    "microbit_display_lattice_image",
    "microbit_display_custom_lattice_image",
    "microbit_display_text",
    "microbit_set_light_intensity",
    "microbit_set_xy_light_intensity",
    "microbit_turn_off_xy_light",
    "microbit_clear_screen",
];
const EVENTS: &[&str] = &[
    "microbit_when_press_key",
    "microbit_when_incline",
    "microbit_when_be_operated",
];

fn block(kind: &str, fields: Value, inputs: Value) -> Value {
    json!({"type":kind,"fields":fields,"inputs":inputs})
}
fn num(n: f64) -> Value {
    block("math_number", json!({"NUM":n}), json!({}))
}
fn set(name: &str, value: Value) -> Value {
    block("variables_set", json!({"VAR":name}), json!({"VALUE":value}))
}
fn random() -> Value {
    block(
        "random",
        json!({}),
        json!({"a":num(1.0),"b":num(1_000_000.0)}),
    )
}
fn chain(statements: Vec<Value>) -> Value {
    let mut next = Value::Null;
    for mut statement in statements.into_iter().rev() {
        if !next.is_null() {
            statement["next"] = next;
        }
        next = statement;
    }
    next
}
fn start(statements: Vec<Value>) -> Value {
    let mut root = block("start_on_click", json!({}), json!({}));
    root["next"] = chain(statements);
    root
}
fn identify(node: &mut Value, serial: &mut usize) {
    if node.get("id").is_none() {
        node["id"] = json!(format!("device-node-{serial}"));
        *serial += 1;
    }
    for socket in ["inputs", "statements"] {
        for child in node[socket]
            .as_object_mut()
            .into_iter()
            .flat_map(Map::values_mut)
        {
            identify(child, serial);
        }
    }
    if let Some(next) = node.get_mut("next") {
        identify(next, serial);
    }
}
fn published(node: &Value) -> Value {
    let mut params = node["fields"].as_object().cloned().unwrap_or_default();
    let mut conditions = vec![];
    for (name, child) in node["inputs"].as_object().into_iter().flatten() {
        if node["type"] == "controls_if" && name.starts_with("IF") {
            conditions.push(published(child));
        } else {
            params.insert(name.clone(), published(child));
        }
    }
    let children: Vec<Value> = node["statements"]
        .as_object()
        .into_iter()
        .flat_map(Map::values)
        .map(published)
        .collect();
    let mut result = json!({"id":node["id"],"kind":"domain_block",
        "type":node["type"],"params":params,"child_block":children,"conditions":conditions});
    if let Some(next) = node.get("next") {
        result["next_block"] = published(next);
    }
    result
}
fn flatten(node: &Value, blocks: &mut Map<String, Value>, edges: &mut Map<String, Value>) {
    let id = node["id"].as_str().unwrap();
    let mut flat = node.clone();
    for key in ["inputs", "statements", "next"] {
        flat.as_object_mut().unwrap().remove(key);
    }
    flat["shadows"] = json!({});
    flat["device_fixture_metadata"] = json!({"preserve":true});
    blocks.insert(id.into(), flat);
    let mut links = Map::new();
    for socket in ["inputs", "statements"] {
        for (name, child) in node[socket].as_object().into_iter().flatten() {
            links.insert(
                child["id"].as_str().unwrap().into(),
                json!({"type":"input",
                "input_name":name,"input_type":if socket == "inputs" {"value"} else {"statement"}}),
            );
            flatten(child, blocks, edges);
        }
    }
    if let Some(next) = node.get("next") {
        links.insert(next["id"].as_str().unwrap().into(), json!({"type":"next"}));
        flatten(next, blocks, edges);
    }
    if !links.is_empty() {
        edges.insert(id.into(), Value::Object(links));
    }
}
fn project(publish: bool, mut roots: Vec<Value>) -> Value {
    let mut native = json!({"version":25,"work_type":"KITTEN","project_name":"Synthetic device probe",
        "size":{"width":640,"height":360},"variables":{},"theatre":{
            "current_scene":"device-scene","scenes_order":["device-scene"],
            "styles":{},"groups":{},"actors":{"device-actor":{
                "id":"device-actor","name":"Synthetic actor","scene":"device-scene",
                "x":0,"y":0,"scale":100,"rotation":0,"visible":true,"styles":[]}},
            "scenes":{"device-scene":{"id":"device-scene","name":"Synthetic scene",
                "actors":["device-actor"],"styles":[]}}}});
    for name in ["result", "after", "scratch", "event"] {
        native["variables"][name] =
            json!({"id":name,"name":name,"type":"any","value":0,"is_global":true});
    }
    let mut serial = 0;
    for root in &mut roots {
        identify(root, &mut serial);
    }
    if publish {
        let compiled: Map<String, Value> = roots
            .iter()
            .map(|root| (root["id"].as_str().unwrap().into(), published(root)))
            .collect();
        native["compile_result"] =
            json!([{"id":"device-actor","procedures":{},"compiled_block_map":compiled}]);
    } else {
        let (mut blocks, mut connections) = (Map::new(), Map::new());
        for root in &roots {
            flatten(root, &mut blocks, &mut connections);
        }
        native["theatre"]["actors"]["device-actor"]["block_data_json"] =
            json!({"blocks":blocks,"connections":connections,"comments":{}});
        native["theatre"]["scenes"]["device-scene"]["block_data_json"] =
            json!({"blocks":{},"connections":{},"comments":{}});
    }
    native
}
fn find<'a>(value: &'a Value, id: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            if map.get("id").and_then(Value::as_str) == Some(id) {
                Some(value)
            } else {
                map.values().find_map(|child| find(child, id))
            }
        }
        Value::Array(items) => items.iter().find_map(|child| find(child, id)),
        _ => None,
    }
}
fn imported(native: &Value) -> nekoc::json::Json {
    let canonical = kitten4::to_neko(native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *native);
    canonical
}
fn run(canonical: &Value, interpreted: bool) -> Engine {
    let saved = canonical.clone();
    let mut vm = Engine::new(Program::compile(canonical).unwrap());
    vm.use_virtual_clock();
    vm.set_random_seed(0x7144);
    if interpreted {
        vm.disable_jit();
    }
    vm.start();
    for _ in 0..20 {
        vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
    }
    assert_eq!(*canonical, saved);
    assert_eq!(
        kitten4::from_neko(canonical).unwrap(),
        canonical["_nekocKitten4"]["source"]
    );
    vm
}
fn probe(kind: &str, inputs: Value) -> Value {
    let mut node = block(kind, json!({"port":"17","mode":"synthetic"}), inputs);
    node["id"] = json!("device-probe");
    node
}

#[test]
fn all_74_official_device_types_have_explicit_non_overlapping_cases() {
    assert_eq!((NAN.len(), NOTICE.len(), EVENTS.len()), (41, 30, 3));
    let mut types: Vec<_> = NAN.iter().chain(NOTICE).chain(EVENTS).collect();
    types.sort();
    types.dedup();
    assert_eq!(types.len(), 74);
}

#[test]
fn all_41_reporters_return_nan_not_zero_false_or_text() {
    for publish in [false, true] {
        for kind in NAN {
            let native = project(
                publish,
                vec![start(vec![
                    set("result", probe(kind, json!({}))),
                    set("after", num(1.0)),
                ])],
            );
            let canonical = imported(&native);
            assert_eq!(
                find(&canonical["actors"], "device-probe").unwrap()["type"],
                format!("kitten4::{kind}")
            );
            let lowered = kitten4::lower_for_vm(&canonical);
            assert_eq!(
                find(&lowered["actors"], "device-probe").unwrap()["fields"]["NUM"],
                "NaN"
            );
            for interpreted in [true, false] {
                let vm = run(&canonical, interpreted);
                assert_eq!(
                    vm.variable_text("result"),
                    "NaN",
                    "{kind} published={publish} interpreted={interpreted}"
                );
                assert_eq!(vm.variable_text("after"), "1");
            }
            // Verify the type as well as the printed spelling: NaN is falsy.
            let mut condition = block(
                "controls_if",
                json!({}),
                json!({"IF0":probe(kind,json!({}))}),
            );
            condition["statements"] = json!({"DO0":set("result",num(9.0))});
            let canonical = imported(&project(
                publish,
                vec![start(vec![condition, set("after", num(1.0))])],
            ));
            for interpreted in [true, false] {
                let vm = run(&canonical, interpreted);
                assert_eq!(
                    vm.variable_text("result"),
                    "0",
                    "NaN must not be truthy: {kind}"
                );
            }
        }
    }
}

#[test]
fn all_30_notice_commands_are_no_device_effect_with_continuation() {
    for publish in [false, true] {
        for kind in NOTICE {
            let canonical = imported(&project(
                publish,
                vec![start(vec![probe(kind, json!({})), set("after", num(1.0))])],
            ));
            let lowered = kitten4::lower_for_vm(&canonical);
            assert_eq!(
                find(&lowered["actors"], "device-probe").unwrap()["type"],
                "kitten4_noop"
            );
            for interpreted in [true, false] {
                let vm = run(&canonical, interpreted);
                assert_eq!(vm.variable_text("after"), "1", "{kind}");
            }
        }
    }
}

#[test]
fn hardware_events_never_start_or_compile_their_unreachable_bodies() {
    for publish in [false, true] {
        for kind in EVENTS {
            let mut event = probe(
                kind,
                json!({"unused":block("unknown_hardware_parameter",json!({}),json!({}))}),
            );
            event["next"] = chain(vec![
                set("event", num(1.0)),
                block("unreachable_hardware_body", json!({}), json!({})),
            ]);
            event["statements"] =
                json!({"DO":block("unreachable_hardware_statement",json!({}),json!({}))});
            let canonical = imported(&project(
                publish,
                vec![event, start(vec![set("after", num(1.0))])],
            ));
            let lowered = kitten4::lower_for_vm(&canonical);
            let event = find(&lowered["actors"], "device-probe").unwrap();
            assert_eq!(event["type"], "kitten4_noop");
            assert!(event.get("next").is_none() && event.get("statements").is_none());
            for interpreted in [true, false] {
                let vm = run(&canonical, interpreted);
                assert_eq!(vm.variable_text("event"), "0");
                assert_eq!(vm.variable_text("after"), "1");
            }
        }
    }
}

#[test]
fn no_device_handlers_still_evaluate_all_dynamic_parameters_once() {
    // inF4/eval_domain evaluates params before calling the ls7Z function.
    // A seeded random stream detects skipped, duplicated or short-circuited args.
    for publish in [false, true] {
        let reference = imported(&project(
            publish,
            vec![start(vec![
                set("scratch", random()),
                set("scratch", random()),
                set("after", random()),
            ])],
        ));
        for kind in NAN.iter().chain(NOTICE) {
            let device = probe(kind, json!({"first":random(),"second":random()}));
            let statement = if NAN.contains(kind) {
                set("result", device)
            } else {
                device
            };
            let canonical = imported(&project(
                publish,
                vec![start(vec![statement, set("after", random())])],
            ));
            for interpreted in [true, false] {
                let actual = run(&canonical, interpreted);
                let expected = run(&reference, interpreted);
                assert_eq!(
                    actual.variable_text("after"),
                    expected.variable_text("after"),
                    "{kind} params"
                );
                if NAN.contains(kind) {
                    assert_eq!(actual.variable_text("result"), "NaN");
                }
            }
        }
    }
}

#[test]
fn loose_device_commands_and_reporters_remain_dormant() {
    for publish in [false, true] {
        let reference = imported(&project(publish, vec![start(vec![set("after", random())])]));
        for kind in NAN.iter().chain(NOTICE) {
            let mut loose = probe(kind, json!({"dynamic":random()}));
            loose["next"] = set("event", num(1.0));
            let canonical = imported(&project(
                publish,
                vec![loose, start(vec![set("after", random())])],
            ));
            for interpreted in [true, false] {
                let actual = run(&canonical, interpreted);
                let expected = run(&reference, interpreted);
                assert_eq!(
                    actual.variable_text("after"),
                    expected.variable_text("after"),
                    "loose {kind}"
                );
                assert_eq!(actual.variable_text("event"), "0");
            }
        }
    }
}

#[test]
fn notice_only_sensor_names_do_not_forge_a_nan_reporter() {
    // These two official functions return undefined, unlike the 41 NaN ones.
    // No undefined-valued device expression exists in the VM: reject explicitly.
    for publish in [false, true] {
        for kind in ["is_digital_port_status", "get_analog_port_value"] {
            let canonical = imported(&project(
                publish,
                vec![start(vec![set("result", probe(kind, json!({})))])],
            ));
            assert!(
                Program::compile(&canonical).is_err(),
                "{kind} must not become a fabricated value"
            );
        }
    }
}

#[test]
fn unknown_hardware_names_stay_unsupported() {
    for publish in [false, true] {
        let canonical = imported(&project(
            publish,
            vec![start(vec![probe("microbit_unknown_operation", json!({}))])],
        ));
        let lowered = kitten4::lower_for_vm(&canonical);
        assert_eq!(
            find(&lowered["actors"], "device-probe").unwrap()["type"],
            "kitten4::microbit_unknown_operation"
        );
        assert!(Program::compile(&canonical).is_err());
    }
}
