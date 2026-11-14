# NekoC Supported TypeScript Syntax

NekoC compiles a growing subset of TypeScript to Kitten N `.bcmkn` projects.

## Supported Syntax

### Variable Declarations

```ts
let score = 0;
const name = "player";
let x = 10 + 20;
```

Ordinary top-level statements and nonconstant initializers are supported:

```ts
const values = [1, 2].map(x => x * 2);
const state = {count: 0};
state.count += 1;
console.log(values.join(","));
const timer = setInterval(() => { state.count += 1; }, 100);
setTimeout(() => { clearInterval(timer); }, 1000);
```

Constants still initialize the project variable table. Other top-level code runs
in source order in an implicit start script. Explicit `onStart` handlers remain
separate, concurrent start scripts; each first waits until that initialization
has finished (a generated `__nekoc_ready` flag). Separate sprite workspaces are
not covered by this initialization barrier. Timers use cooperative broadcast
scripts and millisecond-to-second waits, not the browser event loop.

Data objects support literal properties, nested/aliased values, `obj.key` and
`obj[key]` reads, assignment and arithmetic compound assignment. Methods,
prototypes, accessors, spread and destructuring remain unsupported. See
[the support audit](ts-support-audit.md) for target-specific limitations,
timer cancellation, numeric globals and array factories.

### Function Declarations (Inlined)

```ts
function double(x: number) {
  return x * 2;
}
```

Simple functions (local declarations plus one final `return`, or statement functions without `return`) are inlined at compile time.

Expression inlining uses stable reporter parameters for effectful arguments and local initializers: they execute once, in declaration order, before the body uses them (including unused or short-circuited parameters). Effectful arguments to inline statement functions are currently rejected; evaluate them into variables before the call. Explicit named-variable APIs (`getVar`, `setVar`, `changeVar`, and variable handles) always address project variables, even when a function has a same-named lexical local.

Recursive functions (including mutual recursion) and functions with early or multiple `return`s compile to Kitten N custom procedures. Parameters and mutable `let`/`const` locals are per call: a wrapper allocates a fresh list frame for the implementation. Generated temporaries and lazy expression helpers share that invocation's frame. The native reporter evaluator still has a 200-call safety guard (not the official KN stack limit); wrappers and expression helpers count toward it.

```ts
function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
```

### Arrow Functions (as Callbacks)

```ts
onStart(() => {
  // body
});
```

### If/Else

```ts
if (score > 100) {
  say("High score!");
} else {
  say("Keep trying!");
}
```

### While Loops

```ts
while (x < 10) {
  changeVar("x", 1);
}
```

### For Loops (C-style)

```ts
for (let i = 0; i < 10; i++) {
  moveSteps(10);
}
for (let i = 10; i > 0; i -= 2) {
  moveSteps(i);
}
```

General loops use a live while condition and explicit increment. Fractional starts, variable steps, `i *= 2`, complex conditions, multiple declarations/increments, body writes to the induction variable, existing variables and `for (;;) { ... }` are supported. Conditions are reevaluated each iteration. Constant integer ranges with a read-only induction variable retain the compact traversal-block optimization.

### For...Of Loops

```ts
for (const item of [1, 2, 3]) {
  console.log(item);
}
for (const item of self.list("scores")) {
  console.log(item);
}
```

Works over array literals, known array variables and project lists (`self.list("name")`); the iterable is evaluated once. Literal strings iterate Unicode code points. Dynamic string iteration and `for...in` property-key enumeration currently produce explicit compile errors instead of being treated as list-value iteration.

### Do...While Loops

```ts
do {
  changeVar("x", 1);
} while (x < 10);
```

### Switch/Case

```ts
switch (value) {
  case 1:
    console.log("one");
    break;
  case 2:
    console.log("two");
    break;
  default:
    console.log("other");
}
```

### Continue

```ts
for (let i = 0; i < 10; i++) {
  if (i % 2 === 0) {
    continue;
  }
  changeVar("odd", 1);
}
```

Supported inside nested conditionals and switches. For increments and do/while tests still execute after `continue`. Labeled continue must target an enclosing loop.

### Try/Catch

```ts
try {
  // code that might throw
} catch (e) {
  console.log("Error caught");
}
```

Local throws inside nested loops and conditionals unwind to the enclosing catch. Exceptions across function boundaries and uncaught throws are compile errors. Abrupt completion (`return`, `break`, `continue`, `throw`) in a try/finally construct is rejected because finally-on-every-completion is not implemented.

### Return Statements

```ts
function getValue() {
  return 42;
}
```

### Throw Statements

```ts
throw new Error("Something went wrong");
```

> **Note:** Outside a local try block with catch, throw produces a compile diagnostic; it never silently becomes `stop`.

### Break Statements

```ts
forever(() => {
  if (getVar("x") > 100) {
    break;
  }
});
```

`break` works in loops and anywhere inside a switch case. Switch supports fall-through and conditional breaks; its discriminant is evaluated once and later case expressions are skipped after the first match.

### Labeled Statements

```ts
outer: for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    if (i + j > 15) break outer;
  }
}
```

Labels are preserved as control targets. Labeled break can leave nested loops or a labeled block without stopping the statements that follow that target.

### Lazy Values and Updates

`&&`, `||` and `?:` compile to reporter procedures containing statement-level branches, evaluating only the selected operand and preserving its value. Value-producing `a++`, `++a`, `a--`, `--a` support mutable simple variables; parameter/property updates in expression slots are rejected. `??` currently accepts statically non-nullish numeric, string or boolean operands, including a binding whose declarations and assignments all prove primitive literals; other nullable operands are compile errors, not truthiness tests (`let a = 0; a ?? 7` remains `0`).

