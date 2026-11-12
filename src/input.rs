//! Validated, frame-indexed DOM input replay for diagnostic clients.
use anyhow::{Result, ensure};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputScript {
    pub schema: String,
    pub events: Vec<InputEvent>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InputEvent {
    pub frame: u32,
    pub time_ms: f64,
    #[serde(flatten)]
    pub action: InputAction,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InputAction {
    Keydown {
        key_code: u8,
    },
    Keyup {
        key_code: u8,
    },
    Pointerdown {
        x: f64,
        y: f64,
        pointer_type: Option<PointerType>,
    },
    Pointermove {
        x: f64,
        y: f64,
        pointer_type: Option<PointerType>,
    },
    Pointerup {
        x: f64,
        y: f64,
        pointer_type: Option<PointerType>,
    },
    Pointercancel {
        x: f64,
        y: f64,
        pointer_type: Option<PointerType>,
    },
    #[serde(rename = "device_motion")]
    DeviceMotion {
        x: f64,
        y: f64,
        z: f64,
    },
    #[serde(rename = "device_orientation")]
    DeviceOrientation {
        beta: f64,
        gamma: f64,
        portrait: bool,
    },
    #[serde(rename = "device_event")]
    DeviceEvent {
        action: String,
        #[serde(default)]
        device: String,
        #[serde(default)]
        value: String,
    },
    #[serde(rename = "mobile_button")]
    MobileButton {
        device: String,
        event: String,
        button: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PointerType {
    Mouse,
    Touch,
}

impl InputScript {
    pub fn validate(&self, frames: u32) -> Result<()> {
        ensure!(self.schema == "nekoc-input-v1", "expected nekoc-input-v1");
        let (mut frame, mut time) = (1, 0.0);
        for event in &self.events {
            ensure!(
                event.frame >= frame && event.frame <= frames,
                "input frames must be ordered and within the trace"
            );
            ensure!(
                event.time_ms.is_finite() && event.time_ms >= time,
                "input time_ms must be finite and nondecreasing"
            );
            match event.action {
                InputAction::Pointerdown { x, y, .. }
                | InputAction::Pointermove { x, y, .. }
                | InputAction::Pointerup { x, y, .. }
                | InputAction::Pointercancel { x, y, .. } => {
                    ensure!(x.is_finite() && y.is_finite(), "invalid input coordinate")
                }
                _ => {}
            }
            match &event.action {
                InputAction::DeviceMotion { x, y, z } => ensure!(
                    x.is_finite() && y.is_finite() && z.is_finite(),
                    "invalid device motion"
                ),
                InputAction::DeviceOrientation { beta, gamma, .. } => ensure!(
                    beta.is_finite() && gamma.is_finite(),
                    "invalid device orientation"
                ),
                _ => {}
            }
            frame = event.frame;
            time = event.time_ms;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct InputReplay {
    at: usize,
    pointer: Option<Pointer>,
}

struct Pointer {
    target: String,
    last: [f64; 2],
    start: [f64; 2],
    time_ms: f64,
}

impl InputReplay {
    pub fn before_frame(
        &mut self,
        engine: &mut crate::engine::Engine,
        script: &InputScript,
        frame: u32,
    ) {
        while let Some(event) = script.events.get(self.at).filter(|e| e.frame == frame) {
            self.at += 1;
            match &event.action {
                InputAction::Keydown { key_code } => engine.key_event(&key_code.to_string(), true),
                InputAction::Keyup { key_code } => engine.key_event(&key_code.to_string(), false),
                InputAction::Pointerdown { x, y, .. } => {
                    let target = engine.hit_test(*x, *y).unwrap_or("").to_owned();
                    self.pointer = Some(Pointer {
                        target: target.clone(),
                        last: [*x, *y],
                        start: [*x, *y],
                        time_ms: event.time_ms,
                    });
                    engine.pointer_event(&target, "mouse_down", *x, *y);
                }
                InputAction::Pointermove { x, y, .. } => {
                    engine.set_mouse(*x, *y);
                    if let Some(p) = &mut self.pointer
                        && x.abs() <= engine.program.width / 2.0
                        && y.abs() <= engine.program.height / 2.0
                    {
                        engine.drag_by(&p.target, *x - p.last[0], *y - p.last[1]);
                        p.last = [*x, *y];
                    }
                }
                InputAction::Pointerup { x, y, .. } => {
                    engine.set_mouse(*x, *y);
                    let target = engine.hit_test(*x, *y).unwrap_or("").to_owned();
                    if let Some(p) = self.pointer.take() {
                        let dx = *x - p.start[0];
                        let dy = *y - p.start[1];
                        let elapsed = event.time_ms - p.time_ms;
                        // The offline replay canvas has 1 CSS pixel per stage
                        // unit (web StageInput uses its actual CSS coordinates).
                        if dx != -dy
                            && dx.hypot(dy) > 10.0
                            && dx.abs().max(dy.abs()) / elapsed > 0.3
                        {
                            engine.swipe(if dx.abs() >= dy.abs() {
                                if dx > 0.0 { "right" } else { "left" }
                            } else if dy > 0.0 {
                                "up"
                            } else {
                                "down"
                            });
                        }
                        if p.target != target {
                            engine.pointer_event(&p.target, "", *x, *y);
                        }
                        let inside = *x >= -engine.program.width / 2.0
                            && *x < engine.program.width / 2.0
                            && *y <= engine.program.height / 2.0
                            && *y > -engine.program.height / 2.0;
                        engine.pointer_event(&target, if inside { "mouse_up" } else { "" }, *x, *y);
                        if inside && p.target == target && event.time_ms - p.time_ms < 1000.0 {
                            engine.pointer_event(&target, "mouse_click", *x, *y);
                        }
                    }
                }
                InputAction::Pointercancel { x, y, .. } => {
                    if let Some(p) = self.pointer.take() {
                        engine.pointer_event(&p.target, "", *x, *y);
                    }
                }
                InputAction::DeviceMotion { x, y, z } => {
                    engine.inject_k4_device(crate::device::DeviceInput::Motion {
                        x: *x,
                        y: *y,
                        z: *z,
                    });
                }
                InputAction::DeviceOrientation {
                    beta,
                    gamma,
                    portrait,
                } => {
                    engine.inject_k4_device(crate::device::DeviceInput::Orientation {
                        beta: *beta,
                        gamma: *gamma,
                        portrait: *portrait,
                    });
                }
                InputAction::DeviceEvent {
                    action,
                    device,
                    value,
                } => {
                    engine.inject_k4_device(crate::device::DeviceInput::Event {
                        action: action.clone(),
                        device: device.clone(),
                        value: value.clone(),
                    });
                }
                InputAction::MobileButton {
                    device,
                    event,
                    button,
                } => {
                    engine.inject_k4_device(crate::device::DeviceInput::Button {
                        device: device.clone(),
                        event: event.clone(),
                        button: button.clone(),
                    });
                }
            }
        }
    }
}
