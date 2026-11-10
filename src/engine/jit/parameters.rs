//! Parameter reads use the current call frame, not a pointer retained across a
//! call/return. NativeContext is refreshed by the two frame-changing helpers.
use super::*;

pub(super) const OFF_PARAMETERS: i32 = std::mem::offset_of!(NativeContext, parameters) as i32;
pub(super) const OFF_PARAMETER_COUNT: i32 =
    std::mem::offset_of!(NativeContext, parameter_count) as i32;

const NUMBER_PAYLOAD: i32 = 8;

/// repr(u8) fixes Cell's tag; verify the f64 payload offset too before enabling
/// direct loads. Do not assume the layout of Rust's Vec or read beyond its len.
pub(super) fn number_layout() -> bool {
    let cell = Cell::Number(1.25);
    let Cell::Number(ref number) = cell else {
        unreachable!()
    };
    let base = &cell as *const Cell as usize;
    let payload = number as *const f64 as usize;
    (unsafe { *(base as *const u8) == 0 }) && payload - base == NUMBER_PAYLOAD as usize
}

pub(super) fn refresh(c: &mut NativeContext) {
    let task = unsafe { &(&(*c.engine).tasks)[c.index] };
    c.parameters = task.parameters.as_ptr();
    c.parameter_count = task.parameters.len();
}

impl Gen<'_, '_> {
    pub(super) fn parameter(&mut self, slot: usize, guard: bool) -> Value {
        let base = self
            .b
            .ins()
            .load(types::I64, MemFlags::trusted(), self.ctx, OFF_PARAMETERS);
        let offset = (slot * std::mem::size_of::<Cell>()) as i32;
        if !guard {
            // A length/tag guard dominates this load. Pure expressions cannot
            // mutate call frames; calls/returns refresh context before jumping.
            return self.b.ins().load(
                types::F64,
                MemFlags::trusted(),
                base,
                offset + NUMBER_PAYLOAD,
            );
        }
        let count = self.b.ins().load(
            types::I64,
            MemFlags::trusted(),
            self.ctx,
            OFF_PARAMETER_COUNT,
        );
        let exists = self
            .b
            .ins()
            .icmp_imm(IntCC::UnsignedGreaterThan, count, slot as i64);
        let check = self.b.create_block();
        let absent = self.b.create_block();
        let merge = self.b.create_block();
        let result = self.b.append_block_param(merge, types::F64);
        self.b.ins().brif(exists, check, &[], absent, &[]);
        self.b.switch_to_block(check);
        let tag = self
            .b
            .ins()
            .load(types::I8, MemFlags::trusted(), base, offset);
        let numeric = self.b.ins().icmp_imm(IntCC::Equal, tag, 0);
        let valid = self.number(numeric);
        self.b.ins().jump(merge, &[valid.into()]);
        self.b.switch_to_block(absent);
        let zero = self.b.ins().f64const(0.0);
        self.b.ins().jump(merge, &[zero.into()]);
        self.b.switch_to_block(merge);
        result
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_number_payload_layout_matches_the_checked_abi() {
        assert!(super::number_layout());
    }
}