### Empty Statements

```ts
;
```

Empty statements are ignored.

### Type Assertions (Stripped)

```ts
const value = expr as number;
const value = expr!;
const value = expr satisfies Type;
```

All type assertions are removed during compilation.

### Enum Declarations

```ts
enum Color {
  Red,
  Green,
  Blue,
}
```

Enum members compile to constants (`Color.Green` becomes `1`); string members and explicit values are supported.

### Class Declarations

```ts
class Player {
  move() {
    moveSteps(10);
  }
}
```

Class declarations are accepted but instances and method calls are not supported.

### Template Literals

```ts
const msg = `Hello ${name}!`;
```

### Array Literals

```ts
const items = [1, 2, 3];
```

### Destructuring

```ts
const [a, b] = [1, 2];
```

Object destructuring is not supported (Kitten N has no object values).

### Import/Export (Project Files)

```ts
import { helper } from "./lib/helper";
export function myFunction() { ... }
```

Only relative imports are supported. Imported functions are inlined.

### Import Statements (Type Stripped)

```ts
import type { MyType } from "./types";
```

Type-only imports are stripped.

### Computed Property Access

```ts
const value = obj["key"];
const item = arr[0];
```

### Nullish Coalescing

```ts
const value = expr ?? defaultValue;
```

### Async/Await (Stripped)

```ts
await somePromise;
```

`await` is stripped. Promises are not supported.

### Void Operator

```ts
void expr;
```

Stripped to just `expr`.

### Delete Operator

```ts
delete obj.prop;
```

Returns `true`.

### Ternary

```ts
setVar("label", score > 100 ? "high" : "low");
```

Compiles to `logic_ternary`. As in the official runtime both branches are evaluated.

### Math

`Math.floor/ceil/round/trunc/abs/sqrt/exp/log/log10/pow/max/min/random`, radian `Math.sin/cos/tan/asin/acos/atan`, and constants such as `Math.PI` map to math blocks.

### Strings and Arrays

`+` joins text when either side is statically a string (literal, template, string variable, `as string`, `join()`). Strings support `.length`, `s[i]`, `charAt`, `slice`, `substring`, `includes` and `split`. Variables initialised with an array literal (or `split()` / `tempList()`) hold a list value: `a[i]`, `a[i] = v`, `a.length`, `a.push(x)`, `a.includes(x)`.

### Array and String Methods

Methods without a Kitten N block compile to helper custom blocks built from loops (added only when used): arrays support `map`, `filter`, `forEach`, `reduce`, `find`, `findIndex`, `some`, `every`, `sort`, `indexOf`, `lastIndexOf`, `join`, `concat`, `slice`, `reverse`, `pop`, `shift`, `unshift` and `splice`; strings support `indexOf`, `lastIndexOf`, `startsWith`, `endsWith`, `replace`, `replaceAll`, `trim*`, `repeat`, `padStart`, `padEnd`, `toUpperCase`, `toLowerCase` and `concat`.

### Default Parameters and try/catch

`function f(x, y = 10)` fills omitted arguments. A `throw` written directly in a `try` block jumps to `catch (e)`; `e` receives the thrown value (the message for `new Error(...)`).

### Spread Operator

```ts
const arr = [...otherArr];
```

Spread is stripped to the inner expression.

### RegExp Literals

```ts
const pattern = /hello/;
```

Compiled as text string.

### BigInt Literals

```ts
const big = 123n;
```

Compiled as number.

### Tagged Template Literals

```ts
tag`template`;
```

Tag is stripped, template is compiled normally.

### Instanceof / In Operators

Not supported (Kitten N has no objects); they are compile errors.

## Control Flow Compilation

| TypeScript | Kitten N Block |
|------------|---------------|
| `if (cond) { }` | `controls_if` |
| `if (cond) { } else { }` | `controls_if` with ELSE |
| `while (cond) { }` | `repeat_forever_until` (not cond) |
| `for (let i = 0; i < n; i++) { }` | `traverse_number` (guarded by `if` when bounds are not constant) |
| `for (const x of arr) { }` | `repeat_n_times` with list access |
| `do { } while (cond)` | `repeat_forever` with a trailing `if not cond: break` |
| `switch (x) { case: ... }` | `controls_if` / else-if chain |
| `break` | `break` |
| `continue` | rest of the loop body moved into an else branch |
| `c ? a : b` | `logic_ternary` |
| `return expr` | `procedures_2_return_value` |
| `throw` | `stop` |
| `try { } catch { }` | Try body only |

## Type Handling

All TypeScript type annotations are stripped during compilation:

```ts
// Input
let x: number = 5;
function add(a: number, b: number): number { return a + b; }
const arr: string[] = ["a", "b"];
interface Point { x: number; y: number; }

// Compiled as
let x = 5;
function add(a, b) { return a + b; }
const arr = ["a", "b"];
// interface is stripped entirely
```

## Supported Type Features

- Basic types: `number`, `string`, `boolean`, `any`, `void`, `null`, `undefined`
- Array types: `number[]`, `Array<number>`
- Union types: `string | number`
- Generic types: `Map<string, number>`
- Type assertions: `expr as Type`, `expr!`, `expr satisfies Type`
- Type-only imports/exports: `import type { ... }`
- Interfaces: `interface Foo { ... }` (stripped)
- Type aliases: `type Foo = ...` (stripped)
- Enums: `enum Foo { ... }` (registered as variables)
- Classes: `class Foo { ... }` (registered as variables)
