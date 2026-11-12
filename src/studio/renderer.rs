//! Native egui geometry; no Canvas/WebView dependency. Independent partial
//! renderer: no promise of official filter, solver or subpixel equivalence.
use super::player::NativeSprite;
use crate::engine::SoftMesh;
use eframe::egui::{self, Color32, Mesh, Pos2, TextureId};

pub(super) fn soft_mesh(
    source: &SoftMesh,
    texture: TextureId,
    origin: Pos2,
    scale: f32,
    opacity: f64,
) -> Option<Mesh> {
    if !scale.is_finite()
        || scale <= 0.0
        || !origin.x.is_finite()
        || !origin.y.is_finite()
        || !opacity.is_finite()
        || source.vertices.len() > 65536
        || source.triangles.len() > 131072
    {
        return None;
    }
    let mut mesh = Mesh::with_texture(texture);
    let color = Color32::from_white_alpha((opacity.clamp(0.0, 1.0) * 255.0).round() as u8);
    for &[x, y, u, v] in &source.vertices {
        if ![x, y, u, v].iter().all(|v| v.is_finite())
            || x.abs() > 1e9
            || y.abs() > 1e9
            || !(0.0..=1.0).contains(&u)
            || !(0.0..=1.0).contains(&v)
        {
            return None;
        }
        let pos = egui::pos2(origin.x + x as f32 * scale, origin.y - y as f32 * scale);
        if !pos.x.is_finite() || !pos.y.is_finite() {
            return None;
        }
        mesh.vertices.push(egui::epaint::Vertex {
            pos,
            uv: egui::pos2(u as f32, v as f32),
            color,
        });
    }
    for &[a, b, c] in &source.triangles {
        let (Some(a_pos), Some(b_pos), Some(c_pos)) = (
            source.vertices.get(a),
            source.vertices.get(b),
            source.vertices.get(c),
        ) else {
            return None;
        };
        let area = (b_pos[0] - a_pos[0]) * (c_pos[1] - a_pos[1])
            - (b_pos[1] - a_pos[1]) * (c_pos[0] - a_pos[0]);
        if area.abs() < 1e-12 {
            continue;
        }
        mesh.add_triangle(a as u32, b as u32, c as u32);
    }
    Some(mesh)
}

/// Ordinary actors also use the same native mesh submission path, preserving
/// signed scales, pivots and draw-angle policy when a soft mesh is removed.
pub(super) fn costume_quad(
    sprite: &NativeSprite,
    width: f64,
    height: f64,
    pivot: [f64; 2],
) -> SoftMesh {
    let mut w = width * sprite.scale * sprite.size_x / 10000.0;
    let h = height * sprite.scale * sprite.size_y / 10000.0;
    let angle = match sprite.rotation_type {
        2 => 0.0,
        1 => {
            let d = (sprite.direction + 180.0).rem_euclid(360.0) - 180.0;
            if d <= -90.0 || d > 90.0 {
                w = -w;
            }
            0.0
        }
        _ => sprite.direction.to_radians(),
    };
    let (s, c) = angle.sin_cos();
    let vertices = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
        .map(|[u, v]| {
            let x = (u - 0.5) * w - pivot[0] * w / width;
            let y = (0.5 - v) * h + pivot[1] * h / height;
            [sprite.x + c * x + s * y, sprite.y - s * x + c * y, u, v]
        })
        .to_vec();
    SoftMesh {
        vertices,
        triangles: vec![[0, 1, 2], [0, 2, 3]],
    }
}

