//! Native stage widgets: egui primitives only, no bundled official artwork.
use super::overlay::{CloudIcon, NativeMonitor, NativeOverlay, NativeRanking};
use eframe::egui::{self, Align2, Color32, FontId, Painter, Pos2, Rect, Stroke, Vec2};

const ORANGE: Color32 = Color32::from_rgb(255, 173, 72);

pub(super) fn paint(ui: &mut egui::Ui, stage: Rect, scale: f32, overlay: &NativeOverlay) {
    if !scale.is_finite() || scale <= 0.0 {
        return;
    }
    let painter = ui.painter().with_clip_rect(stage.intersect(ui.clip_rect()));
    for (index, widget) in overlay.monitors.iter().enumerate() {
        let origin = widget
            .position
            .map(|[x, y]| {
                egui::pos2(
                    stage.center().x + x as f32 * scale,
                    stage.center().y - y as f32 * scale,
                )
            })
            .unwrap_or(stage.min + egui::vec2(10.0, 10.0 + index as f32 * 60.0) * scale);
        // The official list widget resizes its body rather than using scalar scale.
        let zoom = if widget.monitor.list {
            scale
        } else {
            scale * widget.scale as f32
        };
        if zoom <= 0.0 || !origin.x.is_finite() || !origin.y.is_finite() {
            continue;
        }
        if widget.monitor.list {
            list(ui, &painter, origin, zoom, widget);
        } else {
            scalar(&painter, origin, zoom, widget);
        }
    }
    if let Some(ranking) = &overlay.ranking {
        ranking_shell(&painter, stage, scale, ranking, ui.input(|i| i.time));
        ui.ctx()
            .request_repaint_after(std::time::Duration::from_millis(33));
    }
}

fn scalar(painter: &Painter, origin: Pos2, scale: f32, widget: &NativeMonitor) {
    let font = FontId::proportional(18.0 * scale);
    let value = painter.layout_no_wrap(widget.monitor.value.clone(), font.clone(), Color32::BLACK);
    if widget.theme == "pure" {
        let value = painter.layout_no_wrap(
            widget.monitor.value.clone(),
            FontId::proportional(45.0 * scale),
            Color32::BLACK,
        );
        painter.galley(origin, value, Color32::BLACK);
        return;
    }
    let prefix = painter.layout_no_wrap(
        widget.prefix.clone(),
        font.clone(),
        Color32::from_rgb(82, 57, 57),
    );
    let name = painter.layout_no_wrap(widget.monitor.name.clone(), font, Color32::WHITE);
    let has_icon = widget.cloud.is_some() && widget.theme == "common";
    let icon_width = if has_icon { 35.0 } else { 10.0 } * scale;
    let text_x = origin.x + icon_width;
    let value_x = text_x + prefix.size().x + name.size().x + 20.0 * scale;
    let height = 52.0 * scale;
    painter.rect_filled(
        Rect::from_min_size(
            origin,
            egui::vec2(value_x - origin.x + value.size().x + 20.0 * scale, height),
        ),
        11.0 * scale,
        ORANGE,
    );
    painter.rect_filled(
        Rect::from_min_size(
            egui::pos2(value_x - 10.0 * scale, origin.y + 10.0 * scale),
            egui::vec2(value.size().x + 20.0 * scale, height - 20.0 * scale),
        ),
        11.0 * scale,
        Color32::WHITE,
    );
    if let Some(icon) = widget.cloud.filter(|_| has_icon) {
        cloud_icon(
            painter,
            origin + egui::vec2(10.0, 17.0) * scale,
            scale,
            icon,
        );
    }
    let y = origin.y + 15.0 * scale;
    let prefix_width = prefix.size().x;
    painter.galley(egui::pos2(text_x, y), prefix, Color32::WHITE);
    painter.galley(egui::pos2(text_x + prefix_width, y), name, Color32::WHITE);
    painter.galley(egui::pos2(value_x, y), value, Color32::BLACK);
}

