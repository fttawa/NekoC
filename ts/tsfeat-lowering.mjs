import ts from "typescript";

/**
 * Lower statically bound TS functions to the frontend's top-level function subset.
 * No runtime library, filesystem, or changes to array methods/types/control flow.
 * Errors deliberately have the same shape as CompileError (without importing the
 * compiler, which would introduce a cycle). Run after expression/value lowering.
 */
export function lowerTsFeatures(sourceFile) {
  const f = ts.factory;
  const printer = ts.createPrinter();
  const fileName = sourceFile.fileName;
  // A single-file checker is used only for lexical binding, not type checking.
  // In particular, unresolved NekoC APIs and imports do not need declarations.
  ts.setParentRecursive(sourceFile, true);
  // Earlier passes may have bound the original tree and then replaced some
  // declarations. The binder otherwise reuses stale .locals/.symbol tables.
  const clearBindings = node => {
    node.locals = undefined;
    node.symbol = undefined;
    node.localSymbol = undefined;
    node.nextContainer = undefined;
    node.flowNode = undefined;
    node.endFlowNode = undefined;
    node.returnFlowNode = undefined;
    ts.forEachChild(node, clearBindings);
  };
  clearBindings(sourceFile);
  const host = {
    getSourceFile: name => name === fileName ? sourceFile : undefined,
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile() {}, getCurrentDirectory: () => "", getDirectories: () => [],
    fileExists: name => name === fileName, readFile: () => undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true }, host);
  const checker = program.getTypeChecker();
  const symbol = node => node && ts.isIdentifier(node) && node.parent && ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : node ? checker.getSymbolAtLocation(node) : undefined;
  const fail = (node, message) => {
    const start = node.pos >= 0 ? node.getStart(sourceFile) : 0;
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    const error = new Error(message);
    error.name = "CompileError";
    error.code = "NEKOC_TSFEAT";
    error.location = { file: fileName, line: position.line + 1, column: position.character + 1 };
    throw error;
  };
  const walk = (node, visit) => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    visit(node);
    ts.forEachChild(node, child => walk(child, visit));
  };
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  };
  const nearestFunction = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return parent;
    }
    return null;
  };
  const topVariable = node => ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
    && ts.isSourceFile(node.parent.parent.parent);
  const isWrite = node => {
    let target = node;
    while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
    const parent = target.parent;
    return (ts.isBinaryExpression(parent) && parent.left === target
      && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
      || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
        && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken))
      || ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === target);
  };
  const isReference = node => {
    const parent = node.parent;
    if (!parent) return false;
    if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
      || (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isComputedPropertyName(parent.name))
      || (ts.isBindingElement(parent) && parent.propertyName === node)
      || (ts.isLabeledStatement(parent) && parent.label === node)
      || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
    if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
    return true;
  };

  const usedNames = new Set();
  walk(sourceFile, node => { if (ts.isIdentifier(node)) usedNames.add(node.text); });
  // Imported files share the compiler's variable/function namespace. Include a
  // deterministic file salt so independently lowered modules do not reuse IDs.
  let fileHash = 2166136261;
  for (const character of fileName.replaceAll("\\", "/")) {
    fileHash = Math.imul(fileHash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  let serial = 0;
  const fresh = hint => {
    let name;
    do { name = `__nekoc_ts_${fileHash}${String(++serial).padStart(6, "0")}_${hint.replace(/[^\w$]/g, "_")}`; } while (usedNames.has(name));
    usedNames.add(name);
    return name;
  };
  const names = new Map();
  const declarationSymbols = new Map();
  const bindName = (name, owner, keep) => {
    if (ts.isIdentifier(name)) {
      const key = symbol(name);
      if (!key) return;
      declarationSymbols.set(key, owner);
      if (!names.has(key)) names.set(key, keep ? name.text : fresh(name.text));
    } else if (ts.isArrayBindingPattern(name) || ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) bindName(element.name, owner, keep);
      }
    }
  };
  walk(sourceFile, node => {
    if (ts.isVariableDeclaration(node)) bindName(node.name, node, topVariable(node));
    if (ts.isParameter(node) && ts.isFunctionLike(node.parent) && node.parent.body) {
      // Sprite API receivers are recognized literally by the backend.
      bindName(node.name, node, ts.isIdentifier(node.name) && node.name.text === "self");
    }
  });

  const records = [];
  const functions = new Map();
  const byNode = new Map();
  const isExported = record => record.node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    || record.declaration?.parent?.parent?.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const register = (node, declaration = null) => {
    if (byNode.has(node)) return byNode.get(node);
    const nameNode = declaration?.name ?? node.name;
    const top = declaration ? topVariable(declaration) : ts.isSourceFile(node.parent);
    const name = top && nameNode && ts.isIdentifier(nameNode) ? nameNode.text : fresh(nameNode?.text ?? "fn");
    const record = { node, declaration, name, captures: new Map(), slots: new Set(), calls: new Set(), emitted: new Map() };
    records.push(record);
    byNode.set(node, record);
    if (nameNode && ts.isIdentifier(nameNode)) {
      const key = symbol(nameNode);
      if (key) functions.set(key, record);
    }
    if (ts.isFunctionExpression(node) && node.name) {
      const key = symbol(node.name);
      if (key) functions.set(key, record);
    }
    return record;
  };
  walk(sourceFile, node => {
    if (ts.isFunctionDeclaration(node) && node.body) register(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (!ts.isVariableDeclarationList(node.parent) || !ts.isVariableStatement(node.parent.parent)) {
          fail(node, "Function-valued loop bindings are not supported; declare the function before the loop instead");
        }
        register(init, node);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) register(callee);
    }
  });
  const resolve = (node, env = new Map()) => {
    node = unwrap(node);
    if (!node) return null;
    if (byNode.has(node)) return byNode.get(node);
    if (!ts.isIdentifier(node)) return null;
    const key = symbol(node);
    return env.get(key) ?? functions.get(key) ?? null;
  };
  // Literal callbacks passed to user functions become ordinary static functions;
  // callbacks to APIs/array methods stay inline and are not otherwise rewritten.
  walk(sourceFile, node => {
    if (!ts.isCallExpression(node) || !resolve(node.expression)) return;
    for (const argument of node.arguments) {
      const value = unwrap(argument);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) register(value);
    }
  });
  // Immutable aliases are compile-time bindings, never runtime function values.
  const aliases = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, node => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
      const key = symbol(node.name);
      if (!key || functions.has(key)) return;
      const target = resolve(node.initializer);
      if (target) {
        if (!(node.parent.flags & ts.NodeFlags.Const)) fail(node, "Function aliases must be const; use a const alias or call the function directly instead");
        functions.set(key, target);
        aliases.add(node);
        changed = true;
      }
    });
  }

  walk(sourceFile, node => {
    if (!ts.isIdentifier(node) || !isReference(node)) return;
    const target = resolve(node);
    const declaration = target?.declaration;
    if (declaration && node.pos >= 0 && declaration.pos >= 0 && node.pos < declaration.pos
      && nearestFunction(node) === nearestFunction(declaration)) {
      fail(node, "A function expression or arrow cannot be used before its initializer; move its declaration before the call or use a hoisted function declaration instead");
    }
  });

  const writes = new Set();
  walk(sourceFile, node => {
    if (ts.isIdentifier(node) && isReference(node) && isWrite(node)) {
      const key = symbol(node);
      if (functions.has(key)) fail(node, "Reassigning a function binding is not supported; use separate named functions and an if statement instead");
      writes.add(key);
    }
    if (ts.isFunctionLike(node) && node.body) {
      for (const param of node.parameters) {
        if (param.dotDotDotToken) fail(param, "Rest parameters (...args) are not supported; pass an array instead");
      }
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !byNode.has(node)) {
      let parent = node.parent;
      while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))) parent = parent.parent;
      if (!ts.isCallExpression(parent) || !parent.arguments.some(arg => unwrap(arg) === node)) {
        fail(node, "Functions cannot be stored or returned as runtime values; declare a named function or const arrow and call it directly instead");
      }
    }
  });
  for (const record of records) {
    for (const param of record.node.parameters) {
      if (param.dotDotDotToken) fail(param, "Rest parameters (...args) are not supported; pass an array instead");
      if (!ts.isIdentifier(param.name)) fail(param, "Only identifier function parameters are supported; pass a named value and destructure it inside the function instead");
      const key = symbol(param.name);
      walk(record.node.body, node => {
        if (ts.isIdentifier(node) && symbol(node) === key && isReference(node)) {
          let parent = node.parent;
          while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))) parent = parent.parent;
          if (ts.isCallExpression(parent) && unwrap(parent.expression) === node) record.slots.add(key);
        }
      });
    }
  }
  // A known function argument also discovers forwarded function parameters.
  changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, node => {
      if (!ts.isCallExpression(node)) return;
      const target = resolve(node.expression);
      if (!target) return;
      target.node.parameters.forEach((param, index) => {
        const key = symbol(param.name);
        const arg = node.arguments[index];
        const argKey = arg && ts.isIdentifier(unwrap(arg)) ? symbol(unwrap(arg)) : null;
        const owner = declarationSymbols.get(argKey)?.parent;
        if (resolve(arg) && !target.slots.has(key)) { target.slots.add(key); changed = true; }
        if (target.slots.has(key) && byNode.has(owner) && !byNode.get(owner).slots.has(argKey)) {
          byNode.get(owner).slots.add(argKey);
          changed = true;
        }
      });
    });
  }

  const addCapture = (record, key, at) => {
    const declaration = declarationSymbols.get(key);
    if (!declaration || topVariable(declaration) || nearestFunction(declaration) === record.node || functions.has(key)) return false;
    for (let owner = declaration.parent; owner; owner = owner.parent) {
      if (owner === record.node) return false;
    }
    if (byNode.get(declaration.parent)?.slots.has(key)) {
      fail(at, "A lifted nested function cannot capture a function-valued parameter; pass it directly to a statically named helper or replace the closure with explicit scalar parameters instead");
    }
    const value = unwrap(declaration.initializer);
    if ((declaration.type && (ts.isArrayTypeNode(declaration.type) || ts.isTupleTypeNode(declaration.type)
      || (ts.isTypeReferenceNode(declaration.type) && ts.isIdentifier(declaration.type.typeName)
        && ["Array", "ReadonlyArray"].includes(declaration.type.typeName.text))))
      || (value && (ts.isArrayLiteralExpression(value)
        || ((ts.isCallExpression(value) || ts.isNewExpression(value)) && ts.isIdentifier(value.expression)
          && value.expression.text === "Array")))) {
      fail(at, "Captured arrays cannot be passed through generated procedure parameters in the official editor; pass an explicit array to a simple inline function, or use a top-level list instead");
    }
    if (record.captures.has(key)) return false;
    if (writes.has(key)) {
      fail(at, "A lifted function cannot capture a reassigned outer local or parameter; move the assignment into a separate statement before the call, or pass the value explicitly instead");
    }
    if (key.name === "self") fail(at, "Capturing a sprite receiver in a lifted function is not supported; keep the self API call inline in the sprite callback instead");
    record.captures.set(key, fresh(`capture_${key.name}`));
    return true;
  };
  for (const record of records) {
    for (const parameter of record.node.parameters) {
      if (!parameter.initializer) continue;
      walk(parameter.initializer, node => {
        if (!ts.isIdentifier(node) || !isReference(node)) return;
        const key = symbol(node);
        const declaration = declarationSymbols.get(key);
        if (declaration && !topVariable(declaration) && nearestFunction(declaration) !== record.node && !functions.has(key)) {
          fail(node, "Default parameter values cannot capture outer locals in lifted functions; pass that value explicitly at the call instead");
        }
      });
    }
    walk(record.node.body, node => {
      // Captures inside another lifted function are propagated via its call.
      if (ts.isIdentifier(node) && isReference(node)) {
        let owner = nearestFunction(node);
        while (owner && !byNode.has(owner)) owner = nearestFunction(owner);
        if (owner === record.node) addCapture(record, symbol(node), node);
      }
      if (ts.isCallExpression(node)) {
        const target = resolve(node.expression);
        if (target) record.calls.add(target);
      }
      if ((node.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(node) && node.text === "arguments" && !symbol(node)))
        && nearestFunction(node) === record.node) {
        fail(node, "this/arguments in lifted functions are not supported; pass explicit named parameters instead");
      }
    });
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const record of records) for (const target of record.calls) {
      for (const key of target.captures.keys()) changed = addCapture(record, key, record.node) || changed;
    }
  }
  // The backend has call-local procedure parameters, but NOT call-local mutable
  // variables. Reject recursive frames that would overwrite one another.
  const reaches = (from, target, seen = new Set()) => {
    if (seen.has(from)) return false;
    seen.add(from);
    return [...from.calls].some(next => next === target || reaches(next, target, seen));
  };
  for (const record of records) {
    if (isExported(record) && record.slots.size) {
      fail(record.node, "Exported higher-order functions cannot be specialized across modules; move the call into the same module or export a wrapper with explicit scalar parameters instead");
    }
    if (!reaches(record, record)) continue;
    let locals = record.node.parameters.some(param => writes.has(symbol(param.name)));
    walk(record.node.body, node => { if (ts.isVariableDeclaration(node) && !aliases.has(node) && !resolve(node.initializer)) locals = true; });
    if (locals || record.captures.size || record.slots.size) {
      fail(record.node, "Recursive functions with local variables, captures, or function parameters cannot be lowered safely; use scalar parameters without reassignment, or an iterative loop instead");
    }
  }
  // Statement-only functions are inlined by the existing compiler. Each call
  // needs distinct local names, including callers that inline such a callee.
  // Clone those functions per static call instead of changing them to custom
  // blocks (which would change return/list/string compatibility).
  for (const record of records) {
    let hasReturn = false;
    let hasLocal = record.node.parameters.some(param => writes.has(symbol(param.name)));
    walk(record.node.body, node => {
      if (ts.isReturnStatement(node) && nearestFunction(node) === record.node) hasReturn = true;
      if (ts.isVariableDeclaration(node) && nearestFunction(node) === record.node && !aliases.has(node) && !resolve(node.initializer)) hasLocal = true;
    });
    record.cloneCalls = ts.isBlock(record.node.body) && !hasReturn && hasLocal;
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (!record.cloneCalls && [...record.calls].some(target => target.cloneCalls)) {
        record.cloneCalls = true;
        changed = true;
      }
    }
  }
  for (const record of records) if (isExported(record)) record.cloneCalls = false;

  const emitted = [];
  let context;
  let specializations = 0;
  const localIdentifier = (key, env, overrides, captures) => {
    const target = env.get(key) ?? functions.get(key);
    if (target) return f.createIdentifier(target.name);
    return f.createIdentifier(captures.get(key) ?? overrides.get(key) ?? names.get(key) ?? key.name);
  };
  const emit = (record, supplied = new Map()) => {
    const key = record.cloneCalls ? fresh("call") : [...record.slots].map(slot => supplied.get(slot)?.name ?? "?").join("|");
    if (record.emitted.has(key)) return record.emitted.get(key);
    for (const slot of record.slots) {
      if (!supplied.has(slot)) fail(record.node, "A function argument must be statically known at every call; pass a named function or const arrow instead of a dynamic value");
      if (writes.has(slot)) fail(record.node, "Reassigning a function parameter is not supported; call separate named functions in an if statement instead");
    }
    if (++specializations > 256) fail(record.node, "Too many static function specializations; replace higher-order recursion with direct named calls instead");
    const outputName = record.slots.size || record.cloneCalls ? fresh(`${record.name}_specialized`) : record.name;
    record.emitted.set(key, outputName);
    const env = new Map(supplied);
    const overrides = new Map();
    if (record.slots.size || record.cloneCalls) {
      walk(record.node, node => {
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
          const local = symbol(node.name);
          if (local) overrides.set(local, fresh(node.name.text));
        }
      });
    }
    const visit = makeVisitor(env, overrides, record.captures);
    const params = record.node.parameters.filter(param => !record.slots.has(symbol(param.name)))
      .map(param => ts.visitNode(param, visit));
    for (const capture of record.captures.values()) params.push(f.createParameterDeclaration(undefined, undefined, capture));
    let body = ts.visitNode(record.node.body, visit);
    if (!ts.isBlock(body)) body = f.createBlock([f.createReturnStatement(body)], true);
    body = parameterCopies(record.node, body, env, overrides, record.captures);
    const modifiers = ts.isFunctionDeclaration(record.node) && ts.isSourceFile(record.node.parent)
      ? record.node.modifiers : record.declaration && topVariable(record.declaration)
        ? record.declaration.parent.parent.modifiers : undefined;
    const declaration = f.createFunctionDeclaration(modifiers, record.node.asteriskToken, outputName,
      record.node.typeParameters, params, record.node.type, body);
    ts.setTextRange(declaration, record.node);
    emitted.push(declaration);
    return outputName;
  };
  const parameterCopies = (node, body, env, overrides, captures) => {
    const copies = [];
    const replacements = new Map();
    for (const param of node.parameters) {
      if (!ts.isIdentifier(param.name)) continue;
      const key = symbol(param.name);
      if (!writes.has(key) || env.has(key)) continue;
      const name = fresh(`mutable_${param.name.text}`);
      const original = localIdentifier(key, new Map(), overrides, captures);
      replacements.set(original.text, name);
      copies.push(f.createVariableStatement(undefined, f.createVariableDeclarationList([
        f.createVariableDeclaration(name, undefined, param.type, original),
      ], ts.NodeFlags.Let)));
    }
    if (!copies.length) return body;
    const replace = child => {
      if (ts.isTypeNode(child)) return child;
      if (ts.isIdentifier(child) && replacements.has(child.text)
        && !(child.parent && ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)
        && !(child.parent && ts.isPropertyAssignment(child.parent) && child.parent.name === child)) {
        return ts.setOriginalNode(ts.setTextRange(f.createIdentifier(replacements.get(child.text)), child), child);
      }
      return ts.visitEachChild(child, replace, context);
    };
    const updated = ts.visitNode(body, replace);
    return f.updateBlock(updated, [...copies, ...updated.statements]);
  };
  const makeVisitor = (env = new Map(), overrides = new Map(), captures = new Map()) => {
    const visit = node => {
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        || ts.isImportDeclaration(node) || ts.isEnumDeclaration(node)) return node;
      if (ts.isFunctionDeclaration(node) && byNode.has(node)) return undefined;
      if (ts.isVariableStatement(node)) {
        const declarations = [];
        for (const declaration of node.declarationList.declarations) {
          if (aliases.has(declaration) || (declaration.initializer && byNode.has(unwrap(declaration.initializer)))) continue;
          declarations.push(ts.visitNode(declaration, visit));
        }
        if (!declarations.length) return undefined;
        if (declarations.length === node.declarationList.declarations.length
          && declarations.every((declaration, index) => declaration === node.declarationList.declarations[index])) return node;
        return f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList, declarations));
      }
      if (ts.isCallExpression(node)) {
        const target = resolve(node.expression, env);
        if (target) {
          const supplied = new Map();
          const args = [];
          target.node.parameters.forEach((param, index) => {
            const slot = symbol(param.name);
            if (target.slots.has(slot)) {
              const value = resolve(node.arguments[index] ?? param.initializer, env);
              if (!value) fail(node.arguments[index] ?? node, "A function argument must be statically known; pass a named function or const arrow instead of a dynamic value");
              if (value.captures.size) fail(node.arguments[index] ?? node, "Function arguments that capture outer locals cannot be specialized safely; pass the captured values as explicit scalar arguments to a named function instead");
              supplied.set(slot, value);
            } else if (node.arguments[index]) args.push(ts.visitNode(node.arguments[index], visit));
          });
          if (node.arguments.length > target.node.parameters.length) {
            fail(node, "Extra function arguments cannot be lowered safely; remove them or pass an explicit array instead");
          }
          // Defaults before hidden captures must occupy their original positions.
          for (const capture of target.captures.keys()) {
            const scalarCount = target.node.parameters.length - target.slots.size;
            while (args.length < scalarCount) {
              const scalarParams = target.node.parameters.filter(param => !target.slots.has(symbol(param.name)));
              const missing = scalarParams[args.length];
              if (!missing.initializer) fail(node, "Captured functions need explicit scalar arguments; supply the missing argument at the call instead");
              args.push(ts.visitNode(missing.initializer, visit));
            }
            args.push(localIdentifier(capture, env, overrides, captures));
          }
          return f.updateCallExpression(node, f.createIdentifier(emit(target, supplied)), node.typeArguments, args);
        }
      }
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && byNode.has(node)) {
        fail(node, "Functions cannot escape as runtime values; call the function directly or pass it to a statically named function instead");
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (ts.isFunctionExpression(node)) {
          walk(node.body, child => {
            if (child.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(child) && child.text === "arguments")) {
              fail(child, "this/arguments in function-expression callbacks are not supported; pass explicit parameters and use an inline arrow callback instead");
            }
            if (node.name && ts.isIdentifier(child) && symbol(child) === symbol(node.name)) {
              fail(child, "Recursive function-expression API callbacks are not supported; use a separate named function and an inline arrow callback instead");
            }
          });
        }
        const updated = ts.visitEachChild(node, visit, context);
        const body = ts.isBlock(updated.body) ? updated.body : f.createBlock([f.createReturnStatement(updated.body)], true);
        const copied = parameterCopies(node, body, env, overrides, captures);
        if (ts.isFunctionExpression(updated)) return ts.setTextRange(f.createArrowFunction(updated.modifiers,
          updated.typeParameters, updated.parameters, updated.type, undefined, copied), node);
        if (copied === body) return updated;
        return ts.isArrowFunction(updated)
          ? f.updateArrowFunction(updated, updated.modifiers, updated.typeParameters, updated.parameters, updated.type, updated.equalsGreaterThanToken, copied)
          : f.updateFunctionExpression(updated, updated.modifiers, updated.asteriskToken, updated.name, updated.typeParameters, updated.parameters, updated.type, copied);
      }
      if (ts.isShorthandPropertyAssignment(node)) {
        const key = checker.getShorthandAssignmentValueSymbol(node);
        if (key && names.has(key)) return f.createPropertyAssignment(node.name, localIdentifier(key, env, overrides, captures));
      }
      if (ts.isBindingElement(node) && !node.propertyName && ts.isIdentifier(node.name)
        && ts.isObjectBindingPattern(node.parent)) {
        const key = symbol(node.name);
        if (key && names.has(key)) return f.updateBindingElement(node, node.dotDotDotToken, node.name,
          localIdentifier(key, env, overrides, captures), node.initializer && ts.visitNode(node.initializer, visit));
      }
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isBindingElement(parent) && parent.propertyName === node)
          || (ts.isLabeledStatement(parent) && parent.label === node)
          || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return node;
        const key = symbol(node);
        if (!key) return node;
        if (functions.has(key) || env.has(key)) {
          fail(node, "A function cannot be used as a runtime value or API callback; call it directly, pass it to a statically named function, or write an inline arrow callback instead");
        }
        if (names.has(key) || overrides.has(key) || captures.has(key)) {
          const renamed = localIdentifier(key, env, overrides, captures);
          return renamed.text === node.text ? node : ts.setOriginalNode(ts.setTextRange(renamed, node), node);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return visit;
  };
  const result = ts.transform(sourceFile, [transformationContext => {
    context = transformationContext;
    return input => {
      const updated = ts.visitEachChild(input, makeVisitor(), context);
      for (const record of records) {
        if (!record.slots.size && !record.cloneCalls && !record.emitted.size) emit(record);
      }
      return emitted.length ? f.updateSourceFile(updated, [...updated.statements, ...emitted]) : updated;
    };
  }]);
  const output = result.transformed[0];
  result.dispose();
  // Existing helper synthesis reads callback bodies with getText(). Updated AST
  // nodes still carry original ranges for source maps, so give changed nodes a
  // printer-backed getText rather than stale source slices. Unchanged nodes keep
  // their native methods and source positions.
  const fixText = node => {
    if (node.pos < 0 || ts.getOriginalNode(node) !== node) {
      node.getText = () => printer.printNode(ts.EmitHint.Unspecified, node, output);
    }
    ts.forEachChild(node, fixText);
  };
  fixText(output);
  ts.setParentRecursive(output, true);
  return output;
}