/// Pixel alpha supplied by egui_extras' PNG/SVG loaders. Match the Web costume
/// information grid: top row first, centre sample per cell, one bit per alpha>0.
pub(super) fn decoded_costume(
    image: &egui::ColorImage,
    width: f64,
    height: f64,
    pivot: [f64; 2],
) -> crate::engine::Costume {
    let iw = image.size[0];
    let ih = image.size[1];
    let mw = iw.min(128);
    let mh = ih.min(128);
    let mut bits = vec![0u8; (mw * mh).div_ceil(8)];
    if mw == 0 || mh == 0 || image.pixels.len() != iw * ih {
        return crate::engine::Costume {
            width,
            height,
            center_point: pivot,
            ..Default::default()
        };
    }
    for y in 0..mh {
        for x in 0..mw {
            let sx = ((2 * x + 1) * iw / (2 * mw)).min(iw - 1);
            let sy = ((2 * y + 1) * ih / (2 * mh)).min(ih - 1);
            if image.pixels[sy * iw + sx].a() > 0 {
                let bit = y * mw + x;
                bits[bit / 8] |= 1 << (bit % 8);
            }
        }
    }
    crate::engine::Costume {
        width,
        height,
        center_point: pivot,
        mask: Some((mw, mh, bits)),
        rgb: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoded_alpha_preserves_top_row_transparency_and_sampling_bounds() {
        let pixels = egui::ColorImage::new(
            [2, 2],
            vec![
                Color32::WHITE,
                Color32::TRANSPARENT,
                Color32::TRANSPARENT,
                Color32::WHITE,
            ],
        );
        let costume = decoded_costume(&pixels, 20.0, 30.0, [2.0, -3.0]);
        assert_eq!(costume.mask, Some((2, 2, vec![0b1001])));
        assert_eq!(costume.center_point, [2.0, -3.0]);
        let pixels = egui::ColorImage::new([256, 256], vec![Color32::WHITE; 256 * 256]);
        let (w, h, bits) = decoded_costume(&pixels, 256.0, 256.0, [0.0; 2])
            .mask
            .unwrap();
        assert_eq!((w, h, bits.len()), (128, 128, 2048));
        assert!(bits.iter().all(|&b| b == 255));
    }

    #[test]
    fn native_svg_loader_supplies_decoded_alpha_without_browser() {
        let ctx = egui::Context::default();
        egui_extras::install_image_loaders(&ctx);
        ctx.include_bytes("bytes://owned-soft-alpha.svg",b"<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><rect width='10' height='20' fill='red'/></svg>".as_slice());
        let mut decoded = None;
        for _ in 0..100 {
            match ctx
                .try_load_image(
                    "bytes://owned-soft-alpha.svg",
                    egui::load::SizeHint::default(),
                )
                .unwrap()
            {
                egui::load::ImagePoll::Ready { image } => {
                    decoded = Some(image);
                    break;
                }
                egui::load::ImagePoll::Pending { .. } => {
                    std::thread::sleep(std::time::Duration::from_millis(5))
                }
            }
        }
        let image = decoded.expect("native SVG image loader must produce pixels");
        let costume = decoded_costume(&image, 20.0, 20.0, [0.0; 2]);
        let (w, h, bits) = costume.mask.unwrap();
        let solid = |x: usize, y: usize| bits[(y * w + x) / 8] & (1u8 << ((y * w + x) % 8)) != 0;
        assert!(solid(w / 4, h / 2));
        assert!(!solid(w * 3 / 4, h / 2));
    }

    fn original_mesh() -> SoftMesh {
        // Repository-owned skewed quad, deliberately not an actor-local mesh.
        SoftMesh {
            vertices: vec![
                [10.0, 30.0, 0.0, 0.0],
                [45.0, 20.0, 1.0, 0.0],
                [35.0, -10.0, 1.0, 1.0],
                [5.0, -5.0, 0.0, 1.0],
            ],
            triangles: vec![[0, 1, 2], [0, 2, 3]],
        }
    }

    #[test]
    fn native_soft_mesh_keeps_world_geometry_uv_texture_and_premultiplied_alpha() {
        let source = original_mesh();
        let texture = TextureId::User(71);
        let mesh = soft_mesh(&source, texture, egui::pos2(100.0, 80.0), 2.0, 0.5).unwrap();
        assert_eq!(mesh.texture_id, texture);
        assert_eq!(mesh.indices, vec![0, 1, 2, 0, 2, 3]);
        assert_eq!(mesh.vertices[0].pos, egui::pos2(120.0, 20.0));
        assert_eq!(mesh.vertices[2].pos, egui::pos2(170.0, 100.0));
        assert_eq!(mesh.vertices[0].uv, egui::pos2(0.0, 0.0));
        assert_eq!(mesh.vertices[2].uv, egui::pos2(1.0, 1.0));
        assert!(
            mesh.vertices
                .iter()
                .all(|v| v.color == Color32::from_white_alpha(128))
        );
        assert!(mesh.is_valid());
    }

    #[test]
    fn native_soft_mesh_rejects_bad_data_and_skips_degenerate_triangles() {
        let texture = TextureId::default();
        let build = |source: &SoftMesh| soft_mesh(source, texture, Pos2::ZERO, 1.0, 1.0);
        let mut source = original_mesh();
        source.triangles.push([0, 0, 1]);
        assert_eq!(build(&source).unwrap().indices.len(), 6);
        source.triangles.push([0, 1, 99]);
        assert!(build(&source).is_none());
        let mut source = original_mesh();
        source.vertices[0][0] = f64::NAN;
        assert!(build(&source).is_none());
        let mut source = original_mesh();
        source.vertices[0][2] = 1.1;
        assert!(build(&source).is_none());
        assert!(soft_mesh(&original_mesh(), texture, Pos2::ZERO, f32::INFINITY, 1.0).is_none());
    }

    #[test]
    fn ordinary_quad_fallback_honors_actor_transform_but_soft_mesh_does_not_apply_it_twice() {
        let actor = NativeSprite {
            id: "owned".into(),
            name: "Owned quad".into(),
            style: None,
            x: 50.0,
            y: 30.0,
            direction: 0.0,
            scale: 200.0,
            size_x: 50.0,
            size_y: 100.0,
            rotation_type: 0,
            visible: true,
            opacity: 1.0,
            draggable: false,
            soft_mesh: None,
            dialog: None,
        };
        let quad = costume_quad(&actor, 20.0, 10.0, [2.0, 1.0]);
        assert_eq!(quad.vertices[0], [38.0, 42.0, 0.0, 0.0]);
        assert_eq!(quad.vertices[2], [58.0, 22.0, 1.0, 1.0]);
        let source = original_mesh();
        let mesh = soft_mesh(&source, TextureId::default(), Pos2::ZERO, 1.0, 1.0).unwrap();
        assert_eq!(mesh.vertices[0].pos, egui::pos2(10.0, -30.0));
    }

    #[test]
    fn native_tessellation_submits_real_textured_triangles_with_stage_clip() {
        let ctx = egui::Context::default();
        let clip = egui::Rect::from_min_size(egui::pos2(20.0, 30.0), egui::vec2(100.0, 80.0));
        let texture = TextureId::User(72);
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            let painter = ctx
                .layer_painter(egui::LayerId::background())
                .with_clip_rect(clip);
            painter.add(egui::Shape::mesh(
                soft_mesh(&original_mesh(), texture, clip.center(), 1.0, 1.0).unwrap(),
            ));
        });
        let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
        let primitive=primitives.iter().find(|p| matches!(&p.primitive,egui::epaint::Primitive::Mesh(m) if m.texture_id==texture)).unwrap();
        assert_eq!(primitive.clip_rect, clip);
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            unreachable!()
        };
        assert_eq!(mesh.indices.len(), 6);
        assert_eq!(mesh.vertices.len(), 4);
    }
}