fn list(ui: &mut egui::Ui, painter: &Painter, origin: Pos2, scale: f32, widget: &NativeMonitor) {
    let bounds = Rect::from_min_size(origin, egui::vec2(186.0, 246.0) * scale);
    painter.rect_filled(bounds, 20.0 * scale, Color32::from_rgb(255, 170, 47));
    painter.rect_stroke(
        bounds,
        20.0 * scale,
        Stroke::new(2.0 * scale, Color32::from_gray(204)),
        egui::StrokeKind::Middle,
    );
    let title = format!("{}{}", widget.prefix, widget.monitor.name);
    let title_painter = painter.with_clip_rect(
        bounds
            .shrink2(egui::vec2(8.0, 0.0) * scale)
            .intersect(painter.clip_rect()),
    );
    title_painter.text(
        origin + egui::vec2(93.0, 24.5) * scale,
        Align2::CENTER_CENTER,
        title,
        FontId::proportional(20.0 * scale),
        Color32::WHITE,
    );
    let body = Rect::from_min_size(
        origin + egui::vec2(8.0, 58.0) * scale,
        egui::vec2(170.0, 180.0) * scale,
    );
    painter.rect_filled(body, 10.0 * scale, Color32::WHITE);
    let rows = widget.items.clone().unwrap_or_else(|| {
        if widget.monitor.value.is_empty() {
            vec![]
        } else {
            widget
                .monitor
                .value
                .split('\n')
                .take(101)
                .map(str::to_owned)
                .collect()
        }
    });
    if rows.is_empty() {
        painter.text(
            body.center_top() + egui::vec2(0.0, 10.0) * scale,
            Align2::CENTER_TOP,
            "空",
            FontId::proportional(16.0 * scale),
            Color32::BLACK,
        );
        return;
    }
    let id = ui.id().with(("native-list-scroll", &widget.monitor.id));
    let response = ui.interact(body, id, egui::Sense::hover());
    let mut offset = ui
        .ctx()
        .data_mut(|data| data.get_temp::<f32>(id).unwrap_or(0.0));
    if response.hovered() {
        offset -= ui.input(|i| i.smooth_scroll_delta.y) / scale;
    }
    offset = offset.clamp(0.0, (rows.len() as f32 * 45.0 - 180.0).max(0.0));
    ui.ctx().data_mut(|data| data.insert_temp(id, offset));
    let clipped = painter.with_clip_rect(body.intersect(painter.clip_rect()));
    for (index, row) in rows.iter().enumerate() {
        let y = body.top() + (index as f32 * 45.0 - offset) * scale;
        let rect = Rect::from_min_size(
            egui::pos2(body.left(), y),
            egui::vec2(body.width(), 45.0 * scale),
        );
        if !rect.intersects(body) {
            continue;
        }
        clipped.rect_filled(
            rect,
            0.0,
            if index % 2 == 1 {
                Color32::from_rgb(244, 245, 247)
            } else {
                Color32::WHITE
            },
        );
        clipped.text(
            rect.left_center() + egui::vec2(5.0 * scale, 0.0),
            Align2::LEFT_CENTER,
            index + 1,
            FontId::proportional(16.0 * scale),
            Color32::GRAY,
        );
        clipped.text(
            rect.left_center() + egui::vec2(31.0 * scale, 0.0),
            Align2::LEFT_CENTER,
            row,
            FontId::proportional(17.5 * scale),
            Color32::from_rgb(67, 55, 46),
        );
    }
}

fn cloud_icon(painter: &Painter, origin: Pos2, scale: f32, kind: CloudIcon) {
    // Original geometric cloud. Private/list marks intentionally do not trace
    // the proprietary SVG assets used by the official renderer.
    let point = |x, y| origin + egui::vec2(x, y) * scale;
    painter.circle_filled(point(6.0, 9.0), 5.0 * scale, Color32::WHITE);
    painter.circle_filled(point(11.0, 6.0), 6.0 * scale, Color32::WHITE);
    painter.circle_filled(point(16.0, 10.0), 4.0 * scale, Color32::WHITE);
    painter.rect_filled(
        Rect::from_min_max(point(5.0, 9.0), point(17.0, 14.0)),
        2.0 * scale,
        Color32::WHITE,
    );
    let stroke = Stroke::new(1.3 * scale, ORANGE);
    match kind {
        CloudIcon::Public => {}
        CloudIcon::Private => {
            painter.circle_stroke(point(12.0, 10.0), 2.2 * scale, stroke);
            painter.rect_filled(
                Rect::from_min_max(point(9.0, 11.0), point(15.0, 16.0)),
                1.0 * scale,
                ORANGE,
            );
        }
        CloudIcon::List => {
            for y in [7.0, 10.0, 13.0] {
                painter.line_segment([point(8.0, y), point(15.0, y)], stroke);
            }
        }
    }
}

