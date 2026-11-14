# Known-difference evidence

These are differential observations from the Node oracle and this repository's
bytecode VM. They are **not official Kitten runtime/editor verification**.
The VM side is intentionally recorded as an expected limitation or runtime
error so that the batch test detects an accidental change rather than silently
turning an unsupported feature into a pass.

The Node value is the JavaScript value rendered with the probe runner's string
conversion. `VM` is the expected VM value/error from the baseline run.

| case | Node | VM | evidence / likely boundary |
| --- | --- | --- | --- |
| core-003/004 | 12 / 22 | `change_variables` error | postfix/prefix update expression is lowered to a change block in a reporter context owned by Sprite |
| core-027 | 10 | 4 | recursive calls overwrite the caller's shared local variables |
| core-040 | aa | NaN | adding two string-valued function results is lowered as numeric addition |
| core-052 | cba | list-reference error | `for-of` string lowering reaches list iteration machinery |
| core-053 | 3 | 18 | `for-in` array keys are not represented with JavaScript's key semantics |
| core-061 | 2 | 10 | labeled break does not exit the intended outer loop |
| core-065 | caught | 0 | throw from the loop body is not caught by the generated handler |
| core-067 | 4.5 | 3 | fractional loop start is normalized by KN loop lowering |
| core-070 | 5 | 3 | changing the loop upper bound has different evaluation timing |
| core-078/079 | 0 / 0 | 1 / 1 | logical operators eagerly evaluate side-effecting right operands |
| core-081 | 5 | 15 | ternary selection eagerly evaluates both side-effecting branches |
| core-082 | 0 | 7 | nullish coalescing is lowered as logical OR and replaces zero |
| core-096 | 57.5 | NaN | Number/parseInt/parseFloat conversion does not match JS parsing |
| core-128 | 0123 | 6 | string `+=` in a loop is lowered as numeric addition |
| core-148 | 1,10,9 | 1,9,10 | default array sorting uses numeric rather than lexicographic order |
| core-152 | 321321 | 123321 | reverse returns/shared aliases are represented differently |
| core-162 | undefined | NaN | out-of-range array read uses numeric empty value |
| core-164 | 12 | NaN | array rest destructuring does not construct the remaining array |
| core-170 | 0 | sparse-property error | assigning `length` is rejected by the KN array model |
| core-171 | 1,2,3 | `,` | flattening nested arrays does not produce JS flat() elements |
| core-196 | a1 | NaN | tuple mixed string/number addition is not typed JS coercion |
| core-198 | aa | NaN | string type annotations do not select string concatenation in KN |
| extra-001 | 0123 | 6 | string `+=` in a loop follows numeric accumulator lowering |
| extra-002 | x012 | NaN | non-empty string accumulator is still numerically lowered |
| extra-005/006 | 12 / 12 | 3 / 3 | repeated string `+=` loses JS string coercion |
| extra-010 | 42 | NaN | `parseInt` with a unit suffix is not accepted as JS numeric parsing |
| extra-025 | true | false | loose equality between a number and numeric string differs |
| extra-034 | xy | NaN | adding two string array elements is lowered as numeric addition |
| extra-036 | 1000 | recursion-depth error | VM reporter recursion has a bounded depth of 200 |

The baseline values above are frozen evidence for regression detection, not a
claim that these behaviors are desirable or permanently unsupported.
