//! Opt-in wall-clock attribution, independent of the expensive coverage maps.
//! Build with jit-timing and set NEKOC_JIT_TIMING=1 before constructing an Engine;
//! read jit_profile().timing. Normal builds erase all collection calls.
//! Each span records inclusive and exclusive time. Exclusive time subtracts child
//! spans (including nested native re-entry), not arbitrary interpreter work.
//! Clock/RefCell/map overhead is charged to the parent, so use this to locate
//! costs, never as the uninstrumented performance benchmark.
#[cfg(feature = "jit-timing")]
pub(super) use enabled::*;

#[cfg(not(feature = "jit-timing"))]
pub(super) use disabled::*;

#[cfg(feature = "jit-timing")]
mod enabled {
    use std::{cell::RefCell, collections::BTreeMap, rc::Rc, time::Instant};

    pub(in crate::engine::jit) type Handle = Rc<RefCell<State>>;

    #[derive(Default, serde::Serialize)]
    struct Sample {
        calls: u64,
        inclusive_ns: u64,
        exclusive_ns: u64,
    }

    #[derive(Default)]
    pub(in crate::engine::jit) struct State {
        samples: BTreeMap<(&'static str, usize), Sample>,
        counters: BTreeMap<(&'static str, usize), u64>,
        children: Vec<u64>,
        reentrant: BTreeMap<usize, bool>,
    }

    pub(in crate::engine::jit) fn from_env() -> Option<Handle> {
        (std::env::var_os("NEKOC_JIT_TIMING").is_some_and(|v| v == "1"))
            .then(|| Rc::new(RefCell::new(State::default())))
    }

    pub(in crate::engine::jit) struct Span {
        active: Option<(Handle, &'static str, usize, Instant)>,
    }

    #[inline]
    pub(in crate::engine::jit) fn span(
        state: Option<&Handle>,
        name: &'static str,
        site: usize,
    ) -> Span {
        Span {
            active: state.map(|state| {
                state.borrow_mut().children.push(0);
                (state.clone(), name, site, Instant::now())
            }),
        }
    }

    impl Drop for Span {
        #[inline]
        fn drop(&mut self) {
            let Some((state, name, site, start)) = self.active.as_ref() else {
                return;
            };
            let elapsed = start.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64;
            let mut state = state.borrow_mut();
            let children = state.children.pop().expect("balanced JIT timing spans");
            if let Some(parent) = state.children.last_mut() {
                *parent += elapsed;
            }
            let sample = state.samples.entry((name, *site)).or_default();
            sample.calls += 1;
            sample.inclusive_ns += elapsed;
            sample.exclusive_ns += elapsed.saturating_sub(children);
        }
    }

    #[inline]
    pub(in crate::engine::jit) fn count(
        state: Option<&Handle>,
        name: &'static str,
        site: usize,
        n: u64,
    ) {
        if let Some(state) = state {
            *state.borrow_mut().counters.entry((name, site)).or_default() += n;
        }
    }

    #[inline]
    pub(in crate::engine::jit) fn instruction(
        c: &super::super::NativeContext,
        name: &'static str,
        pc: usize,
    ) -> Span {
        let mut name = name;
        if let Some(state) = c.timing.as_ref() {
            let cached = state.borrow().reentrant.get(&pc).copied();
            let reentrant = cached.unwrap_or_else(|| {
                let engine = unsafe { &*c.engine };
                let reentrant = engine.jit_reentrant(engine.program.ops[pc]);
                state.borrow_mut().reentrant.insert(pc, reentrant);
                reentrant
            });
            if reentrant {
                count(c.timing.as_ref(), "helper/reentrant-tail", pc, 1);
                name = match name {
                    "helper/call" => "reentrant/call",
                    "helper/return" => "reentrant/return",
                    "helper/append-cell" => "reentrant/append-cell",
                    other => other,
                };
            }
        }
        span(c.timing.as_ref(), name, pc)
    }

    pub(in crate::engine::jit) fn snapshot(state: &Handle) -> serde_json::Value {
        let state = state.borrow();
        let mut totals: BTreeMap<&str, Sample> = BTreeMap::new();
        let sites: Vec<_> = state
            .samples
            .iter()
            .map(|(&(name, site), sample)| {
                let total = totals.entry(name).or_default();
                total.calls += sample.calls;
                total.inclusive_ns += sample.inclusive_ns;
                total.exclusive_ns += sample.exclusive_ns;
                serde_json::json!({"name":name,"site":site,"calls":sample.calls,
            "inclusive_ns":sample.inclusive_ns,"exclusive_ns":sample.exclusive_ns})
            })
            .collect();
        let counters: Vec<_> = state
        .counters
        .iter()
        .map(|(&(name, site), &value)| serde_json::json!({"name":name,"site":site,"value":value}))
        .collect();
        serde_json::json!({"unit":"ns","totals":totals,"sites":sites,"counters":counters,
                "note":"Instrumented wall time; exclusive subtracts child spans. Region and compile sites are op PCs. Helper sites use op PCs when supplied by native ABI; list helpers use encoded ListRef, assign-item uses encoded target, actor helpers use variable slots, repeat/break use 0. reporter/node sites are expression PCs. Inline guards, parameter reads and math-only helpers remain in native residual, not separately timed. Counters are overlapping observations, not mutually exclusive exit reasons."})
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn nested_spans_are_exclusive_and_counted() {
            let state = Rc::new(RefCell::new(State::default()));
            {
                let _outer = span(Some(&state), "outer", 7);
                let _inner = span(Some(&state), "inner", 8);
                count(Some(&state), "ops", 7, 3);
            }
            let result = snapshot(&state);
            let outer = &result["totals"]["outer"];
            let inner = &result["totals"]["inner"];
            assert_eq!(outer["calls"], 1);
            assert_eq!(inner["calls"], 1);
            assert_eq!(
                outer["inclusive_ns"].as_u64().unwrap(),
                outer["exclusive_ns"].as_u64().unwrap() + inner["inclusive_ns"].as_u64().unwrap()
            );
            assert_eq!(result["counters"][0]["value"], 3);
            assert!(state.borrow().children.is_empty());
        }

        #[test]
        fn disabled_spans_have_no_state_or_clock() {
            let span = span(None, "disabled", 0);
            assert!(span.active.is_none());
            count(None, "disabled", 0, 1);
        }

        #[test]
        fn timed_native_run_preserves_state_without_coverage_maps() {
            use super::super::super::{Engine, Jit, Op};
            use crate::engine::{Expr, ExprOp, Program, Script, ScriptEvent};
            let project = crate::studio::document::Document::blank().value().clone();
            let mut program = Program::compile(&project).unwrap();
            program.initial = vec![0.0];
            program.initial_values = vec![None];
            program.variable_names = vec!["out".into()];
            program.expressions = vec![ExprOp::Constant(3.0)];
            program.expression_starts = vec![0];
            program.ops = vec![Op::Set(0, Expr { end: 1 }), Op::Halt];
            program.sources = vec!["timing-test".into(); 2];
            program.scripts = vec![Script {
                hat: "timing".into(),
                actor: 1,
                event: ScriptEvent::Start,
                start: 0,
            }];
            let mut engine = Engine::new(program);
            // No process-global env mutation: tests may run concurrently.
            engine.jit = Jit::new(engine.program.ops.len());
            let state = Rc::new(RefCell::new(State::default()));
            engine.jit.as_mut().unwrap().timing = Some(state.clone());
            engine.start();
            engine.current_task = 0;
            engine.jit_compile(0);
            assert_eq!(engine.jit_run(0, 0, 1, 100), Some(1));
            assert_eq!(engine.slots[0], 3.0);
            assert_eq!(engine.tasks[0].pc, 1);
            assert!(engine.jit_profile.is_none());
            let profile = engine.jit_profile();
            assert_eq!(profile["timing"]["totals"]["compile"]["calls"], 1);
            assert_eq!(profile["timing"]["totals"]["region/native"]["calls"], 1);
            assert!(state.borrow().children.is_empty());
        }
    }
}

// Compile diagnostics out of normal releases, rather than adding a branch and
// larger helper prologues to every native/Rust round trip being optimized.
#[cfg(not(feature = "jit-timing"))]
mod disabled {
    #[derive(Clone)]
    pub(in crate::engine::jit) struct Handle;
    pub(in crate::engine::jit) struct Span;
    impl Drop for Span {
        fn drop(&mut self) {}
    }
    pub(in crate::engine::jit) fn from_env() -> Option<Handle> {
        None
    }
    #[inline(always)]
    pub(in crate::engine::jit) fn span(_: Option<&Handle>, _: &'static str, _: usize) -> Span {
        Span
    }
    #[inline(always)]
    pub(in crate::engine::jit) fn count(_: Option<&Handle>, _: &'static str, _: usize, _: u64) {}
    #[inline(always)]
    pub(in crate::engine::jit) fn instruction(
        _: &super::super::NativeContext,
        _: &'static str,
        _: usize,
    ) -> Span {
        Span
    }
    pub(in crate::engine::jit) fn snapshot(_: &Handle) -> serde_json::Value {
        unreachable!("timing feature disabled")
    }
}
