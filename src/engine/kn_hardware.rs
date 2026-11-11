//! Measured KN disconnected profile for a runtime with an empty hardware Map.
//!
//! Official 0.27.4 lazy domain calls and actual panel socket definitions:
//! docs/kn-hardware-evidence.json; reproduce with tools/compat/kn-hardware-probe.mjs.
//! This is not a simulator. Do not use it after a hardware backend is installed.
//! Remaining synchronous evidence: docs/kn-hardware-remaining-evidence.json.
//! catbit/wand/tudao evidence: docs/kn-other-hardware-evidence.json.
//! Remaining async guards and dormant events: docs/kn-remaining-official.md.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DisconnectedValue {
    BooleanFalse,
    NumberNaN,
    Undefined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Reporter {
    pub result: DisconnectedValue,
    /// Required child block inputs, in official panel order. Evaluate ALL of
    /// these once before returning `result`; the domain guard is not permission
    /// to elide child evaluation, compile errors, or side effects.
    pub inputs: &'static [&'static str],
}

/// `None` is an unsupported block, never a default false/NaN fallback.
/// Menu fields are not child expressions. The measured disconnected result is
/// the same for the panel's menu options and invalid/empty field values.
pub(super) fn reporter(block_type: &str) -> Option<Reporter> {
    use DisconnectedValue::*;
    let (result, inputs): (_, &'static [&'static str]) = match block_type {
        "microbit_button_is_pressed" | "microbit_logo_is_pressed" | "microbit_is_gesture" => {
            (BooleanFalse, &[])
        }
        "catbit_button_is_pressed" | "wand_button_is_pressed" => (BooleanFalse, &[]),
        "wand_coordinate"
        | "wand_rotation"
        | "get_robot_master_motor_power"
        | "get_robot_master_infrared_sensor_distance"
        | "get_robot2_master_motor_power" => (NumberNaN, &[]),
        "microbit_led_is_plot" => (BooleanFalse, &["x", "y"]),
        "microbit_pin_digital_read" | "microbit_pin_analog_read" => (NumberNaN, &[]),
        "microbit_accelerometer"
        | "microbit_compass_heading"
        | "microbit_light_level"
        | "microbit_magnetometer"
        | "microbit_rotation"
        | "microbit_sound_level"
        | "microbit_temperature" => (NumberNaN, &[]),
        // Declared Number output does not change the actual undefined result.
        "microbit_get_volume" => (Undefined, &[]),
        "microbit_math_map" => (
            NumberNaN,
            &["value", "fromStart", "fromEnd", "toStart", "toEnd"],
        ),
        _ => return None,
    };
    Some(Reporter { result, inputs })
}

/// Exact Promise-command allowlist. No device method or duration is run while
/// disconnected, but all value sockets must be evaluated before awaiting the
/// already-fulfilled undefined result. Fields are deliberately not expressions.
pub(super) fn async_command(block_type: &str) -> Option<&'static [&'static str]> {
    Some(match block_type {
        "microbit_led_clear"
        | "microbit_led_show_custom"
        | "microbit_led_show_icon"
        | "microbit_pin_set_touch_mode"
        | "microbit_play_melody"
        | "microbit_stop"
        | "wand_reset_position"
        | "set_robot_master_light_color"
        | "stop_robot_master_light"
        | "stop_robot_master_motor"
        | "stop_robot2_master_motor" => &[],
        "microbit_led_plot" | "microbit_led_toggle" | "microbit_led_unplot" => &["x", "y"],
        "microbit_led_plot_graph" => &["value", "high"],
        "microbit_led_show_number" => &["num"],
        "microbit_led_show_text" => &["text"],
        "microbit_pause_by_beats" => &["beats"],
        "microbit_pin_analog_write" | "microbit_pin_digital_write" => &["value"],
        "microbit_play_tone_by_beats" => &["note", "beats"],
        "microbit_servo_set_angle_270" => &["angle"],
        "microbit_set_volume" => &["volume"],
        "set_robot_master_light_color_duration" => &["times"],
        "set_robot_master_motor_power_rotation" | "set_robot2_master_motor_power_rotation" => {
            &["power"]
        }
        "set_robot_master_motor_power_rotation_duration"
        | "set_robot2_master_motor_power_rotation_duration" => &["power", "times"],
        "change_robot_master_motor_power" | "change_robot2_master_motor_power" => &["n"],
        _ => return None,
    })
}

/// Only measured synchronous commands. Promise-returning guards must not be
/// collapsed to synchronous no-ops. Sockets still evaluate before the guard.
pub(super) fn command(block_type: &str) -> Option<&'static [&'static str]> {
    match block_type {
        "microbit_set_bpm" => Some(&["bpm"]),
        "microbit_change_bpm" => Some(&["offset"]),
        _ => None,
    }
}
