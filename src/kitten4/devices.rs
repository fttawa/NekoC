//! The fixed offline player's ls7Z hardware domain, not hardware emulation.
//!
//! Keep source blocks opaque; this hook belongs exclusively in lower_block.
//! Official locations and the intentionally omitted toast UI are documented in
//! docs/kitten4-devices.md. Dynamic sockets are evaluated before the no-device
//! result, just as the official runner evaluates params before calling a domain.
use super::*;

pub(super) fn lower_devices(block: &mut Value) -> bool {
    let kind = block["type"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches(OPAQUE);
    let behavior = match kind {
        "is_get_sound"
        | "get_sound_intensity"
        | "is_get_light"
        | "get_light_sensor_intensity"
        | "is_switch_on"
        | "is_button_pressed"
        | "infrared_sensor_switch"
        | "is_sensor_get_line"
        | "is_get_sport"
        | "is_get_high_temp"
        | "is_get_magnetic"
        | "hcsr04_get_distance"
        | "dht11_get_temp_humi"
        | "get_press_intensity"
        | "soil_sensor_get_humi"
        | "grayscale_sensor_get"
        | "get_potentiometer_turn_angle"
        | "get_resistance_intensity"
        | "joystick_get_x_value"
        | "joystick_get_y_value"
        | "is_joystick_pressed"
        | "get_distance"
        | "sensor_get_light_intensity"
        | "sensor_get_sound_intensity"
        | "get_temp_humi"
        | "weeemake_get_potentiometer_angle"
        | "weeemake_get_double_line"
        | "weeemake_joystick_get_x_value"
        | "weeemake_joystick_get_y_value"
        | "is_touch_sensor_switch"
        | "is_infrared_control"
        | "weeemake_is_get_sport"
        | "microbit_is_press_key"
        | "microbit_is_incline"
        | "microbit_get_incline_angle"
        | "microbit_get_acceleration"
        | "microbit_get_light_intensity"
        | "microbit_get_temperature"
        | "microbit_get_compass_heading"
        | "microbit_get_compass_field_strength"
        | "microbit_is_pin_level" => Offline::Nan,
        // Despite their names, is_digital_port_status/get_analog_port_value
        // call the notice and return undefined; they do NOT return NaN.
        "set_digital_port_status"
        | "set_pwm_port_value"
        | "is_digital_port_status"
        | "get_analog_port_value"
        | "servo_motor_angle"
        | "led_light"
        | "led_light_intensity"
        | "dc_single_motor_turn"
        | "dc_single_motor_speed"
        | "dc_both_motor_turn"
        | "dc_both_motor_speed"
        | "buzzer_sound"
        | "shake_sensor"
        | "shake_sensor_intensity"
        | "led_light_on"
        | "car_light_on"
        | "digital_show"
        | "buzzer_play_midi"
        | "fan_speed"
        | "steering_angle"
        | "rgb_light_color"
        | "rgb_light_color_digital"
        | "weeemake_motor_turn_speed"
        | "microbit_display_lattice_image"
        | "microbit_display_custom_lattice_image"
        | "microbit_display_text"
        | "microbit_set_light_intensity"
        | "microbit_set_xy_light_intensity"
        | "microbit_turn_off_xy_light"
        | "microbit_clear_screen" => Offline::Notice,
        "microbit_when_press_key" | "microbit_when_incline" | "microbit_when_be_operated" => {
            Offline::Event
        }
        _ => return false,
    };
    let id = block["id"].clone();
    let next = block.get("next").cloned();
    let arguments: Vec<Value> = block["inputs"]
        .as_object_mut()
        .into_iter()
        .flat_map(Map::values_mut)
        .map(Value::take)
        .collect();
    let args = || {
        let inputs: Map<String, Value> = arguments
            .iter()
            .enumerate()
            .map(|(n, value)| (format!("ITEM{n}"), value.clone()))
            .collect();
        // Lists are truthy in the K4 VM. This evaluates values of any type,
        // without numeric/text coercion or short-circuiting between sockets.
        json!({"id":format!("{}-device-args", id.as_str().unwrap_or_default()),
            "type":"temporary_list","inputs":inputs})
    };
    let nan = || json!({"type":"math_number","fields":{"NUM":"NaN"}});
    *block = match behavior {
        Offline::Nan if arguments.is_empty() => {
            json!({"id":id,"type":"math_number","is_output":true,"fields":{"NUM":"NaN"}})
        }
        Offline::Nan => json!({"id":id,"type":"logic_ternary","is_output":true,
            "inputs":{"condition":args(),"ifTrue":nan(),"ifFalse":nan()}}),
        Offline::Notice if !arguments.is_empty() => {
            // is_output here is a VM-internal dormant-root marker: a loose
            // command stack must not become an event merely to eval params.
            // In an active chain controls_if still evaluates its condition.
            json!({"id":id,"type":"controls_if","is_output":true,
                "inputs":{"IF0":args()},"statements":{}})
        }
        Offline::Notice | Offline::Event => json!({"id":id,"type":"kitten4_noop"}),
    };
    if !matches!(behavior, Offline::Event)
        && let Some(next) = next
    {
        block["next"] = next;
    }
    // Events deliberately lose both next and statement bodies. VlbI/d removes
    // these roots from published works, and no hardware responder can fire them.
    true
}

#[derive(Clone, Copy)]
enum Offline {
    Nan,
    Notice,
    Event,
}
