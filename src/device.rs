//! Public host boundary for K4 mobile and sensor inputs.
//!
//! The event variants are deliberately independent of browser DOM event
//! objects so CLI replay, the web player, and embedders share one contract.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeviceInput {
    /// DeviceMotion accelerationIncludingGravity sample (m/s²).
    Motion { x: f64, y: f64, z: f64 },
    /// DeviceOrientation sample in degrees.
    Orientation {
        beta: f64,
        gamma: f64,
        portrait: bool,
    },
    /// A mobile service event already classified by its host.
    Event {
        action: String,
        device: String,
        value: String,
    },
    /// A mobile controller button transition.
    Button {
        device: String,
        event: String,
        button: String,
    },
}
