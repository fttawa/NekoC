import ts from "typescript";

// Host-only type queries; no filesystem or standard library is required in WASM.
export function objectTypes(sourceFiles, origins = new WeakMap()) {
  const normalize = name => name.replaceAll("\\", "/");
  const files = new Map(sourceFiles.map(file => [normalize(file.fileName), file]));
  const lib = "/__nekoc_object_types.d.ts";
  files.set(lib, ts.createSourceFile(lib,
    "interface Array<T> { [n: number]: T; length: number; } interface ReadonlyArray<T> { [n: number]: T; readonly length: number; }",
    ts.ScriptTarget.Latest, true));
  const host = {
    getSourceFile: name => files.get(normalize(name)),
    readFile: name => files.get(normalize(name))?.text,
    fileExists: name => files.has(normalize(name)),
    getDefaultLibFileName: () => lib, writeFile() {},
    getCurrentDirectory: () => "", getDirectories: () => [],
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNames: (names, containingFile) => names.map(name => {
      const base = normalize(containingFile).replace(/[^/]*$/, "") + name;
      const parts = [];
      for (const part of base.split("/")) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
      }
      const resolved = [parts.join("/"), `${parts.join("/")}.ts`, `${parts.join("/")}/index.ts`].find(candidate => files.has(candidate));
      return resolved ? { resolvedFileName: resolved, extension: ts.Extension.Ts } : undefined;
    }),
  };
  const checker = ts.createProgram([...files.keys()], { noLib: true }, host).getTypeChecker();
  // The compiler reuses source nodes in synthetic inline expressions. Snapshot
  // types while the source tree still has its original parents; querying the
  // checker after lowering can otherwise crash inside TypeScript.
  const originalTypes = new WeakMap();
  const snapshot = node => {
    if (ts.isExpression(node)) originalTypes.set(node, checker.getTypeAtLocation(node));
    ts.forEachChild(node, snapshot);
  };
  for (const file of sourceFiles) snapshot(file);
  const type = node => node ? originalTypes.get(origins.get(node) ?? node) ?? null : null;
  const array = node => {
    const t = type(node);
    return !!t && (checker.isArrayType(t) || checker.isTupleType(t));
  };
  const objectType = t => !!t && (t.isUnion() ? t.types.some(objectType)
    : !(t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
      && !!(t.flags & ts.TypeFlags.Object) && !checker.isArrayType(t) && !checker.isTupleType(t) && !t.getCallSignatures().length);
  const object = node => objectType(type(node));
  const key = node => {
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    const t = type(node);
    return t && (t.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) ? String(t.value) : null;
  };
  const string = node => !!(type(node)?.flags & ts.TypeFlags.StringLike);
  return { array, object, objectType, key, string, type, checker };
}

