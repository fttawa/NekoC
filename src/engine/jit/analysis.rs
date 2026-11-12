//! Read-only classification shared by one region build. Keep caches local: tests
//! and embedders may replace program tables between builds, so persistent cached
//! purity would require invalidation and could make native pointer use unsound.
use super::{Engine, Expr, ExprOp, ListRef, Op, is_straight};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct OpClass {
    pub(super) supported: bool,
    pub(super) reentrant: bool,
}

pub(super) struct Analysis<'a> {
    engine: &'a Engine,
    purity: RefCell<BTreeMap<(bool, usize), bool>>,
    ops: RefCell<BTreeMap<usize, OpClass>>,
}

impl<'a> Analysis<'a> {
    pub(super) fn new(engine: &'a Engine) -> Self {
        Self {
            engine,
            purity: RefCell::new(BTreeMap::new()),
            ops: RefCell::new(BTreeMap::new()),
        }
    }

    pub(super) fn classify(&self, pc: usize) -> OpClass {
        if let Some(&class) = self.ops.borrow().get(&pc) {
            return class;
        }
        let op = self.engine.program.ops[pc];
        let reentrant = self.reentrant(op);
        let class = OpClass {
            supported: reentrant || self.supported_non_reentrant(op),
            reentrant,
        };
        self.ops.borrow_mut().insert(pc, class);
        class
    }

    pub(super) fn pure_expr(&self, root: usize) -> bool {
        if let Some(&pure) = self.purity.borrow().get(&(false, root)) {
            return pure;
        }
        let program = &self.engine.program;
        let start = program.expression_starts[root] as usize;
        let pure = (start..=root).all(|pc| match program.expressions[pc] {
            ExprOp::Value(i) | ExprOp::Truth(i) | ExprOp::TextLength(i) => self.pure_value(i),
            ExprOp::ListItem(ListRef::Expression(i), _)
            | ExprOp::ListLength(ListRef::Expression(i)) => self.pure_value(i as usize),
            _ => true,
        });
        self.purity.borrow_mut().insert((false, root), pure);
        pure
    }

    fn pure_value(&self, root: usize) -> bool {
        if let Some(&pure) = self.purity.borrow().get(&(true, root)) {
            return pure;
        }
        // Cache complete root queries only. The existing iterative walk retains
        // its visited-set behavior for shared/cyclic graphs and deep reporters.
        let pure = self.engine.jit_pure_value(root);
        self.purity.borrow_mut().insert((true, root), pure);
        pure
    }

    fn delegable(&self, op: Op) -> bool {
        self.engine.jit_delegable_with(
            op,
            |e: Expr| self.pure_expr(e.end as usize - 1),
            |v| self.pure_value(v),
        )
    }

    fn supported_non_reentrant(&self, op: Op) -> bool {
        self.engine.jit_supported_non_reentrant_with(
            op,
            |e: Expr| self.pure_expr(e.end as usize - 1),
            |op| self.delegable(op),
        )
    }

    fn reentrant(&self, op: Op) -> bool {
        self.engine
            .jit_reentrant_with(op, |root| self.pure_expr(root), |v| self.pure_value(v))
    }

    /// The old forward suffix scan, computed once in reverse. Only adjacent
    /// region pcs in the same fuel chunk share a suffix; leaders, exits, control
    /// flow and reentrant tails retain exactly the same boundaries.
    pub(super) fn chunk_lengths(
        &self,
        region: &BTreeSet<usize>,
        leaders: &BTreeSet<usize>,
    ) -> BTreeMap<usize, i64> {
        let mut lengths = BTreeMap::new();
        let mut next = None;
        for &pc in region.iter().rev() {
            let remaining = match next {
                Some((next_pc, remaining))
                    if next_pc == pc + 1
                        && !leaders.contains(&next_pc)
                        && !self.classify(pc).reentrant
                        && is_straight(self.engine.program.ops[pc]) =>
                {
                    remaining + 1
                }
                _ => 1,
            };
            lengths.insert(pc, remaining);
            next = Some((pc, remaining));
        }
        lengths
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Cell, Program, Target, ValueExpr};

    fn engine(ops: Vec<Op>) -> Engine {
        let project = crate::studio::document::Document::blank().value().clone();
        let mut engine = Engine::new(Program::compile(&project).unwrap());
        engine.program.constants = vec![Cell::Number(1.0)];
        engine.program.values = vec![ValueExpr::Constant(0), ValueExpr::CallReturn(0, 0)];
        engine.program.expressions = vec![ExprOp::Value(0), ExprOp::Truth(1)];
        engine.program.expression_starts = vec![0, 1];
        engine.program.call_arguments = vec![vec![0], vec![1]];
        engine.program.ops = ops;
        engine
    }

