# NekoC

**NekoC** (Neko Compiler) is an experimental compiler and runtime for Kitten N `.bcmkn` projects.

Write TypeScript → Compile to Kitten N blocks → Export `.bcmkn` that the official editor can open.

## Quick Start

```bash
npm install
cargo build
```

```ts
// hello.ts
let score = 0;
onStart(() => {
  score = score + 1;
  console.log(score);
});
```

```bash
nekoc compile-ts-bcmkn hello.ts --template samples/我的作品-原生.bcmkn --out hello.bcmkn
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `compile-ts <input.ts> --out <output.json>` | Compile TS to workspace JSON |
| `compile-ts-bcmkn <input.ts> --template <template.bcmkn> --out <out.bcmkn>` | Compile TS to `.bcmkn` |
| `compile-ts-scenario <input.ts> --template <t> --scenario <s> --out <out>` | Compile and verify |
| `decompile <input.bcmkn> --out <output.ts>` | Decompile `.bcmkn` to TypeScript |
| `inspect <input.bcmkn> --out <report.json>` | Inspect `.bcmkn` structure |
| `validate <input.bcmkn>` | Validate `.bcmkn` |
| `run <input.bcmkn> --ticks 30 [--event click]` | Run and snapshot |
| `run-scenario <input.bcmkn> <scenario.json>` | Run scenario test |
| `watch <input.ts> --template <t> --out <out>` | Watch and auto-recompile |
| `diff <left.bcmkn> <right.bcmkn>` | Structural diff |
| `roundtrip <input.bcmkn> <output.bcmkn>` | Roundtrip test |
| `test <input.ts>` | Run compile-time unit tests |
| `analyze-ir <ir.json> --out <report.json>` | Analyze IR |

### Options

| Option | Description |
|--------|-------------|
| `--optimize` | Enable constant folding, dead code elimination, expression simplification |
| `--emit-ir <path>` | Emit IR sidecar |
| `--emit-analysis <path>` | Emit analysis report |

## Documentation

- **[API Reference](docs/api.md)** — All functions, events, variables, lists, motion, appearance, effects, pen, clones, sensing
- **[Self API](docs/self-api.md)** — Sprite callback API (`self.move()`, `self.say()`, etc.)
- **[Supported Syntax](docs/syntax.md)** — All supported TypeScript syntax constructs
- **[Operators](docs/operators.md)** — Arithmetic, comparison, logical, bitwise, assignment operators

## Examples

### Events and Variables

```ts
let score = 0;
onClick(() => {
  score = score + 1;
  say(`Score: ${score}`);
});
```

### Control Flow

```ts
onStart(() => {
  forRange("i", 1, 10, 1, () => {
    moveSteps(rangeValue("i"));
    turn(36);
  });
});
```

### Broadcasts

```ts
onStart(() => {
  broadcast("reset");
});
onMessage("reset", () => {
  setVar("score", 0);
});
```

### Lists

```ts
onStart(() => {
  appendList("items", "hello");
  appendList("items", "world");
  if (listContains("items", "hello")) {
    say("Found!");
  }
});
```

### Multi-Screen

```ts
screen("menu", { backdrop: "https://example.com/menu.png" }, () => {
  sprite("start", { costume: "https://example.com/start.png" }, () => {
    onStart(() => {
      switchScreen("game");
    });
  });
});

screen("game", { backdrop: "https://example.com/game.png" }, () => {
  sprite("player", { costume: "https://example.com/player.png" }, () => {
    onStart(() => {
      console.log("Game started");
    });
  });
});
```

### Sprite Self API

```ts
sprite("player", {
  costume: "https://example.com/player.png",
  x: 0,
  y: 0,
}, self => {
  self.onStart(() => {
    self.move(10);
    self.turn(90);
    self.say("Hello!");
    self.setEffect("color", 50);
    self.penDown();
    self.setPenColor("#ff0000");
  });
});
```

### Compile-Time Tests

```ts
function double(x: number) {
  return x * 2;
}

test("double", () => {
  expect(double(21)).toBe(42);
});
```

```bash
cargo run -- test my_tests.ts
```

## Optimizer

Enable with `--optimize`:

```bash
nekoc compile-ts input.ts --out output.json --optimize
```

Optimizations:
- **Constant folding** — `2 + 3` → `5` at compile time
- **Dead code elimination** — removes unreferenced blocks
- **Expression simplification** — `x + 0 → x`, `x * 1 → x`, `x * 0 → 0`

## Runtime

NekoC includes a reverse-engineered Kitten N runtime interpreter. Run `.bcmkn` projects directly:

```bash
nekoc run project.bcmkn --ticks 30
nekoc run project.bcmkn --ticks 1 --event click:100,200
nekoc run project.bcmkn --ticks 1 --event key-down:space
```

### Scenario Testing

```json
{
  "ticks": 2,
  "events": [
    { "kind": "click", "x": 15, "y": -20 }
  ],
  "expect": {
    "variables.kn-var-score": 1
  },
  "expect_trace": [
    { "kind": "start" },
    { "kind": "click", "x": 15, "y": -20 }
  ]
}
```

```bash
nekoc run-scenario project.bcmkn scenario.json
```

### Source Map

The compiler generates source maps. Runtime trace entries include `source_line` and `source_column` for debugging:

```json
{
  "tick": 1,
  "kind": "start",
  "owner_id": "actor-1",
  "block_id": "b1",
  "source_line": 2,
  "source_column": 0
}
```

## Testing

```bash
cargo test                          # Rust tests (151 tests)
npm run typecheck                   # TypeScript type checking
npm run test:ts                     # TypeScript unit tests
npm run test:tools                  # Oracle comparison tests
```

## Project Structure

```
kitten-n-cli/
├── src/
│   ├── main.rs              # CLI entry point
│   ├── lib.rs               # Module declarations
│   ├── runtime/             # Runtime interpreter
│   │   ├── mod.rs           # Runtime struct, public API
│   │   ├── eval.rs          # Expression evaluation
│   │   ├── exec.rs          # Block execution
│   │   └── helpers.rs       # Utility functions
│   ├── decompile.rs         # .bcmkn → TypeScript decompiler
│   ├── bcmkn_compiler.rs    # TS → .bcmkn compiler pipeline
│   ├── optimizer.rs         # Constant folding, dead code elimination
│   ├── scenario.rs          # Scenario test runner
│   ├── ir.rs                # Intermediate representation
│   ├── analysis.rs          # IR analysis
│   ├── diff.rs              # Structural diff
│   ├── inspect.rs           # .bcmkn inspection
│   ├── validate.rs          # .bcmkn validation
│   └── ts_frontend.rs       # TypeScript frontend entry
├── ts/
│   ├── compile-ts.mjs       # TypeScript compiler (JS)
│   └── nekoc.d.ts           # TypeScript type definitions
├── samples/                 # Sample projects
├── tests/
│   └── mvp.rs               # Integration tests (147 tests)
└── docs/                    # Documentation
```

## Status

- ✅ TypeScript → `.bcmkn` compilation
- ✅ `.bcmkn` → TypeScript decompilation
- ✅ Runtime interpreter (151 tests)
- ✅ Scenario testing system
- ✅ Watch mode
- ✅ Optimizer
- ✅ Source maps
- ✅ Comprehensive TS syntax support
- ✅ Self API with type definitions

## Repository Notes

Do not add third-party `.bcmkn` files to the repository. Large editor bundles, downloaded editor assets, generated reports, and temporary research output should stay outside Git.
