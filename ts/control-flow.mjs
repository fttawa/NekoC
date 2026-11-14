import ts from "typescript";

const num = (c, value, parent) => c.addBlock({ type: "math_number", parent_id: parent, fields: { NUM: String(value) }, is_output: true });
const get = (c, variable, parent) => c.addBlock({ type: "variables_get", parent_id: parent, fields: { variable }, is_output: true });
const set = (c, variable, value, parent) => {
  const id = c.addBlock({ type: "variables_set", parent_id: parent, fields: { variable } });
  c.connectInput(id, typeof value === "function" ? value(id) : num(c, value, id), "value", "value");
  return id;
};
const compare = (c, variable, value, parent, OP = "EQ") => {
  const id = c.addBlock({ type: "logic_compare", parent_id: parent, fields: { OP }, is_output: true });
  c.connectInput(id, get(c, variable, id), "A", "value");
  c.connectInput(id, num(c, value, id), "B", "value");
  return id;
};
function combine(c, tests, parent, type = "and") {
  if (tests.length === 1) return tests[0](parent);
  const id = c.addBlock({ type: "logic_operation", parent_id: parent, fields: { type }, is_output: true });
  c.connectInput(id, tests[0](id), "A", "value");
  c.connectInput(id, combine(c, tests.slice(1), id, type), "B", "value");
  return id;
}
function chain(c, ids) {
  ids = ids.filter(Boolean);
  for (let i = 1; i < ids.length; i++) c.connectNext(c.chainTail(ids[i - 1]), ids[i]);
  return ids[0] ?? null;
}
function scope(c, kind, extra = {}) {
  const flag = `__flow_${++c.helperCount}`;
  c.globalVariables.add(flag);
  return { flag, kind, ...extra };
}
const scopes = c => c.flowScopes ??= [];
const flags = c => [...scopes(c).map(s => s.flag), ...c.tryStack.map(s => s.flag)];
function guard(c, parent, compile, continuing = null) {
  const active = flags(c);
  if (!active.length) return compile(parent);
  const id = c.addBlock({ type: "controls_if", parent_id: parent });
  c.connectInput(id, combine(c, active.map(flag => p => compare(c, flag,
    continuing?.flag === flag ? 2 : 0, p, continuing?.flag === flag ? "NEQ" : "EQ")), id), "IF0", "value");
  const first = compile(id);
  if (first) c.connectInput(id, first, "DO0", "statement");
  return id;
}

export function statementList(c, statements, parent) {
  c.loopBodyNext = false;
  return chain(c, Array.from(statements, statement => guard(c, parent, p => c.compileStatement(statement, p))));
}

export function loopBody(c, statements, parent, epilogue = null) {
  let abrupt = flags(c).length > 0;
  const scan = node => {
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node) || ts.isThrowStatement(node)) abrupt = true;
    ts.forEachChild(node, scan);
  };
  for (const statement of statements) scan(statement);
  // Preserve compact native loops (including benchmark warp batches) when no
  // completion needs to cross the body. No flag reads/writes are then needed.
  if (!abrupt) return chain(c, [c.compileStatementList(statements, parent), epilogue?.(parent)]);
  const current = scope(c, "loop");
  scopes(c).push(current);
  let body;
  try {
    body = c.compileStatementList(statements, parent);
    if (epilogue) body = chain(c, [body, guard(c, parent, epilogue, current)]);
  } finally { scopes(c).pop(); }
  const exit = c.addBlock({ type: "controls_if", parent_id: parent });
  const tests = [p => compare(c, current.flag, 2, p), ...flags(c).map(flag => p => compare(c, flag, 0, p, "NEQ"))];
  c.connectInput(exit, combine(c, tests, exit, "or"), "IF0", "value");
  c.connectInput(exit, c.addBlock({ type: "break", parent_id: exit }), "DO0", "statement");
  return chain(c, [set(c, current.flag, 0, parent), body, exit]);
}

export function jump(c, statement, parent, continuing = false) {
  const active = scopes(c);
  let target;
  if (statement.label) {
    const index = active.findLastIndex(s => s.kind === "label" && s.label === statement.label.text);
    if (index >= 0) {
      target = active[index];
      if (continuing) {
        let node = target.statement;
        while (ts.isLabeledStatement(node)) node = node.statement;
        if (!isLoop(node)) c.unsupported(statement, "continue label must name a loop");
        target = active.slice(index + 1).find(s => s.kind === "loop");
      }
    }
  } else target = active.findLast(s => s.kind === "loop" || (!continuing && s.kind === "switch"));
  if (!target) c.unsupported(statement, continuing ? "continue needs an enclosing loop and a valid label" : "break can only be used inside loops, switches, or a valid labeled statement");
  return set(c, target.flag, continuing ? 1 : 2, parent);
}

