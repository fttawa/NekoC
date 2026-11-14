# AGENTS.md

Guidance for coding agents working in this repository. For writing NekoC
programs (the TS subset, stage declarations and API), read [llms.txt](llms.txt).

## What lives where

- `ts/compile-ts.mjs` — TypeScript frontend (Node, uses the `typescript`
  package). Parses TS and emits a Kitten N workspace report. Also the
  `--check` mode used by `nekoc check`.
- `ts/nekoc.d.ts` — type declarations for every API the compiler accepts. When
  you add or change an API in the compiler, update this file and `docs/api.md`.
- `src/bcmkn_compiler.rs` — assembles the workspace report into a `.bcmkn`
  (stage, sprites, costumes, variables, procedures). `default_template()` is
  the empty work used when no `--template` is given.
- `src/check.rs` — `nekoc check`. `src/validate.rs` — structural checks that
  mirror what the official runtime and editor reject.
- `src/engine.rs`, `src/engine/` — the VM (with a cranelift JIT) used by
  `nekoc run`, the web player and `src/player.rs` (player backend SDK).
- `src/kitten4*.rs` — Kitten 4 `.bcm` support.
- `web/` (Web Studio and player), `extension/` (browser extension),
  `samples/` (language samples and fixtures), `tools/` (verification
  scripts), `tests/` (Rust `*.rs` and Node `*.test.mjs`), `docs/`.

## Build

```bash
npm install --ignore-scripts
cargo build
```

## Checks before committing

All of these must pass; CI runs the same set on Windows.

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets --no-fail-fast
npm run -s typecheck
node --test tests/*.test.mjs
```

- Moving or renaming tests that reference blocks can change
  `docs/kn-block-coverage.md`; regenerate it with
  `node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md`.
- Some tool tests read frozen files through `git show`, so keep full history
  (no shallow clones when running the whole suite).
- Do not add wall-clock performance assertions to tests that run in CI; keep
  timing checks local and make CI tests deterministic.

## Producing `.bcmkn` works

- TS plain data objects lower to numeric handles in a hidden global list heap,
  using share-player-supported list/variable/arithmetic/custom-procedure blocks,
  never `_object_*`. Keep the legacy Rust object-block runtime for old works.
  Properties must be initialized and keys compile-time constants; unsupported
  dynamic keys, coercion/JSON/delete and value-producing property updates must
  produce actionable diagnostics, not invalid works. Preserve alias identity and
  single evaluation of initializers/arguments/assignment targets. See
  `docs/ts-share-objects.md` for limitations and official share-bundle evidence.

- After generating or modifying a `.bcmkn`, run
  `node tools/editor-compat.mjs <work.bcmkn>` (needs Playwright; set
  `NEKOC_NODE_MODULES` to a `node_modules` that has it). Only `ok: true`
  counts as passing.
- Custom blocks with parameters: every `procedures_2_stable_parameter` id must
  equal the matching id in the procedure's `params`, and every
  `procedures_2_parameter` needs `mutation` with `id="<param id>"`. The
  official runtime finds parameters only by that id
  (`procedure_no_such_parameter` otherwise). `nekoc check` flags this.
- Return blocks (`procedures_2_return_value`) need the `items="1"` mutation and
  a number shadow, as the editor writes them.
- Do not commit third-party works or the official runtime bundle.

## Commits and PRs

- No attribution lines in commit messages, PR titles or descriptions (no
  `Co-Authored-By`, no "Generated with …", no session links).
- Branch from `main`, open a PR, and merge only after every CI job passes.
