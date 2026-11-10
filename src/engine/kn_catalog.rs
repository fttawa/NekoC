//! KN catalog helpers; keep typed values and timer state out of lowering.
use super::*;

/// Independent of the visible stage timer, including its start/stop/reset state.
/// 参考 HateNeko 0.7.1 的 rt/impl/time.lua::get_timer/reset_timer。
#[derive(Default)]
pub(super) struct BlockTimer {
    origin: f64,
}
impl BlockTimer {
    pub(super) fn reset(&mut self, now: f64) {
        self.origin = now;
    }
    pub(super) fn elapsed(&self, now: f64) -> f64 {
        now - self.origin
    }
}

impl Compiler {
    /// Script variable pseudo-APIs (not registered official block types) use the
    /// same JSON identifier as variables_set;
    /// a plain declared name also resolves to the script slot, never a new global.
    /// 参考 HateNeko 0.7.1 的 rt/impl/data.lua::script_variables_set/change_script_variables。
    pub(super) fn script_target(&mut self, name: &str) -> Target {
        if let Some(&slot) = self.locals.get(name) {
            Target::Local(slot)
        } else {
            self.target(name)
        }
    }

    /// Official main.8ccf2442.js:2962446: Object.values(arguments).
    /// The editor's argument object follows socket order. Numeric property keys
    /// are enumerated first by JS; other keys retain their insertion order.
    /// Do not reuse temporary_list's ITEM suffix sorting or drop unknown sockets.
    pub(super) fn array_literal(&mut self, block: &Value) -> Result<ValueExpr> {
        let mut inputs = block["inputs"]
            .as_object()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let index = |key: &str| {
            key.parse::<u32>()
                .ok()
                .filter(|&i| i != u32::MAX && i.to_string() == key)
        };
        inputs.sort_by_key(|(key, _)| index(key).map_or((1, 0), |i| (0, i)));
        let values = inputs
            .into_iter()
            .map(|(_, block)| self.value(block))
            .collect::<Result<Vec<_>>>()?;
        let span = Span {
            start: self.program.value_args.len() as u32,
            len: values.len() as u32,
        };
        self.program.value_args.extend(values);
        Ok(ValueExpr::Temporary(span))
    }
}