export function labeled(c, statement, parent) {
  const current = scope(c, "label", { label: statement.label.text, statement: statement.statement });
  scopes(c).push(current);
  let body;
  try { body = c.compileStatement(statement.statement, parent); }
  finally { scopes(c).pop(); }
  return chain(c, [set(c, current.flag, 0, parent), body]);
}

const isLoop = n => ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);

export function switchStatement(c, statement, parent) {
  const current = scope(c, "switch");
  const value = `${current.flag}_value`, selected = `${current.flag}_case`;
  c.globalVariables.add(value);
  c.globalVariables.add(selected);
  const clauses = Array.from(statement.caseBlock.clauses);
  const ids = [set(c, value, p => c.compileExpression(statement.expression, p), parent), set(c, current.flag, 0, parent), set(c, selected, -1, parent)];
  clauses.forEach((clause, index) => {
    if (!ts.isCaseClause(clause)) return;
    // Case expressions after the first match must not be evaluated.
    const check = c.addBlock({ type: "controls_if", parent_id: parent });
    c.connectInput(check, compare(c, selected, -1, check), "IF0", "value");
    const match = c.addBlock({ type: "controls_if", parent_id: check });
    const eq = c.addBlock({ type: "logic_compare", parent_id: match, fields: { OP: "EQ" }, is_output: true });
    c.connectInput(eq, get(c, value, eq), "A", "value");
    c.connectInput(eq, c.compileExpression(clause.expression, eq), "B", "value");
    c.connectInput(match, eq, "IF0", "value");
    c.connectInput(match, set(c, selected, index, match), "DO0", "statement");
    c.connectInput(check, match, "DO0", "statement");
    ids.push(check);
  });
  const fallback = clauses.findIndex(ts.isDefaultClause);
  if (fallback >= 0) {
    const check = c.addBlock({ type: "controls_if", parent_id: parent });
    c.connectInput(check, compare(c, selected, -1, check), "IF0", "value");
    c.connectInput(check, set(c, selected, fallback, check), "DO0", "statement");
    ids.push(check);
  }
  scopes(c).push(current);
  try {
    clauses.forEach((clause, index) => {
      const check = c.addBlock({ type: "controls_if", parent_id: parent });
      c.connectInput(check, combine(c, [p => compare(c, selected, 0, p, "GTE"), p => compare(c, selected, index, p, "LTE")], check), "IF0", "value");
      const body = c.compileStatementList(clause.statements, check);
      if (body) c.connectInput(check, body, "DO0", "statement");
      ids.push(check);
    });
  } finally { scopes(c).pop(); }
  return chain(c, ids);
}

export function doWhile(c, statement, parent) {
  const id = c.addBlock({ type: "repeat_forever", parent_id: parent });
  const body = c.inLoop(() => loopBody(c, c.statementBodyStatements(statement.statement), id, p => {
    const check = c.addBlock({ type: "controls_if", parent_id: p });
    const not = c.addBlock({ type: "logic_negate", parent_id: check, is_output: true });
    c.connectInput(not, c.compileExpression(statement.expression, not), "logic", "value");
    c.connectInput(check, not, "IF0", "value");
    c.connectInput(check, c.addBlock({ type: "break", parent_id: check }), "DO0", "statement");
    return check;
  }));
  c.connectInput(id, body, "DO", "statement");
  return id;
}

function compileSequence(c, expression, parent) {
  if (!expression) return null;
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return chain(c, [compileSequence(c, expression.left, parent), compileSequence(c, expression.right, parent)]);
  }
  return c.compileStatementExpression(expression, parent);
}

