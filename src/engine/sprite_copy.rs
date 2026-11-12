//! Renderer snapshots omit private runtime containers, unlike entity clones.
use super::{RoleCamp, Sprite};

impl Sprite {
    /// Copy the complete serialized state without retaining runtime containers.
    /// This snapshot is for frame output only, never for a live engine entity.
    pub(super) fn clone_for_frame(&self) -> Self {
        Self {
            id: self.id.clone(),
            name: self.name.clone(),
            style: self.style.clone(),
            x: self.x,
            y: self.y,
            direction: self.direction,
            scale: self.scale,
            visible: self.visible,
            opacity: self.opacity,
            effects: self.effects,
            size_x: self.size_x,
            size_y: self.size_y,
            flip_x: self.flip_x,
            flip_y: self.flip_y,
            rotation_type: self.rotation_type,
            dialog: self.dialog.clone(),
            draggable: self.draggable,
            text: self.text.clone(),
            styles: Vec::new(),
            // RoleCamp has no Default; Unset carries no owned group string.
            camp: RoleCamp::Unset,
            text_style: self.text_style,
            text_scale: self.text_scale,
            origin: self.origin,
            clone_index: self.clone_index,
            empty_code: self.empty_code,
            alive: self.alive,
            variables: Default::default(),
            scene: self.scene,
            stage: self.stage,
            pen: self.pen,
            color: self.color,
            hsv: self.hsv,
            size: self.size,
            fill_color: self.fill_color,
            fill_path: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Cell, Dialog, Engine, Program, SpriteText};
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    fn engine() -> Engine {
        let document = crate::studio::document::Document::blank();
        Engine::new(Program::compile(document.value()).unwrap())
    }

    fn assert_frame_copy(source: &Sprite) {
        // Freeze the ordinary Clone's output before exercising the new path.
        let expected = serde_json::to_vec(&source.clone()).unwrap();
        let original = format!("{source:?}");
        let mut frame = source.clone_for_frame();
        assert_eq!(serde_json::to_vec(&frame).unwrap(), expected);
        assert!(frame.styles.is_empty());
        assert!(frame.variables.is_empty());
        assert!(frame.fill_path.is_none());
        assert!(matches!(frame.camp, RoleCamp::Unset));
        assert_eq!(frame.flip_x, source.flip_x);
        assert_eq!(frame.flip_y, source.flip_y);

        // Mutating owned frame strings must not affect the source sprite.
        frame.id.push_str("-frame");
        frame.name.clear();
        if let Some(style) = &mut frame.style {
            style.clear();
        }
        if let Some(dialog) = &mut frame.dialog {
            dialog.text.clear();
        }
        if let Some(text) = &mut frame.text {
            text.text.clear();
            text.color.clear();
        }
        assert_eq!(serde_json::to_vec(source).unwrap(), expected);
        // Also covers skipped fields, including NaN, without float equality.
        assert_eq!(format!("{source:?}"), original);
    }

    #[test]
    fn frame_copy_matches_ordinary_clone_for_initial_sprites() {
        let engine = engine();
        assert!(!engine.sprites.is_empty());
        for sprite in &engine.sprites {
            assert_frame_copy(sprite);
        }
    }

    #[test]
    fn frame_copy_omits_runtime_containers_without_changing_source() {
        let mut engine = engine();
        let source = engine.sprites.iter_mut().find(|s| !s.stage).unwrap();
        source.id = "custom-id#7".into();
        source.name = "角色 \"snapshot\"".into();
        source.style = Some("custom-style".into());
        source.x = -12.5;
        source.y = 23.75;
        source.direction = -135.0;
        source.scale = 42.0;
        source.visible = false;
        source.opacity = 0.375;
        source.effects = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        source.size_x = -80.0;
        source.size_y = 125.0;
        source.flip_x = true;
        source.flip_y = true;
        source.rotation_type = 2;
        source.dialog = Some(Dialog {
            text: "自定义气泡\nsecond line".into(),
            think: true,
        });
        source.draggable = true;
        source.text = Some(SpriteText {
            text: "文字\nrendered text".into(),
            size: 48.5,
            color: "#12abef".into(),
        });
        source.styles = vec!["costume-a".into(), "costume-b".into()];
        source.camp = RoleCamp::Custom("custom-camp".into());
        source.text_style = (27.5, 0xabcdef);
        source.text_scale = Some(91.25);
        source.origin = 17;
        source.clone_index = 7;
        source.empty_code = true;
        source.alive = false;
        let list = Rc::new(RefCell::new(vec![Cell::Text("private-value".into())]));
        source.variables.insert(23, Cell::List(list.clone()));
        source.scene = 3;
        source.pen = true;
        source.color = [0.1, 0.2, 0.3, 0.4];
        source.hsv = [120.0, 0.25, 0.75];
        source.size = 9.0;
        source.fill_color = Some([0.5, 0.6, 0.7, 0.8]);
        source.fill_path = Some(vec![[1.0, 2.0], [3.0, 4.0]]);

        assert_frame_copy(source);
        let frame = source.clone_for_frame();
        assert_eq!(Rc::strong_count(&list), 2);
        drop(frame);
        // The ordinary Clone remains a full runtime-state copy.
        let ordinary = source.clone();
        assert_eq!(ordinary.styles, source.styles);
        assert!(matches!(&ordinary.camp, RoleCamp::Custom(id) if id == "custom-camp"));
        assert_eq!(ordinary.fill_path, source.fill_path);
        assert!(
            matches!(ordinary.variables.get(&23), Some(Cell::List(value)) if Rc::ptr_eq(value, &list))
        );
        drop(ordinary);

        // Preserve non-finite values themselves, not only JSON's null encoding.
        for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.0] {
            source.x = number;
            source.y = number;
            source.direction = number;
            source.scale = number;
            source.opacity = number;
            source.effects = [number; 8];
            source.size_x = number;
            source.size_y = number;
            source.text.as_mut().unwrap().size = number;
            assert_frame_copy(source);
            let frame = source.clone_for_frame();
            for actual in [
                frame.x,
                frame.y,
                frame.direction,
                frame.scale,
                frame.opacity,
                frame.size_x,
                frame.size_y,
                frame.text.as_ref().unwrap().size,
            ]
            .into_iter()
            .chain(frame.effects)
            {
                assert_eq!(actual.to_bits(), number.to_bits());
            }
        }
        source.style = None;
        source.dialog = None;
        source.text = None;
        source.camp = RoleCamp::Standard(2);
        assert_frame_copy(source);
        assert_eq!(Rc::strong_count(&list), 2);
    }
}
