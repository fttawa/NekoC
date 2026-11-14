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

The tsfeat merge reclassified lexical shadowing, static function arguments,
nested declarations/function expressions, assigned scalar parameters, IIFEs, hoisted calls,
comma/assignment expressions, static nullish comparisons and `typeof`, supported
formatting/UTF-16 operations, negative string slices and constant JSON folding
as matches after executing the cases against Node. Dynamic JSON stays a compile
error. The extra-016 probe's top-level function refers to an event-local `g`;
unique lexical names now reject that inaccessible binding instead of capturing
its former global runtime storage. This is an explicit compile error, not a new
known difference.

The baseline values above are frozen evidence for regression detection, not a
claim that these behaviors are desirable or permanently unsupported.
