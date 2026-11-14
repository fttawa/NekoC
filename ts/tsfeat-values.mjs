import ts from "typescript";

// Nullish values are erased only after every read has been proven to be a
// compile-time comparison/typeof. They must never become a magic string or 0:
// either representation would alias an ordinary JavaScript value.
export function lowerTsValues(sourceFile) {
  const f = ts.factory;
  const host = {
    getSourceFile: name => name === sourceFile.fileName ? sourceFile : undefined,
    getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => "",
    getDirectories: () => [], fileExists: name => name === sourceFile.fileName,
    readFile: () => undefined, getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const checker = ts.createProgram([sourceFile.fileName], { noLib: true, noResolve: true }, host).getTypeChecker();
  const symbol = node => checker.getSymbolAtLocation(node);
  const declarations = new Map();
  const writes = new Set();
  const ordinaryDeclaration = node => ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
    && !ts.isForOfStatement(node.parent.parent) && !ts.isForInStatement(node.parent.parent);
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  };
  const functionOf = node => { for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return null; };
  const safeInitializer = (d, read) => {
    if (functionOf(d) !== functionOf(read)) return false;
    const scope = d.parent.parent.parent;
    // var is function-scoped even in a skipped conditional block. Without
    // dominance analysis only direct function/source declarations are safe.
    return !!(d.parent.flags & ts.NodeFlags.BlockScoped) || ts.isSourceFile(scope)
      || (ts.isBlock(scope) && ts.isFunctionLike(scope.parent));
  };
  const scan = node => {
    if (ordinaryDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(symbol(node.name), node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(unwrap(node.left))) writes.add(symbol(unwrap(node.left)));
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && ts.isIdentifier(node.operand)) writes.add(symbol(node.operand));
    ts.forEachChild(node, scan);
  };
  scan(sourceFile);
  const error = (node, message) => {
    const e = new Error(message);
    e.name = "CompileError";
    const p = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    e.location = { file: sourceFile.fileName, line: p.line + 1, column: p.character + 1 };
    throw e;
  };
  const primitive = (node, seen = new Set()) => {
    node = unwrap(node);
    if (!node) return { known: true, value: undefined };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
    if (ts.isIdentifier(node)) {
      const s = symbol(node);
      if (node.text === "undefined" && !s?.declarations?.length) return { known: true, value: undefined };
      const d = declarations.get(s);
      if (d && (node.pos < d.end || !safeInitializer(d, node))) return { known: false };
      if (d && !writes.has(s) && !seen.has(s)) return primitive(d.initializer, new Set([...seen, s]));
    }
    if (ts.isNumericLiteral(node)) return { known: true, value: Number(node.text) };
    if (ts.isStringLiteralLike(node)) return { known: true, value: node.text };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
    return { known: false };
  };
  const nullishDeclarations = new Set([...declarations].filter(([s, d]) => {
    const p = primitive(d.initializer);
    return !writes.has(s) && p.known && p.value == null;
  }).map(([, d]) => d));
  const typeofValue = (node, seen = new Set()) => {
    const p = primitive(node);
    if (p.known) return typeof p.value;
    node = unwrap(node);
    if (ts.isArrayLiteralExpression(node) && node.elements.every(item => primitive(item).known)) return "object";
    if (ts.isObjectLiteralExpression(node) && node.properties.every(item => ts.isPropertyAssignment(item)
      && !ts.isComputedPropertyName(item.name) && primitive(item.initializer).known)) return "object";
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return "function";
    if (ts.isIdentifier(node)) {
      const s = symbol(node);
      if (s?.declarations?.some(d => ts.isFunctionDeclaration(d))) return "function";
      const d = declarations.get(s);
      if (d && node.pos >= d.end && safeInitializer(d, node) && !writes.has(s) && d.initializer && !seen.has(s)) return typeofValue(d.initializer, new Set([...seen, s]));
    }
    return null;
  };
  let changed = false;
  const result = ts.transform(sourceFile, [context => {
    const visit = node => {
      if (ts.isTypeNode(node)) return node;
      if (ts.isTypeOfExpression(node)) {
        const operand = unwrap(node.expression);
        const kind = ts.isIdentifier(operand) && !symbol(operand) ? "undefined" : typeofValue(operand);
        if (!kind) error(node, "typeof requires a statically known, unchanged value; compare against an explicit type flag instead");
        changed = true;
        return f.createStringLiteral(kind);
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
        const a = primitive(node.left), b = primitive(node.right);
        if (a.known && b.known && (a.value == null || b.value == null)) {
          const op = node.operatorToken.kind;
          const equal = [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op) ? a.value == b.value : a.value === b.value;
          changed = true;
          return equal !== [ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(op) ? f.createTrue() : f.createFalse();
        }
      }
      if (ts.isVariableDeclaration(node) && nullishDeclarations.has(node)) {
        changed = true;
        // References left after folding are rejected below, so this unused
        // storage slot is not an observable representation of null/undefined.
        return f.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, f.createNumericLiteral(0));
      }
      if (ordinaryDeclaration(node) && ts.isIdentifier(node.name) && !node.initializer) {
        error(node, "Uninitialized mutable variables need undefined storage, which is not supported; initialize with a concrete value before assigning later");
      }
      if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined" && !symbol(node)?.declarations?.length)) {
        error(node, "null/undefined values are supported only in static comparisons and typeof; use an explicit validity flag for runtime values");
      }
      if (ts.isIdentifier(node) && !(ts.isVariableDeclaration(node.parent) && node === node.parent.name)
        && nullishDeclarations.has(declarations.get(symbol(node)))) {
        error(node, "Reading a null/undefined variable at runtime is not supported; use an explicit validity flag and initialize a concrete value");
      }
      if (ts.isDeleteExpression(node)) error(node, "delete is not supported: array deletion creates a hole (it is not splice); use splice(i, 1) to remove an element, or an explicit validity flag to preserve indices");
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  try {
    if (!changed) return sourceFile;
    return ts.createSourceFile(sourceFile.fileName, ts.createPrinter().printFile(result.transformed[0]), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } finally { result.dispose(); }
}
