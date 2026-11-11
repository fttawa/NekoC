//! Local host-backed KN reporters and code-API aliases.
//! This is a frame-sampled host boundary, not an emulation of KN Promise timing.
use super::*;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct State {
    volume: Option<f64>,
    pub(super) resolved: bool,
}

impl Compiler {
    /// Official JS-to-XML code API alias (main.8ccf2442.js:2797697).
    /// Deliberately reuse the native reporter compiler, including its errors.
    pub(super) fn kn_sprite_property(&mut self, block: &Value) -> Result<ExprOp> {
        ensure!(
            self.program.semantics == RuntimeSemantics::KnCurrent,
            "get_sprite_property requires KN semantics"
        );
        // Official code conversion normalizes named effects before its native
        // reporter lowering. Retain numeric spellings for canonical JSON.
        let attribute = match field(block, "attribute") {
            "color" => "0",
            "opacity" => "1",
            "brightness" => "2",
            "pixelate" => "3",
            "ripple" => "4",
            "distortion" => "5",
            "grayscale" => "6",
            attribute => attribute,
        };
        let (kind, key) = match attribute {
            "x" | "y" => ("coordinate_of_sprite", Some("coordinate")),
            "style_index" => ("style_of_sprite", None),
            "scale" | "width" | "height" | "direction" => {
                ("appearance_of_sprite", Some("appearance"))
            }
            "0" | "1" | "2" | "3" | "4" | "5" | "6" => ("effect_of_sprite", Some("effect")),
            "distance" => ("distance_to", None),
            other => bail!("unsupported get_sprite_property attribute {other}"),
        };
        let mut native = block.clone();
        native["type"] = Value::String(kind.into());
        native["fields"]
            .as_object_mut()
            .context("missing sprite property fields")?
            .remove("attribute");
        if let Some(key) = key {
            native["fields"][key] = Value::String(attribute.into());
        }
        // Native expressions are leaves. Extract the one compiled operation so
        // the caller adds it exactly once to its expression work list.
        let before = self.expression_work.len();
        self.expression_one(&native, 0)?;
        ensure!(
            self.expression_work.len() == before + 1,
            "invalid sprite alias lowering"
        );
        Ok(self.expression_work.pop().unwrap())
    }
}

impl Engine {
    /// Host sample already normalized by the KN browser algorithm to 0..100.
    /// Some completes with a sample; None explicitly completes record-disabled
    /// with NaN. Use set_kn_voice_pending for a host request not yet settled.
    /// Native/headless callers can supply samples without a browser extension.
    pub fn set_kn_voice_volume(&mut self, sample: Option<f64>) -> Result<()> {
        ensure!(
            sample.is_none_or(|n| n.is_finite() && (0.0..=100.0).contains(&n)),
            "KN microphone volume must be finite and within 0..100"
        );
        self.kn_local.volume = sample;
        self.kn_local.resolved = true;
        Ok(())
    }

    pub fn set_kn_voice_pending(&mut self) {
        self.kn_local.resolved = false;
        self.kn_local.volume = None;
    }

    pub(super) fn kn_voice_resolved(&self) -> bool {
        self.kn_local.resolved
    }

    pub(super) fn kn_voice_volume(&self) -> f64 {
        // Async lowering must check resolved before evaluating this getter.
        // Resolved None is the explicit record-disabled NaN, not denial.
        self.kn_local.volume.unwrap_or(f64::NAN)
    }
}
