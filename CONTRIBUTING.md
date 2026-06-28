# Contributing

NekoC is still reverse-engineering-heavy, so small, verifiable changes are best.

## Development Checks

Before opening a PR, run:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
npm audit --audit-level=moderate
```

## Fixtures

Only commit fixtures that you own or that are explicitly licensed for public
redistribution. Do not commit third-party Kitten N projects, downloaded editor
bundles, private works, generated `.bcmkn` outputs, or large research dumps.

## Compiler Changes

When adding TypeScript syntax or a new Kitten N block:

- Add a focused test first.
- Preserve unknown `.bcmkn` fields.
- Prefer lowering through existing block helpers before introducing new
  abstractions.
- Keep generated block graphs loadable in the official editor.
