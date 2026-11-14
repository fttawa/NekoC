import ts from "typescript";

// Conservative whole-source proof for primitive bindings. Every declaration
// and assignment must keep the binding non-nullish; unknown function results
// or aliased property reads are deliberately not guessed from type annotations.
export function nonNullishBinding(c, expression, literal) {
  if (!ts.isIdentifier(expression)) return false;
  let declarations = 0;
  let safe = true;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text) {
      declarations++;
      safe &&= Boolean(node.initializer && literal(node.initializer));
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === expression.text) safe = false;
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === expression.text
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      safe &&= literal(node.right);
    }
    // Explicit named-variable writes may bypass lexical identifier assignments.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && ["setVar", "changeVar"].includes(node.expression.text)) {
      if (!ts.isStringLiteral(node.arguments[0]) || node.arguments[0].text === expression.text) safe = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(c.sourceFile);
  return declarations === 1 && safe;
}

// Capture only procedure/range parameters. Ordinary variables stay live reads
// inside the selected branch; the enclosing function later binds its locals
// to the shared invocation frame. Inputs are evaluated before entering helpers.
function reporter(c, input, parent, build, boxed = false) {
  const serial = ++c.helperCount;
  const id = `kn-proc-choice-${serial}`;
  const valueName = `__choiceValue${serial}`;
  const captures = [...new Set([...(c.functionParams ?? []), ...c.rangeBindings])];
  const names = boxed ? captures : [valueName, ...captures];
  const spec = { id, name: id, type: "ROUND", params: [
    { id: `${id}-label`, name: id, type: "Label" },
    ...names.map((name, index) => ({ id: `${id}-param-${index}`, name, type: "String" })),
  ] };
  const call = c.compileProcedureCallArgs(spec, [...(boxed ? [] : [input]), ...captures.map(name => ts.factory.createIdentifier(name))], parent, true);
  const saved = [c.blocks, c.connections, c.functionParams, c.currentProcedureParams, c.rangeBindings,
    c.flowScopes, c.tryStack, c.loopDepth, c.currentStatementNode];
  c.blocks = {};
  c.connections = {};
  c.functionParams = new Set(names);
  c.currentProcedureParams = new Map(spec.params.filter(p => p.type === "String").map(p => [p.name, p.id]));
  c.rangeBindings = [];
  c.flowScopes = [];
  c.tryStack = [];
  c.loopDepth = 0;
  try {
    const shadows = Object.fromEntries(spec.params.map((p, index) => [`PARAMS${index}`, p.type !== "String" ? ""
      : `<shadow xmlns="http://www.w3.org/1999/xhtml" type="math_number" id="shadow-${p.id}" visible="visible"><field constraints="-Infinity,Infinity,0," allow_text="true" name="NUM">0</field></shadow>`]));
    const definition = c.addBlockWithId(id, { type: "procedures_2_defnoreturn", parent_id: null,
      fields: { NAME: id },
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml">${spec.params.map(p =>
        `<arg id="${p.id}" name="${p.name}" type="${p.type}"></arg>`).join("")}</mutation>`,
      shadows: { PROCEDURES_2_DEFNORETURN_DEFINE: "", ...shadows, STACK: "" },
      deletable: false, editable: false,
    });
    spec.params.forEach((param, index) => {
      if (param.type !== "String") return;
      const block = c.addBlockWithId(param.id, { type: "procedures_2_stable_parameter", parent_id: definition,
        fields: { param_name: param.name } });
      c.connectInput(definition, block, `PARAMS${index}`, "value");
    });
    c.connectInput(definition, build(valueName, definition), "STACK", "statement");
    c.procedures.push({ ...spec, workspaceData: { blocks: c.blocks, connections: c.connections, comments: {} } });
  } finally {
    [c.blocks, c.connections, c.functionParams, c.currentProcedureParams, c.rangeBindings,
      c.flowScopes, c.tryStack, c.loopDepth, c.currentStatementNode] = saved;
  }
  return call;
}

// The editor refuses list/hexagonal reporters directly in custom-block value
// slots. A round, no-input reporter preserves the value and evaluates once.
export function boxedValue(c, expression, parent) {
  return reporter(c, null, parent, (_, definition) => c.compileReturn(expression, definition), true);
}

// A null branch denotes the already evaluated condition value (&& / ||).
export function lazyChoice(c, condition, whenTrue, whenFalse, parent) {
  return reporter(c, condition, parent, (value, definition) => {
    const choice = c.addBlock({ type: "controls_if", parent_id: definition,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>' });
    c.connectInput(choice, c.compileParameterGet(value, choice, condition), "IF0", "value");
    for (const [branch, slot] of [[whenTrue, "DO0"], [whenFalse, "ELSE"]]) {
      const ret = c.addReturnValueBlock(choice);
      c.connectInput(ret, branch ? c.compileExpression(branch, ret) : c.compileParameterGet(value, ret, condition), "VALUE", "value");
      c.connectInput(choice, ret, slot, "statement");
    }
    return choice;
  });
}

export function updateValue(c, expression, parent) {
  const operand = expression.operand;
  if (!ts.isIdentifier(operand) || c.functionParams?.has(operand.text)
    || c.lookupExpressionBinding(operand.text) || c.lookupRangeBinding(operand.text)) {
    c.unsupported(expression, "Value-producing updates require a mutable simple variable; parameters and properties are not supported");
  }
  if (!c.globalVariables.has(operand.text)) c.unsupported(operand, `Unknown identifier: ${operand.text}`);
  // JS ++/-- converts the old value to a number, including the postfix result.
  const numeric = ts.factory.createCallExpression(ts.factory.createIdentifier("Number"), undefined, [operand]);
  return reporter(c, numeric, parent, (value, definition) => {
    const next = ts.factory.createBinaryExpression(ts.factory.createIdentifier(value),
      expression.operator === ts.SyntaxKind.PlusPlusToken ? ts.SyntaxKind.PlusToken : ts.SyntaxKind.MinusToken,
      ts.factory.createNumericLiteral(1));
    const assign = c.addBlock({ type: "variables_set", parent_id: definition, fields: { variable: operand.text } });
    c.connectInput(assign, c.compileExpression(next, assign), "value", "value");
    const ret = c.addReturnValueBlock(definition);
    c.connectInput(ret, ts.isPostfixUnaryExpression(expression) ? c.compileParameterGet(value, ret, expression)
      : c.compileExpression(next, ret), "VALUE", "value");
    c.connectNext(assign, ret);
    return assign;
  });
}