export function forStatement(c, statement, parent) {
  // Keep traverse_number only for constant integer bounds with a read-only
  // induction variable. Its inclusive integer range is not a general JS for.
  const decls = statement.initializer && ts.isVariableDeclarationList(statement.initializer) ? statement.initializer.declarations : [];
  for (const declaration of decls) {
    if (ts.isIdentifier(declaration.name) && (c.functionParams?.has(declaration.name.text)
      || c.lookupExpressionBinding(declaration.name.text))) {
      c.unsupported(declaration.name, `Loop variable shadowing a function parameter is not supported: ${declaration.name.text}`);
    }
  }
  const decl = decls.length === 1 ? decls[0] : null;
  let spec = null;
  if (decl && ts.isIdentifier(decl.name) && statement.condition && ts.isBinaryExpression(statement.condition)) {
    const literal = node => {
      if (!node) return null;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
      return null;
    };
    const from = literal(decl.initializer), to = literal(statement.condition.right);
    let writes = false;
    const visit = node => {
      if ((ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left) && node.left.text === decl.name.text)
        || ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && ts.isIdentifier(node.operand) && node.operand.text === decl.name.text)
        || ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.name.text === decl.name.text)) writes = true;
      ts.forEachChild(node, visit);
    };
    visit(statement.statement);
    if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && !writes) {
      try { spec = c.nativeForLoopSpec(statement); } catch { /* General for below handles non-range syntax. */ }
      if (spec && (!Number.isSafeInteger(spec.step) || spec.step <= 0)) spec = null;
    }
  }
  if (spec) {
    // Preserve zero-iteration behavior without relying on traverse direction.
    const check = c.addBlock({ type: "controls_if", parent_id: parent });
    const condition = c.addBlock({ type: "logic_compare", parent_id: check,
      fields: { OP: spec.down ? "GTE" : "LTE" }, is_output: true });
    c.connectInput(condition, c.compileExpression(spec.from, condition), "A", "value");
    c.connectInput(condition, c.compileForLoopLimit(spec.to, condition, spec.exclusiveEnd, spec.down), "B", "value");
    c.connectInput(check, condition, "IF0", "value");
    // Retain range bindings rather than reserving a global induction variable:
    // old helpers and disjoint loops may reuse the same local range name.
    const loop = c.compileTraverseLoop(statement, spec, check);
    c.connectInput(check, loop, "DO0", "statement");
    return check;
  }
  if (decls.length) {
    // A general for uses writable variables, unlike traversal parameters.
    // Give each declaration site its own storage so disjoint loops and inline
    // statement calls can reuse i without colliding in the flat project table.
    const names = new Map(decls.filter(d => ts.isIdentifier(d.name)).map(d =>
      [d.name.text, `__for_local_${++c.helperCount}_${d.name.text}`]));
    // General block shadowing is not implemented. Reject nested declarations
    // instead of accidentally renaming references across their lexical scope.
    const checkShadowing = node => {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)
        && names.has(node.name.text)) c.unsupported(node.name, `Loop variable shadowing is not supported: ${node.name.text}`);
      ts.forEachChild(node, checkShadowing);
    };
    checkShadowing(statement.statement);
    const transformed = ts.transform(statement, [context => {
      const visit = node => {
        if (ts.isShorthandPropertyAssignment(node) && names.has(node.name.text)) {
          return ts.factory.createPropertyAssignment(node.name, ts.factory.createIdentifier(names.get(node.name.text)));
        }
        const propertyName = node.parent && ((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
          || (ts.isPropertyAssignment(node.parent) && node.parent.name === node));
        if (ts.isIdentifier(node) && names.has(node.text) && !propertyName) {
          return ts.setTextRange(ts.setOriginalNode(ts.factory.createIdentifier(names.get(node.text)), node), node);
        }
        const updated = ts.visitEachChild(node, visit, context);
        // Callback helpers are indexed by AST identity during preprocessing.
        // Preserve that registration when renamed loop references rebuild calls.
        if (updated !== node && c.helperCalls.has(node)) c.helperCalls.set(updated, c.helperCalls.get(node));
        return updated;
      };
      return node => ts.visitNode(node, visit);
    }]);
    statement = transformed.transformed[0];
    transformed.dispose();
  }
  let init = null;
  if (statement.initializer) {
    init = ts.isVariableDeclarationList(statement.initializer)
      ? chain(c, Array.from(statement.initializer.declarations, d => c.compileVariableDeclaration(d, parent)))
      : compileSequence(c, statement.initializer, parent);
  }
  const id = c.addBlock({ type: statement.condition ? "repeat_forever_until" : "repeat_forever", parent_id: parent });
  if (statement.condition) {
    const not = c.addBlock({ type: "logic_negate", parent_id: id, is_output: true });
    c.connectInput(not, c.compileExpression(statement.condition, not), "logic", "value");
    c.connectInput(id, not, "condition", "value");
  }
  const body = c.inLoop(() => loopBody(c, c.statementBodyStatements(statement.statement), id,
    statement.incrementor ? p => compileSequence(c, statement.incrementor, p) : null));
  c.connectInput(id, body, "DO", "statement");
  return chain(c, [init, id]);
}

