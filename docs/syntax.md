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

Recursive functions (including mutual recursion) and functions with early or multiple `return`s compile to Kitten N custom procedures. Parameters are per call; `let`/`const` locals inside them are shared by all calls. `return c ? a : b` is lowered to if/else so recursion terminates.

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

Counting up uses `<`/`<=` with `i++`, `i += k` or `i = i + k`; counting down uses `>`/`>=` with `i--`, `i -= k` or `i = i - k`. Bounds may be variables; a loop whose start is already past its end runs zero times.

### For...Of Loops

```ts
for (const item of [1, 2, 3]) {
  console.log(item);
}
for (const item of self.list("scores")) {
  console.log(item);
}
```

Works over array literals, array variables and project lists (`self.list("name")`).

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

Supported as the last statement of a loop body, or as `if (...) { ...; continue; }` directly in a loop body (the rest of the body becomes the else branch).

### Try/Catch

```ts
try {
  // code that might throw
} catch (e) {
  console.log("Error caught");
}
```

> **Note:** Only throws written directly in the try block reach the catch block; others stop the script.

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

> **Note:** Outside a try block with catch, throw compiles to a `stop` block.

### Break Statements

```ts
forever(() => {
  if (getVar("x") > 100) {
    break;
  }
});
```

`break` works in `while`, `for`, `for...of`, `do...while`, `forever`, `repeat` and `repeatUntil`. In `switch` it may only end a case.

### Labeled Statements

```ts
outer: for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    if (i + j > 15) break outer;
  }
}
```

> **Note:** Labels are stripped during compilation.

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
- Ambient declarations (`declare`), overload signatures, and namespaces that
  contain only interfaces/type aliases are stripped. A namespace with runtime
  values is rejected because Kitten N has no namespace value model.
- Default parameters with constant defaults (including an earlier constant
  parameter), such as `function f(a, b = 1)`, are expanded at each call. An
  omitted optional parameter may be used only when its value is not observed;
  use a default parameter when `undefined` must be tested.
  Inline calls whose arguments would capture a callee parameter name are
  rejected; rename the caller variable or use a non-inline function.
  String defaults support inline string operations; functions lowered to custom
  procedures reject string defaults because their parameter types cannot be
  specialized per call.
  String bracket reads require a provably in-bounds integer index on a constant
  string (including inline parameter/local aliases and immutable literal names).
  Out-of-bounds or unproven reads are rejected rather than treating possible
  `undefined` as text; use `charAt` when empty-string fallback is intended.
  Even in-bounds bracket reads are rejected when the selected UTF-16 code unit
  is a high or low surrogate: the current UTF-8 runtime cannot preserve isolated
  surrogates. Other BMP characters in the same string remain indexable.
- Enums: `enum Foo { ... }` (registered as variables)
- Classes: `class Foo { ... }` (registered as variables)
