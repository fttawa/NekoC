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
| core-162 | undefined | NaN | out-of-range array read returns the Kitten N `list_item` empty value; there is no undefined value to return instead |
| extra-036 | 1000 | recursion-depth error | VM reporter recursion has a bounded depth of 200 |

All other differences recorded at main `4e64c70` were fixed by the
fix/ts-semantics integration: the cases now match Node or fail with an
explicit compile error (`baseline.mjs` `errors`). Explicit rejections that
stand in for JS behavior include `+`, `+=` and `==` on `any`/union
operands, regular expressions, generators, `for...in` and BigInt.

The baseline values above are frozen evidence for regression detection, not a
claim that these behaviors are desirable or permanently unsupported.
