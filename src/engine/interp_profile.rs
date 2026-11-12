//! Opt-in nested interpreter diagnostics, compiled out of ordinary builds.
//!
//! Counts are exact for instrumented entries. Timings include instrumentation
//! overhead and must not be compared with normal release benchmark timings.
use std::{cell::RefCell, collections::BTreeMap, fmt, fmt::Debug, time::Instant};

#[derive(Default, serde::Serialize)]
struct Entry {
    calls: u64,
    inclusive_ns: u128,
    exclusive_ns: u128,
}

#[derive(Default)]
struct Profile {
    entries: BTreeMap<String, Entry>,
    children: Vec<u128>,
}

thread_local! {
    static PROFILE: RefCell<Profile> = RefCell::new(Profile::default());
}

pub(super) struct Span {
    key: String,
    start: Instant,
}

// Stop Debug after the variant name: do not format a large descriptor payload
// just to discard it. This is diagnostics-only, never an execution-time key.
struct Variant(String);

impl fmt::Write for Variant {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        if let Some(end) = text.find(['(', ' ', '{']) {
            self.0.push_str(&text[..end]);
            Err(fmt::Error)
        } else {
            self.0.push_str(text);
            Ok(())
        }
    }
}

pub(super) fn span(category: &str, value: &impl Debug) -> Span {
    use fmt::Write;
    let start = Instant::now();
    let mut variant = Variant(String::new());
    let _ = write!(variant, "{value:?}");
    let key = format!("{category}/{}", variant.0);
    PROFILE.with_borrow_mut(|p| p.children.push(0));
    Span { key, start }
}

impl Drop for Span {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed().as_nanos();
        PROFILE.with_borrow_mut(|p| {
            let children = p.children.pop().expect("balanced profiling spans");
            if let Some(parent) = p.children.last_mut() {
                *parent += elapsed;
            }
            let entry = p.entries.entry(std::mem::take(&mut self.key)).or_default();
            entry.calls += 1;
            entry.inclusive_ns += elapsed;
            entry.exclusive_ns += elapsed.saturating_sub(children);
        });
    }
}

/// Reset at a frame boundary, after warmup. Never call inside an active span.
pub fn reset() {
    PROFILE.with_borrow_mut(|p| {
        assert!(p.children.is_empty());
        p.entries.clear();
    });
}

/// Return the current thread's entries without changing VM state.
pub fn snapshot() -> serde_json::Value {
    PROFILE.with_borrow(|p| serde_json::to_value(&p.entries).expect("profile serialization"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_entries_count_repeated_calls_and_reset_without_active_spans() {
        reset();
        {
            let _outer = span("op", &Some(123));
            for _ in 0..2 {
                let _inner = span("value", &None::<usize>);
            }
        }
        let report = snapshot();
        assert_eq!(report["op/Some"]["calls"], 1);
        assert_eq!(report["value/None"]["calls"], 2);
        let outer = &report["op/Some"];
        let inner = &report["value/None"];
        assert_eq!(
            outer["inclusive_ns"].as_u64().unwrap(),
            outer["exclusive_ns"].as_u64().unwrap() + inner["inclusive_ns"].as_u64().unwrap()
        );
        reset();
        assert_eq!(snapshot(), serde_json::json!({}));
    }
}
