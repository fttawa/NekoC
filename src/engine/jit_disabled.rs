//! No executable memory or native code generation on wasm; always interpret.
use super::Engine;

pub(super) struct Jit;

impl Jit {
    pub(super) fn new(_: usize) -> Option<Box<Self>> {
        None
    }
}

impl Engine {
    pub(super) fn jit_begin_frame(&mut self) {}
    pub(super) fn jit_record_interpreted(&mut self, _: usize) {}
    pub(super) fn jit_try(&mut self, _: usize, _: usize, _: usize, _: usize) -> Option<usize> {
        None
    }
    pub fn enable_jit_profile(&mut self) {}
    pub fn jit_profile(&self) -> serde_json::Value {
        serde_json::Value::Null
    }
}
