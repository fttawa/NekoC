//! Fixed K4 Tn6a pen/stamp domain rules, separate from KN coercion and limits.
use super::{Cell, Engine, TextAlign, TextStamp};

#[derive(Clone, Copy, Debug)]
pub(super) enum Command {
    Text {
        text: usize,
        size: usize,
        align: TextAlign,
    },
    Size {
        value: usize,
        change: i8,
    },
}

pub(super) fn transition_kind(kind: &str, direction: &str) -> String {
    match kind {
        "distrot" => "distort".into(),
        "fadeInOut" => "fade_in_out".into(),
        "bounce" | "slide" => format!("{kind}_{direction}"),
        _ => kind.into(),
    }
}

impl Engine {
    /// Rt.set_pen_down tests both stored coordinates for JS truthiness. With
    /// either coordinate zero a repeated pen-down draws another dot; away from
    /// the axes it is idempotent. A down brush's stored origin is its position.
    pub(super) fn k4_pen_down_draws(&self, actor: usize) -> bool {
        let a = &self.sprites[actor];
        !a.pen || a.x == 0.0 || a.y == 0.0 || a.x.is_nan() || a.y.is_nan()
    }

    /// Rt draws a filled origin disk and then a closed two-point stroke. Both
    /// composite independently, including alpha; a zero-length path has no
    /// Canvas stroke. The sensing raster remains pixel-centre (not AA) based.
    pub(super) fn raster_k4_line(
        &mut self,
        from: (f64, f64),
        to: (f64, f64),
        size: f64,
        color: [f32; 4],
    ) {
        self.raster_line(from, from, size, color);
        if from != to {
            self.raster_line(from, to, size, color);
        }
    }

    pub(super) fn raster_k4_stamp(&mut self, actor: usize) {
        if self.sprites[actor].text.is_some() {
            return;
        }
        let Some(mut g) = self.geometry(actor) else {
            return;
        };
        // Same destination rectangle as Rt.draw_image_stamp / the viewer.
        let (w, h) = (g.width.abs(), g.height.abs());
        let dx = ((-w / 2.0).floor() + w.floor() / 2.0) * g.width.signum();
        let dy = -((-h / 2.0).floor() + h.floor() / 2.0) * g.height.signum();
        let (s, c) = g.angle.sin_cos();
        g.x += c * dx + s * dy;
        g.y += -s * dx + c * dy;
        g.width = w.floor() * g.width.signum();
        g.height = h.floor() * g.height.signum();
        let (l, r, b, t) = g.bounds();
        let (w, h) = self.raster_size();
        let (hw, hh) = (w as f64 / 2.0, h as f64 / 2.0);
        let mut texels = vec![];
        for py in (hh - t).floor().max(0.0) as usize..((hh - b).ceil().max(0.0) as usize).min(h) {
            for px in (l + hw).floor().max(0.0) as usize..((r + hw).ceil().max(0.0) as usize).min(w)
            {
                if let Some((u, v)) = g.uv(px as f64 + 0.5 - hw, hh - py as f64 - 0.5)
                    && let Some(rgb) = self.costume_texel(g.costume, u, v)
                {
                    texels.push(((py * w + px) * 4, rgb));
                }
            }
        }
        if let Some(raster) = self.raster_mut() {
            for (at, rgb) in texels {
                Self::blend_pixel(raster, at, rgb, 1.0);
            }
        }
    }