export function validateObjectOperations(file, types, reject) {
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name && ts.isComputedPropertyName(p.name))) {
      reject(node, "Computed object literal keys are not supported; use literal property names");
    }
    const erased = t => !!(t?.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
    if (ts.isExpression(node) && node.parent && (ts.isPropertyAssignment(node.parent) || ts.isArrayLiteralExpression(node.parent))
      && types.object(node) && erased(types.checker.getContextualType(node))) {
      reject(node, "Object container values must preserve their static shape; replace any/unknown properties or elements with explicit object types");
    }
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && node.type && types.object(node.body)
      && erased(types.checker.getTypeFromTypeNode(node.type))) {
      reject(node, "Object return types must preserve their static shape; replace any/unknown with an explicit object type");
    }
    if (ts.isVariableDeclaration(node) && node.initializer && types.object(node.initializer) && erased(types.type(node.name))
      || ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && types.object(node.right) && erased(types.type(node.left))) {
      reject(node, "Object aliases must preserve their static shape; replace any/unknown with an explicit object type");
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && types.object(node.expression)) {
      const target = types.type(node.expression);
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : types.key(node.argumentExpression);
      if (target.isUnion()) reject(node, "Object union property access is not supported; use a single initialized object shape instead");
      if (key !== null) {
        const property = types.checker.getPropertyOfType(target, key);
        if (!property || property.flags & ts.SymbolFlags.Optional) {
          reject(node, `Object property ${JSON.stringify(key)} must be present and initialized; add it to the object literal (missing/optional properties are not supported)`);
        }
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && !(ts.isIdentifier(node.expression) && ["self", "this"].includes(node.expression.text))
      && types.type(node.expression)?.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Union)) {
      const symbol = ts.isIdentifier(node.expression) ? types.checker.getSymbolAtLocation(node.expression) : null;
      if (symbol?.declarations?.some(ts.isParameter) && !file.fileName.startsWith("__nekoc_helpers")) {
        reject(node, "Object parameter access needs a statically known shape; annotate it, for example obj: { x: number }, instead of any/unknown/union");
      }
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && erased(types.type(node)) && types.object(node.expression)) {
      reject(node, "Casting a data object to any/unknown is not supported; preserve its static shape for share-player property checks");
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && types.object(node.expression)) {
      const source = types.type(node.expression);
      const target = types.type(node);
      if (!types.object(node) || types.checker.getPropertiesOfType(target).some(property => {
        const original = types.checker.getPropertyOfType(source, property.name);
        return !original || !!(original.flags & ts.SymbolFlags.Optional) && !(property.flags & ts.SymbolFlags.Optional);
      })) {
        reject(node, "Object assertions cannot invent initialized properties or scalar values; initialize the full shape in an object literal instead");
      }
    }
    if (ts.isReturnStatement(node) && node.expression && types.object(node.expression)) {
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      if (owner?.type && erased(types.checker.getTypeFromTypeNode(owner.type))) {
        reject(node, "Object return types must preserve their static shape; replace any/unknown with an explicit object type");
      }
    }
    if (ts.isConditionalExpression(node) && (types.object(node.whenTrue) || types.object(node.whenFalse))) {
      reject(node, "Object-valued conditional expressions are not supported; use if/else with explicit assignments instead");
    }
    if (ts.isDeleteExpression(node)) reject(node, "delete is not supported; assign an explicit property value instead");
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        ? `${node.expression.expression.text}.${node.expression.name.text}`
        : ts.isIdentifier(node.expression) ? node.expression.text : "";
      if (["JSON.parse", "JSON.stringify", "Object.keys", "Object.values", "Object.entries", "Object.assign"].includes(name)) {
        reject(node, `${name} is not supported for share-player objects; read or write properties explicitly instead of JSON serialization/reflection`);
      }
      if (["console.log", "consoleLog", "String", "Number", "parseInt", "parseFloat", "say", "think", "sayFor", "thinkFor", "join", "length", "ask", "textJoin"].includes(name) && node.arguments.some(types.object)) {
        reject(node, "Object coercion/logging is not supported; pass a scalar property (obj.x) instead");
      }
      if (ts.isPropertyAccessExpression(node.expression)
        && ["say", "think", "sayFor", "thinkFor"].includes(node.expression.name.text) && node.arguments.some(types.object)) {
        reject(node, "Object text coercion is not supported; pass a scalar property (obj.x) instead");
      }
      // A user function may otherwise erase an object argument before its body
      // reaches logging/coercion checks. Generated adapters have untyped scalar
      // and handle parameters by design; validate their original user AST instead.
      const signature = types.checker.getResolvedSignature(node);
      if (signature?.declaration && !signature.declaration.getSourceFile().fileName.startsWith("__nekoc_")) {
        node.arguments.forEach((arg, i) => {
          const parameter = signature.parameters[i];
          if (types.object(arg) && parameter && erased(types.checker.getTypeOfSymbolAtLocation(parameter, node))) {
            reject(arg, "Object function arguments need a statically known shape; annotate the parameter instead of any/unknown");
          }
        });
      }
      if (ts.isPropertyAccessExpression(node.expression) && types.array(node.expression.expression)
        && ["join", "sort"].includes(node.expression.name.text)) {
        const element = types.checker.getIndexTypeOfType(types.type(node.expression.expression), ts.IndexKind.Number);
        if (types.objectType(element) && (!node.arguments.length || node.expression.name.text === "join")) {
          reject(node, "Object array coercion is not supported; map scalar properties before join/sort, or supply a scalar-property comparator");
        }
      }
    }
    if (ts.isTemplateExpression(node) && node.templateSpans.some(span => types.object(span.expression))) {
      reject(node, "Object template coercion is not supported; interpolate a scalar property instead");
    }
    if (ts.isBinaryExpression(node) && (types.object(node.left) || types.object(node.right))) {
      const allowed = [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
         ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken];
      if (!allowed.includes(node.operatorToken.kind)) reject(node, "Object numeric/string coercion is not supported; use a scalar property instead");
      if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)
        && !(types.object(node.left) && types.object(node.right))) {
        reject(node, "Comparing an object with a scalar is not supported; compare two object references or scalar properties instead");
      }
    }
    if (ts.isPrefixUnaryExpression(node) && types.object(node.operand) && node.operator !== ts.SyntaxKind.ExclamationToken) {
      reject(node, "Object numeric coercion is not supported; use a scalar property instead");
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      && (ts.isPropertyAccessExpression(node.operand) || ts.isElementAccessExpression(node.operand))
      && !ts.isExpressionStatement(node.parent) && !ts.isForStatement(node.parent)) {
      reject(node, "Object/element ++/-- update values are not supported; use a separate update statement, then read the property");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
