//! Live clone slots grouped by prototype, independent of layer/script order.
#[derive(Default)]
pub(super) struct CloneIndex {
    by_origin: Vec<Vec<usize>>,
}

impl CloneIndex {
    pub(super) fn slots(&self, origin: usize) -> &[usize] {
        self.by_origin.get(origin).map_or(&[], Vec::as_slice)
    }

    pub(super) fn insert(&mut self, origin: usize, slot: usize) {
        if self.by_origin.len() <= origin {
            self.by_origin.resize_with(origin + 1, Vec::new);
        }
        self.by_origin[origin].push(slot);
    }

    pub(super) fn remove(&mut self, origin: usize, slot: usize) {
        if let Some(slots) = self.by_origin.get_mut(origin)
            && let Some(at) = slots.iter().position(|&i| i == slot)
        {
            slots.swap_remove(at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Engine, Program, RuntimeSemantics};

    fn assert_index(engine: &Engine) {
        for origin in 0..engine.program.sprites.len() {
            let mut expected: Vec<_> = engine
                .sprites
                .iter()
                .enumerate()
                .filter(|&(i, s)| s.alive && s.origin == origin && i != origin)
                .map(|(i, _)| i)
                .collect();
            let mut actual = engine.clone_index.slots(origin).to_vec();
            expected.sort_unstable();
            actual.sort_unstable();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn live_index_tracks_deferred_delete_eviction_slot_reuse_and_restart() {
        let document = crate::studio::document::Document::blank();
        let mut program = Program::compile(document.value()).unwrap();
        program.semantics = RuntimeSemantics::Kitten4;
        let mut e = Engine::new(program);
        e.disable_jit();
        e.start();
        for batch in 0..3 {
            e.clone_counts.clear();
            for _ in 0..250 {
                e.clone_sprite(1, None).unwrap();
            }
            assert_index(&e);
            if batch == 0 {
                let slot = e.clone_index.slots(1)[7];
                e.request_entity_disposal(slot);
                assert_index(&e);
                e.dispose_requested_entities();
                assert_index(&e);
                e.clone_counts.clear();
                e.clone_sprite(1, None).unwrap();
                assert_eq!(e.sprites[slot].clone_index, 251);
                assert_index(&e);
            }
        }
        assert_eq!(e.clone_index.slots(1).len(), 512);
        let oldest = e
            .clone_index
            .slots(1)
            .iter()
            .map(|&i| e.sprites[i].clone_index)
            .min()
            .unwrap();
        assert_eq!(oldest, 240);
        e.delete_clone(1);
        assert_index(&e);
        e.start();
        assert_index(&e);
        assert!(e.clone_index.slots(1).is_empty());
    }

    #[test]
    fn kn_live_cap_and_clone_of_clone_keep_origin_membership() {
        let document = crate::studio::document::Document::blank();
        let mut e = Engine::new(Program::compile(document.value()).unwrap());
        e.program.semantics = RuntimeSemantics::KnCurrent;
        e.disable_jit();
        e.start();
        e.clone_sprite(1, None).unwrap();
        let clone = e.clone_index.slots(1)[0];
        for _ in 0..310 {
            e.clone_sprite(clone, None).unwrap();
        }
        assert_eq!(e.clone_index.slots(1).len(), 300);
        assert_index(&e);
        e.delete_clone(clone);
        e.clone_sprite(1, None).unwrap();
        assert_index(&e);
        assert_eq!(e.clone_index.slots(1).len(), 300);
    }
}
