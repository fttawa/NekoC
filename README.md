# NekoC

NekoC, short for **Neko Compiler**, is an experimental compiler and inspection
toolchain for Kitten N `.bcmkn` projects.

Kitten means kitten; `neko` means cat. Kitten N is a visual programming
environment, while NekoC explores a text-first path: write a small TypeScript
program, compile it into Kitten N block graphs, and export a `.bcmkn` project
that the official editor can open.

## Status

This project is early and conservative.

- JSON-based `.bcmkn` inspection, roundtrip, structural diff, workspace export,
  decompile-style reporting, and validation are implemented.
- The TypeScript frontend supports a growing subset of Kitten N blocks.
- Plain TypeScript helper functions are inlined at compile time.
- Natural TypeScript variable syntax has started: `let score = 0`,
  `score = score + 1`, and `console.log(score)` compile to Kitten N blocks.
- The compiler preserves unknown project fields and avoids destructive
  rewriting of IDs/resources.

NekoC is not affiliated with Codemao or Kitten N.

## Install

Prerequisites:

- Rust toolchain
- Node.js and npm

```bash
npm install
cargo build
```

Run tests:

```bash
cargo test
npm audit --audit-level=moderate
```

## CLI

```bash
nekoc inspect <input.bcmkn> --out report.json
nekoc roundtrip <input.bcmkn> <output.bcmkn>
nekoc diff <left.bcmkn> <right.bcmkn>
nekoc decompile <input.bcmkn> --out decompile.json
nekoc workspace <input.bcmkn> --out workspace.json
nekoc validate <input.bcmkn> --out validate.json
nekoc compile-ts <input.ts> --out workspace.json
nekoc compile-ts-bcmkn <input.ts> --template template.bcmkn --out output.bcmkn
```

During development, use Cargo:

```bash
cargo run -- compile-ts samples/natural_ts.ts --out natural_ts.workspace.json
cargo run -- compile-ts-bcmkn samples/natural_ts.ts --template samples/我的作品-原生.bcmkn --out natural_ts.bcmkn
```

## TypeScript Example

```ts
let score = 0;

onStart(() => {
  score = score + 1;
  console.log(score);
});
```

Older DSL-style calls are still supported while the real TypeScript lowering
layer grows:

```ts
onStart(() => {
  setVar("score", 0);
  forever(() => {
    changeVar("score", 1);
    consoleLog(getVar("score"));
  });
});
```

## Repository Notes

The included `.bcmkn` fixture is a small native template used for compiler
roundtrip and validation tests. Do not add third-party or private Kitten N works
to the repository. Large editor bundles, downloaded editor assets, generated
reports, and temporary research output should stay outside Git.

## Roadmap

- Lower more natural TypeScript syntax: `if`, `while`, `for`, local variables,
  and expressions.
- Introduce a typed intermediate representation between TypeScript AST and
  Kitten N block JSON.
- Expand resource handling for scenes, actors, costumes, and media.
- Add optimization passes after roundtrip correctness is stable.
