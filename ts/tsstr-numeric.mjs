import ts from "typescript";

const numericFunctions = new Map([
  ["Number", Number],
  ["parseInt", parseInt],
  ["parseFloat", parseFloat],
]);

function unwrap(node) {
  while (ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)) {
    node = node.expression;
  }
  return node;
}

// A wrapper distinguishes an unsupported expression from any primitive value.
// Type assertions only erase syntax: `"42px" as number` is still a string.
function staticPrimitive(node) {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text };
  }
  if (ts.isNumericLiteral(node)) return { value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = staticPrimitive(node.operand);
    if (!operand) return null;
    switch (node.operator) {
      case ts.SyntaxKind.PlusToken: return { value: +operand.value };
      case ts.SyntaxKind.MinusToken: return { value: -operand.value };
      case ts.SyntaxKind.ExclamationToken: return { value: !operand.value };
      case ts.SyntaxKind.TildeToken: return { value: ~operand.value };
      default: return null;
    }
  }
  return null;
}

/**
 * Evaluate a Number/parseInt/parseFloat CallExpression with literal primitive
 * arguments. Returns { value: number }, including NaN, Infinity and negative
 * zero, or null for an unsupported callee/argument. Missing arguments and extra
 * static arguments follow JavaScript semantics; dynamic extra arguments are
 * rejected because evaluating them could have observable effects.
 *
 * This does not resolve names: callers must ensure the callee refers to the
 * JavaScript built-in, not a shadowing declaration. Identifiers (even NaN,
 * Infinity and undefined), property access, spread arguments and arbitrary
 * expressions are deliberately not evaluated. TS assertions are erased, not
 * used as conversions. No source code is executed.
 */
export function evaluateStaticNumericCall(call) {
  if (!call || !ts.isCallExpression(call)) return null;
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return null;
  const convert = numericFunctions.get(callee.text);
  if (!convert) return null;
  const args = [];
  for (const argument of call.arguments) {
    const primitive = staticPrimitive(argument);
    if (!primitive) return null;
    args.push(primitive.value);
  }
  // Native built-ins supply the specification's ToString, ToNumber, ToInt32,
  // whitespace, sign, prefix and longest-valid-prefix rules without an
  // approximation of their parsing algorithms.
  return { value: convert(...args) };
}
