# NekoC Supported TypeScript Syntax

NekoC compiles a growing subset of TypeScript to Kitten N `.bcmkn` projects.

## Supported Syntax

### Variable Declarations

```ts
let score = 0;
const name = "player";
let x = 10 + 20;
```

### Function Declarations (Inlined)

```ts
function double(x: number) {
  return x * 2;
}
```

Functions are inlined at compile time. They don't create Kitten N custom procedures.

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
```

### For...Of Loops

```ts
for (const item of list) {
  console.log(item);
}
```

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

### Try/Catch

```ts
try {
  // code that might throw
} catch (e) {
  console.log("Error caught");
}
```

> **Note:** Try/catch compiles to the try body only. The catch block is ignored.

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

> **Note:** Throw compiles to a `stop` block.

### Break Statements

```ts
forever(() => {
  if (getVar("x") > 100) {
    break;
  }
});
```

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

Enum members are registered as global variables.

### Class Declarations

```ts
class Player {
  move() {
    moveSteps(10);
  }
}
```

Class methods are registered as global variables.

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
const { x, y } = obj;
```

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

### Optional Chaining

```ts
const value = obj?.prop;
```

Simplified to regular property access.

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

```ts
obj instanceof Class;
"prop" in obj;
```

Simplified to `true`.

## Control Flow Compilation

| TypeScript | Kitten N Block |
|------------|---------------|
| `if (cond) { }` | `controls_if` |
| `if (cond) { } else { }` | `controls_if` with ELSE |
| `while (cond) { }` | `when` (condition checked each tick) |
| `for (let i = 0; i < n; i++) { }` | `repeat_n_times` or `traverse_number` |
| `for (const x of arr) { }` | `repeat_n_times` with list access |
| `do { } while (cond)` | Body executed once, then `when` |
| `switch (x) { case: ... }` | Chain of `controls_if` blocks |
| `break` | `break` |
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
