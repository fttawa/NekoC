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
has finished (a generated `__nekoc_ready` flag). In object programs, sprite start
events also wait for this barrier. Timers use cooperative broadcast
scripts and millisecond-to-second waits, not the browser event loop.

Data objects use numeric references into a hidden global list heap (not private
`_object_*` blocks), compatible with the official sharing player. Literal and
initialized properties, nested/aliased values, objects in arrays, function
parameters/returns and root timers preserve reference identity. `obj.key` and
`obj[key]` require compile-time constant keys. Standalone property updates and
compound assignments are supported; missing/optional properties, dynamic keys,
object coercion/logging/JSON, `delete`, and value-producing property updates are
compile errors. Log scalar properties instead. Object programs use custom
procedures rather than argument-substituting inlining; recursive object mutation
or allocation and recursive locals must be rewritten as loops. The heap has no
GC until restart. Methods, prototypes, accessors, spread and destructuring remain
unsupported. See [object lowering and evidence](ts-share-objects.md) and
[the support audit](ts-support-audit.md) for target-specific limitations,
timer cancellation, numeric globals and array factories.

### String addition and numeric conversion

`+` and `+=` use the TypeScript checker's operand types, including string
annotations, function returns, tuple slots, `string[]` elements and object
properties. A known
string operand selects concatenation. Without one, `any`, mixed unions and
non-primitive operands are rejected: use `String(value)` for concatenation,
or supply an accurate numeric type for arithmetic. Type assertions describe values; they
do not perform conversions.
Variable/property reads use their declared types, not control-flow narrowing:
TypeScript does not track all callback or alias writes. A declared mixed union
such as `string | number` is therefore rejected for ambiguous addition even
after an assignment or a type guard; use `String(value)` to request concatenation.
This protection also applies through parentheses, non-null assertions,
`satisfies`, and conditional/logical expressions; these do not turn a declared
mixed union into a runtime guarantee of a single primitive type.
Object property `++` / `--` requires a statically numeric property; string and
`any` properties are rejected because native addition can concatenate strings.

`parseInt` and `parseFloat` currently accept **literal primitive arguments
only** (including parenthesized/asserted literals and a literal `parseInt`
radix). They are evaluated using JavaScript's prefix-parsing rules, not by
converting the whole string and truncating. For example, `parseInt("42px")`
is `42`, `parseInt("11", 2)` is `3`, and `parseFloat("1.5em")` is `1.5`.
Dynamic arguments, including variable reads, produce a compile error; no
approximate parser is emitted. `Number` literal conversions use JS rules too;
dynamic `Number(value)` and unary `+value` accept statically numeric or boolean
operands only.
Dynamic string/`any` conversion is rejected because the native KN conversion
block preserves some invalid strings instead of returning JS `NaN`.
`String(value)` uses the native string conversion block.
Literal conversions/parsing whose result is negative zero are rejected, including
`parseInt("-0px")`, `parseFloat("-0")`, `Number("-0")` and `+"-0"`.
The official player does not preserve the sign of emitted negative-zero number
blocks. Native `-0` literals and dynamic negation still have this underlying
known limitation; this is not a promise of full signed-zero JS semantics.

Loose equality between statically known string/number/boolean operands of
different types inserts numeric conversions, whereas `===` / `!==` retain
the native non-coercing comparison. Cross-type loose equality requires any string
operand to be a literal convertible to a non-NaN number; dynamic/invalid numeric
strings produce a compile error instead of a native conversion error. Loose
equality with `any`, mixed unions or non-primitive operands is rejected; use
explicit conversions or strict equality. This is
not a complete implementation of JS equality: native KN equality considers
`NaN` equal to itself. That remains a known difference; the verified coercion
case is `"5" == 5`.

### Function Declarations (Inlined)

```ts
function double(x: number) {
  return x * 2;
}
```

Simple functions (local declarations plus one final `return`, or statement functions without `return`) are inlined at compile time, except in programs using data objects, where custom procedures preserve argument evaluation and object allocation identity.

Expression inlining uses stable reporter parameters for effectful arguments and local initializers: they execute once, in declaration order, before the body uses them (including unused or short-circuited parameters). Statement inlining similarly freezes nonconstant arguments in normal-procedure parameters, including omitted trailing defaults and unused arguments, before running the body. Literal names and constant aliases remain available to compile-time resource/name APIs. Explicit named-variable APIs (`getVar`, `setVar`, `changeVar`, and variable handles) always address project variables, even when a function has a same-named lexical local.

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

`&&`, `||` and `?:` compile to reporter procedures containing statement-level branches, evaluating only the selected operand and preserving its value. `Math.max`, `Math.min`, `Math.trunc` and boolean-to-number conversion use the same reporter shape: each argument is evaluated once, and no `logic_ternary` (missing from the share player) is emitted. Value-producing `a++`, `++a`, `a--`, `--a` support mutable simple variables; parameter/property updates in expression slots are rejected. `??` currently accepts statically non-nullish numeric, string or boolean operands, including a binding whose declarations and assignments all prove primitive literals; other nullable operands are compile errors, not truthiness tests (`let a = 0; a ?? 7` remains `0`).

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
  parameter), such as `function f(a, b = 1)`, are expanded at each call.
  Other defaults, such as `b = next()` or `b = settings.size`, are evaluated
  once at the call, in argument order, when they read no parameter and every
  name they use means the same file-level binding at the definition and at the
  call; otherwise they are compile errors. An
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