export function throwStatement(c, statement, parent) {
  const context = c.tryStack.at(-1);
  if (!context) c.unsupported(statement, "throw requires a local enclosing try/catch; uncaught and cross-function exceptions are not supported");
  let value = statement.expression;
  if (value && ts.isNewExpression(value) && ts.isIdentifier(value.expression) && /Error$/.test(value.expression.text)) {
    value = value.arguments?.[0] ?? ts.factory.createStringLiteral("");
  }
  return chain(c, [set(c, context.error, p => value ? c.compileExpression(value, p)
    : c.addBlock({ type: "text", parent_id: p, fields: { TEXT: "" }, is_output: true }), parent), set(c, context.flag, 1, parent)]);
}

export function forOf(c, statement, parent, listName, source) {
  if (statement.awaitModifier) c.unsupported(statement, "for await...of is not supported");
  const decl = ts.isVariableDeclarationList(statement.initializer) ? statement.initializer.declarations[0] : null;
  const binding = decl?.name ?? statement.initializer;
  if (!ts.isIdentifier(binding)) c.unsupported(statement.initializer, "for...of needs a simple loop variable");
  if (listName === null && !c.isArrayExpression(source)) {
    c.unsupported(statement.expression, "for...of requires a known array or project list; string iteration is not supported");
  }
  const variable = binding.text;
  if (c.functionParams?.has(variable) || c.lookupExpressionBinding(variable)
    || c.lookupRangeBinding(variable) || (decl && c.globalVariables.has(variable))) {
    c.unsupported(binding, `Loop variable shadowing is not supported: ${variable}`);
  }
  c.globalVariables.add(variable);
  const name = `__for_of_${++c.helperCount}`;
  const iterable = `${name}_source`, counter = `${name}_index`;
  c.globalVariables.add(iterable);
  c.globalVariables.add(counter);
  c.arrayVariables.add(iterable);
  const save = listName === null ? set(c, iterable, p => c.compileExpression(source, p), parent) : null;
  const connectList = id => listName !== null ? c.connectListInput(id, "list", listName)
    : c.connectInput(id, get(c, iterable, id), "list", "value");
  const id = c.addBlock({ type: "repeat_forever_until", parent_id: parent });
  const condition = c.addBlock({ type: "logic_compare", parent_id: id, fields: { OP: "GTE" }, is_output: true });
  c.connectInput(condition, get(c, counter, condition), "A", "value");
  const length = c.addBlock({ type: "list_length", parent_id: condition, is_output: true });
  connectList(length);
  c.connectInput(condition, length, "B", "value");
  c.connectInput(id, condition, "condition", "value");
  // List indices are one-based. Increment before loading the current item;
  // continue skips the remaining body, never the iterator advancement.
  const step = c.addBlock({ type: "change_variables", parent_id: id, fields: { variable: counter, method: "increase" } });
  c.connectInput(step, num(c, 1, step), "value", "value");
  const assign = set(c, variable, p => {
    const item = c.addBlock({ type: "list_item", parent_id: p, fields: { item: "any" }, is_output: true });
    connectList(item);
    c.connectInput(item, get(c, counter, item), "list_index", "value");
    return item;
  }, id);
  const body = c.inLoop(() => loopBody(c, c.statementBodyStatements(statement.statement), id));
  c.connectInput(id, chain(c, [step, assign, body]), "DO", "statement");
  return chain(c, [save, set(c, counter, 0, parent), id]);
}

export function validateFinally(c, statement) {
  if (!statement.finallyBlock) return;
  // A finally must run on every completion. Returns still use the procedure
  // runtime directly, so reject abrupt shapes rather than silently skip it.
  const visit = node => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) || ts.isBreakStatement(node) || ts.isContinueStatement(node) || ts.isThrowStatement(node)) {
      c.unsupported(node, "Abrupt control flow with try/finally is not supported; finally must not be skipped");
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
}
