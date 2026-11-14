# TypeScript/JavaScript semantics corpus

This directory contains the 245 synthetic probes copied from the read-only
`E:/nekoc-wt/tscases` source (`cases.mjs` and `cases2.mjs`). The corpus is
intentionally checked in as source, not as generated `.bcmkn` works or as a
third-party project.

## Statuses and baseline

`baseline.mjs` records the main-branch baseline at
`4e64c70a848088a6506f8b4979545d085625fef8`. Every original case gets one of:

* `match`: Node's deterministic oracle and the bytecode VM agree.
* `compile-error`: compilation is expected to fail; `error` is the required
  diagnostic fragment.
* `known-diff`: the case compiles but is deliberately not claimed equivalent;
  the expected Node value/error and VM value/error are recorded in the
  baseline mapping and explained in `known-diff.md`.

The declaration fixes made after that baseline are represented separately in
`runtime-extra.mjs` (20 cases). They cover omitted/undefined/zero defaults,
chained defaults referring to earlier parameters, recursive defaults, local
type/interface/declare declarations, type-only namespaces, overloads, string
default operations, and property names that are not lexical variable reads.

## Runner

`prepare.mjs` is the short shared preparation API. `prepareCases(cases)` runs
the Node oracle and TypeScript frontend in one process and returns reports
that can be assembled in memory. It accepts additional cases with `{id, cat,
name, top, body}`; `runtime-extra.mjs` is the checked-in example.

* `tests/ts-js-semantics.test.mjs` checks corpus size, status completeness,
  and the Node oracle (fast JavaScript-only test).
* `tests/ts_js_semantics.rs` invokes the preparation module once, assembles
  each successful report, and runs the bytecode Engine with JIT disabled for
  60 virtual ticks. It verifies `match`, `compile-error`, and `known-diff`
  assertions in a single batch test.

The Node oracle registers all `onStart` callbacks before dispatching them.
This avoids treating the host API itself as a semantic failure. It is only a
small synchronous oracle and does not claim equivalence for general async
behavior.

The baseline currently contains 159 matches, 54 compile errors, and 32 known
differences among the 245 original probes. A later frontend change may turn a
compile error into a match; update only the relevant baseline entry and its
evidence after confirming both Node and VM results.

## Run and update expectations

Install dependencies with `npm ci --ignore-scripts`, then run:

```sh
node --test tests/ts-js-semantics.test.mjs
cargo test --test ts_js_semantics -- --nocapture
```

In the shared Windows task environment, route every Cargo command through the
global semaphore instead: `bash E:/nekoc-wt/_cargo.sh test --test
ts_js_semantics -- --nocapture` (from the worktree root).

The fast metadata check is included in `npm run -s test:tools`; the full VM
comparison is included in `cargo test --all-targets`. No wall-clock performance
assertions are made. Finite numeric observations allow the original relative
rounding tolerance (`1e-9`); NaN/Infinity and other text must match exactly.

IDs use stable 1-based positions in the original arrays. To promote a fixed
case to `match`, remove its entry from `errors`/`diffs` (or the extra mappings)
in `baseline.mjs`, then run the full VM test. Do not regenerate the whole
baseline to hide a new mismatch. For a newly unsupported form, use
`compile-error` and an explicit stable error fragment; for a documented
limitation, use `known-diff` and update `known-diff.md` with the observation.

All official-editor/player equivalence in this corpus remains **未验证**.
The Node host's `wait()` is a synchronous final-state stub for the sole
noncompeting wait probe; it is not a scheduling oracle. Random probes assert
only their specified range predicates, not a particular random sequence.
