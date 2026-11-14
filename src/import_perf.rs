//! Opt-in, thread-local import timings. Normal player calls do not read the clock.
use std::{cell::RefCell, collections::BTreeMap};
use web_time::Instant;

thread_local! {
    static TIMINGS: RefCell<Option<BTreeMap<&'static str, f64>>> = const { RefCell::new(None) };
}

pub struct Span {
    name: &'static str,
    start: Option<Instant>,
}

pub fn span(name: &'static str) -> Span {
    Span {
        name,
        start: TIMINGS.with(|t| t.borrow().as_ref().map(|_| Instant::now())),
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        if let Some(start) = self.start {
            TIMINGS.with(|t| {
                if let Some(t) = t.borrow_mut().as_mut() {
                    *t.entry(self.name).or_default() += start.elapsed().as_secs_f64() * 1000.0;
                }
            });
        }
    }
}

/// Timings are inclusive: e.g. diagnostics contains its engine compiles.
pub fn measure<T>(f: impl FnOnce() -> T) -> (T, BTreeMap<&'static str, f64>) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            TIMINGS.with(|t| {
                t.borrow_mut().take();
            });
        }
    }
    TIMINGS.with(|t| {
        let mut timings = t.borrow_mut();
        assert!(timings.is_none(), "nested import timing collection");
        *timings = Some(BTreeMap::new());
    });
    let _reset = Reset;
    let result = f();
    let timings = TIMINGS.with(|t| t.borrow_mut().take().unwrap());
    (result, timings)
}
