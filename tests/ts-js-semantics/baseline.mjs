// Main baseline: 4e64c70a848088a6506f8b4979545d085625fef8.
// Keys are stable 1-based indexes into the original two probe collections.
const errors = {
  6: "Only variable and array element", 8: "Only expression, variable",
  17: "Unsupported binary expression operator", 19: "Unsupported expression",
  20: "Unknown identifier: undefined", 28: "Unsupported expression call",
  29: "Unsupported expression call: f", 30: "Rest parameters",
  31: "Only expression, variable", 32: "Unsupported expression",
  34: "Cannot assign to function parameter n", 36: "Unsupported expression call",
  37: "Unsupported expression call: late", 42: "Inline parameter binding cycle",
  49: "For loop condition must compare", 50: "Only one for loop variable",
  56: "continue is supported as the last statement", 59: "switch fall-through",
  68: "Only for loops with a let initializer", 69: "Cannot assign to for loop parameter",
  71: "Expected a numeric literal", 72: "For loop step must be",
  73: "Only for loops with a let initializer", 86: "Bitwise operators work only",
  98: "Unsupported binary expression operator", 99: "typeof is not supported",
  105: "Unsupported expression call: p.toFixed", 106: "Unsupported expression call: isNaN",
  107: "Unsupported expression call: n.toString", 119: "slice with negative indices",
  129: "Unsupported expression call: s.charCodeAt", 130: "Unsupported expression call: String.fromCharCode",
  133: "Unsupported expression call: s.at", 136: "Unsupported expression call: test",
  146: "reduce needs an initial value", 165: "Unsupported expression call: a.at",
  167: "Only variable and array element", 175: "Unknown identifier: lim",
  176: "Unsupported expression call: Array.isArray", 179: "Object destructuring is not supported",
  180: "new P() is not supported", 181: "new Map() is not supported",
  182: "new Set() is not supported", 183: "Unsupported expression",
  184: "Unsupported expression call: JSON.stringify", 185: "Unsupported expression call: Date.now",
  186: "Unsupported binary expression operator", 187: "Unsupported binary expression operator",
  188: "Only calls and assignments", 199: "Namespaces containing runtime values",
  205: "Expression function gen must end", 207: "Only calls and assignments",
};
const diffs = {
  3: { error: "unsupported expression change_variables", node: "12" },
  4: { error: "unsupported expression change_variables", node: "22" },
  27: { value: "4", node: "10" }, 40: { value: "NaN", node: "aa" },
  52: { error: "expected list reference", node: "cba" },
  53: { value: "18", node: "3" }, 61: { value: "10", node: "2" },
  65: { value: "0", node: "caught" }, 67: { value: "3", node: "4.5" },
  70: { value: "3", node: "5" }, 78: { value: "1", node: "0" },
  79: { value: "1", node: "0" }, 81: { value: "15", node: "5" },
  82: { value: "7", node: "0" }, 96: { value: "NaN", node: "57.5" },
  128: { value: "6", node: "0123" }, 148: { value: "1,9,10", node: "1,10,9" },
  152: { value: "123321", node: "321321" }, 162: { value: "NaN", node: "undefined" },
  164: { value: "NaN", node: "12" },
  170: { error: "unsupported KN array property assignment", node: "0" },
  171: { value: ",", node: "1,2,3" }, 196: { value: "NaN", node: "a1" },
  198: { value: "NaN", node: "aa" },
};
const extraErrors = { 15: "Inline parameter binding cycle", 17: "Variable shadowing is not supported: k" };
const extraDiffs = {
  1: { value: "6", node: "0123" }, 2: { value: "NaN", node: "x012" },
  5: { value: "3", node: "12" }, 6: { value: "3", node: "12" },
  10: { value: "NaN", node: "42" }, 25: { value: "false", node: "true" },
  34: { value: "NaN", node: "xy" },
  36: { error: "reporter procedure recursion exceeds 200", node: "1000" },
};

export function baseline(group, index) {
  const error = (group === "core" ? errors : extraErrors)[index];
  const difference = (group === "core" ? diffs : extraDiffs)[index];
  return error ? { status: "compile-error", error }
    : difference ? { status: "known-diff", ...difference }
      : { status: "match" };
}
