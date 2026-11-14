import ts from "typescript";

// Statement-level lowering keeps mutable lexical bindings in their original
// scope; no lifted closure or reporter containing a statement block is needed.
export function lowerTsSequences(sourceFile) {
  const f = ts.factory;
  const names = new Set();
  const collect = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collect); };
  collect(sourceFile);
  let next = 0;
  const fresh = () => { let name; do { name = `__tsfeatSequence${next++}`; } while (names.has(name)); names.add(name); return f.createIdentifier(name); };
  const unwrap = node => { while (ts.isParenthesizedExpression(node)) node = node.expression; return node; };
  const special = node => ts.isBinaryExpression(node) && [ts.SyntaxKind.CommaToken, ts.SyntaxKind.EqualsToken].includes(node.operatorToken.kind);
  const result = ts.transform(sourceFile, [context => {
    const declaration = (name, value) => f.createVariableStatement(undefined, f.createVariableDeclarationList([
      f.createVariableDeclaration(name, undefined, undefined, value),
    ], ts.NodeFlags.Const));
    const value = (node, prefix) => {
      const inner = unwrap(node);
      if ((ts.isPrefixUnaryExpression(inner) || ts.isPostfixUnaryExpression(inner))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(inner.operator)) {
        throw new Error("Update values inside comma expressions are not supported; split the update into a separate statement before reading the value");
      }
      if (!special(inner)) return ts.visitEachChild(node, visit, context);
      if (inner.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        const left = value(inner.left, prefix);
        prefix.push(declaration(fresh(), left));
        return value(inner.right, prefix);
      }
      if (!ts.isIdentifier(inner.left)) throw new Error("Assignment values require a simple variable target; split property/array assignments into separate statements");
      const right = value(inner.right, prefix);
      const temp = fresh();
      prefix.push(declaration(temp, right));
      prefix.push(f.createExpressionStatement(f.createBinaryExpression(inner.left, ts.SyntaxKind.EqualsToken, temp)));
      return temp;
    };
    const statement = node => {
      const prefix = [];
      if (ts.isExpressionStatement(node)) {
        const inner = unwrap(node.expression);
        if (special(inner) && (inner.operatorToken.kind === ts.SyntaxKind.CommaToken || special(unwrap(inner.right)))) {
          prefix.push(declaration(fresh(), value(inner, prefix)));
          return [f.createBlock([], false), ...prefix];
        }
        if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken && special(unwrap(inner.right))) {
          const right = value(inner.right, prefix);
          return [...prefix, f.updateExpressionStatement(node, f.updateBinaryExpression(inner, inner.left, inner.operatorToken, right))];
        }
      }
      if (ts.isVariableStatement(node)) {
        const hasSequence = node.declarationList.declarations.some(d => d.initializer && special(unwrap(d.initializer)));
        for (const d of node.declarationList.declarations) {
          const initial = d.initializer && special(unwrap(d.initializer)) ? value(d.initializer, prefix) : d.initializer && ts.visitNode(d.initializer, visit);
          prefix.push(f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList,
            [f.updateVariableDeclaration(d, d.name, d.exclamationToken, d.type, initial)])));
        }
        // Prevent the backend's lazy local-expression substitution from
        // discarding or duplicating a comma operand even if its temp is unused.
        return hasSequence ? [f.createBlock([], false), ...prefix] : prefix;
      }
      if (ts.isReturnStatement(node) && node.expression && special(unwrap(node.expression))) {
        const result = value(node.expression, prefix);
        // A block makes this a procedure, not a lazy expression-inline body:
        // otherwise an unused discarded-value declaration would never execute.
        return [f.createBlock([...prefix, f.updateReturnStatement(node, result)], true)];
      }
      return [ts.visitNode(node, visit)];
    };
    // tsctrl lowers comma-separated for initializers/increments in place,
    // including continue paths. Only their top-level comma spine is exempt:
    // nested conditional operands and the repeatedly evaluated test still use
    // the normal checks below.
    const forHeader = node => {
      if (!node) return node;
      if (ts.isParenthesizedExpression(node)) return f.updateParenthesizedExpression(node, forHeader(node.expression));
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return f.updateBinaryExpression(node, forHeader(node.left), node.operatorToken, forHeader(node.right));
      }
      return ts.visitNode(node, visit);
    };
    const visit = node => {
      if (ts.isSourceFile(node)) return f.updateSourceFile(node, node.statements.flatMap(statement));
      if (ts.isBlock(node)) return f.updateBlock(node, node.statements.flatMap(statement));
      if (ts.isForStatement(node)) return f.updateForStatement(node,
        forHeader(node.initializer), ts.visitNode(node.condition, visit),
        forHeader(node.incrementor), ts.visitNode(node.statement, visit));
      // Do not hoist out of conditional operands/loop tests: doing so would
      // eagerly execute writes that JS may skip or evaluate on each iteration.
      if (special(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) throw new Error("Comma expressions here require conditional/repeated evaluation; split them into separate statements in the same branch or loop body");
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  try {
    const output = result.transformed[0];
    const printer = ts.createPrinter();
    const fix = node => { if (node.pos < 0 || ts.getOriginalNode(node) !== node) node.getText = () => printer.printNode(ts.EmitHint.Unspecified, node, output); ts.forEachChild(node, fix); };
    fix(output);
    ts.setParentRecursive(output, true);
    return output;
  } finally { result.dispose(); }
}
