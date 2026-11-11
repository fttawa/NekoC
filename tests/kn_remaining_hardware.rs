//! Disconnected KN hardware, never a physical device simulator.
#[path = "../src/engine/kn_hardware.rs"]
mod profile;
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

const SENSORS: &[&str] = &[
    "microbit_accelerometer",
    "microbit_compass_heading",
    "microbit_light_level",
    "microbit_magnetometer",
    "microbit_rotation",
    "microbit_sound_level",
    "microbit_temperature",
];
const COMMANDS: &[&str] = &[
    "microbit_led_clear",
    "microbit_led_plot",
    "microbit_led_plot_graph",
    "microbit_led_show_custom",
    "microbit_led_show_icon",
    "microbit_led_show_number",
    "microbit_led_show_text",
    "microbit_led_toggle",
    "microbit_led_unplot",
    "microbit_pause_by_beats",
    "microbit_pin_analog_write",
    "microbit_pin_digital_write",
    "microbit_pin_set_touch_mode",
    "microbit_play_melody",
    "microbit_play_tone_by_beats",
    "microbit_servo_set_angle_270",
    "microbit_set_volume",
    "microbit_stop",
    "wand_reset_position",
    "set_robot_master_light_color",
    "set_robot_master_light_color_duration",
    "stop_robot_master_light",
    "set_robot_master_motor_power_rotation",
    "set_robot_master_motor_power_rotation_duration",
    "change_robot_master_motor_power",
    "stop_robot_master_motor",
    "set_robot2_master_motor_power_rotation",
    "set_robot2_master_motor_power_rotation_duration",
    "change_robot2_master_motor_power",
    "stop_robot2_master_motor",
];
const EVENTS: &[&str] = &[
    "microbit_button_when",
    "microbit_logo_when",
    "microbit_pin_when",
    "catbit_button_when",
    "catbit_usb_button_when",
    "wand_direction_when",
];
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn number(n: usize) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn log(v: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":v}})
}
fn chain(blocks: Vec<Value>) -> Value {
    blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}
fn project(roots: Vec<Value>) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["obj"] =
        json!({"id":"obj","name":"obj","type":"variable","value":{}});
    p["variables"]["variableIds"] = json!(["obj"]);
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!(roots);
    p
}
fn start(blocks: Vec<Value>) -> Value {
    json!({"type":"on_running_group_activated","next":chain(blocks)})
}
fn vm(p: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(p).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.start();
    vm
}
fn tick(vm: &mut Engine) -> Vec<String> {
    vm.advance(1.0 / 60.0, 10000, Duration::from_secs(1))
        .unwrap()
        .logs
}
fn object() -> Value {
    json!({"type":"variables_get","fields":{"variable":"obj"}})
}
fn set(key: &str, value: Value) -> Value {
    json!({"type":"_object_set","inputs":{"obj":object(),"key":text(key),"value":value}})
}
fn get(key: &str) -> Value {
    json!({"type":"_object_get","inputs":{"obj":object(),"key":text(key)}})
}
fn command(name: &str, value: impl Fn(usize) -> Value) -> Value {
    let mut b = json!({"type":name,"fields":{"key":"invalid","value":"invalid","mode":"invalid"}});
    for (i, socket) in profile::async_command(name).unwrap().iter().enumerate() {
        b["inputs"][*socket] = value(i);
    }
    b
}

#[test]
fn seven_sensors_keep_number_nan_in_typed_numeric_and_deep_paths() {
    assert_eq!(SENSORS.len() + COMMANDS.len() + EVENTS.len(), 43);
    for &name in SENSORS {
        let _ = profile::command(name); // Also compile the profile's synchronous API.
        assert_eq!(
            profile::reporter(name).unwrap().result,
            profile::DisconnectedValue::NumberNaN
        );
        let sensor = json!({"type":name,"fields":{"key":"invalid","rotation":""}});
        let mut deep = sensor.clone();
        for _ in 0..70 {
            deep = json!({"type":"logic_negate","inputs":{"logic":deep}});
        }
        let p = project(vec![start(vec![
            log(sensor.clone()),
            log(
                json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":sensor,"B":number(1)}}),
            ),
            log(deep),
        ])]);
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            let logs: Vec<_> = (0..10).flat_map(|_| tick(&mut vm)).collect();
            assert_eq!(logs, ["NaN", "NaN", "false"], "{name}");
        }
    }
}

#[test]
fn each_promise_reporter_has_its_own_next_update_continuation() {
    let sensor = |name: &str| json!({"type":name});
    let nested = json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{
        "A":sensor("microbit_temperature"),"B":sensor("microbit_light_level")}});
    for jit in [false, true] {
        let p = project(vec![
            start(vec![log(nested.clone()), log(text("after"))]),
            start(vec![log(text("other"))]),
        ]);
        let mut engine = vm(&p, jit);
        assert_eq!(tick(&mut engine), ["other"]);
        assert!(tick(&mut engine).is_empty());
        assert_eq!(tick(&mut engine), ["NaN", "after"]);
        for name in SENSORS {
            let p = project(vec![start(vec![log(sensor(name)), log(text("after"))])]);
            let mut vm = vm(&p, jit);
            assert!(tick(&mut vm).is_empty(), "{name}");
            assert_eq!(tick(&mut vm), ["NaN", "after"], "{name}");
        }
    }
}

