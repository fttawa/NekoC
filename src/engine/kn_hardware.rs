//! Measured KN disconnected profile for a runtime with an empty hardware Map.
//!
//! Official 0.27.4 lazy domain calls and actual panel socket definitions:
//! docs/kn-hardware-evidence.json; reproduce with tools/compat/kn-hardware-probe.mjs.
//! This is not a simulator. Do not use it after a hardware backend is installed.
//! Remaining synchronous evidence: docs/kn-hardware-remaining-evidence.json.
//! catbit/wand/tudao evidence: docs/kn-other-hardware-evidence.json.
//! Async reporters/commands and events remain unsupported.

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

/// Only measured synchronous commands. Promise-returning guards must not be
/// collapsed to synchronous no-ops. Sockets still evaluate before the guard.
pub(super) fn command(block_type: &str) -> Option<&'static [&'static str]> {
    match block_type {
        "microbit_set_bpm" => Some(&["bpm"]),
        "microbit_change_bpm" => Some(&["offset"]),
        _ => None,
    }
}
