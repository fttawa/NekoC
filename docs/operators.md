# NekoC Supported Operators & Expressions

## Arithmetic Operators

| Operator | Example | Result |
|----------|---------|--------|
| `+` | `1 + 2` | `3` |
| `-` | `5 - 3` | `2` |
| `*` | `4 * 3` | `12` |
| `/` | `10 / 2` | `5` |
| `%` | `10 % 3` | `1` |
| `**` | `2 ** 10` | `1024` |

## Comparison Operators

| Operator | Example | Result |
|----------|---------|--------|
| `==` | `1 == 1` | `true` |
| `===` | `1 === 1` | `true` |
| `!=` | `1 != 2` | `true` |
| `!==` | `1 !== 2` | `true` |
| `>` | `5 > 3` | `true` |
| `>=` | `5 >= 5` | `true` |
| `<` | `3 < 5` | `true` |
| `<=` | `3 <= 5` | `true` |

## Logical Operators

| Operator | Example | Result |
|----------|---------|--------|
| `&&` | `true && false` | `false` |
| `\|\|` | `true \|\| false` | `true` |
| `!` | `!true` | `false` |
| `??` | `null ?? "default"` | `"default"` |

## Bitwise Operators

| Operator | Example | Result |
|----------|---------|--------|
| `&` | `5 & 3` | `1` |
| `\|` | `5 \| 3` | `7` |
| `^` | `5 ^ 3` | `6` |
| `~` | `~5` | `-6` |
| `<<` | `1 << 3` | `8` |
| `>>` | `8 >> 2` | `2` |
| `>>>` | `-1 >>> 0` | `4294967295` |

> **Note:** Bitwise operators are simplified in NekoC and may not produce exact results for all inputs.

## Assignment Operators

| Operator | Example | Equivalent |
|----------|---------|------------|
| `=` | `x = 5` | `x = 5` |
| `+=` | `x += 3` | `x = x + 3` |
| `-=` | `x -= 2` | `x = x - 2` |
| `*=` | `x *= 4` | `x = x * 4` |
| `/=` | `x /= 2` | `x = x / 2` |
| `%=` | `x %= 3` | `x = x % 3` |
| `**=` | `x **= 2` | `x = x ** 2` |
| `&=` | `x &= 0xf` | `x = x & 0xf` |
| `\|=` | `x \|= 0x1` | `x = x \| 0x1` |
| `^=` | `x ^= 0xff` | `x = x ^ 0xff` |
| `<<=` | `x <<= 2` | `x = x << 2` |
| `>>=` | `x >>= 1` | `x = x >> 1` |
| `>>>=` | `x >>>= 0` | `x = x >>> 0` |
| `&&=` | `x &&= true` | `x = x && true` |
| `\|\|=` | `x \|\|= false` | `x = x \|\| false` |
| `??=` | `x ??= "default"` | `x = x ?? "default"` |

## Unary Operators

| Operator | Example | Result |
|----------|---------|--------|
| `-` | `-x` | Negation |
| `+` | `+x` | Identity |
| `!` | `!x` | Logical NOT |
| `~` | `~x` | Bitwise NOT |
| `++x` | `++x` | Pre-increment |
| `x++` | `x++` | Post-increment |
| `--x` | `--x` | Pre-decrement |
| `x--` | `x--` | Post-decrement |
| `typeof` | `typeof x` | Returns `"number"` |
| `void` | `void expr` | Evaluates expr, returns undefined |
| `delete` | `delete obj.prop` | Returns `true` |
| `await` | `await expr` | Stripped, evaluates expr |

## Conditional (Ternary) Expression

```ts
const result = condition ? trueValue : falseValue;
```

Compiles to a `controls_if` block.

## Template Literals

```ts
const msg = `Hello ${name}, score: ${score}`;
```

Compiles to `text_join` block with interpolated expressions.

## Parenthesized Expressions

```ts
const result = (a + b) * c;
```

Parentheses are preserved in the block structure.

## Type Assertions (Stripped)

```ts
const value = expr as number;   // Stripped to: expr
const value = expr!;            // Stripped to: expr
const value = expr satisfies T; // Stripped to: expr
```

Type assertions are removed during compilation. They don't affect runtime behavior.

## Optional Chaining (Simplified)

```ts
const value = obj?.prop;  // Compiled as: obj (property access)
```

Optional chaining is simplified to regular property access. No null checking is performed at runtime.

## Array Literals

```ts
const arr = [1, 2, 3];
```

Compiles to a `temporary_list` block.

## Destructuring

```ts
const [a, b] = [1, 2];
```

Compiles to individual variable assignments.

## Math Functions

| Function | Description |
|----------|-------------|
| `Math.abs(x)` | Absolute value |
| `Math.floor(x)` | Floor |
| `Math.ceil(x)` | Ceiling |
| `Math.round(x)` | Round |
| `Math.sqrt(x)` | Square root |
| `Math.log(x)` | Natural logarithm |
| `Math.log10(x)` | Base-10 logarithm |
| `Math.pow(2, x)` | Power of 2 |
| `Math.exp(x)` | Exponential |
| `Math.sin(x)` | Sine (degrees) |
| `Math.cos(x)` | Cosine (degrees) |
| `Math.tan(x)` | Tangent (degrees) |

## Number Properties

| Property | Description |
|----------|-------------|
| `x % 2 === 0` | Even |
| `x % 2 === 1` | Odd |
| `x > 0` | Positive |
| `x < 0` | Negative |
| `isPrime(x)` | Prime check |
| `isInteger(x)` | Integer check |

## String Operations

| Operation | Example | Result |
|-----------|---------|--------|
| Concatenation | `"hello" + " world"` | `"hello world"` |
| Template | `` `x=${x}` `` | `"x=5"` |
| Length | `str.length` | Number of characters |
| Contains | `str.contains("sub")` | `true/false` |
| Split | `str.split(",")` | Array of strings |
| Substring | `str.substring(start, end)` | Substring |
| CharAt | `str.charAt(index)` | Single character |

## Random

```ts
random(min, max)  // Random number between min and max
```

> **Note:** The random function uses a deterministic seed based on the current tick count. It produces consistent results for the same execution path.