    pub(super) fn exec_k4_drawing(&mut self, command: Command, actor: usize) {
        // Tn6a/w accepts number except NaN, including infinities. Do not use
        // eval()/Cell::number(): strings and booleans must not be coerced here.
        match command {
            Command::Text { text, size, align } => {
                let text = self.eval_value(text, actor).text();
                let Cell::Number(size) = self.eval_value(size, actor) else {
                    return;
                };
                if size.is_nan() {
                    return;
                }
                let a = &self.sprites[actor];
                self.text_stamps.push(TextStamp {
                    before_line: self.lines.len() / 9,
                    text,
                    x: a.x,
                    y: a.y,
                    size: size.clamp(1.0, 10_000.0),
                    direction: a.direction - self.program.costume_turn,
                    align,
                    color: a.color,
                });
            }
            Command::Size { value, change } => {
                let Cell::Number(value) = self.eval_value(value, actor) else {
                    return;
                };
                if value.is_nan() {
                    return;
                }
                let a = &mut self.sprites[actor];
                let next = if change == 0 {
                    value
                } else {
                    a.size + value * f64::from(change)
                };
                a.size = next.clamp(1.0, 10_000.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{engine::Program, kitten4};
    use serde_json::Value;
    use std::time::Duration;

    #[test]
    fn k4_origin_disk_composites_separately_and_zero_path_has_no_stroke() {
        let native: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/kitten4/partial-pen-3-alpha-endpoints.bcm"
        ))
        .unwrap();
        let mut engine =
            Engine::new(Program::compile(&kitten4::to_neko(&native).unwrap()).unwrap());
        let color = [0.0, 0.0, 0.0, 0.5];
        engine.raster_k4_line((-120.0, 30.0), (-120.0, 30.0), 20.0, color);
        engine.raster_k4_line((-120.0, 30.0), (-20.0, 30.0), 20.0, color);
        let raster = engine.pen_rasters[engine.current_scene].as_ref().unwrap();
        // Canvas quantizes premultiplied alpha slightly differently (223/127);
        // this pixel-centre sensing raster intentionally rounds to 224/128.
        assert_eq!(raster[((360 - 30) * 960 + 480 - 120) * 4 + 3], 224);
        assert_eq!(raster[((360 - 30) * 960 + 480 - 70) * 4 + 3], 128);
    }

    #[test]
    fn k4_repeated_pen_down_only_redraws_when_an_origin_coordinate_is_falsy() {
        let native: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/kitten4/partial-pen-3-repeated-down-nonzero.bcm"
        ))
        .unwrap();
        let mut engine =
            Engine::new(Program::compile(&kitten4::to_neko(&native).unwrap()).unwrap());
        let actor = engine.sprites.iter().position(|a| !a.stage).unwrap();
        assert!(engine.k4_pen_down_draws(actor));
        engine.sprites[actor].pen = true;
        assert!(!engine.k4_pen_down_draws(actor));
        engine.sprites[actor].x = 0.0;
        assert!(engine.k4_pen_down_draws(actor));
        engine.sprites[actor].x = -120.0;
        engine.sprites[actor].y = 0.0;
        assert!(engine.k4_pen_down_draws(actor));
    }

    #[test]
    fn hidden_transparent_sprite_still_stamps_raw_pixels_into_color_raster() {
        let native: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/kitten4/partial-drawing-image-state.bcm"
        ))
        .unwrap();
        let mut program = Program::compile(&kitten4::to_neko(&native).unwrap()).unwrap();
        program.uses_color = true;
        let mut engine = Engine::new(program);
        engine.set_costume(
            "costume-a",
            super::super::Costume {
                width: 80.0,
                height: 40.0,
                center_point: [13.0, -7.0],
                mask: Some((1, 1, vec![1])),
                rgb: Some(vec![200, 40, 30]),
            },
        );
        engine.start();
        engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
        let pixels = engine.pen_rasters[engine.current_scene].as_ref().unwrap();
        let drawn = pixels
            .chunks_exact(4)
            .filter(|p| p[3] != 0)
            .collect::<Vec<_>>();
        assert!(!drawn.is_empty());
        assert!(drawn.iter().all(|p| *p == [200, 40, 30, 255]));
    }

    #[test]
    fn official_transition_state_and_brush_size() {
        let evidence: Value = serde_json::from_str(include_str!(
            "../../docs/kitten4-partial-drawing-evidence.json"
        ))
        .unwrap();
        for (name, case) in evidence["cases"].as_object().unwrap() {
            if !name.starts_with("transition-") && name != "pen-sizes" {
                continue;
            }
            let native: Value = serde_json::from_str(
                &std::fs::read_to_string(format!(
                    "tests/fixtures/kitten4/partial-drawing-{name}.bcm"
                ))
                .unwrap(),
            )
            .unwrap();
            for interpreted in [false, true] {
                let mut engine =
                    Engine::new(Program::compile(&kitten4::to_neko(&native).unwrap()).unwrap());
                if interpreted {
                    engine.disable_jit();
                }
                engine.start();
                for observation in case["observations"].as_array().unwrap() {
                    engine
                        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
                        .unwrap();
                    if name == "pen-sizes" {
                        let actor = engine.sprites.iter().find(|a| !a.stage).unwrap();
                        assert_eq!(actor.size, observation["sizes"][0].as_f64().unwrap());
                    } else {
                        let expected = case["observations"][0]["transition"].as_str().unwrap();
                        assert_eq!(
                            engine
                                .next_transition
                                .as_ref()
                                .map(|t| t.kind.as_str())
                                .unwrap_or("none"),
                            if expected.is_empty() {
                                "none"
                            } else {
                                expected
                            },
                            "{name}"
                        );
                    }
                }
            }
        }
    }
}
