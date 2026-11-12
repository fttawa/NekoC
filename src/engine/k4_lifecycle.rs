use super::{Engine, RuntimeSemantics};

impl Engine {
    // Official iNFq/destruct_entity queues destruction for update_dispose at
    // the next update entry. Scripts stop now, but the drawable and its local
    // state survive this frame. Scene cleanup and clone-cap eviction retain
    // their separate immediate path; KN disposal is also unchanged.
    pub(super) fn request_entity_disposal(&mut self, actor: usize) {
        if self.program.semantics != RuntimeSemantics::Kitten4 {
            self.delete_clone(actor);
            return;
        }
        if !self.k4_pending_disposals.contains(&actor) {
            self.k4_pending_disposals.push(actor);
        }
        for index in 0..self.tasks.len() {
            if self.tasks[index].actor == actor {
                self.finish_task(index);
            }
        }
    }

    pub(super) fn dispose_requested_entities(&mut self) {
        #[cfg(feature = "interp-profile")]
        let _profile = super::interp_profile::span("dispose_requested_entities", &());
        for actor in std::mem::take(&mut self.k4_pending_disposals) {
            self.delete_clone(actor);
        }
    }
}
