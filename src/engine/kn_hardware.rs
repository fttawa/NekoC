//! Measured KN microbit profile for a runtime with NO installed hardware.
//!
//! Official 0.27.4 lazy domain calls and actual panel socket definitions:
//! docs/kn-hardware-evidence.json; reproduce with tools/compat/kn-hardware-probe.mjs.
//! This is not a simulator. Do not use it after a hardware backend is installed.
//! Async reporters, commands, events and non-microbit hardware remain unsupported.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DisconnectedValue {
    BooleanFalse,
    NumberNaN,
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
        "microbit_led_is_plot" => (BooleanFalse, &["x", "y"]),
        "microbit_pin_digital_read" | "microbit_pin_analog_read" => (NumberNaN, &[]),
        "microbit_math_map" => (
            NumberNaN,
            &["value", "fromStart", "fromEnd", "toStart", "toEnd"],
        ),
        _ => return None,
    };
    Some(Reporter { result, inputs })
}