fn ranking_shell(
    painter: &Painter,
    stage: Rect,
    stage_scale: f32,
    ranking: &NativeRanking,
    time: f64,
) {
    let scale = stage_scale
        .min(stage.width() / 555.0)
        .min(stage.height() / 400.0);
    let bounds = Rect::from_center_size(stage.center(), egui::vec2(555.0, 400.0) * scale);
    painter.rect_filled(bounds, 20.0 * scale, Color32::from_rgb(209, 238, 255));
    painter.text(
        bounds.center_top() + egui::vec2(0.0, 45.0) * scale,
        Align2::CENTER_CENTER,
        "排行榜",
        FontId::proportional(48.0 * scale),
        Color32::from_rgb(76, 160, 202),
    );
    let user = Rect::from_min_size(
        bounds.min + egui::vec2(25.0, 90.0) * scale,
        egui::vec2(505.0, 74.0) * scale,
    );
    painter.rect_filled(user, 20.0 * scale, Color32::WHITE);
    painter.text(
        user.left_center() + egui::vec2(22.0, 0.0) * scale,
        Align2::LEFT_CENTER,
        "-",
        FontId::proportional(27.0 * scale),
        Color32::GRAY,
    );
    // Neutral anonymous silhouette, not an invented user/avatar.
    let avatar = user.left_center() + egui::vec2(90.0, 0.0) * scale;
    painter.circle_filled(avatar, 23.0 * scale, Color32::from_gray(230));
    painter.circle_filled(
        avatar - egui::vec2(0.0, 7.0) * scale,
        7.0 * scale,
        Color32::from_gray(175),
    );
    painter.rect_filled(
        Rect::from_center_size(
            avatar + egui::vec2(0.0, 9.0) * scale,
            egui::vec2(22.0, 12.0) * scale,
        ),
        6.0 * scale,
        Color32::from_gray(175),
    );
    painter.text(
        user.left_center() + egui::vec2(125.0, 0.0) * scale,
        Align2::LEFT_CENTER,
        "未登录用户",
        FontId::proportional(20.0 * scale),
        Color32::BLACK,
    );
    let score = ranking
        .score
        .map(|v| {
            if v.abs() >= 1e10 {
                format!("{v:.5e}")
            } else {
                v.to_string()
            }
        })
        .unwrap_or_else(|| "-".into());
    painter.text(
        user.right_center() - egui::vec2(20.0, 0.0) * scale,
        Align2::RIGHT_CENTER,
        score,
        FontId::proportional(22.0 * scale),
        Color32::from_rgb(255, 128, 72),
    );
    let body = Rect::from_min_max(
        bounds.min + egui::vec2(24.0, 184.0) * scale,
        bounds.max - Vec2::splat(26.0 * scale),
    );
    painter.rect_filled(body, 20.0 * scale, Color32::WHITE);
    let center = body.center() - egui::vec2(0.0, 20.0) * scale;
    for index in 0..12 {
        let angle =
            index as f32 * std::f32::consts::TAU / 12.0 + (time as f32 * std::f32::consts::PI);
        let direction = egui::vec2(angle.cos(), angle.sin());
        painter.line_segment(
            [
                center + direction * 22.0 * scale,
                center + direction * 34.0 * scale,
            ],
            Stroke::new(5.0 * scale, Color32::from_gray(80 + index as u8 * 12)),
        );
    }
    painter.text(
        center + egui::vec2(0.0, 65.0) * scale,
        Align2::CENTER_CENTER,
        "loading",
        FontId::proportional(18.0 * scale),
        Color32::from_gray(174),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Monitor;

    #[test]
    fn native_overlay_tessellates_with_stage_clip_and_without_asset_textures() {
        let ctx = egui::Context::default();
        let stage = Rect::from_min_size(egui::pos2(20.0, 30.0), egui::vec2(640.0, 400.0));
        let overlay = NativeOverlay {
            monitors: vec![NativeMonitor {
                monitor: Monitor {
                    id: "owned".into(),
                    name: "Score".into(),
                    list: false,
                    value: "42".into(),
                },
                position: Some([-300.0, 180.0]),
                scale: 1.25,
                theme: "common".into(),
                prefix: String::new(),
                cloud: Some(CloudIcon::Private),
                items: None,
            }],
            ranking: Some(NativeRanking {
                variable: "owned".into(),
                score: Some(42.0),
            }),
        };
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE)
                .show(ctx, |ui| paint(ui, stage, 0.5, &overlay));
        });
        let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
        assert!(!primitives.is_empty());
        for primitive in primitives {
            assert_eq!(primitive.clip_rect, stage);
            if let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive {
                assert!(mesh.is_valid());
                assert_eq!(mesh.texture_id, egui::TextureId::default());
            }
        }
    }
}
