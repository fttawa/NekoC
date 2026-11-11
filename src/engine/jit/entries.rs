//! A region's machine code is shared by its fuel-accounted leaders. Entering in
//! the middle of a chunk is forbidden: its fuel has not been charged yet.
use cranelift_codegen::ir::{Block, InstBuilder, Value};
use cranelift_frontend::{FunctionBuilder, Switch};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn dispatch(
    b: &mut FunctionBuilder<'_>,
    entry: Value,
    leaders: &BTreeSet<usize>,
    region: &BTreeSet<usize>,
    blocks: &BTreeMap<usize, Block>,
) -> Vec<usize> {
    let entries: Vec<_> = leaders.intersection(region).copied().collect();
    let invalid = b.create_block();
    let mut switch = Switch::new();
    for &pc in &entries {
        switch.set_entry(pc as u128, blocks[&pc]);
    }
    switch.emit(b, entry, invalid);
    b.switch_to_block(invalid);
    // Defensive ABI fallback: an unknown entry executes nothing, consuming no
    // fuel. The caller only installs aliases listed in `entries`.
    b.ins().return_(&[entry]);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use cranelift_codegen::ir::{AbiParam, Signature, types};
    use cranelift_codegen::isa::CallConv;
    use cranelift_frontend::FunctionBuilderContext;

    #[test]
    fn only_fuel_leaders_inside_the_region_are_exposed() {
        let mut context = cranelift_codegen::Context::new();
        context.func.signature = Signature::new(CallConv::SystemV);
        context
            .func
            .signature
            .params
            .push(AbiParam::new(types::I64));
        context
            .func
            .signature
            .returns
            .push(AbiParam::new(types::I64));
        let mut scope = FunctionBuilderContext::new();
        let mut b = FunctionBuilder::new(&mut context.func, &mut scope);
        let start = b.create_block();
        b.append_block_params_for_function_params(start);
        b.switch_to_block(start);
        let entry = b.block_params(start)[0];
        let blocks = BTreeMap::from([(0, b.create_block()), (2, b.create_block())]);
        assert_eq!(
            dispatch(
                &mut b,
                entry,
                &BTreeSet::from([0, 2, 99]),
                &BTreeSet::from([0, 1, 2, 3]),
                &blocks
            ),
            [0, 2]
        );
        for &block in blocks.values() {
            b.switch_to_block(block);
            b.ins().return_(&[entry]);
        }
        b.seal_all_blocks();
        b.finalize();
        cranelift_codegen::verify_function(
            &context.func,
            &cranelift_codegen::settings::Flags::new(cranelift_codegen::settings::builder()),
        )
        .unwrap();
    }
}
