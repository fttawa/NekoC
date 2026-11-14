// Baseline after the fix/ts-semantics integration (originally main at
// 4e64c70a848088a6506f8b4979545d085625fef8; see README.md).
// Keys are stable 1-based indexes into the original two probe collections.
const errors = {
  6: "Only variable and array element",
  8: "Variable shadowing is not supported: x",
  17: "Unsupported binary expression operator",
  19: "Unsupported expression",
  20: "Unknown identifier: undefined",
  28: "Unsupported expression call",
  29: "Unsupported expression",
  30: "Rest parameters",
  31: "Only expression, variable",
  32: "Unsupported expression",
  34: "Cannot assign to function parameter n",
  36: "Unsupported expression call",
  37: "Unsupported expression call: late",
  53: "for...in enumerates property keys",
  86: "Bitwise operators work only",
  98: "Unsupported binary expression operator",
  99: "typeof is not supported",
  105: "Unsupported expression call: p.toFixed",
  106: "Unsupported expression call: isNaN",
  107: "Unsupported expression call: n.toString",
  110: "Cannot determine JavaScript + / += semantics for any, union or non-primitive operands",
  119: "slice with negative indices",
  129: "Unsupported expression call: s.charCodeAt",
  130: "Unsupported expression call: String.fromCharCode",
  133: "Unsupported expression call: s.at",
  136: "Regular expressions are not supported",
  179: "Object destructuring is not supported",
  180: "new P() is not supported",
  181: "new Map() is not supported",
  182: "new Set() is not supported",
  183: "Unsupported expression",
  184: "JSON.stringify is not supported for share-player objects",
  185: "Unsupported expression call: Date.now",
  186: "Unsupported binary expression operator",
  187: "Unsupported binary expression operator",
  188: "delete is not supported",
  190: "Cannot determine JavaScript + / += semantics for any, union or non-primitive operands",
  193: "Cannot determine JavaScript + / += semantics for any, union or non-primitive operands",
  197: "Cannot determine JavaScript + / += semantics for any, union or non-primitive operands",
  199: "Namespaces containing runtime values",
  205: "Generator functions are not supported: gen",
  207: "Only calls and assignments",
};
const diffs = {
  162: {value: "NaN", node: "undefined"},
};
const extraErrors = {
  17: "Variable shadowing is not supported: k",
  25: "Cannot determine JavaScript loose equality for any, union or non-primitive operands",
};
const extraDiffs = {
  36: {error: "reporter procedure recursion exceeds 200", node: "1000"},
};

export function baseline(group, index) {
  const error = (group === "core" ? errors : extraErrors)[index];
  const difference = (group === "core" ? diffs : extraDiffs)[index];
  return error ? { status: "compile-error", error }
    : difference ? { status: "known-diff", ...difference }
      : { status: "match" };
}