#[test]
fn thirty_commands_evaluate_each_socket_once_in_order_and_continue() {
    for &name in COMMANDS {
        let sockets = profile::async_command(name).unwrap();
        let b = command(name, |i| {
            set(
                sockets[i],
                json!({"type":"_object_get","inputs":{"key":text("count"),"obj":set("count", json!({
                    "type":"math_arithmetic","fields":{"type":"add"},
                    "inputs":{"A":get("count"),"B":number(1)}
                }))}}),
            )
        });
        let mut blocks = vec![
            json!({"type":"_execute","inputs":{"action":set("count", number(0))}}),
            b,
        ];
        blocks.extend(sockets.iter().map(|s| log(get(s))));
        blocks.push(log(get("count")));
        let p = project(vec![start(blocks)]);
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            assert!(tick(&mut vm).is_empty(), "{name}: Promise must suspend");
            let logs: Vec<_> = (0..5).flat_map(|_| tick(&mut vm)).collect();
            let expected: Vec<_> = (1..=sockets.len())
                .chain(std::iter::once(sockets.len()))
                .map(|i| i.to_string())
                .collect();
            assert_eq!(logs, expected, "{name}");
        }
        for socket in sockets {
            let mut b = command(name, |_| number(1));
            b["inputs"].as_object_mut().unwrap().remove(*socket);
            assert!(
                Program::compile(&project(vec![start(vec![b])])).is_err(),
                "{name}:{socket}"
            );
            let mut b = command(name, |_| number(1));
            b["inputs"][*socket] = json!({"type":"unimplemented-input"});
            assert!(
                Program::compile(&project(vec![start(vec![b])])).is_err(),
                "{name}:{socket}"
            );
            let mut b = command(name, |_| number(1));
            b["inputs"][*socket] = json!({"type":"calculate","inputs":{"input":text("1+")}});
            let p = project(vec![start(vec![b, log(text("must not run"))])]);
            let mut vm = vm(&p, false);
            assert!(
                vm.advance(0.0, 10000, Duration::from_secs(1)).is_err(),
                "{name}:{socket}"
            );
        }
    }
    assert!(profile::async_command("microbit_future_command").is_none());
}

#[test]
fn nested_await_freezes_prior_values_and_never_repeats_side_effects() {
    let sensor = || json!({"type":"microbit_temperature"});
    let counted = json!({"type":"_object_get","inputs":{"obj":set("count", json!({
        "type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":get("count"),"B":number(1)}
    })),"key":text("count")}});
    let expr = json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":counted,"B":sensor()}});
    for jit in [false, true] {
        let p = project(vec![start(vec![
            json!({"type":"_execute","inputs":{"action":set("count", number(0))}}),
            log(expr.clone()),
            log(get("count")),
            json!({"type":"repeat_n_times","inputs":{"times":number(3)},"statements":{"DO":log(sensor())}}),
            log(text("done")),
        ])]);
        let mut vm = vm(&p, jit);
        assert!(tick(&mut vm).is_empty());
        assert_eq!(tick(&mut vm), ["NaN", "1"]);
        let logs: Vec<_> = (0..10).flat_map(|_| tick(&mut vm)).collect();
        assert_eq!(logs, ["NaN", "NaN", "NaN", "done"]);
    }
}

#[test]
fn asynchronous_loop_gates_and_wait_until_recompute_after_resume() {
    let condition = json!({"type":"logic_compare","fields":{"OP":"NEQ"},"inputs":{
        "A":{"type":"microbit_temperature"},"B":number(0)}});
    for jit in [false, true] {
        // NaN != 0 is true: until exits after its first await, while enters
        // and exits via break; neither gate may overwrite its await prologue.
        let p = project(vec![start(vec![
            json!({"type":"repeat_forever_until","inputs":{"condition":condition.clone()},"statements":{"DO":log(text("must not run"))}}),
            json!({"type":"controls_while","inputs":{"BOOL":condition.clone()},"statements":{"DO":{"type":"break"}}}),
            json!({"type":"wait_until","inputs":{"condition":condition.clone()}}),
            log(text("done")),
        ])]);
        let mut vm = vm(&p, jit);
        assert!(tick(&mut vm).is_empty());
        assert!(tick(&mut vm).is_empty());
        assert!(tick(&mut vm).is_empty());
        assert_eq!(tick(&mut vm), ["done"]);
    }
}

#[test]
fn six_event_bodies_are_validated_but_not_dispatched_by_start_or_input() {
    for &name in EVENTS {
        for statement in [true, false] {
            let mut hat = json!({"type":name,"fields":{"key":"A","value":"down","type":"down"}});
            if statement {
                hat["statements"]["DO"] = log(text("device event"));
            } else {
                hat["next"] = log(text("device event"));
            }
            let p = project(vec![hat.clone(), start(vec![log(text("start"))])]);
            for jit in [false, true] {
                let mut vm = vm(&p, jit);
                let logs: Vec<_> = (0..100)
                    .flat_map(|_| {
                        vm.key_event("A", true);
                        tick(&mut vm)
                    })
                    .collect();
                assert_eq!(logs, ["start"], "{name}");
                vm.start();
                assert_eq!(tick(&mut vm), ["start"], "{name}");
            }
            if statement {
                hat["statements"]["DO"] = json!({"type":"unknown-body"});
            } else {
                hat["next"] = json!({"type":"unknown-body"});
            }
            assert!(Program::compile(&project(vec![hat])).is_err(), "{name}");
        }
    }
}