    #[test]
    fn cached_classification_preserves_the_reentrant_whitelist_and_rebuilds_fresh() {
        let pure = Expr { end: 1 };
        let impure = Expr { end: 2 };
        let mut engine = engine(vec![
            Op::Set(0, pure),
            Op::Set(0, impure),
            Op::Branch(impure, 0),
            Op::Call(0, 0),
            Op::Call(0, 1),
            Op::SetValue(Target::Global(0), 1),
            Op::ReturnValue(1),
            Op::Kitten4Change(Target::Local(0), 1, false),
            Op::AppendList(ListRef::Expression(1), 0),
            Op::AppendList(ListRef::Global(0), 1),
            Op::SetActorVariable(0, 1),
            Op::ClearList(ListRef::Expression(1)),
            Op::Halt,
        ]);
        {
            let analysis = Analysis::new(&engine);
            for (pc, expected) in [
                (true, false),
                (false, false),
                (true, true),
                (true, false),
                (true, true),
                (true, true),
                (true, true),
                (true, true),
                (true, true),
                (true, true),
                (false, false),
                (false, false),
                (false, false),
            ]
            .into_iter()
            .enumerate()
            {
                let class = analysis.classify(pc);
                assert_eq!((class.supported, class.reentrant), expected, "pc {pc}");
                let cached_queries = analysis.purity.borrow().len();
                assert_eq!(analysis.classify(pc), class);
                assert_eq!(analysis.purity.borrow().len(), cached_queries);
            }
            assert_eq!(analysis.ops.borrow().len(), engine.program.ops.len());
            // Only complete roots are cached; numeric expressions and values
            // occupy different namespaces even when they share the same index.
            assert_eq!(analysis.purity.borrow().get(&(false, 1)), Some(&false));
            assert_eq!(analysis.purity.borrow().get(&(true, 0)), Some(&true));
        }
        engine.program.values[1] = ValueExpr::Constant(0);
        let rebuilt = Analysis::new(&engine);
        assert_eq!(
            rebuilt.classify(1),
            OpClass {
                supported: true,
                reentrant: false,
            }
        );
        assert!(!rebuilt.classify(2).reentrant);
    }

    #[test]
    fn cached_purity_keeps_deep_shared_and_cyclic_tree_classification() {
        let mut engine = engine(vec![]);
        engine.program.values = vec![ValueExpr::Constant(0)];
        for child in 0..10_000 {
            engine.program.values.push(ValueExpr::Kitten4Add(child, 0));
        }
        // A separate cycle was accepted by the original visited-set walk. Do
        // not silently change that classification by caching unfinished nodes.
        engine.program.values.push(ValueExpr::Boolean(10_001));
        for impure in [false, true] {
            engine.program.values[0] = if impure {
                ValueExpr::CallReturn(0, 0)
            } else {
                ValueExpr::Constant(0)
            };
            let analysis = Analysis::new(&engine);
            assert_eq!(analysis.pure_value(10_000), !impure);
            assert_eq!(analysis.pure_value(10_000), !impure);
            assert!(analysis.pure_value(10_001));
        }
    }

    #[test]
    fn cached_expression_purity_checks_list_expression_inputs_without_evaluation() {
        let mut engine = engine(vec![]);
        engine.program.expressions = vec![
            ExprOp::ListLength(ListRef::Expression(1)),
            ExprOp::ListItem(ListRef::Expression(1), true),
            ExprOp::Value(0),
            ExprOp::Truth(1),
        ];
        engine.program.expression_starts = vec![0, 1, 2, 3];
        let analysis = Analysis::new(&engine);
        for root in 0..engine.program.expressions.len() {
            assert_eq!(analysis.pure_expr(root), engine.jit_pure_expr(root));
            assert_eq!(analysis.pure_expr(root), root == 2);
        }
    }

    #[test]
    fn reverse_chunk_lengths_match_forward_suffix_scans_at_every_boundary() {
        let set = Op::Set(0, Expr { end: 1 });
        let engine = engine(vec![
            set,
            set,
            set,
            Op::Branch(Expr { end: 1 }, 0),
            set,
            Op::SetValue(Target::Global(0), 1),
            set,
            Op::Call(0, 0),
            set,
            Op::Return,
            set,
            set,
        ]);
        let analysis = Analysis::new(&engine);
        // Include a hole and a leader in a straight run, as well as control
        // flow/reentrant boundaries whose successors are independently reachable.
        let region = BTreeSet::from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
        let leaders = BTreeSet::from([0, 2, 6, 8, 11]);
        let lengths = analysis.chunk_lengths(&region, &leaders);
        for &pc in &region {
            let mut last = pc;
            while !engine.jit_reentrant(engine.program.ops[last])
                && is_straight(engine.program.ops[last])
                && region.contains(&(last + 1))
                && !leaders.contains(&(last + 1))
            {
                last += 1;
            }
            assert_eq!(lengths[&pc], (last - pc + 1) as i64, "pc {pc}");
        }
        assert_eq!(lengths[&0], 2);
        assert_eq!(lengths[&2], 2);
        assert_eq!(lengths[&4], 2);
        assert_eq!(lengths[&5], 1);
        assert_eq!(lengths[&9], 1);
        assert_eq!(lengths[&11], 1);
    }

    #[test]
    fn maximum_straight_chunk_lengths_match_the_original_fuel_accounting() {
        let engine = engine(vec![
            Op::Set(0, Expr { end: 1 });
            super::super::MAX_REGION_OPS
        ]);
        let analysis = Analysis::new(&engine);
        let region = (0..engine.program.ops.len()).collect();
        let lengths = analysis.chunk_lengths(&region, &BTreeSet::from([0]));
        for pc in 0..engine.program.ops.len() {
            assert_eq!(lengths[&pc], (engine.program.ops.len() - pc) as i64);
        }
    }
}
