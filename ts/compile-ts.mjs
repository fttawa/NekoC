import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { keyboardCode, effectCode, mathFunctionCode } from "./kitten-n.mjs";

/** A compile error. `location` is { file, line, column } (1-based) when known. */
export class CompileError extends Error {
  constructor(message, location = null, code = "NEKOC") {
    super(message);
    this.name = "CompileError";
    this.location = location;
    this.code = code;
  }
}

function fail(message, location = null, code = "NEKOC") {
  throw new CompileError(message, location, code);
}

function nodeLocation(node) {
  const sourceFile = node?.getSourceFile?.();
  if (!sourceFile || typeof node.pos !== "number" || node.pos < 0) return null;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { file: sourceFile.fileName, line: line + 1, column: character + 1 };
}

function rejectParseDiagnostics(sourceFile) {
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (!diagnostics.length) return;
  const first = diagnostics[0];
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(first.start ?? 0);
  fail(diagnostics.map((diagnostic) => {
    const start = diagnostic.start ?? 0;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return `${sourceFile.fileName}:${line + 1}:${character + 1}: TS${diagnostic.code}: ${message}`;
  }).join("\n"), { file: sourceFile.fileName, line: line + 1, column: character + 1 }, `TS${first.code}`);
}

// Global flag the implicit start script sets once top-level initialization ran.
const STARTUP_READY = "__nekoc_ready";

class WorkspaceCompiler {
  constructor(source, sourceFile) {
    this.source = source;
    this.sourceFile = sourceFile;
    this.entryPath = path.resolve(source);
    this.nextId = 1;
    this.blocks = {};
    this.connections = {};
    this.sourceMap = {};
    this.currentStatementNode = null;
    this.scriptCount = 0;
    this.procedureSpecs = new Map();
    this.procedures = [];
    this.inlineFunctions = new Map();
    // Functions that cannot be inlined (recursive, or with early/multiple
    // returns) compile to custom blocks: name -> { fn, spec, returnsValue }.
    this.functionProcedures = new Map();
    this.functionParams = null;
    this.expressionBindings = [];
    this.inlineCallStack = [];
    this.loadedModules = new Set();
    this.moduleExports = new Map();
    this.registeredImports = new Set();
    this.globalVariables = new Set();
    // Constant initial values of top-level let/const, written into the
    // project's variable table (they hold before any script runs).
    this.initialValues = {};
    this.constStringLiterals = new Map();
    this.keyButtons = [];
    this.enumValues = new Map();
    // Variables initialised with an array (a list value held in a variable).
    this.arrayVariables = new Set();
    // Call nodes of callback methods (a.map(x => ...)) -> helper function name.
    this.helperCalls = new Map();
    this.helperCount = 0;
    // Variables initialised with a string; `+` on them joins text.
    this.stringVariables = new Set();
    STRING_VARIABLES = this.stringVariables;
    this.loopDepth = 0;
    this.loopBodyNext = false;
    this.tryStack = [];
    this.rangeBindings = [];
    this.resources = {
      stage: null,
      sprites: [],
      screens: [],
    };
    this.currentScreen = null;
    this.runtimeInitializers = new Set();
    this.generatedEvents = [];
  }

  compile(sourceFile) {
    this.loadImports(sourceFile, this.entryPath);
    this.synthesizeHelpers(sourceFile);

    const startup = [];
    const explicitStarts = [];
    sourceFile.statements.forEach((statement) => {
      if (ts.isImportDeclaration(statement)) {
        return;
      }
      if (this.isInlineFunctionDefinition(statement)) {
        this.registerInlineFunction(statement);
        return;
      }
      if (this.isGlobalVariableDeclaration(statement)) {
        this.registerGlobalVariableDeclaration(statement);
        return;
      }
      if (ts.isEnumDeclaration(statement)) {
        this.compileEnumDeclaration(statement);
        return;
      }
      if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        this.registerProcedureSpec(statement.expression);
      }
    });
    this.planFunctionProcedures();
    for (const entry of this.functionProcedures.values()) {
      this.compileFunctionProcedure(entry);
    }

    sourceFile.statements.forEach((statement) => {
      if (ts.isImportDeclaration(statement)) {
        return;
      }
      if (this.isInlineFunctionDefinition(statement)) {
        return;
      }
      if (this.isGlobalVariableDeclaration(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (this.runtimeInitializers.has(declaration)) {
            startup.push(ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
              declaration.name, ts.SyntaxKind.EqualsToken, declaration.initializer)));
          }
        }
        return;
      }
      if (ts.isEnumDeclaration(statement)) {
        return;
      }
      if (ts.isClassDeclaration(statement)) {
        this.compileClassDeclaration(statement);
        return;
      }
      if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        if (calleeName(statement.expression.expression) === "test") {
          return;
        }
        const name = calleeName(statement.expression.expression);
        if (name === "onStart" || isMemberCallName(name, "onStart")) {
          explicitStarts.push(statement.expression);
        } else if (["defineProc", "defineReporter", "keyButton", "stage", "screen", "sprite", "onClick", "onKey", "onMessage", "when", "onBumpActor"].includes(name)) {
          this.compileTopLevelCall(statement.expression);
        } else {
          startup.push(statement);
        }
        return;
      }
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) return;
      startup.push(statement);
    });
    for (const call of this.generatedEvents) this.compileTopLevelCall(call);
    if (startup.length) {
      // Top-level statements form their own start script. Explicit onStart
      // handlers stay separate scripts so they still run concurrently (one
      // may loop forever), but each first waits for initialization to finish.
      const ready = ts.factory.createIdentifier(STARTUP_READY);
      const setReady = value => ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
        ready, ts.SyntaxKind.EqualsToken, ts.factory.createNumericLiteral(value)));
      const compileStart = statements => {
        const entry = this.addBlock({ type: "on_running_group_activated", parent_id: null });
        this.scriptCount++;
        const first = this.compileStatementList(statements, entry);
        if (first) this.connectNext(entry, first);
      };
      if (explicitStarts.length) {
        this.globalVariables.add(STARTUP_READY);
        this.initialValues[STARTUP_READY] = 0;
        // Reset first in case the variable kept a value from an earlier run.
        startup.unshift(setReady(0));
        startup.push(setReady(1));
      }
      compileStart(startup);
      const waitReady = ts.factory.createExpressionStatement(ts.factory.createCallExpression(
        ts.factory.createIdentifier("waitUntil"), undefined,
        [ts.factory.createBinaryExpression(ready, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createNumericLiteral(1))]));
      for (const call of explicitStarts) compileStart([waitReady, ...callbackBody(call.arguments[0], this)]);
    } else {
      for (const call of explicitStarts) this.compileTopLevelCall(call);
    }

    return {
      source: this.source,
      summary: {
        scripts: this.scriptCount,
        procedures: this.procedures.length,
        blocks: Object.keys(this.blocks).length,
        connections: this.countConnections(),
      },
      workspaceData: {
        blocks: this.blocks,
        connections: this.connections,
        comments: {},
      },
      sourceMap: this.sourceMap,
      initialValues: this.initialValues,
      keyButtons: this.keyButtons,
      resources: this.resources,
      procedures: this.procedures,
    };
  }

  loadImports(sourceFile, fromPath) {
    sourceFile.statements.forEach((statement) => {
      if (!ts.isImportDeclaration(statement)) {
        return;
      }
      const modulePath = this.importModuleSpecifier(statement);
      if (!modulePath.startsWith(".")) {
        this.unsupported(statement, `Only relative imports are supported: ${modulePath}`);
      }
      const resolvedPath = this.resolveImportPath(fromPath, modulePath);
      this.loadModule(resolvedPath, statement);
    });
  }

  loadModule(modulePath, importNode) {
    const resolvedPath = path.resolve(modulePath);
    let exports = this.moduleExports.get(resolvedPath);
    if (!exports) {
      if (this.loadedModules.has(resolvedPath)) {
        this.unsupported(importNode, `Circular imports are not supported: ${resolvedPath}`);
      }
      this.loadedModules.add(resolvedPath);
      const sourceText = fs.readFileSync(resolvedPath, "utf8");
      const moduleSourceFile = ts.createSourceFile(
        resolvedPath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      rejectParseDiagnostics(moduleSourceFile);
      this.loadImports(moduleSourceFile, resolvedPath);
      exports = this.collectModuleExports(moduleSourceFile);
      this.moduleExports.set(resolvedPath, exports);
    }
    const requested = this.importedNames(importNode);
    requested.forEach((name) => {
      const statement = exports.get(name);
      if (!statement) {
        this.unsupported(importNode, `Module ${resolvedPath} does not export ${name}`);
      }
      const importKey = `${resolvedPath}:${name}`;
      if (!this.registeredImports.has(importKey)) {
        this.registerInlineFunction(statement);
        this.registeredImports.add(importKey);
      }
    });
  }

  collectModuleExports(sourceFile) {
    const exports = new Map();
    sourceFile.statements.forEach((statement) => {
      if (!hasExportModifier(statement)) {
        return;
      }
      const name = inlineFunctionName(statement);
      if (!name || !this.isInlineFunctionDefinition(statement)) {
        this.unsupported(statement, "Only exported functions are supported in imported modules");
      }
      exports.set(name, statement);
    });
    return exports;
  }

  importModuleSpecifier(statement) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      this.unsupported(statement, "Import module specifier must be a string literal");
    }
    return statement.moduleSpecifier.text;
  }

  importedNames(statement) {
    const clause = statement.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      this.unsupported(statement, "Only named imports are supported");
    }
    return clause.namedBindings.elements.map((element) => element.name.text);
  }

  resolveImportPath(fromPath, modulePath) {
    const basePath = path.resolve(path.dirname(fromPath), modulePath);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      path.join(basePath, "index.ts"),
    ];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) {
      fail(`Unable to resolve import ${modulePath} from ${fromPath}`);
    }
    return resolved;
  }

  isInlineFunctionDefinition(statement) {
    if (ts.isFunctionDeclaration(statement)) {
      return true;
    }
    return this.inlineArrowFunctionDeclaration(statement) !== null;
  }

  isGlobalVariableDeclaration(statement) {
    return ts.isVariableStatement(statement) && !this.isInlineFunctionDefinition(statement);
  }

  registerGlobalVariableDeclaration(statement) {
    statement.declarationList.declarations.forEach((declaration) => {
      if (!ts.isIdentifier(declaration.name)) {
        this.unsupported(declaration.name, "Only simple variable names are supported");
      }
      if (this.globalVariables.has(declaration.name.text)) {
        this.unsupported(declaration.name, `Duplicate variable declaration: ${declaration.name.text}`);
      }
      this.globalVariables.add(declaration.name.text);
      if (declaration.initializer) {
        // Non-constant initializers run at startup (see compile()).
        const value = constantInitialValue(declaration.initializer);
        if (value === null) this.runtimeInitializers.add(declaration);
        else this.initialValues[declaration.name.text] = value;
        if (this.isArrayExpression(declaration.initializer)) this.arrayVariables.add(declaration.name.text);
        // A top-level `const NAME = "..."` can also stand in for a literal where
        // one is required (resource URLs, sprite and message names).
        if ((statement.declarationList.flags & ts.NodeFlags.Const) && ts.isStringLiteral(declaration.initializer)) {
          this.constStringLiterals.set(declaration.name.text, declaration.initializer);
        }
        if (typeof value === "string") this.stringVariables.add(declaration.name.text);
      }
    });
  }

  // Enum members become constants: C.Green compiles to its value.
  compileEnumDeclaration(statement) {
    const enumName = statement.name.text;
    const members = new Map();
    let next = 0;
    for (const member of statement.members) {
      let value = next;
      if (member.initializer) {
        if (ts.isStringLiteral(member.initializer)) {
          value = member.initializer.text;
        } else {
          value = constantNumber(member.initializer);
          if (value === null) {
            this.unsupported(member.initializer, "Enum members need constant values");
          }
        }
      }
      members.set(member.name.text, value);
      next = typeof value === "number" ? value + 1 : next;
    }
    this.enumValues.set(enumName, members);
  }

  compileClassDeclaration(statement) {
    if (!statement.name) return;
    const className = statement.name.text;
    this.globalVariables.add(className);
    if (statement.members) {
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          this.globalVariables.add(`${className}_${methodName}`);
        }
      }
    }
  }

  registerInlineFunction(statement) {
    const arrowFunction = this.inlineArrowFunctionDeclaration(statement);
    const name = arrowFunction?.name ?? statement.name?.text;
    if (!name) {
      this.unsupported(statement, "Function declarations must have a name");
    }
    if (this.inlineFunctions.has(name) || this.procedureSpecs.has(name)) {
      this.unsupported(statement, `Duplicate function definition: ${name}`);
    }
    const params = arrowFunction?.params ?? statement.parameters;
    const body = arrowFunction?.body ?? statement.body;
    if (!body) {
      this.unsupported(statement, "Function declarations must have a body");
    }
    this.inlineFunctions.set(name, {
      name,
      params: params.map((param) => {
        if (!ts.isIdentifier(param.name)) {
          this.unsupported(param, "Only identifier function parameters are supported");
        }
        if (param.dotDotDotToken) {
          this.unsupported(param, "Rest parameters (...args) are not supported; pass an array instead");
        }
        return param.name.text;
      }),
      defaults: params.map((param) => param.initializer ?? null),
      body,
    });
  }

  // Decide which functions become custom blocks instead of being inlined:
  // recursive ones (directly or through other functions), and ones whose
  // body is not "local declarations, then one final return".
  planFunctionProcedures() {
    const calls = new Map();
    for (const [name, fn] of this.inlineFunctions) {
      const called = new Set();
      visitFunctionBody(fn.body, (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && this.inlineFunctions.has(node.expression.text)) {
          called.add(node.expression.text);
        }
      });
      calls.set(name, called);
    }
    const reaches = (from, target) => {
      const seen = new Set();
      const stack = [...calls.get(from)];
      while (stack.length) {
        const next = stack.pop();
        if (next === target) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(...calls.get(next));
      }
      return false;
    };
    for (const [name, fn] of this.inlineFunctions) {
      let returnsValue = false;
      let hasReturn = false;
      visitFunctionBody(fn.body, (node) => {
        if (ts.isReturnStatement(node)) {
          hasReturn = true;
          returnsValue ||= Boolean(node.expression);
        }
      });
      if (!ts.isBlock(fn.body)) returnsValue = true;
      const statements = ts.isBlock(fn.body) ? Array.from(fn.body.statements) : [];
      const simpleExpression = !ts.isBlock(fn.body) || (
        statements.length > 0
        && ts.isReturnStatement(statements.at(-1)) && statements.at(-1).expression
        && statements.slice(0, -1).every((statement) => ts.isVariableStatement(statement))
      );
      const simpleStatement = ts.isBlock(fn.body) && !hasReturn;
      if (!reaches(name, name) && (simpleExpression || simpleStatement)) {
        continue;
      }
      if (this.procedureSpecs.has(name)) {
        this.unsupported(fn.body, `Function ${name} clashes with a procedure of the same name`);
      }
      const part = sanitizeIdPart(name);
      const spec = {
        id: `kn-proc-fn-${part}`,
        name,
        type: returnsValue ? "ROUND" : "NORMAL",
        params: [
          { id: `kn-label-fn-${part}-0`, type: "Label", name },
          ...fn.params.map((param, index) => ({
            id: `kn-param-fn-${part}-${index + 1}-${sanitizeIdPart(param)}`,
            type: "String",
            name: param,
          })),
        ],
      };
      this.functionProcedures.set(name, { fn, spec, returnsValue });
    }
  }

  // Parameters are per call (procedure parameters); locals declared with
  // let/const are ordinary variables shared by every call.
  compileFunctionProcedure({ fn, spec, returnsValue }) {
    const saved = [this.blocks, this.connections, this.expressionBindings, this.inlineCallStack,
      this.rangeBindings, this.loopDepth, this.functionParams, this.tryStack, this.currentProcedureParams];
    this.tryStack = [];
    this.currentProcedureParams = procedureParamIds(spec);
    this.blocks = {};
    this.connections = {};
    this.expressionBindings = [];
    this.inlineCallStack = [];
    this.rangeBindings = [];
    this.loopDepth = 0;
    this.functionParams = new Set(fn.params);
    try {
      const defId = this.addBlockWithId(spec.id, {
        type: "procedures_2_defnoreturn",
        parent_id: null,
        fields: { NAME: spec.id },
        mutation: procedureMutation(spec.params),
        shadows: {
          PROCEDURES_2_DEFNORETURN_DEFINE: "",
          ...procedureDefinitionShadows(spec.params),
          STACK: "",
        },
        deletable: false,
        editable: false,
      });
      spec.params.forEach((param, index) => {
        if (param.type !== "String") return;
        const paramId = this.addBlockWithId(param.id, {
          type: "procedures_2_stable_parameter",
          parent_id: defId,
          fields: { param_name: param.name },
        });
        this.connectInput(defId, paramId, `PARAMS${index}`, "value");
      });
      let firstChild;
      if (ts.isBlock(fn.body)) {
        firstChild = this.compileStatementList(Array.from(fn.body.statements), defId);
      } else {
        firstChild = this.compileReturn(fn.body, defId);
      }
      if (firstChild) {
        this.connectInput(defId, firstChild, "STACK", "statement");
      }
      this.procedures.push({
        id: spec.id,
        name: spec.name,
        type: returnsValue ? "ROUND" : "NORMAL",
        params: spec.params,
        workspaceData: { blocks: this.blocks, connections: this.connections, comments: {} },
      });
    } finally {
      [this.blocks, this.connections, this.expressionBindings, this.inlineCallStack,
        this.rangeBindings, this.loopDepth, this.functionParams, this.tryStack, this.currentProcedureParams] = saved;
    }
  }

  // Array/string methods without a Kitten N block are built from loops in
  // synthesized TypeScript helpers, compiled like user functions (custom
  // blocks). Callback methods get one helper per call site, with the
  // callback as its own function; shared helpers are added only when used.
  synthesizeHelpers(sourceFile) {
    const parts = [];
    const globals = {
      "Math.sign": "function __jsSign(__jsSignX) { if (__jsSignX === 0) return __jsSignX; if (__jsSignX > 0) return 1; if (__jsSignX < 0) return -1; return __jsSignX; }",
      "Math.cbrt": "function __jsCbrt(__jsCbrtX) { if (__jsCbrtX < 0) return -Math.pow(-__jsCbrtX, 1 / 3); return Math.pow(__jsCbrtX, 1 / 3); }",
      "Math.log2": "function __jsLog2(__jsLog2X) { return Math.log(__jsLog2X) / Math.LN2; }",
      "Number.isInteger": "function __jsIsInteger(__jsIntegerX) { return __jsIntegerX === Math.trunc(__jsIntegerX); }",
      "Math.atan2": "function __jsAtan2(__jsAtanY, __jsAtanX) { if (__jsAtanX > 0) return Math.atan(__jsAtanY / __jsAtanX); if (__jsAtanX < 0) { if (__jsAtanY < 0) return Math.atan(__jsAtanY / __jsAtanX) - Math.PI; return Math.atan(__jsAtanY / __jsAtanX) + Math.PI; } if (__jsAtanY > 0) return Math.PI / 2; if (__jsAtanY < 0) return -Math.PI / 2; return 0; }",
    };
    const globalNames = { "Math.sign": "__jsSign", "Math.cbrt": "__jsCbrt", "Math.log2": "__jsLog2", "Math.atan2": "__jsAtan2", "Number.isInteger": "__jsIsInteger" };
    this.globalHelpers = new Map();
    const used = new Set();
    const visit = (node) => {
      if (ts.isCallExpression(node) && calleeName(node.expression) === "Array.from") {
        const [options, callback] = node.arguments;
        if (!options || !ts.isObjectLiteralExpression(options) || options.properties.length !== 1
          || !ts.isPropertyAssignment(options.properties[0]) || options.properties[0].name.getText(sourceFile) !== "length"
          || !callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) || node.arguments.length !== 2) {
          this.unsupported(node, "Array.from supports ({length: n}, inlineMapper) only");
        }
        const n = ++this.helperCount;
        const name = `__arrayFrom${n}`;
        const cb = `__arrayFromCallback${n}`;
        const params = callback.parameters.map(p => {
          if (!ts.isIdentifier(p.name)) this.unsupported(p, "Array.from mapper parameters must be simple names");
          return p.name.text;
        });
        if (params.length > 2) this.unsupported(callback, "Array.from mapper expects at most two parameters");
        for (let outer = node.parent; outer; outer = outer.parent) {
          if (ts.isFunctionLike(outer)) {
            for (const param of outer.parameters ?? []) {
              if (ts.isIdentifier(param.name) && !params.includes(param.name.text) && expressionContainsIdentifier(callback.body, param.name.text)) {
                this.unsupported(callback, `Array.from mapper cannot capture function parameter ${param.name.text}; copy it into a variable first`);
              }
            }
          }
        }
        const body = ts.isBlock(callback.body) ? callback.body.getText(sourceFile) : `{ return ${callback.body.getText(sourceFile)}; }`;
        parts.push(`function ${cb}(${params.join(",")}) ${body}
          function ${name}(__arrayFromLength${n}) { const __arrayFromOut${n} = []; let __arrayFromIndex${n} = 0;
            while (__arrayFromIndex${n} < Math.floor(Math.max(0, __arrayFromLength${n}))) {
              __arrayFromOut${n}.push(${cb}(${["0", `__arrayFromIndex${n}`].slice(0, params.length).join(",")}));
              __arrayFromIndex${n}++;
            } return __arrayFromOut${n}; }`);
        this.helperCalls.set(node, { name, factoryArgs: [options.properties[0].initializer] });
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "fill") {
        const target = node.expression.expression;
        if ((ts.isCallExpression(target) || ts.isNewExpression(target)) && calleeName(target.expression) === "Array") {
          if (target.arguments?.length !== 1 || node.arguments.length !== 1) this.unsupported(node, "Array(n).fill(v) expects one length and one fill value");
          const length = constantNumber(target.arguments[0]);
          if (length !== null && (!Number.isInteger(length) || length < 0)) this.unsupported(target, "Array length must be a finite nonnegative integer");
          const n = ++this.helperCount;
          const name = `__arrayFill${n}`;
          parts.push(`function ${name}(__arrayFillLength${n}, __arrayFillValue${n}) {
            const __arrayFillOut${n} = []; let __arrayFillIndex${n} = 0;
            while (__arrayFillIndex${n} < __arrayFillLength${n}) { __arrayFillOut${n}.push(__arrayFillValue${n}); __arrayFillIndex${n}++; }
            return __arrayFillOut${n}; }`);
          this.helperCalls.set(node, { name, factoryArgs: [target.arguments[0], node.arguments[0]] });
        }
      }
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (Object.hasOwn(globals, name) && !this.globalHelpers.has(name)) {
          parts.push(globals[name]);
          this.globalHelpers.set(name, globalNames[name]);
        }
      }
      if (ts.isCallExpression(node) && ["setTimeout", "setInterval"].includes(calleeName(node.expression))) {
        const callback = node.arguments[0];
        if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) || node.arguments.length > 2) {
          this.unsupported(node, "Timers expect an inline callback and optional delay in milliseconds");
        }
        if (callback.parameters.length) this.unsupported(callback, "Timer callbacks cannot have parameters");
        for (let outer = node.parent; outer; outer = outer.parent) {
          if (ts.isCallExpression(outer) && calleeName(outer.expression) === "sprite") {
            this.unsupported(node, "Timers inside sprite workspaces are not supported yet; schedule them in the root workspace");
          }
          if (ts.isFunctionLike(outer)) {
            for (const param of outer.parameters ?? []) {
              if (ts.isIdentifier(param.name) && expressionContainsIdentifier(callback.body, param.name.text)) {
                this.unsupported(callback, `Timer callbacks cannot capture function parameter ${param.name.text}; copy it into a variable first`);
              }
            }
          }
        }
        const n = ++this.helperCount;
        const name = `__timerStart${n}`;
        const worker = `__timerWorker${n}`;
        const message = `__nekoc_timer_${n}`;
        const token = `__timerToken${n}`;
        const received = `__timerReceived${n}`;
        const body = ts.isBlock(callback.body) ? callback.body.getText(sourceFile) : `{ ${callback.body.getText(sourceFile)}; }`;
        parts.push(`function __timerCallback${n}() ${body}
        function ${name}(__timerMs${n}) {
          const ${token} = {active: true, delay: Math.max(0, __timerMs${n}) / 1000};
          broadcast(${JSON.stringify(message)}, ${token}); return ${token};
        }
        function ${worker}(__timerArg${n}) {
          while (__timerArg${n}.active) {
            wait(__timerArg${n}.delay);
            if (!__timerArg${n}.active) return;
            ${calleeName(node.expression) === "setTimeout" ? `__timerArg${n}.active = false;` : ""}
            __timerCallback${n}();
          }
        }`);
        const event = ts.createSourceFile(`__timer_event${n}.ts`,
          `onMessage(${JSON.stringify(message)}, ${JSON.stringify(received)}, () => { ${worker}(messageValue(${JSON.stringify(received)})); });`,
          ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        this.generatedEvents.push(event.statements[0].expression);
        this.helperCalls.set(node, { name, timer: true });
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        used.add(method);
        const callback = node.arguments[0];
        if (CALLBACK_METHODS.has(method) && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          parts.push(this.synthesizeCallbackHelper(node, method, callback, sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const needed = new Set();
    const need = (name) => {
      if (needed.has(name)) return;
      needed.add(name);
      for (const dependency of SHARED_HELPERS[name].needs ?? []) need(dependency);
    };
    for (const method of used) {
      if (Object.hasOwn(METHOD_HELPERS, method)) {
        for (const name of METHOD_HELPERS[method]) need(name);
      }
    }
    for (const name of needed) parts.push(SHARED_HELPERS[name].source);
    if (!parts.length) return;
    const helperFile = ts.createSourceFile("__nekoc_helpers.ts", parts.join("\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of helperFile.statements) {
      this.registerInlineFunction(statement);
    }
  }

  synthesizeCallbackHelper(call, method, callback, sourceFile) {
    const n = ++this.helperCount;
    const params = callback.parameters.map((param) => {
      if (!ts.isIdentifier(param.name)) this.unsupported(param, "Callback parameters must be simple names");
      return param.name.text;
    });
    const statementBody = method === "forEach";
    const body = ts.isBlock(callback.body)
      ? callback.body.getText(sourceFile)
      : statementBody ? `{ ${callback.body.getText(sourceFile)}; }` : `{ return ${callback.body.getText(sourceFile)}; }`;
    // Callback params cannot reach parameters of an enclosing custom block.
    for (let outer = call.parent; outer; outer = outer.parent) {
      if (ts.isFunctionLike(outer) && outer !== callback) {
        for (const param of outer.parameters ?? []) {
          if (ts.isIdentifier(param.name) && expressionContainsIdentifier(callback.body, param.name.text)
            && !params.includes(param.name.text)) {
            this.unsupported(callback, `Callbacks cannot use the parameter ${param.name.text} of an enclosing function; copy it into a variable first`);
          }
        }
      }
    }
    const cb = `__cb${n}`;
    const name = `__${method}${n}`;
    const args = (...names) => names.slice(0, params.length).join(", ");
    const x = `__x${n}`;
    const i = `__i${n}`;
    const loop = (inner) => `let ${i} = 0; for (const ${x} of __arrL) { ${inner} ${i}++; }`;
    let helper;
    switch (method) {
      case "map":
        helper = `function ${name}(__arrL) { const __out${n} = []; ${loop(`__out${n}.push(${cb}(${args(x, i, "__arrL")}));`)} return __out${n}; }`;
        break;
      case "filter":
        helper = `function ${name}(__arrL) { const __out${n} = []; ${loop(`if (${cb}(${args(x, i, "__arrL")})) { __out${n}.push(${x}); }`)} return __out${n}; }`;
        break;
      case "forEach":
        helper = `function ${name}(__arrL) { ${loop(`${cb}(${args(x, i, "__arrL")});`)} }`;
        break;
      case "reduce":
        if (call.arguments.length < 2) this.unsupported(call, "reduce needs an initial value: a.reduce((acc, x) => ..., init)");
        helper = `function ${name}(__arrL, __init${n}) { let __acc${n} = __init${n}; ${loop(`__acc${n} = ${cb}(${args(`__acc${n}`, x, i, "__arrL")});`)} return __acc${n}; }`;
        break;
      case "find":
        helper = `function ${name}(__arrL) { ${loop(`if (${cb}(${args(x, i, "__arrL")})) { return ${x}; }`)} return ""; }`;
        break;
      case "findIndex":
        helper = `function ${name}(__arrL) { ${loop(`if (${cb}(${args(x, i, "__arrL")})) { return ${i}; }`)} return -1; }`;
        break;
      case "some":
        helper = `function ${name}(__arrL) { ${loop(`if (${cb}(${args(x, i, "__arrL")})) { return true; }`)} return false; }`;
        break;
      case "every":
        helper = `function ${name}(__arrL) { ${loop(`if (!(${cb}(${args(x, i, "__arrL")}))) { return false; }`)} return true; }`;
        break;
      case "sort":
        helper = sortHelper(name, `${cb}(__arrL[__b${n}], __v${n}) > 0`, n);
        break;
      default:
        this.unsupported(call, `Unsupported callback method ${method}`);
    }
    this.helperCalls.set(call, { name, extra: method === "reduce" ? [call.arguments[1]] : [] });
    return `function ${cb}(${params.join(", ")}) ${body}\n${helper}`;
  }

  // Builds a synthetic call to a helper: helper(target, ...args).
  helperCall(name, target, args) {
    const call = ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, [target, ...args]);
    return call;
  }

  compileHelperCall(name, target, args, parentId, asExpression = true) {
    const call = this.helperCall(name, target, args);
    if (this.functionProcedures.has(name)) {
      return this.compileFunctionProcedureCall(call, parentId, asExpression);
    }
    return asExpression
      ? this.compileInlineExpressionFunction(call, parentId, name)
      : this.compileInlineStatementFunction(call, parentId, name);
  }

  compileFunctionProcedureCall(call, parentId, asExpression) {
    const { fn, spec, returnsValue } = this.functionProcedures.get(calleeName(call.expression));
    const args = this.functionArguments(fn, call);
    if (asExpression && !returnsValue) {
      this.unsupported(call, `Function ${spec.name} does not return a value`);
    }
    if (!asExpression && returnsValue) {
      // Value discarded: store it in a scratch variable.
      const id = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: "__discard" } });
      this.globalVariables.add("__discard");
      this.connectInput(id, this.compileProcedureCallArgs(spec, args, id, true), "value", "value");
      return id;
    }
    return this.compileProcedureCallArgs(spec, args, parentId, asExpression);
  }

  // Call arguments with defaults filled in for omitted trailing parameters.
  functionArguments(fn, call) {
    const args = Array.from(call.arguments);
    if (args.length > fn.params.length) {
      this.unsupported(call, `Function ${fn.name} expects at most ${fn.params.length} arguments but got ${args.length}`);
    }
    for (let i = args.length; i < fn.params.length; i++) {
      if (!fn.defaults?.[i]) {
        this.unsupported(call, `Function ${fn.name} expects ${fn.params.length} arguments but got ${call.arguments.length}`);
      }
      args.push(fn.defaults[i]);
    }
    return args;
  }

  inlineArrowFunctionDeclaration(statement) {
    if (!ts.isVariableStatement(statement)) {
      return null;
    }
    if (statement.declarationList.declarations.length !== 1) {
      return null;
    }
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      return null;
    }
    if (!ts.isArrowFunction(declaration.initializer)) {
      return null;
    }
    return {
      name: declaration.name.text,
      params: declaration.initializer.parameters,
      body: declaration.initializer.body,
    };
  }

  registerProcedureSpec(call) {
    const name = calleeName(call.expression);
    if (name !== "defineProc" && name !== "defineReporter") {
      return;
    }

    const procedureName = stringLiteralValue(call.arguments[0], this);
    if (this.procedureSpecs.has(procedureName)) {
      this.unsupported(call, `Duplicate procedure definition: ${procedureName}`);
    }

    const procedureId = `kn-proc-${sanitizeIdPart(procedureName)}`;
    for (const [otherName, other] of this.procedureSpecs) {
      if (other.id === procedureId) {
        this.unsupported(call, `Procedure names "${otherName}" and "${procedureName}" produce the same id ${procedureId}; rename one`);
      }
    }
    const valueParams = arrayStringLiteralValues(call.arguments[1], this).map((paramName, index) => ({
      id: `kn-param-${sanitizeIdPart(procedureName)}-${index + 1}-${sanitizeIdPart(paramName)}`,
      type: "String",
      name: paramName,
    }));
    const params = [
      {
        id: `kn-label-${sanitizeIdPart(procedureName)}-0`,
        type: "Label",
        name: procedureName,
      },
      ...valueParams,
    ];

    this.procedureSpecs.set(procedureName, {
      id: procedureId,
      name: procedureName,
      type: name === "defineReporter" ? "ROUND" : "NORMAL",
      params,
    });
  }

  compileTopLevelCall(call) {
    const name = calleeName(call.expression);
    if (isMemberCallName(name, "onStart")) {
      return this.compileNextHat(call, "on_running_group_activated", 0);
    }
    if (isMemberCallName(name, "onClick")) {
      return this.compileNextHat(call, "sprite_on_tap", 0, { type: "mouse_click", sprite: "--self" });
    }
    switch (name) {
      case "defineProc":
        return this.compileProcedureDefinition(call, false);
      case "defineReporter":
        return this.compileProcedureDefinition(call, true);
      case "keyButton":
        return this.compileKeyButton(call);
      case "stage":
        return this.compileStageResource(call);
      case "screen":
        return this.compileScreenResource(call);
      case "sprite":
        return this.compileSpriteResource(call);
      case "onStart":
        return this.compileNextHat(call, "on_running_group_activated", 0);
      case "onClick":
        return this.compileNextHat(call, "sprite_on_tap", 0, { type: "mouse_click", sprite: "--self" });
      case "onKey":
        return this.compileKeyHat(call);
      case "onMessage":
        return this.compileMessageHat(call);
      case "when":
        return this.compileWhenHat(call);
      case "onBumpActor":
        return this.compileBumpActorHat(call);
      default:
        this.unsupported(call, `Unsupported top-level call: ${name || "<unknown>"}`);
    }
  }

  compileKeyButton(call) {
    const [key, label, visible] = call.arguments;
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      this.unsupported(call, "keyButton expects (key, label, visible?)");
    }
    let shown = true;
    if (visible) {
      if (visible.kind !== ts.SyntaxKind.TrueKeyword && visible.kind !== ts.SyntaxKind.FalseKeyword) {
        this.unsupported(call, "keyButton visible must be true or false");
      }
      shown = visible.kind === ts.SyntaxKind.TrueKeyword;
    }
    this.keyButtons.push({ key: stringLiteralValue(key, this), label: stringLiteralValue(label, this), visible: shown });
  }

  compileStageResource(call) {
    if (call.arguments.length !== 1) {
      this.unsupported(call, "stage expects one options object");
    }
    const options = objectLiteralOptions(call.arguments[0], this);
    this.resources.stage = {
      name: optionalStringOption(options, "name", "main", this, call.arguments[0]),
      backdrop: optionalStringOption(options, "backdrop", null, this, call.arguments[0]),
    };
  }

  compileScreenResource(call) {
    if (call.arguments.length !== 3) {
      this.unsupported(call, "screen expects name, options, and callback");
    }
    const name = stringLiteralValue(call.arguments[0], this);
    if (this.resources.screens.some((screen) => screen.name === name)) {
      this.unsupported(call.arguments[0], `Duplicate screen resource: ${name}`);
    }
    const options = objectLiteralOptions(call.arguments[1], this);
    const body = callbackBody(call.arguments[2], this);
    const screen = {
      id: allocateResourceId(`nekoc-screen-${sanitizeIdPart(name)}`,
        new Set(this.resources.screens.map((screen) => screen.id))),
      name,
      backdrop: optionalStringOption(options, "backdrop", null, this, call.arguments[1]),
      sprites: [],
    };
    this.resources.screens.push(screen);

    const savedScreen = this.currentScreen;
    this.currentScreen = screen;
    try {
      body.forEach((statement) => {
        if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
          const callName = calleeName(statement.expression.expression);
          if (callName === "sprite") {
            this.compileSpriteResource(statement.expression);
            return;
          }
        }
        this.unsupported(statement, "screen callbacks support only sprite calls");
      });
    } finally {
      this.currentScreen = savedScreen;
    }
  }

  compileSpriteResource(call) {
    if (call.arguments.length !== 3) {
      this.unsupported(call, "sprite expects name, options, and callback");
    }
    const name = stringLiteralValue(call.arguments[0], this);
    const targetSprites = this.currentScreen ? this.currentScreen.sprites : this.resources.sprites;
    if (targetSprites.some((sprite) => sprite.name === name)) {
      this.unsupported(call.arguments[0], `Duplicate sprite resource: ${name}`);
    }
    const options = objectLiteralOptions(call.arguments[1], this);
    const body = callbackBody(call.arguments[2], this);
    const workspace = this.compileIsolatedTopLevelStatements(body, call.arguments[2]);

    targetSprites.push({
      name,
      costume: optionalStringOption(options, "costume", null, this, call.arguments[1]),
      x: optionalNumberOption(options, "x", 0, this, call.arguments[1]),
      y: optionalNumberOption(options, "y", 0, this, call.arguments[1]),
      scale: optionalNumberOption(options, "scale", 100, this, call.arguments[1]),
      visible: optionalBooleanOption(options, "visible", true, this, call.arguments[1]),
      rotation: optionalNumberOption(options, "rotation", 0, this, call.arguments[1]),
      centerX: optionalNumberOption(options, "centerX", 0, this, call.arguments[1]),
      centerY: optionalNumberOption(options, "centerY", 0, this, call.arguments[1]),
      ...(options.has("costumes") ? { costumes: costumeListOption(options.get("costumes"), this) } : {}),
      workspaceData: workspace.workspaceData,
      summary: workspace.summary,
    });
  }

  compileIsolatedTopLevelStatements(statements, node) {
    const savedBlocks = this.blocks;
    const savedConnections = this.connections;
    const savedScriptCount = this.scriptCount;

    this.blocks = {};
    this.connections = {};
    this.scriptCount = 0;

    try {
      statements.forEach((statement) => {
        if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
          this.compileTopLevelCall(statement.expression);
          return;
        }
        this.unsupported(statement, "sprite callbacks support only top-level event calls");
      });
      const isolatedScriptCount = this.scriptCount;
      const workspaceData = {
        blocks: this.blocks,
        connections: this.connections,
        comments: {},
      };
      const summary = {
        scripts: isolatedScriptCount,
        blocks: Object.keys(this.blocks).length,
        connections: this.countConnections(),
      };
      return { workspaceData, summary };
    } finally {
      const isolatedScriptCount = this.scriptCount;
      this.blocks = savedBlocks;
      this.connections = savedConnections;
      this.scriptCount = savedScriptCount + isolatedScriptCount;
    }
  }

  compileProcedureDefinition(call, returnsValue) {
    const procedureName = stringLiteralValue(call.arguments[0], this);
    const spec = this.lookupProcedureSpec(call, procedureName);
    const body = callbackBody(call.arguments[2], this);
    const savedBlocks = this.blocks;
    const savedConnections = this.connections;
    const savedParams = this.currentProcedureParams;
    this.currentProcedureParams = procedureParamIds(spec);
    this.blocks = {};
    this.connections = {};

    const defId = this.addBlockWithId(spec.id, {
      type: "procedures_2_defnoreturn",
      parent_id: null,
      fields: { NAME: spec.id },
      mutation: procedureMutation(spec.params),
      shadows: {
        PROCEDURES_2_DEFNORETURN_DEFINE: "",
        ...procedureDefinitionShadows(spec.params),
        STACK: "",
      },
      deletable: false,
      editable: false,
    });
    spec.params.forEach((param, index) => {
      if (param.type !== "String") {
        return;
      }
      const paramId = this.addBlockWithId(param.id, {
        type: "procedures_2_stable_parameter",
        parent_id: defId,
        fields: { param_name: param.name },
      });
      this.connectInput(defId, paramId, `PARAMS${index}`, "value");
    });
    const firstChild = this.compileStatementList(body, defId);
    if (firstChild) {
      this.connectInput(defId, firstChild, "STACK", "statement");
    }

    this.procedures.push({
      id: spec.id,
      name: spec.name,
      type: returnsValue ? "ROUND" : "NORMAL",
      params: spec.params,
      workspaceData: {
        blocks: this.blocks,
        connections: this.connections,
        comments: {},
      },
    });

    this.blocks = savedBlocks;
    this.connections = savedConnections;
    this.currentProcedureParams = savedParams;
  }

  compileNextHat(call, type, callbackIndex, fields = undefined) {
    const body = callbackBody(call.arguments[callbackIndex], this);
    const entryId = this.addBlock({
      type,
      parent_id: null,
      ...(fields ? { fields } : {}),
    });
    this.scriptCount += 1;
    const first = this.compileStatementList(body, entryId);
    if (first) {
      this.connectNext(entryId, first);
    }
  }

  compileKeyHat(call) {
    const key = keyboardCode(stringLiteralValue(call.arguments[0], this));
    let keyType;
    let bodyArg;
    if (call.arguments.length === 2 && isCallbackBody(call.arguments[1])) {
      // onKey(key, body) - state omitted, default to "down"
      keyType = "down";
      bodyArg = call.arguments[1];
    } else {
      // onKey(key, state, body)
      keyType = stringLiteralValue(call.arguments[1], this);
      bodyArg = call.arguments[2];
    }
    const entryId = this.addBlock({
      type: "on_keydown",
      parent_id: null,
      fields: { key, type: keyType },
    });
    this.scriptCount += 1;
    const body = callbackBody(bodyArg, this);
    const first = this.compileStatementList(body, entryId);
    if (first) {
      this.connectNext(entryId, first);
    }
  }

  compileMessageHat(call) {
    if (call.arguments.length >= 3) {
      return this.compileMessageWithParamHat(call);
    }

    const entryId = this.addBlock({
      type: "self_listen",
      parent_id: null,
    });
    this.scriptCount += 1;
    const messageId = this.compileBroadcastMessage(call.arguments[0], entryId);
    this.connectInput(entryId, messageId, "message", "value");
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.compileStatementList(body, entryId);
    if (firstChild) {
      this.connectInput(entryId, firstChild, "DO", "statement");
    }
  }

  compileMessageWithParamHat(call) {
    const entryId = this.addBlock({
      type: "self_listen_with_param",
      parent_id: null,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>',
    });
    this.scriptCount += 1;
    const messageId = this.compileBroadcastMessage(call.arguments[0], entryId);
    this.connectInput(entryId, messageId, "message", "value");
    const paramId = this.compileBroadcastParamName(call.arguments[1], entryId);
    this.connectInput(entryId, paramId, "param", "value");
    const body = callbackBody(call.arguments[2], this);
    const firstChild = this.compileStatementList(body, entryId);
    if (firstChild) {
      this.connectInput(entryId, firstChild, "DO", "statement");
    }
  }

  compileWhenHat(call) {
    const entryId = this.addBlock({
      type: "when",
      parent_id: null,
    });
    this.scriptCount += 1;
    const conditionId = this.compileExpression(call.arguments[0], entryId);
    this.connectInput(entryId, conditionId, "condition", "value");
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.compileStatementList(body, entryId);
    if (firstChild) {
      this.connectInput(entryId, firstChild, "DO", "statement");
    }
  }

  compileBumpActorHat(call) {
    const entryId = this.addBlock({
      type: "on_bump_actor",
      parent_id: null,
      fields: {
        type: stringLiteralValue(call.arguments[0], this),
        sprite: stringLiteralValue(call.arguments[1], this),
      },
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>',
    });
    this.scriptCount += 1;
    const paramId = this.addBlock({
      type: "on_bump_actor_param",
      parent_id: entryId,
      fields: { TEXT: stringLiteralValue(call.arguments[2], this) },
      is_output: true,
    });
    this.connectInput(entryId, paramId, "actor", "value");
    const body = callbackBody(call.arguments[3], this);
    const firstChild = this.compileStatementList(body, entryId);
    if (firstChild) {
      this.connectInput(entryId, firstChild, "DO", "statement");
    }
  }


  compileStatementList(statements, parentIdForChildren) {
    let firstId = null;
    let previousId = null;

    statements = Array.from(statements);
    // Kitten N has no continue block. Directly in a loop body,
    // `if (c) { ...; continue; } rest` becomes `if (c) { ... } else { rest }`
    // and a trailing `continue` is dropped.
    const loopBody = this.loopBodyNext;
    this.loopBodyNext = false;
    if (loopBody && statements.length && ts.isContinueStatement(statements.at(-1)) && !statements.at(-1).label) {
      statements = statements.slice(0, -1);
    }
    const continueAt = loopBody ? statements.findIndex((statement) => ifEndsWithContinue(statement)) : -1;
    const tail = continueAt >= 0 ? statements.slice(continueAt + 1) : [];
    if (continueAt >= 0) this.loopBodyNext = false;
    if (continueAt >= 0) statements = statements.slice(0, continueAt + 1);

    statements.forEach((statement, index) => {
      const blockId = index === continueAt
        ? this.compileIfContinue(statement, tail, parentIdForChildren)
        : this.compileStatement(statement, parentIdForChildren);
      if (!blockId) return;
      if (!firstId) {
        firstId = blockId;
      }
      if (previousId) {
        this.connectNext(previousId, blockId);
      }
      previousId = blockId;
      // Inline statement functions may emit a chain, not just one block.
      for (;;) {
        const next = Object.entries(this.connections[previousId] ?? {})
          .find(([, connection]) => connection.type === "next");
        if (!next) break;
        previousId = next[0];
      }
    });

    return firstId;
  }

  compileIfContinue(statement, rest, parentId) {
    const thenStatements = this.statementBodyStatements(statement.thenStatement).slice(0, -1);
    const id = this.addBlock({
      type: "controls_if",
      parent_id: parentId,
      ...(rest.length ? { mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>' } : {}),
    });
    this.connectInput(id, this.compileExpression(statement.expression, id), "IF0", "value");
    const first = this.compileStatementList(thenStatements, id);
    if (first) this.connectInput(id, first, "DO0", "statement");
    if (rest.length) {
      this.loopBodyNext = true;
      const elseFirst = this.compileStatementList(rest, id);
      if (elseFirst) this.connectInput(id, elseFirst, "ELSE", "statement");
    }
    return id;
  }

  // The official loader resolves a parameter reporter through the param id in
  // its mutation (id="..."), not its name; without it the runtime reports
  // procedure_no_such_parameter and stops.
  compileParameterGet(name, parentId, node) {
    const paramId = this.currentProcedureParams?.get(name);
    if (!paramId) {
      this.unsupported(node, `Unknown procedure parameter: ${name}`);
    }
    return this.addBlock({
      type: "procedures_2_parameter",
      parent_id: parentId,
      fields: { param_name: name },
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" id="${paramId}"></mutation>`,
      is_output: true,
    });
  }

  compileLoopBody(statements, parentId) {
    this.loopBodyNext = true;
    return this.compileStatementList(statements, parentId);
  }

  chainTail(id) {
    for (;;) {
      const next = Object.entries(this.connections[id] ?? {}).find(([, connection]) => connection.type === "next");
      if (!next) return id;
      id = next[0];
    }
  }

  compileStatement(statement, parentId) {
    this.currentStatementNode = statement;
    if (ts.isExpressionStatement(statement)) {
      return this.compileStatementExpression(statement.expression, parentId);
    }
    if (ts.isVariableStatement(statement)) {
      return this.compileVariableStatement(statement, parentId);
    }
    if (ts.isIfStatement(statement)) {
      return this.compileNativeIfStatement(statement, parentId);
    }
    if (ts.isWhileStatement(statement)) {
      return this.compileNativeWhileStatement(statement, parentId);
    }
    if (ts.isForStatement(statement)) {
      return this.compileNativeForStatement(statement, parentId);
    }
    if (ts.isBreakStatement(statement)) {
      return this.compileNativeBreakStatement(statement, parentId);
    }
    if (ts.isSwitchStatement(statement)) {
      return this.compileSwitchStatement(statement, parentId);
    }
    if (ts.isDoStatement(statement)) {
      return this.compileDoWhileStatement(statement, parentId);
    }
    if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
      return this.compileForOfStatement(statement, parentId);
    }
    if (ts.isTryStatement(statement)) {
      return this.compileTryStatement(statement, parentId);
    }
    if (ts.isThrowStatement(statement)) {
      return this.compileThrow(statement, parentId);
    }
    if (ts.isReturnStatement(statement)) {
      if (statement.expression) {
        return this.compileReturn(statement.expression, parentId);
      }
      return this.addBlock({ type: "stop", parent_id: parentId });
    }
    if (ts.isEmptyStatement(statement)) {
      return null;
    }
    if (ts.isContinueStatement(statement)) {
      this.unsupported(statement, "continue is supported as the last statement of a loop body, or as `if (...) { ...; continue; }` directly in the loop body");
    }
    if (ts.isLabeledStatement(statement)) {
      return this.compileStatement(statement.statement, parentId);
    }
    this.unsupported(statement, "Only expression, variable, if, while, for, break, switch, do, try, throw, and return statements are supported");
  }

  compileVariableStatement(statement, parentId) {
    let firstId = null;
    let previousId = null;

    statement.declarationList.declarations.forEach((declaration) => {
      const blockId = this.compileVariableDeclaration(declaration, parentId);
      if (!firstId) {
        firstId = blockId;
      }
      if (previousId) {
        this.connectNext(previousId, blockId);
      }
      previousId = blockId;
    });

    return firstId;
  }

  compileVariableDeclaration(declaration, parentId) {
    if (ts.isArrayBindingPattern(declaration.name)) {
      return this.compileArrayDestructuring(declaration, parentId);
    }
    if (ts.isObjectBindingPattern(declaration.name)) {
      return this.compileObjectDestructuring(declaration, parentId);
    }
    if (!ts.isIdentifier(declaration.name)) {
      this.unsupported(declaration.name, "Only simple variable names are supported");
    }
    const variableName = declaration.name.text;
    this.registerBlockVariable(declaration.name, variableName);
    if (declaration.initializer && this.isArrayExpression(declaration.initializer)) {
      this.arrayVariables.add(variableName);
    } else if (declaration.initializer && isStringExpression(declaration.initializer)) {
      this.stringVariables.add(variableName);
    }
    const id = this.addBlock({
      type: "variables_set",
      parent_id: parentId,
      fields: { variable: variableName },
    });
    const valueId = declaration.initializer
      ? this.compileExpression(declaration.initializer, id)
      : this.addBlock({
        type: "math_number",
        parent_id: id,
        fields: { NUM: "0" },
        is_output: true,
      });
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  registerBlockVariable(node, variableName) {
    if (this.lookupRangeBinding(variableName) || this.globalVariables.has(variableName)) {
      this.unsupported(node, `Variable shadowing is not supported: ${variableName}`);
    }
    this.globalVariables.add(variableName);
  }

  compileArrayDestructuring(declaration, parentId) {
    let firstId = null;
    let previousId = null;
    const elements = declaration.name.elements;
    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      if (ts.isOmittedExpression(elem)) continue;
      let varName;
      if (ts.isBindingElement(elem) && ts.isIdentifier(elem.name)) {
        varName = elem.name.text;
      } else if (ts.isIdentifier(elem)) {
        varName = elem.text;
      } else {
        continue;
      }
      this.registerBlockVariable(elem, varName);
      const id = this.addBlock({
        type: "variables_set",
        parent_id: parentId,
        fields: { variable: varName },
      });
      if (declaration.initializer) {
        const listGetId = this.addBlock({
          type: "list_item",
          parent_id: id,
          is_output: true,
        });
        const listId = this.compileExpression(declaration.initializer, listGetId);
        this.connectInput(listGetId, listId, "list", "value");
        const indexId = this.addBlock({
          type: "math_number",
          parent_id: listGetId,
          fields: { NUM: String(i + 1) },
          is_output: true,
        });
        this.connectInput(listGetId, indexId, "list_index", "value");
        this.connectInput(id, listGetId, "value", "value");
      }
      if (!firstId) firstId = id;
      if (previousId) this.connectNext(previousId, id);
      previousId = id;
    }
    return firstId || this.addBlock({ type: "restart", parent_id: parentId });
  }

  compileObjectDestructuring(declaration) {
    this.unsupported(declaration.name, "Object destructuring is not supported; read properties explicitly");
  }

  compileStatementExpression(expression, parentId) {
    if (ts.isCallExpression(expression)) {
      return this.compileStatementCall(expression, parentId);
    }
    if (ts.isBinaryExpression(expression) && assignmentOperatorSpec(expression.operatorToken.kind)) {
      return this.compileAssignmentExpression(expression, parentId);
    }
    if (this.isUpdateExpression(expression)) {
      return this.compileUpdateExpression(expression, parentId);
    }
    this.unsupported(expression, "Only calls and assignments are supported as statements");
  }

  statementBodyStatements(statement) {
    if (ts.isBlock(statement)) {
      return Array.from(statement.statements);
    }
    return [statement];
  }

  compileStatementCall(call, parentId) {
    const name = calleeName(call.expression);
    if (name === "clearInterval" || name === "clearTimeout") {
      if (call.arguments.length !== 1) this.unsupported(call, `${name} expects one timer handle`);
      const target = ts.factory.createPropertyAccessExpression(call.arguments[0], "active");
      return this.compileObjectAssignment(ts.factory.createBinaryExpression(target, ts.SyntaxKind.EqualsToken, ts.factory.createFalse()), parentId);
    }
    if (this.helperCalls.get(call)?.timer) {
      const id = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: "__discardTimer" } });
      this.connectInput(id, this.compileExpressionCall(call, id), "value", "value");
      return id;
    }
    switch (memberCallName(name)) {
      case "setVar":
        return this.compileSetVar(call, parentId);
      case "changeVar":
        return this.compileChangeVar(call, parentId);
      case "showVariable":
        return this.compileShowHideVariable(call, parentId, "show");
      case "hideVariable":
        return this.compileShowHideVariable(call, parentId, "hide");
      case "wait":
        return this.compileWait(call, parentId);
      case "waitUntil":
        return this.compileWaitUntil(call, parentId);
      case "forever":
        return this.compileForever(call, parentId);
      case "repeat":
      case "repeatTimes":
        return this.compileRepeatTimes(call, parentId);
      case "repeatUntil":
        return this.compileRepeatUntil(call, parentId);
      case "broadcast":
        return this.compileBroadcast(call, parentId, false);
      case "broadcastAndWait":
        return this.compileBroadcast(call, parentId, true);
      case "move":
        return this.compileValueStatement(call, parentId, "self_go_forward", "steps", 0);
      case "turn":
        return this.compileValueStatement(call, parentId, "self_rotate", "degrees", 0);
      case "pointTowards":
        return this.compileValueStatement(call, parentId, "self_point_towards", "degrees", 0);
      case "show":
        return this.compileFieldStatement(parentId, "self_appear", { value: "appear" });
      case "hide":
        return this.compileFieldStatement(parentId, "self_appear", { value: "disappear" });
      case "say":
        return this.compileDialog(call, parentId, "talk", true);
      case "think":
        return this.compileDialog(call, parentId, "think", false);
      case "ask":
        return this.compileValueStatement(call, parentId, "self_ask", "text", 0);
    }
    const variableHandleCall = selfVariableHandleCall(call);
    if (variableHandleCall) {
      switch (variableHandleCall.methodName) {
        case "set":
          return this.compileSetVariable(parentId, variableHandleCall.nameArg, call.arguments[0]);
        case "change":
          return this.compileChangeVariable(parentId, variableHandleCall.nameArg, call.arguments[0]);
        case "show":
          return this.compileShowHideVariableByNameArg(parentId, variableHandleCall.nameArg, "show");
        case "hide":
          return this.compileShowHideVariableByNameArg(parentId, variableHandleCall.nameArg, "hide");
      }
    }
    const listHandleCall = selfListHandleCall(call);
    if (listHandleCall) {
      switch (listHandleCall.methodName) {
        case "add":
        case "append":
          return this.compileListAppendByArgs(parentId, listHandleCall.nameArg, call.arguments[0]);
        case "insert":
          return this.compileListInsertByArgs(parentId, listHandleCall.nameArg, call.arguments[0], call.arguments[1]);
        case "replace":
          return this.compileListReplaceByArgs(
            parentId,
            listHandleCall.nameArg,
            call.arguments[0],
            call.arguments[1],
            call.arguments[2],
          );
        case "delete":
        case "remove":
          return this.compileListDeleteByArgs(parentId, listHandleCall.nameArg, call.arguments[0], call.arguments[1]);
        case "copyTo":
          return this.compileListCopyByArgs(parentId, listHandleCall.nameArg, call.arguments[0]);
        case "show":
          return this.compileShowHideListByNameArg(parentId, listHandleCall.nameArg, "show");
        case "hide":
          return this.compileShowHideListByNameArg(parentId, listHandleCall.nameArg, "hide");
      }
    }
    // self.<api>(...) inside a sprite body is the same block as the global <api>(...).
    switch (selfApiName(name)) {
      case "setVar":
        return this.compileSetVar(call, parentId);
      case "changeVar":
        return this.compileChangeVar(call, parentId);
      case "scriptVars":
        return this.compileScriptVars(call, parentId);
      case "wait":
        return this.compileWait(call, parentId);
      case "waitUntil":
        return this.compileWaitUntil(call, parentId);
      case "forever":
        return this.compileForever(call, parentId);
      case "repeat":
      case "repeatTimes":
        return this.compileRepeatTimes(call, parentId);
      case "repeatUntil":
        return this.compileRepeatUntil(call, parentId);
      case "forRange":
        return this.compileForRange(call, parentId);
      case "ifThen":
        return this.compileIf(call, parentId, false);
      case "ifElse":
        return this.compileIf(call, parentId, true);
      case "broadcast":
        return this.compileBroadcast(call, parentId, false);
      case "broadcastAndWait":
        return this.compileBroadcast(call, parentId, true);
      case "consoleLog":
      case "console.log":
        return this.compileConsoleLog(call, parentId);
      case "callProc":
        return this.compileProcedureCall(call, parentId, false);
      case "returnValue":
        return this.compileReturnValue(call, parentId);
      case "breakLoop":
        return this.addBlock({ type: "break", parent_id: parentId });
      case "warp":
        return this.compileStatementBlock(call, parentId, "warp", 0);
      case "tell":
        return this.compileTell(call, parentId, false);
      case "tellAndWait":
        return this.compileTell(call, parentId, true);
      case "stop":
        return this.compileStop(call, parentId);
      case "restart":
        return this.addBlock({ type: "restart", parent_id: parentId });
      case "moveSteps":
        return this.compileValueStatement(call, parentId, "self_go_forward", "steps", 0);
      case "moveTo":
        return this.compileMoveTo(call, parentId, "self_move_to", 0);
      case "glideTo":
        return this.compileGlideTo(call, parentId);
      case "setX":
        return this.compileValueStatement(call, parentId, "self_set_position_x", "value", 0);
      case "setY":
        return this.compileValueStatement(call, parentId, "self_set_position_y", "value", 0);
      case "changeX":
        return this.compileCoordinateChange(call, parentId, "self_change_coordinate_x", 0, 0);
      case "changeY":
        return this.compileCoordinateChange(call, parentId, "self_change_coordinate_y", 0, 0);
      case "glideChangeX":
        return this.compileCoordinateChange(call, parentId, "self_glide_coordinate_x", 1, 0);
      case "glideChangeY":
        return this.compileCoordinateChange(call, parentId, "self_glide_coordinate_y", 1, 0);
      case "turn":
        return this.compileValueStatement(call, parentId, "self_rotate", "degrees", 0);
      case "pointTowards":
        return this.compileValueStatement(call, parentId, "self_point_towards", "degrees", 0);
      case "rotateAround":
        return this.compileRotateAround(call, parentId);
      case "faceTo":
        return this.compileActorFieldStatement(call, parentId, "self_face_to", "sprite");
      case "setFaceTo":
        return this.compileActorFieldStatement(call, parentId, "self_face_to_sprite", "sprite");
      case "moveToTarget":
        return this.compileActorFieldStatement(call, parentId, "self_move_specify", "sprite");
      case "moveToTargetSprite":
        return this.compileActorFieldStatement(call, parentId, "self_move_specify_sprite", "sprite");
      case "bounceOffEdge":
        return this.addBlock({ type: "self_bounce_off_edge", parent_id: parentId });
      case "setRotationType":
        return this.addBlock({
          type: "self_set_rotation_type",
          parent_id: parentId,
          fields: { rotation_type: stringLiteralValue(call.arguments[0], this) },
        });
      case "show":
        return this.compileFieldStatement(parentId, "self_appear", { value: "appear" });
      case "hide":
        return this.compileFieldStatement(parentId, "self_appear", { value: "disappear" });
      case "appearWith":
        return this.compileFieldStatement(parentId, "self_appear_animation", {
          appear: stringLiteralValue(call.arguments[0], this),
          direction: stringLiteralValue(call.arguments[1], this),
          animation: stringLiteralValue(call.arguments[2], this),
        });
      case "fadeVisibility":
        return this.compileValueStatementWithFields(call, parentId, "self_gradually_show_hide", "time", 0, {
          show_hide: stringLiteralValue(call.arguments[1], this),
        });
      case "say":
        return this.compileDialog(call, parentId, "talk", true);
      case "think":
        return this.compileDialog(call, parentId, "think", false);
      case "closeDialog":
        return this.addBlock({ type: "close_self_dialog", parent_id: parentId });
      case "stageDialog":
        return this.compileStageDialog(call, parentId);
      case "ask":
        return this.compileValueStatement(call, parentId, "self_ask", "text", 0);
      case "setScale":
        return this.compileValueStatement(call, parentId, "set_scale", "scale", 0);
      case "changeScale":
        return this.compileSignedValueStatement(call, parentId, "self_change_scale", "scale", 0);
      case "setSize":
        return this.compileValueStatementWithFields(call, parentId, "set_width_height_scale", "value", 1, {
          type: stringLiteralValue(call.arguments[0], this),
        });
      case "changeSize":
        return this.compileSignedValueStatement(call, parentId, "add_width_height_scale", "value", 1, {
          type: stringLiteralValue(call.arguments[0], this),
        });
      case "setEffect":
        return this.compileValueStatementWithFields(call, parentId, "self_set_effect", "value", 1, {
          scope: effectCode(stringLiteralValue(call.arguments[0], this)),
        });
      case "changeEffect":
        return this.compileSignedValueStatement(call, parentId, "self_change_effect", "value", 1, {
          scope: effectCode(stringLiteralValue(call.arguments[0], this)),
        });
      case "clearEffects":
        return this.addBlock({ type: "clear_all_effects", parent_id: parentId });
      case "setText":
        return this.compileValueStatement(call, parentId, "self_text_effect_text", "text", 0);
      case "setTextSize":
        return this.compileValueStatement(call, parentId, "self_text_effect_size", "size", 0);
      case "setTextColor":
        return this.compileFieldStatement(parentId, "self_text_effect_color", {
          color: stringLiteralValue(call.arguments[0], this),
        });
      case "setLayer":
        return this.compileFieldStatement(parentId, "set_top_bottom_layer", {
          layer: stringLiteralValue(call.arguments[0], this),
          target_layer: stringLiteralValue(call.arguments[1], this),
        });
      case "setDraggable":
        return this.compileFieldStatement(parentId, "self_set_draggable", {
          draggable: stringLiteralValue(call.arguments[0], this),
        });
      case "setCamp":
        return this.compileFieldStatement(parentId, "self_set_role_camp", {
          role_camp: stringLiteralValue(call.arguments[0], this),
        });
      case "stressAnimation":
        return this.compileFieldStatement(parentId, "self_stress_animation", {
          animation: stringLiteralValue(call.arguments[0], this),
        });
      case "globalAnimation":
        return this.compileFieldStatement(parentId, "global_animation", {
          animation: stringLiteralValue(call.arguments[0], this),
        });
      case "showTimer":
        return this.compileFieldStatement(parentId, "show_hide_timer", { showHide: "show" });
      case "hideTimer":
        return this.compileFieldStatement(parentId, "show_hide_timer", { showHide: "hide" });
      case "showVariable":
        return this.compileShowHideVariable(call, parentId, "show");
      case "hideVariable":
        return this.compileShowHideVariable(call, parentId, "hide");
      case "showList":
        return this.compileShowHideList(call, parentId, "show");
      case "hideList":
        return this.compileShowHideList(call, parentId, "hide");
      case "showRanking":
        return this.compileFieldStatement(parentId, "show_hide_ranking", {
          show_hide: "show",
          ranking: stringLiteralValue(call.arguments[0], this),
        });
      case "hideRanking":
        return this.compileFieldStatement(parentId, "show_hide_ranking", {
          show_hide: "hide",
          ranking: stringLiteralValue(call.arguments[0], this),
        });
      case "appendList":
        return this.compileListAppend(call, parentId);
      case "insertList":
        return this.compileListInsert(call, parentId);
      case "replaceListItem":
        return this.compileListReplace(call, parentId);
      case "deleteListItem":
        return this.compileListDelete(call, parentId);
      case "copyList":
        return this.compileListCopy(call, parentId);
      case "nextStyle":
        return this.compileFieldStatement(parentId, "self_prev_next_style", { prev_next: "next" });
      case "prevStyle":
        return this.compileFieldStatement(parentId, "self_prev_next_style", { prev_next: "prev" });
      case "setStyle":
        return this.compileResourceInputStatement(call, parentId, "set_sprite_style", "style_id", "get_styles", "style_id", 0);
      case "playAudio":
        return this.compileResourceInputStatement(call, parentId, "play_audio", "audio_id", "get_play_audio", "audio_id", 0);
      case "playAudioAndWait":
        return this.compileResourceInputStatement(call, parentId, "play_audio_and_wait", "audio_id", "get_play_audio", "audio_id", 0);
      case "stopAudio":
        return this.compileResourceInputStatement(call, parentId, "stop_audio", "audio_id", "get_stop_audio", "audio_id", 0);
      case "setScreenTransition":
        return this.compileFieldStatement(parentId, "set_screen_transition", {
          direction: stringLiteralValue(call.arguments[0], this),
          type: stringLiteralValue(call.arguments[1], this),
        });
      case "switchScreen":
        return this.compileResourceInputStatement(call, parentId, "switch_to_screen", "screen_id", "get_screens", "screen_id", 0);
      case "clearDrawing":
        return this.addBlock({ type: "clear_drawing", parent_id: parentId });
      case "penDown":
        return this.addBlock({ type: "self_pen_down", parent_id: parentId });
      case "penUp":
        return this.addBlock({ type: "self_pen_up", parent_id: parentId });
      case "setPenColor": {
        const colorId = this.compileExpression(call.arguments[0], parentId);
        const colorBlock = this.blocks[colorId];
        let color;
        if (colorBlock.type === "math_number") {
          const packed = Number(colorBlock.fields.NUM);
          if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffff) {
            this.unsupported(call, "Constant RGB color must be an integer in 0..0xffffff");
          }
          color = `#${packed.toString(16).padStart(6, "0")}`;
        } else if (colorBlock.type === "text") {
          color = colorBlock.fields.TEXT;
        } else {
          this.unsupported(call, "Pen color is a field: expected a constant string or RGB number");
        }
        delete this.blocks[colorId];
        delete this.connections[colorId];
        delete this.sourceMap[colorId];
        return this.compileFieldStatement(parentId, "self_set_pen_color", {
          color,
        });
      }
      case "setPenSize":
        return this.compileValueStatement(call, parentId, "self_set_pen_size", "size", 0);
      case "changePenSize":
        return this.compileSignedValueStatement(call, parentId, "self_change_pen_size", "steps", 0);
      case "setPenEffect":
        return this.compileValueStatementWithFields(call, parentId, "self_set_pen_color_property", "val", 1, {
          scope: stringLiteralValue(call.arguments[0], this),
        });
      case "changePenEffect":
        return this.compileSignedValueStatement(call, parentId, "self_change_pen_color_property", "steps", 1, {
          scope: stringLiteralValue(call.arguments[0], this),
        });
      case "stampText":
        return this.compileStampText(call, parentId);
      case "imageStamp":
        return this.addBlock({ type: "image_stamp", parent_id: parentId });
      case "setPenLayer":
        return this.compileFieldStatement(parentId, "set_pen_layer", {
          layer: stringLiteralValue(call.arguments[0], this),
          target_layer: stringLiteralValue(call.arguments[1], this),
        });
      case "askChoice":
        return this.compileAskChoice(call, parentId);
      case "clone":
      case "createClone":
        return this.compileFieldStatement(parentId, "mirror", {
          sprite: call.arguments.length > 0 ? stringLiteralValue(call.arguments[0], this) : "--self",
        });
      case "deleteClone":
        return this.addBlock({ type: "dispose_clone", parent_id: parentId });
      case "timerStart":
        return this.compileFieldStatement(parentId, "set_timer_state", { type: "start" });
      case "timerStop":
        return this.compileFieldStatement(parentId, "set_timer_state", { type: "stop" });
      case "timerReset":
        return this.compileFieldStatement(parentId, "set_timer_state", { type: "reset" });
      case "faceToBodyPart":
        return this.compileFieldStatement(parentId, "face_to_body_part", {
          body_part: stringLiteralValue(call.arguments[0], this),
        });
      default: {
        const statement = this.compileMethodStatement(call, parentId);
        if (statement !== undefined) return statement;
      }
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "push"
          && this.isArrayExpression(call.expression.expression)) {
          let firstId = null;
          let previousId = null;
          for (const argument of call.arguments) {
            const id = this.addBlock({ type: "list_append", parent_id: parentId });
            this.connectInput(id, this.compileExpression(call.expression.expression, id), "list", "value");
            this.connectInput(id, this.compileExpression(argument, id), "list_item_value", "value");
            if (previousId) this.connectNext(previousId, id);
            firstId ??= id;
            previousId = id;
          }
          return firstId;
        }
        if (this.functionProcedures.has(name)) {
          return this.compileFunctionProcedureCall(call, parentId, false);
        }
        if (this.inlineFunctions.has(name)) {
          return this.compileInlineStatementFunction(call, parentId, name);
        }
        this.unsupported(call, `Unsupported statement call: ${name || "<unknown>"}`);
    }
  }

  compileInlineStatementFunction(call, parentId, name) {
    return this.withInlineFunctionCall(call, name, () => {
      const fn = this.inlineFunctions.get(name);
      if (!ts.isBlock(fn.body)) {
        this.unsupported(call, `Statement function ${name} must use a block body`);
      }
      const statements = Array.from(fn.body.statements);
      if (statements.some((statement) => ts.isReturnStatement(statement))) {
        this.unsupported(call, `Statement function ${name} cannot contain return`);
      }
      return this.compileStatementList(statements, parentId);
    });
  }

  compileSetVar(call, parentId) {
    const [nameArg, valueArg] = call.arguments;
    return this.compileSetVariable(parentId, nameArg, valueArg);
  }

  compileSetVariable(parentId, nameArg, valueArg) {
    const id = this.addBlock({
      type: "variables_set",
      parent_id: parentId,
      fields: { variable: stringLiteralValue(nameArg, this) },
    });
    const valueId = this.compileExpression(valueArg, id);
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileAssignmentExpression(expression, parentId) {
    if ((ts.isPropertyAccessExpression(expression.left) && !["self", "this"].includes(expression.left.expression.getText()))
      || (ts.isElementAccessExpression(expression.left) && !this.isArrayExpression(expression.left.expression))) {
      return this.compileObjectAssignment(expression, parentId);
    }
    if (ts.isPropertyAccessExpression(expression.left)) {
      const propertyName = expression.left.name.text;
      if (propertyName === "x") {
        return this.compileValueExpressionStatement(parentId, "self_set_position_x", "value", expression.right);
      }
      if (propertyName === "y") {
        return this.compileValueExpressionStatement(parentId, "self_set_position_y", "value", expression.right);
      }
      if (propertyName === "scale") {
        return this.compileValueExpressionStatement(parentId, "set_scale", "scale", expression.right);
      }
      this.unsupported(expression.left.name, `Unsupported self property assignment: ${propertyName}`);
    }
    if (ts.isElementAccessExpression(expression.left) && this.isArrayExpression(expression.left.expression)
      && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // a[i] = v -> replace item i + 1
      const id = this.addBlock({ type: "replace_list_item", parent_id: parentId, fields: { item: "any" } });
      this.connectInput(id, this.compileExpression(expression.left.expression, id), "list", "value");
      this.connectInput(id, this.compilePlusOne(expression.left.argumentExpression, id), "list_index", "value");
      this.connectInput(id, this.compileExpression(expression.right, id), "list_item_value", "value");
      return id;
    }
    if (!ts.isIdentifier(expression.left)) {
      this.unsupported(expression.left, "Only variable and array element (a[i] = v) assignments are supported");
    }
    const variableName = expression.left.text;
    if (this.functionParams?.has(variableName) || this.lookupExpressionBinding(variableName)) {
      this.unsupported(expression.left, `Cannot assign to function parameter ${variableName}; copy it into a local variable first`);
    }
    if (this.lookupRangeBinding(variableName)) {
      this.unsupported(expression.left, `Cannot assign to for loop parameter: ${variableName}`);
    }
    this.globalVariables.add(variableName);
    const id = this.addBlock({
      type: "variables_set",
      parent_id: parentId,
      fields: { variable: variableName },
    });
    const spec = assignmentOperatorSpec(expression.operatorToken.kind);
    if (!spec) {
      this.unsupported(expression.operatorToken, "Unsupported assignment operator");
    }
    let valueId;
    if (spec.kind === "assign") {
      valueId = this.compileExpression(expression.right, id);
    } else if (spec.operator === "add" && isStringExpression(expression.right)) {
      // s += "text" appends.
      valueId = this.compileTextJoin([{ expression: expression.left }, { expression: expression.right }], id);
    } else {
      valueId = this.compileVariableArithmeticExpression(variableName, expression.right, id, spec.operator);
    }
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  isUpdateExpression(expression) {
    return (
      (ts.isPostfixUnaryExpression(expression) || ts.isPrefixUnaryExpression(expression)) &&
      (expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken)
    );
  }

  compileUpdateExpression(expression, parentId) {
    if (ts.isPropertyAccessExpression(expression.operand) || ts.isElementAccessExpression(expression.operand)) {
      return this.compileAssignmentExpression(ts.factory.createBinaryExpression(expression.operand,
        expression.operator === ts.SyntaxKind.PlusPlusToken ? ts.SyntaxKind.PlusEqualsToken : ts.SyntaxKind.MinusEqualsToken,
        ts.factory.createNumericLiteral(1)), parentId);
    }
    if (!ts.isIdentifier(expression.operand)) {
      this.unsupported(expression.operand, "Only simple variable updates are supported");
    }
    const variableName = expression.operand.text;
    if (this.lookupRangeBinding(variableName)) {
      this.unsupported(expression.operand, `Cannot update for loop parameter: ${variableName}`);
    }
    this.globalVariables.add(variableName);
    const id = this.addBlock({
      type: "variables_set",
      parent_id: parentId,
      fields: { variable: variableName },
    });
    const operator = expression.operator === ts.SyntaxKind.PlusPlusToken ? "add" : "minus";
    const valueId = this.compileVariableArithmeticNumber(variableName, "1", id, operator);
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileVariableArithmeticExpression(variableName, rightExpressionOrBlockId, parentId, operator) {
    const id = this.addBlock({
      type: "math_arithmetic",
      parent_id: parentId,
      fields: { type: operator },
      is_output: true,
    });
    const leftId = this.addBlock({
      type: "variables_get",
      parent_id: id,
      fields: { variable: variableName },
      is_output: true,
    });
    const rightId = typeof rightExpressionOrBlockId === "string"
      ? rightExpressionOrBlockId
      : this.compileExpression(rightExpressionOrBlockId, id);
    this.connectInput(id, leftId, "A", "value");
    this.connectInput(id, rightId, "B", "value");
    return id;
  }

  compileVariableArithmeticNumber(variableName, numberText, parentId, operator) {
    const id = this.addBlock({
      type: "math_arithmetic",
      parent_id: parentId,
      fields: { type: operator },
      is_output: true,
    });
    const leftId = this.addBlock({
      type: "variables_get",
      parent_id: id,
      fields: { variable: variableName },
      is_output: true,
    });
    const rightId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: numberText },
      is_output: true,
    });
    this.connectInput(id, leftId, "A", "value");
    this.connectInput(id, rightId, "B", "value");
    return id;
  }

  compileChangeVar(call, parentId) {
    const [nameArg, valueArg] = call.arguments;
    return this.compileChangeVariable(parentId, nameArg, valueArg);
  }

  compileChangeVariable(parentId, nameArg, valueArg) {
    if (!ts.isNumericLiteral(valueArg) && !(ts.isPrefixUnaryExpression(valueArg) && ts.isNumericLiteral(valueArg.operand))) {
      const id = this.addBlock({
        type: "change_variables",
        parent_id: parentId,
        fields: { variable: stringLiteralValue(nameArg, this), method: "increase" },
      });
      const valueId = this.compileExpression(valueArg, id);
      this.connectInput(id, valueId, "value", "value");
      return id;
    }
    const change = numericLiteralValue(valueArg, this);
    const method = change < 0 ? "decrease" : "increase";
    const id = this.addBlock({
      type: "change_variables",
      parent_id: parentId,
      fields: {
        variable: stringLiteralValue(nameArg, this),
        method,
      },
    });
    const valueId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: String(Math.abs(change)) },
      is_output: true,
    });
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileShowHideVariable(call, parentId, showHide) {
    return this.compileShowHideVariableByNameArg(parentId, call.arguments[0], showHide);
  }

  compileShowHideVariableByNameArg(parentId, nameArg, showHide) {
    return this.compileFieldStatement(parentId, "show_hide_variables", {
      show_hide: showHide,
      variable: stringLiteralValue(nameArg, this),
    });
  }

  compileShowHideList(call, parentId, showHide) {
    return this.compileShowHideListByNameArg(parentId, call.arguments[0], showHide);
  }

  compileShowHideListByNameArg(parentId, nameArg, showHide) {
    return this.compileFieldStatement(parentId, "show_hide_list", {
      show_hide: showHide,
      list: stringLiteralValue(nameArg, this),
    });
  }

  compileScriptVars(call, parentId) {
    const paramCount = call.arguments.length;
    if (paramCount > 20) this.unsupported(call, "A scriptVars block supports at most 20 names");
    const args = Array.from({ length: paramCount }, (_, i) => `<arg name="PARAMS${i}"></arg>`).join("");
    const id = this.addBlock({
      type: "script_variables",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${paramCount}">${args}</mutation>`,
    });
    for (let index = 0; index < paramCount; index += 1) {
      const paramId = this.addBlock({
        type: "script_variables_param",
        parent_id: id,
        fields: { TEXT: stringLiteralValue(call.arguments[index], this) },
        is_output: true,
      });
      this.connectInput(id, paramId, `PARAMS${index}`, "value");
    }
    return id;
  }

  compileWait(call, parentId) {
    const id = this.addBlock({
      type: "wait",
      parent_id: parentId,
    });
    const valueId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, valueId, "time", "value");
    return id;
  }

  compileWaitUntil(call, parentId) {
    const id = this.addBlock({
      type: "wait_until",
      parent_id: parentId,
    });
    const conditionId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, conditionId, "condition", "value");
    return id;
  }

  compileForever(call, parentId) {
    return this.inLoop(() => {
      const id = this.addBlock({ type: "repeat_forever", parent_id: parentId });
      const first = this.compileLoopBody(callbackBody(call.arguments[0], this), id);
      if (first) this.connectInput(id, first, "DO", "statement");
      return id;
    });
  }

  // Callback loops (forever/repeat/repeatUntil/forRange) accept break like native loops.
  inLoop(compile) {
    this.loopDepth += 1;
    try {
      return compile();
    } finally {
      this.loopDepth -= 1;
    }
  }

  compileRepeatTimes(call, parentId) {
    const id = this.addBlock({
      type: "repeat_n_times",
      parent_id: parentId,
    });
    const timesId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, timesId, "times", "value");
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.inLoop(() => this.compileLoopBody(body, id));
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }
    return id;
  }

  compileRepeatUntil(call, parentId) {
    const id = this.addBlock({
      type: "repeat_forever_until",
      parent_id: parentId,
    });
    const conditionId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, conditionId, "condition", "value");
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.inLoop(() => this.compileLoopBody(body, id));
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }
    return id;
  }

  compileIf(call, parentId, hasElse) {
    const id = this.addBlock({
      type: "controls_if",
      parent_id: parentId,
      ...(hasElse
        ? { mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>' }
        : {}),
    });
    const conditionId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, conditionId, "IF0", "value");

    const thenBody = callbackBody(call.arguments[1], this);
    const firstThenChild = this.compileStatementList(thenBody, id);
    if (firstThenChild) {
      this.connectInput(id, firstThenChild, "DO0", "statement");
    }

    if (hasElse) {
      const elseBody = callbackBody(call.arguments[2], this);
      const firstElseChild = this.compileStatementList(elseBody, id);
      if (firstElseChild) {
        this.connectInput(id, firstElseChild, "ELSE", "statement");
      }
    }

    return id;
  }

  compileNativeIfStatement(statement, parentId) {
    const hasElse = Boolean(statement.elseStatement);
    const id = this.addBlock({
      type: "controls_if",
      parent_id: parentId,
      ...(hasElse
        ? { mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>' }
        : {}),
    });
    const conditionId = this.compileExpression(statement.expression, id);
    this.connectInput(id, conditionId, "IF0", "value");

    const thenBody = this.statementBodyStatements(statement.thenStatement);
    const firstThenChild = this.compileStatementList(thenBody, id);
    if (firstThenChild) {
      this.connectInput(id, firstThenChild, "DO0", "statement");
    }

    if (statement.elseStatement) {
      const firstElseChild = ts.isIfStatement(statement.elseStatement)
        ? this.compileNativeIfStatement(statement.elseStatement, id)
        : this.compileStatementList(this.statementBodyStatements(statement.elseStatement), id);
      if (firstElseChild) {
        this.connectInput(id, firstElseChild, "ELSE", "statement");
      }
    }

    return id;
  }

  compileNativeWhileStatement(statement, parentId) {
    const id = this.addBlock({
      type: "repeat_forever_until",
      parent_id: parentId,
    });
    const negateId = this.addBlock({
      type: "logic_negate",
      parent_id: id,
      is_output: true,
    });
    const conditionId = this.compileExpression(statement.expression, negateId);
    this.connectInput(negateId, conditionId, "logic", "value");
    this.connectInput(id, negateId, "condition", "value");

    this.loopDepth += 1;
    try {
      const firstChild = this.compileLoopBody(this.statementBodyStatements(statement.statement), id);
      if (firstChild) {
        this.connectInput(id, firstChild, "DO", "statement");
      }
    } finally {
      this.loopDepth -= 1;
    }

    return id;
  }

  compileNativeBreakStatement(statement, parentId) {
    if (this.loopDepth <= 0) {
      this.unsupported(statement, "break can only be used inside loops");
    }
    return this.addBlock({ type: "break", parent_id: parentId });
  }

  // switch -> if / else if / else chain. Empty cases share the next body
  // (case 1: case 2: ...); other fall-through is rejected.
  compileSwitchStatement(statement, parentId) {
    const groups = [];
    let pending = [];
    const clauses = statement.caseBlock.clauses;
    clauses.forEach((clause, index) => {
      pending.push(clause);
      if (clause.statements.length === 0 && index < clauses.length - 1) return;
      const statements = Array.from(clause.statements);
      const last = statements.at(-1);
      const terminated = last && (ts.isBreakStatement(last) && !last.label || ts.isReturnStatement(last) || ts.isThrowStatement(last));
      if (!terminated && index < clauses.length - 1) {
        this.unsupported(clause, "switch fall-through into the next case is not supported; end the case with break");
      }
      const body = last && ts.isBreakStatement(last) && !last.label ? statements.slice(0, -1) : statements;
      body.forEach((child) => visitOutsideLoops(child, (node) => {
        if (ts.isBreakStatement(node) && !node.label) {
          this.unsupported(node, "break inside a switch case is only supported as the last statement of the case");
        }
      }));
      groups.push({ clauses: pending, body, isDefault: pending.some((c) => ts.isDefaultClause(c)) });
      pending = [];
    });
    const cases = groups.filter((group) => !group.isDefault);
    const fallback = groups.find((group) => group.isDefault);
    const build = (index, parent) => {
      if (index >= cases.length) {
        return fallback ? this.compileStatementList(fallback.body, parent) : null;
      }
      const group = cases[index];
      const rest = index + 1 < cases.length || fallback;
      const ifId = this.addBlock({
        type: "controls_if",
        parent_id: parent,
        ...(rest ? { mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>' } : {}),
      });
      const conditions = group.clauses.filter((c) => ts.isCaseClause(c)).map((clause) => (conditionParent) => {
        const condId = this.addBlock({ type: "logic_compare", parent_id: conditionParent, fields: { OP: "EQ" }, is_output: true });
        this.connectInput(condId, this.compileExpression(statement.expression, condId), "A", "value");
        this.connectInput(condId, this.compileExpression(clause.expression, condId), "B", "value");
        return condId;
      });
      const anyOf = (items, conditionParent) => {
        if (items.length === 1) return items[0](conditionParent);
        const orId = this.addBlock({ type: "logic_operation", parent_id: conditionParent, fields: { type: "or" }, is_output: true });
        this.connectInput(orId, items[0](orId), "A", "value");
        this.connectInput(orId, anyOf(items.slice(1), orId), "B", "value");
        return orId;
      };
      this.connectInput(ifId, anyOf(conditions, ifId), "IF0", "value");
      const first = this.compileStatementList(group.body, ifId);
      if (first) this.connectInput(ifId, first, "DO0", "statement");
      if (rest) {
        const elseFirst = build(index + 1, ifId);
        if (elseFirst) this.connectInput(ifId, elseFirst, "ELSE", "statement");
      }
      return ifId;
    };
    return build(0, parentId);
  }

  // do { B } while (C)  ->  forever { B; if (!C) break; }
  compileDoWhileStatement(statement, parentId) {
    const loopId = this.addBlock({ type: "repeat_forever", parent_id: parentId });
    const body = [...this.statementBodyStatements(statement.statement)];
    const first = this.inLoop(() => this.compileLoopBody(body, loopId));
    const ifId = this.addBlock({ type: "controls_if", parent_id: loopId });
    const notId = this.addBlock({ type: "logic_negate", parent_id: ifId, is_output: true });
    this.connectInput(notId, this.compileExpression(statement.expression, notId), "logic", "value");
    this.connectInput(ifId, notId, "IF0", "value");
    this.connectInput(ifId, this.addBlock({ type: "break", parent_id: ifId }), "DO0", "statement");
    if (first) {
      const tail = this.chainTail(first);
      this.connectNext(tail, ifId);
      this.connectInput(loopId, first, "DO", "statement");
    } else {
      this.connectInput(loopId, ifId, "DO", "statement");
    }
    return loopId;
  }

  // for (const x of [a, b]) unrolls inside a run-once loop (so break works);
  // for (const x of list) walks the list by index.
  compileForOfStatement(statement, parentId) {
    const decl = ts.isVariableDeclarationList(statement.initializer) ? statement.initializer.declarations[0] : null;
    if (!decl || !ts.isIdentifier(decl.name)) {
      this.unsupported(statement.initializer, "for...of needs a simple loop variable, e.g. for (const x of ...)");
    }
    const variableName = decl.name.text;
    this.globalVariables.add(variableName);
    const body = this.statementBodyStatements(statement.statement);
    const source = stripParens(statement.expression);
    const setVariable = (parent, valueFor) => {
      const setId = this.addBlock({ type: "variables_set", parent_id: parent, fields: { variable: variableName } });
      this.connectInput(setId, valueFor(setId), "value", "value");
      return setId;
    };
    const chain = (parent, ids) => {
      ids = ids.filter(Boolean);
      for (let i = 1; i < ids.length; i++) {
        const tail = this.chainTail(ids[i - 1]);
        this.connectNext(tail, ids[i]);
      }
      return ids[0] ?? null;
    };
    const loopId = this.addBlock({ type: "repeat_n_times", parent_id: parentId });
    if (ts.isArrayLiteralExpression(source)) {
      const once = this.addBlock({ type: "math_number", parent_id: loopId, fields: { NUM: "1" }, is_output: true });
      this.connectInput(loopId, once, "times", "value");
      const ids = [];
      this.inLoop(() => {
        for (const element of source.elements) {
          ids.push(setVariable(loopId, (setId) => this.compileExpression(element, setId)));
          ids.push(this.compileLoopBody(body, loopId));
        }
      });
      const first = chain(loopId, ids);
      if (first) this.connectInput(loopId, first, "DO", "statement");
      return loopId;
    }
    const counter = `__for_of_${variableName}_${this.nextId}`;
    this.globalVariables.add(counter);
    // self.list("L") / self.list("L").get() name a project list directly.
    const listName = forOfListName(source);
    const connectList = (blockId) => (listName !== null
      ? this.connectListInput(blockId, "list", listName)
      : this.connectInput(blockId, this.compileExpression(statement.expression, blockId), "list", "value"));
    const lenId = this.addBlock({ type: "list_length", parent_id: loopId, is_output: true });
    connectList(lenId);
    this.connectInput(loopId, lenId, "times", "value");
    const resetId = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: counter } });
    this.connectInput(resetId, this.addBlock({ type: "math_number", parent_id: resetId, fields: { NUM: "0" }, is_output: true }), "value", "value");
    const stepId = this.addBlock({ type: "change_variables", parent_id: loopId, fields: { variable: counter, method: "increase" } });
    this.connectInput(stepId, this.addBlock({ type: "math_number", parent_id: stepId, fields: { NUM: "1" }, is_output: true }), "value", "value");
    const assignId = setVariable(loopId, (setId) => {
      const itemId = this.addBlock({ type: "list_item", parent_id: setId, fields: { item: "any" }, is_output: true });
      connectList(itemId);
      this.connectInput(itemId, this.addBlock({ type: "variables_get", parent_id: itemId, fields: { variable: counter }, is_output: true }), "list_index", "value");
      return itemId;
    });
    const first = chain(loopId, [stepId, assignId, this.inLoop(() => this.compileLoopBody(body, loopId))]);
    this.connectInput(loopId, first, "DO", "statement");
    this.connectNext(resetId, loopId);
    return resetId;
  }

  // try { ... throw x ... } catch (e) { ... } finally { ... }
  //   flag = 0; repeat 1 { body; throw -> error = x, flag = 1, break }
  //   if (flag == 1) { e = error; catch body }  finally body
  // Throws must be directly in the try body (not in nested loops or other
  // functions); a throw elsewhere stops the script.
  compileTryStatement(statement, parentId) {
    const body = this.statementBodyStatements(statement.tryBlock);
    const finallyStatements = statement.finallyBlock ? Array.from(statement.finallyBlock.statements) : [];
    if (!statement.catchClause) {
      const first = this.compileStatementList(body, parentId);
      const rest = this.compileStatementList(finallyStatements, parentId);
      if (first && rest) this.connectNext(this.chainTail(first), rest);
      return first ?? rest;
    }
    body.forEach((child) => visitOutsideLoops(child, (node) => {
      if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && !ts.isSwitchStatement(node.parent)) {
        this.unsupported(node, "break / continue inside a try block with catch is not supported");
      }
    }));
    const n = ++this.helperCount;
    const flag = `__thrown${n}`;
    const error = `__error${n}`;
    this.globalVariables.add(flag);
    this.globalVariables.add(error);
    const setNumber = (variable, value, parent) => {
      const id = this.addBlock({ type: "variables_set", parent_id: parent, fields: { variable } });
      this.connectInput(id, this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: String(value) }, is_output: true }), "value", "value");
      return id;
    };
    const resetId = setNumber(flag, 0, parentId);
    const wrapper = this.addBlock({ type: "repeat_n_times", parent_id: parentId });
    this.connectInput(wrapper, this.addBlock({ type: "math_number", parent_id: wrapper, fields: { NUM: "1" }, is_output: true }), "times", "value");
    this.tryStack.push({ flag, error, depth: this.loopDepth + 1 });
    let first;
    try {
      first = this.inLoop(() => this.compileStatementList(body, wrapper));
    } finally {
      this.tryStack.pop();
    }
    if (first) this.connectInput(wrapper, first, "DO", "statement");
    this.connectNext(resetId, wrapper);
    const ifId = this.addBlock({ type: "controls_if", parent_id: parentId });
    const cmp = this.addBlock({ type: "logic_compare", parent_id: ifId, fields: { OP: "EQ" }, is_output: true });
    this.connectInput(cmp, this.addBlock({ type: "variables_get", parent_id: cmp, fields: { variable: flag }, is_output: true }), "A", "value");
    this.connectInput(cmp, this.addBlock({ type: "math_number", parent_id: cmp, fields: { NUM: "1" }, is_output: true }), "B", "value");
    this.connectInput(ifId, cmp, "IF0", "value");
    const handler = [];
    const binding = statement.catchClause.variableDeclaration;
    if (binding) {
      if (!ts.isIdentifier(binding.name)) this.unsupported(binding, "catch needs a simple variable name");
      this.globalVariables.add(binding.name.text);
      const setE = this.addBlock({ type: "variables_set", parent_id: ifId, fields: { variable: binding.name.text } });
      this.connectInput(setE, this.addBlock({ type: "variables_get", parent_id: setE, fields: { variable: error }, is_output: true }), "value", "value");
      handler.push(setE);
    }
    handler.push(this.compileStatementList(Array.from(statement.catchClause.block.statements), ifId));
    const handlerIds = handler.filter(Boolean);
    for (let i = 1; i < handlerIds.length; i++) this.connectNext(this.chainTail(handlerIds[i - 1]), handlerIds[i]);
    if (handlerIds[0]) this.connectInput(ifId, handlerIds[0], "DO0", "statement");
    this.connectNext(wrapper, ifId);
    const rest = this.compileStatementList(finallyStatements, parentId);
    if (rest) this.connectNext(ifId, rest);
    return resetId;
  }

  compileThrow(statement, parentId) {
    const context = this.tryStack.at(-1);
    if (!context || this.loopDepth !== context.depth) {
      return this.addBlock({ type: "stop", parent_id: parentId });
    }
    // new Error(message) carries its message; anything else is thrown as is.
    let value = statement.expression;
    if (value && ts.isNewExpression(value) && ts.isIdentifier(value.expression) && /Error$/.test(value.expression.text)) {
      value = value.arguments?.[0] ?? ts.factory.createStringLiteral("");
    }
    const setError = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: context.error } });
    this.connectInput(setError, value ? this.compileExpression(value, setError)
      : this.addBlock({ type: "text", parent_id: setError, fields: { TEXT: "" }, is_output: true }), "value", "value");
    const setFlag = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: context.flag } });
    this.connectInput(setFlag, this.addBlock({ type: "math_number", parent_id: setFlag, fields: { NUM: "1" }, is_output: true }), "value", "value");
    const stop = this.addBlock({ type: "break", parent_id: parentId });
    this.connectNext(setError, setFlag);
    this.connectNext(setFlag, stop);
    return setError;
  }

  // C-style for -> traverse_number. That block counts toward `to` in either
  // direction, so a loop whose bounds may be reversed (zero iterations in
  // JS) is wrapped in `if (from <= to)` (or >= when counting down).
  compileNativeForStatement(statement, parentId) {
    const spec = this.nativeForLoopSpec(statement);
    const fromConst = constantNumber(spec.from);
    const toConst = constantNumber(spec.to);
    if (fromConst !== null && toConst !== null) {
      const last = spec.down ? toConst + (spec.exclusiveEnd ? 1 : 0) : toConst - (spec.exclusiveEnd ? 1 : 0);
      if (spec.down ? fromConst < last : fromConst > last) {
        return null;
      }
      return this.compileTraverseLoop(statement, spec, parentId);
    }
    const guardId = this.addBlock({ type: "controls_if", parent_id: parentId });
    const compareId = this.addBlock({
      type: "logic_compare",
      parent_id: guardId,
      fields: { OP: spec.down ? "GTE" : "LTE" },
      is_output: true,
    });
    this.connectInput(compareId, this.compileExpression(spec.from, compareId), "A", "value");
    this.connectInput(compareId, this.compileForLoopLimit(spec.to, compareId, spec.exclusiveEnd, spec.down), "B", "value");
    this.connectInput(guardId, compareId, "IF0", "value");
    this.connectInput(guardId, this.compileTraverseLoop(statement, spec, guardId), "DO0", "statement");
    return guardId;
  }

  compileTraverseLoop(statement, spec, parentId) {
    const id = this.addBlock({
      type: "traverse_number",
      parent_id: parentId,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>',
    });
    const paramId = this.addBlock({
      type: "traverse_number_param",
      parent_id: id,
      fields: { TEXT: spec.variable },
      is_output: true,
    });
    this.connectInput(id, paramId, "value", "value");

    const fromId = this.compileExpression(spec.from, id);
    const toId = this.compileForLoopLimit(spec.to, id, spec.exclusiveEnd, spec.down);
    const byId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: String(spec.step) },
      is_output: true,
    });
    this.connectInput(id, fromId, "from", "value");
    this.connectInput(id, toId, "to", "value");
    this.connectInput(id, byId, "by", "value");

    this.loopDepth += 1;
    this.rangeBindings.push(spec.variable);
    try {
      const firstChild = this.compileLoopBody(this.statementBodyStatements(statement.statement), id);
      if (firstChild) {
        this.connectInput(id, firstChild, "DO", "statement");
      }
    } finally {
      this.rangeBindings.pop();
      this.loopDepth -= 1;
    }

    return id;
  }

  nativeForLoopSpec(statement) {
    if (!statement.initializer || !ts.isVariableDeclarationList(statement.initializer)) {
      this.unsupported(statement, "Only for loops with a let initializer are supported");
    }
    if (statement.initializer.declarations.length !== 1) {
      this.unsupported(statement.initializer, "Only one for loop variable is supported");
    }
    const declaration = statement.initializer.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      this.unsupported(declaration, "For loop variable must be initialized");
    }
    const variable = declaration.name.text;
    const condition = statement.condition;
    if (
      !condition ||
      !ts.isBinaryExpression(condition) ||
      !ts.isIdentifier(condition.left) ||
      condition.left.text !== variable
    ) {
      this.unsupported(statement, "For loop condition must compare the loop variable");
    }
    const { step, down } = this.nativeForLoopStep(statement.incrementor, variable);
    const kind = condition.operatorToken.kind;
    const allowed = down
      ? [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]
      : [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken];
    if (!allowed.includes(kind)) {
      this.unsupported(condition.operatorToken, down
        ? "Counting-down for loops need a > or >= condition"
        : "Counting-up for loops need a < or <= condition");
    }
    return {
      variable,
      from: declaration.initializer,
      to: condition.right,
      exclusiveEnd: kind === ts.SyntaxKind.LessThanToken || kind === ts.SyntaxKind.GreaterThanToken,
      step,
      down,
    };
  }

  // i++, ++i, i += k, i = i + k count up; i--, --i, i -= k, i = i - k count down.
  nativeForLoopStep(incrementor, variable) {
    const isVar = (node) => node && ts.isIdentifier(node) && node.text === variable;
    const positive = (node) => {
      const step = numericLiteralValue(node, this);
      if (step <= 0) {
        this.unsupported(node, "For loop step must be a positive number");
      }
      return step;
    };
    if (incrementor && (ts.isPostfixUnaryExpression(incrementor) || ts.isPrefixUnaryExpression(incrementor)) && isVar(incrementor.operand)) {
      if (incrementor.operator === ts.SyntaxKind.PlusPlusToken) return { step: 1, down: false };
      if (incrementor.operator === ts.SyntaxKind.MinusMinusToken) return { step: 1, down: true };
    }
    if (incrementor && ts.isBinaryExpression(incrementor) && isVar(incrementor.left)) {
      const op = incrementor.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusEqualsToken) return { step: positive(incrementor.right), down: false };
      if (op === ts.SyntaxKind.MinusEqualsToken) return { step: positive(incrementor.right), down: true };
      const right = incrementor.right;
      if (op === ts.SyntaxKind.EqualsToken && ts.isBinaryExpression(right) && isVar(right.left)) {
        if (right.operatorToken.kind === ts.SyntaxKind.PlusToken) return { step: positive(right.right), down: false };
        if (right.operatorToken.kind === ts.SyntaxKind.MinusToken) return { step: positive(right.right), down: true };
      }
    }
    this.unsupported(incrementor, "For loop step must be i++, i--, i += k, i -= k, i = i + k or i = i - k");
  }

  compileForLoopLimit(expression, parentId, exclusiveEnd, down = false) {
    if (!exclusiveEnd) {
      return this.compileExpression(expression, parentId);
    }
    const value = constantNumber(expression);
    if (value !== null) {
      return this.addBlock({
        type: "math_number",
        parent_id: parentId,
        fields: { NUM: String(down ? value + 1 : value - 1) },
        is_output: true,
      });
    }
    const id = this.addBlock({
      type: "math_arithmetic",
      parent_id: parentId,
      fields: { type: down ? "add" : "minus" },
      is_output: true,
    });
    const leftId = this.compileExpression(expression, id);
    const rightId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: "1" },
      is_output: true,
    });
    this.connectInput(id, leftId, "A", "value");
    this.connectInput(id, rightId, "B", "value");
    return id;
  }

  compileForRange(call, parentId) {
    const id = this.addBlock({
      type: "traverse_number",
      parent_id: parentId,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>',
    });
    const paramId = this.addBlock({
      type: "traverse_number_param",
      parent_id: id,
      fields: { TEXT: stringLiteralValue(call.arguments[0], this) },
      is_output: true,
    });
    this.connectInput(id, paramId, "value", "value");

    const fromId = this.compileExpression(call.arguments[1], id);
    const toId = this.compileExpression(call.arguments[2], id);
    const byId = this.compileExpression(call.arguments[3], id);
    this.connectInput(id, fromId, "from", "value");
    this.connectInput(id, toId, "to", "value");
    this.connectInput(id, byId, "by", "value");

    const body = callbackBody(call.arguments[4], this);
    const firstChild = this.inLoop(() => this.compileLoopBody(body, id));
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }
    return id;
  }

  compileStatementBlock(call, parentId, type, callbackIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
    });
    const body = callbackBody(call.arguments[callbackIndex], this);
    const firstChild = this.compileStatementList(body, id);
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }
    return id;
  }

  compileBroadcast(call, parentId, waitForReceivers) {
    if (!waitForReceivers && call.arguments.length >= 2) {
      return this.compileBroadcastWithParam(call, parentId);
    }

    const id = this.addBlock({
      type: waitForReceivers ? "self_broadcast_and_wait" : "self_broadcast",
      parent_id: parentId,
    });
    const messageId = this.compileBroadcastMessage(call.arguments[0], id);
    this.connectInput(id, messageId, "message", "value");
    return id;
  }

  compileBroadcastWithParam(call, parentId) {
    const id = this.addBlock({
      type: "self_broadcast_with_param",
      parent_id: parentId,
    });
    const messageId = this.compileBroadcastMessage(call.arguments[0], id);
    this.connectInput(id, messageId, "message", "value");
    const paramId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, paramId, "param", "value");
    return id;
  }

  compileConsoleLog(call, parentId) {
    const id = this.addBlock({
      type: "console_log",
      parent_id: parentId,
    });
    const valueId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, valueId, "console_log", "value");
    return id;
  }

  compileProcedureCall(call, parentId, returnsValue) {
    const procedureName = stringLiteralValue(call.arguments[0], this);
    const spec = this.lookupProcedureSpec(call, procedureName);
    return this.compileProcedureCallArgs(spec, call.arguments.slice(1), parentId, returnsValue);
  }

  compileProcedureCallArgs(spec, args, parentId, returnsValue) {
    const id = this.addBlock({
      type: returnsValue ? "procedures_2_callreturn" : "procedures_2_callnoreturn",
      parent_id: parentId,
      fields: { NAME: spec.id },
      mutation: procedureCallMutation(spec),
      shadows: {
        NAME: "",
        ...procedureCallShadows(spec.params),
      },
      ...(returnsValue ? { is_output: true } : {}),
    });

    let valueArgumentIndex = 0;
    spec.params.forEach((param, paramIndex) => {
      if (param.type !== "String") {
        return;
      }
      const argument = args[valueArgumentIndex];
      valueArgumentIndex += 1;
      if (!argument) {
        return;
      }
      const valueId = this.compileExpression(argument, id);
      this.connectInput(id, valueId, param.id, "value");
    });
    return id;
  }

  compileReturnValue(call, parentId) {
    const id = this.addReturnValueBlock(parentId);
    const valueId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, valueId, "VALUE", "value");
    return id;
  }

  lookupProcedureSpec(node, name) {
    const spec = this.procedureSpecs.get(name);
    if (!spec) {
      this.unsupported(node, `Unknown procedure: ${name}`);
    }
    return spec;
  }

  compileTell(call, parentId, waitForReceiver) {
    const id = this.addBlock({
      type: waitForReceiver ? "sync_tell" : "tell",
      parent_id: parentId,
      fields: { sprite: stringLiteralValue(call.arguments[0], this) },
    });
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.compileStatementList(body, id);
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }
    return id;
  }

  compileStop(call, parentId) {
    return this.addBlock({
      type: "stop",
      parent_id: parentId,
      // No argument stops the current script, as documented.
      fields: { scope: call.arguments.length ? stringLiteralValue(call.arguments[0], this) : "1" },
    });
  }

  compileValueStatement(call, parentId, type, inputName, argumentIndex) {
    return this.compileValueExpressionStatement(parentId, type, inputName, call.arguments[argumentIndex]);
  }

  compileValueExpressionStatement(parentId, type, inputName, expression) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
    });
    const valueId = this.compileExpression(expression, id);
    this.connectInput(id, valueId, inputName, "value");
    return id;
  }

  compileValueStatementWithFields(call, parentId, type, inputName, argumentIndex, fields) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
      fields,
    });
    const valueId = this.compileExpression(call.arguments[argumentIndex], id);
    this.connectInput(id, valueId, inputName, "value");
    return id;
  }

  compileSignedValueStatement(call, parentId, type, inputName, argumentIndex, extraFields = {}) {
    const change = numericLiteralValue(call.arguments[argumentIndex], this);
    const id = this.addBlock({
      type,
      parent_id: parentId,
      fields: {
        ...extraFields,
        increase: change < 0 ? "decrease" : "increase",
      },
    });
    const valueId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: String(Math.abs(change)) },
      is_output: true,
    });
    this.connectInput(id, valueId, inputName, "value");
    return id;
  }

  compileFieldStatement(parentId, type, fields) {
    return this.addBlock({
      type,
      parent_id: parentId,
      fields,
    });
  }

  compileDialog(call, parentId, dialogType, timed) {
    const id = this.addBlock({
      type: timed ? "self_dialog" : "self_dialog_wait",
      parent_id: parentId,
      fields: { type: dialogType },
    });
    const textId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, textId, "text", "value");
    if (timed) {
      if (call.arguments.length > 1) {
        const timeId = this.compileExpression(call.arguments[1], id);
        this.connectInput(id, timeId, "time", "value");
      } else {
        const timeId = this.addBlock({
          type: "math_number",
          parent_id: id,
          fields: { NUM: "2" },
          is_output: true,
        });
        this.connectInput(id, timeId, "time", "value");
      }
    }
    return id;
  }

  compileStageDialog(call, parentId) {
    const id = this.addBlock({
      type: "create_stage_dialog",
      parent_id: parentId,
      fields: { sprite: stringLiteralValue(call.arguments[0], this) },
    });
    const textId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, textId, "text", "value");
    return id;
  }

  compileStampText(call, parentId) {
    const id = this.addBlock({
      type: "stamp",
      parent_id: parentId,
      fields: { align: stringLiteralValue(call.arguments[2], this) },
    });
    const textId = this.compileExpression(call.arguments[0], id);
    const sizeId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, textId, "text", "value");
    this.connectInput(id, sizeId, "size", "value");
    return id;
  }

  compileAskChoice(call, parentId) {
    const choiceCount = Math.max(0, call.arguments.length - 1);
    const id = this.addBlock({
      type: "ask_and_choose",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${choiceCount}"></mutation>`,
    });
    const questionId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, questionId, "question", "value");
    for (let index = 0; index < choiceCount; index += 1) {
      const choiceId = this.compileExpression(call.arguments[index + 1], id);
      this.connectInput(id, choiceId, `CHOICE${index}`, "value");
    }
    return id;
  }

  compileResourceInputStatement(call, parentId, type, inputName, resourceType, fieldName, argumentIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
    });
    const argument = call.arguments[argumentIndex];
    const valueId = ts.isStringLiteral(argument) ? this.compileResourceShadow(
      resourceType,
      fieldName,
      argument.text,
      id,
    ) : this.compileExpression(argument, id);
    this.connectInput(id, valueId, inputName, "value");
    return id;
  }

  compileListAppend(call, parentId) {
    return this.compileListAppendByArgs(parentId, call.arguments[0], call.arguments[1]);
  }

  compileListAppendByArgs(parentId, listNameArg, valueArg) {
    const id = this.addBlock({ type: "list_append", parent_id: parentId });
    const valueId = this.compileExpression(valueArg, id);
    this.connectInput(id, valueId, "list_item_value", "value");
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    return id;
  }

  compileListInsert(call, parentId) {
    return this.compileListInsertByArgs(parentId, call.arguments[0], call.arguments[1], call.arguments[2]);
  }

  compileListInsertByArgs(parentId, listNameArg, indexArg, valueArg) {
    const id = this.addBlock({ type: "list_insert_value", parent_id: parentId });
    const valueId = this.compileExpression(valueArg, id);
    const indexId = this.compileExpression(indexArg, id);
    this.connectInput(id, valueId, "list_item_value", "value");
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    this.connectInput(id, indexId, "list_index", "value");
    return id;
  }

  compileListReplace(call, parentId) {
    return this.compileListReplaceByArgs(
      parentId,
      call.arguments[0],
      call.arguments[1],
      call.arguments[2],
      call.arguments[3],
    );
  }

  compileListReplaceByArgs(parentId, listNameArg, itemArg, indexArg, valueArg) {
    const id = this.addBlock({
      type: "replace_list_item",
      parent_id: parentId,
      fields: { item: stringLiteralValue(itemArg, this) },
    });
    const indexId = this.compileExpression(indexArg, id);
    const valueId = this.compileExpression(valueArg, id);
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    this.connectInput(id, indexId, "list_index", "value");
    this.connectInput(id, valueId, "list_item_value", "value");
    return id;
  }

  compileListDelete(call, parentId) {
    return this.compileListDeleteByArgs(parentId, call.arguments[0], call.arguments[1], call.arguments[2]);
  }

  compileListDeleteByArgs(parentId, listNameArg, itemArg, indexArg) {
    const mode = stringLiteralValue(itemArg, this);
    const id = this.addBlock({
      type: "delete_list_item",
      parent_id: parentId,
      fields: { item: mode },
    });
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    if (mode !== "all") {
      const indexId = this.compileExpression(indexArg, id);
      this.connectInput(id, indexId, "list_index", "value");
    }
    return id;
  }

  compileListCopy(call, parentId) {
    return this.compileListCopyByArgs(parentId, call.arguments[0], call.arguments[1]);
  }

  compileListCopyByArgs(parentId, listNameArg, targetNameArg) {
    const id = this.addBlock({ type: "list_copy", parent_id: parentId });
    if (ts.isStringLiteral(listNameArg)) {
      this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    } else {
      this.connectInput(id, this.compileExpression(listNameArg, id), "list", "value");
    }
    this.connectListInput(id, "target_list", stringLiteralValue(targetNameArg, this));
    return id;
  }

  compileMoveTo(call, parentId, type, firstArgumentIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
    });
    const xId = this.compileExpression(call.arguments[firstArgumentIndex], id);
    const yId = this.compileExpression(call.arguments[firstArgumentIndex + 1], id);
    this.connectInput(id, xId, "x", "value");
    this.connectInput(id, yId, "y", "value");
    return id;
  }

  compileGlideTo(call, parentId) {
    const id = this.addBlock({
      type: "self_glide_to",
      parent_id: parentId,
    });
    const timeId = this.compileExpression(call.arguments[0], id);
    const xId = this.compileExpression(call.arguments[1], id);
    const yId = this.compileExpression(call.arguments[2], id);
    this.connectInput(id, timeId, "time", "value");
    this.connectInput(id, xId, "x", "value");
    this.connectInput(id, yId, "y", "value");
    return id;
  }

  compileCoordinateChange(call, parentId, type, valueArgumentIndex, timeArgumentIndex) {
    const change = numericLiteralValue(call.arguments[valueArgumentIndex], this);
    const id = this.addBlock({
      type,
      parent_id: parentId,
      fields: {
        increase: change < 0 ? "decrease" : "increase",
      },
    });

    if (type === "self_glide_coordinate_x" || type === "self_glide_coordinate_y") {
      const timeId = this.compileExpression(call.arguments[timeArgumentIndex], id);
      this.connectInput(id, timeId, "time", "value");
    }

    const valueId = this.addBlock({
      type: "math_number",
      parent_id: id,
      fields: { NUM: String(Math.abs(change)) },
      is_output: true,
    });
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileRotateAround(call, parentId) {
    const id = this.addBlock({
      type: "self_rotate_around",
      parent_id: parentId,
      fields: { sprite: stringLiteralValue(call.arguments[0], this) },
    });
    const degreesId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, degreesId, "degrees", "value");
    return id;
  }

  compileActorFieldStatement(call, parentId, type, fieldName) {
    return this.addBlock({
      type,
      parent_id: parentId,
      fields: { [fieldName]: stringLiteralValue(call.arguments[0], this) },
    });
  }

  compileExpression(expression, parentId) {
    const id = this.compileExpressionUnfolded(expression, parentId);
    this.foldPureNumber(id);
    return id;
  }

  // Fold after inline expansion, so imported wrappers and local bindings work
  // exactly like direct builtins. Only an explicit pure numeric whitelist is used.
  foldPureNumber(id) {
    const block = this.blocks[id];
    const children = Object.entries(this.connections[id] ?? {});
    const args = {};
    for (const [childId, connection] of children) {
      if (connection.type !== "input") return;
      const child = this.blocks[childId];
      if (child?.type !== "math_number") return;
      const value = Number(child.fields.NUM);
      if (!Number.isFinite(value)) return;
      args[connection.input_name] = value;
    }
    let value;
    const op = block.fields?.type;
    if (block.type === "math_arithmetic" && args.A !== undefined && args.B !== undefined) {
      switch (op) {
        case "add": value = args.A + args.B; break;
        case "minus": case "subtract": value = args.A - args.B; break;
        case "multiply": value = args.A * args.B; break;
        case "divide": if (args.B !== 0) value = args.A / args.B; break;
        case "power": value = args.A ** args.B; break;
      }
    } else if (block.type === "math_modulo" && args.A >= 0 && args.B > 0) {
      // Negative remainder semantics differ across runtimes; retain those blocks.
      value = args.A % args.B;
    } else if (block.type === "math_round" && args.num !== undefined) {
      if (op === "round_down") value = Math.floor(args.num);
      if (op === "round_up") value = Math.ceil(args.num);
    } else if (block.type === "math_function" && args.num !== undefined) {
      if (op === "1") value = Math.abs(args.num);
      if (op === "2") value = -args.num;
    }
    if (!Number.isFinite(value) || Object.is(value, -0)) return;
    block.type = "math_number";
    block.fields = { NUM: String(value) };
    delete block.inputs;
    delete block.mutation;
    delete this.connections[id];
    for (const [childId] of children) {
      delete this.blocks[childId];
      delete this.connections[childId];
      delete this.sourceMap[childId];
    }
  }

  compileExpressionUnfolded(expression, parentId) {
    if (!expression) {
      this.unsupported(expression, "Missing expression");
    }
    if (ts.isIdentifier(expression)) {
      const boundExpression = this.lookupExpressionBinding(expression.text);
      if (boundExpression) {
        return this.compileExpression(boundExpression, parentId);
      }
      if (this.functionParams?.has(expression.text)) {
        return this.compileParameterGet(expression.text, parentId, expression);
      }
      if (this.lookupRangeBinding(expression.text)) {
        return this.addBlock({
          type: "traverse_number_value",
          parent_id: parentId,
          fields: { TEXT: expression.text },
          is_output: true,
        });
      }
      if (this.globalVariables.has(expression.text)) {
        return this.addBlock({
          type: "variables_get",
          parent_id: parentId,
          fields: { variable: expression.text },
          is_output: true,
        });
      }
      this.unsupported(expression, `Unknown identifier: ${expression.text}`);
    }
    if (ts.isNumericLiteral(expression)) {
      return this.addBlock({
        type: "math_number",
        parent_id: parentId,
        fields: { NUM: expression.text },
        is_output: true,
      });
    }
    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      return this.addBlock({
        type: "math_number",
        parent_id: parentId,
        fields: { NUM: `-${expression.operand.text}` },
        is_output: true,
      });
    }
    if (ts.isStringLiteral(expression)) {
      return this.addBlock({
        type: "text",
        parent_id: parentId,
        fields: { TEXT: expression.text },
        is_output: true,
      });
    }
    if (ts.isTemplateExpression(expression)) {
      return this.compileTemplateExpression(expression, parentId);
    }
    if (ts.isNoSubstitutionTemplateLiteral(expression)) {
      return this.addBlock({
        type: "text",
        parent_id: parentId,
        fields: { TEXT: expression.text },
        is_output: true,
      });
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
      return this.addBlock({
        type: "logic_boolean",
        parent_id: parentId,
        fields: { BOOL: expression.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false" },
        is_output: true,
      });
    }
    if (ts.isCallExpression(expression)) {
      return this.compileExpressionCall(expression, parentId);
    }
    if (ts.isBinaryExpression(expression)) {
      return this.compileNativeBinaryExpression(expression, parentId);
    }
    if (ts.isParenthesizedExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isTypeAssertionExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isNonNullExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isConditionalExpression(expression)) {
      return this.compileConditionalExpression(expression, parentId);
    }
    if (ts.isPrefixUnaryExpression(expression)) {
      return this.compilePrefixUnaryExpression(expression, parentId);
    }
    if (ts.isPostfixUnaryExpression(expression)) {
      return this.compilePostfixUnaryExpression(expression, parentId);
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return this.compileArrayLiteralExpression(expression, parentId);
    }
    if (ts.isVoidExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isDeleteExpression(expression)) {
      return this.addBlock({
        type: "logic_boolean",
        parent_id: parentId,
        fields: { BOOL: "true" },
        is_output: true,
      });
    }
    if (ts.isAwaitExpression(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isSpreadElement(expression)) {
      return this.compileExpression(expression.expression, parentId);
    }
    if (ts.isPropertyAccessExpression(expression)) {
      return this.compilePropertyAccessExpression(expression, parentId);
    }
    if (ts.isElementAccessExpression(expression)) {
      return this.compileElementAccessExpression(expression, parentId);
    }
    if (ts.isTaggedTemplateExpression(expression)) {
      return this.compileExpression(expression.template, parentId);
    }
    if (ts.isRegularExpressionLiteral(expression)) {
      return this.addBlock({
        type: "text",
        parent_id: parentId,
        fields: { TEXT: expression.text },
        is_output: true,
      });
    }
    if (expression.kind === ts.SyntaxKind.BigIntLiteral) {
      return this.addBlock({
        type: "math_number",
        parent_id: parentId,
        fields: { NUM: expression.text.replace("n", "") },
        is_output: true,
      });
    }
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === "length") {
      return this.compileLength(expression.expression, parentId);
    }
    if (ts.isTypeOfExpression(expression)) {
      this.unsupported(expression, "typeof is not supported: Kitten N values have no runtime type tag");
    }
    if (ts.isNewExpression(expression)) {
      const what = expression.expression.getText?.() ?? "object";
      this.unsupported(expression, `new ${what}() is not supported: Kitten N has no objects (use variables, arrays or lists)`);
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return this.compileObjectLiteral(expression, parentId);
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword].includes(expression.operatorToken.kind)) {
      this.unsupported(expression.operatorToken, "in / instanceof are not supported: Kitten N has no objects");
    }
    this.unsupported(expression, "Unsupported expression");
  }

  compileExpressionCall(call, parentId) {
    const name = calleeName(call.expression);
    const factory = this.helperCalls.get(call);
    if (factory?.factoryArgs) return this.compileExpressionCall(ts.factory.createCallExpression(
      ts.factory.createIdentifier(factory.name), undefined, factory.factoryArgs), parentId);
    if (name === "Math.hypot") {
      // Inline sqrt(a² + b² + …) so no list is passed to a custom block (the
      // editor drops list reporters plugged into procedure arguments).
      const f = ts.factory;
      const square = arg => f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier("Math"), "pow"), undefined, [arg, f.createNumericLiteral(2)]);
      if (!call.arguments.length) return this.compileExpression(f.createNumericLiteral(0), parentId);
      const sum = call.arguments.map(square).reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.PlusToken, b));
      const replacement = f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier("Math"), "sqrt"), undefined, [sum]);
      return this.compileExpression(replacement, parentId);
    }
    if (this.globalHelpers?.has(name)) {
      const arity = name === "Math.atan2" ? 2 : 1;
      if (call.arguments.length !== arity) this.unsupported(call, `${name} expects ${arity} argument(s)`);
      if (name === "Number.isInteger" && (isStringExpression(call.arguments[0]) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(call.arguments[0].kind))) {
        return this.compileExpression(ts.factory.createFalse(), parentId);
      }
      return this.compileExpressionCall(ts.factory.createCallExpression(ts.factory.createIdentifier(this.globalHelpers.get(name)), undefined,
        call.arguments), parentId);
    }
    const timer = this.helperCalls.get(call);
    if (timer?.timer) {
      const replacement = ts.factory.createCallExpression(ts.factory.createIdentifier(timer.name), undefined,
        [call.arguments[1] ?? ts.factory.createNumericLiteral(0)]);
      return this.compileExpressionCall(replacement, parentId);
    }
    if (name?.startsWith("Math.")) {
      return this.compileMathCall(call, name.slice(5), parentId);
    }
    if (["Number", "parseFloat", "String", "parseInt"].includes(name)) {
      const convert = (parent) => {
        const id = this.addBlock({ type: "convert_type", parent_id: parent, fields: { type: name === "String" ? "string" : "number" }, is_output: true });
        this.connectInput(id, this.compileExpression(call.arguments[0], id), "text", "value");
        return id;
      };
      if (name !== "parseInt") return convert(parentId);
      // parseInt: integer part (toward zero) of the numeric value.
      return this.compileTruncate(convert, parentId);
    }
    if (isMemberCallName(name, "getVar")) {
      return this.compileVariableGet(parentId, call.arguments[0]);
    }
    const variableHandleCall = selfVariableHandleCall(call);
    if (variableHandleCall?.methodName === "get") {
      return this.compileVariableGet(parentId, variableHandleCall.nameArg);
    }
    const listHandleCall = selfListHandleCall(call);
    if (listHandleCall) {
      switch (listHandleCall.methodName) {
        case "get":
          return this.compileListGetByNameArg(parentId, listHandleCall.nameArg);
        case "item":
          return this.compileListItemByArgs(parentId, listHandleCall.nameArg, call.arguments[0], call.arguments[1]);
        case "length":
          return this.compileListUnaryExpressionByNameArg(parentId, "list_length", listHandleCall.nameArg);
        case "indexOf":
          return this.compileListValueExpressionByArgs(parentId, "list_index_of", listHandleCall.nameArg, call.arguments[0]);
        case "contains":
          return this.compileListValueExpressionByArgs(parentId, "list_is_exist", listHandleCall.nameArg, call.arguments[0]);
      }
    }
    // Methods on ordinary values (a.join(), s.trim()) before DSL names, so
    // `a.slice(1).join("")` is not read as the join() block.
    if (isValueMethodCall(call)) {
      const method = this.compileMethodCall(call, parentId);
      if (method) return method;
    }
    switch (selfApiName(name)) {
      case "getVar":
        return this.compileVariableGet(parentId, call.arguments[0]);
      case "scriptVar":
        return this.addBlock({
          type: "script_variables_value",
          parent_id: parentId,
          fields: { TEXT: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "messageValue":
        return this.addBlock({
          type: "self_listen_value",
          parent_id: parentId,
          fields: { TEXT: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "param":
        return this.compileParameterGet(stringLiteralValue(call.arguments[0], this), parentId, call);
      case "actorParam":
        return this.addBlock({
          type: "procedures_2_actor_param",
          parent_id: parentId,
          fields: {
            param_name: stringLiteralValue(call.arguments[0], this),
            attribute: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "callReporter":
        return this.compileProcedureCall(call, parentId, true);
      case "receivedBroadcast":
        return this.compileReceivedBroadcast(call, parentId);
      case "bumpActorValue":
        return this.addBlock({
          type: "on_bump_actor_value",
          parent_id: parentId,
          fields: {
            TEXT: stringLiteralValue(call.arguments[0], this),
            attribute: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "rangeValue":
        return this.addBlock({
          type: "traverse_number_value",
          parent_id: parentId,
          fields: { TEXT: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "xOf":
        return this.compileCoordinateOfSprite(call, parentId, "x");
      case "yOf":
        return this.compileCoordinateOfSprite(call, parentId, "y");
      case "distanceTo":
        return this.addBlock({
          type: "distance_to",
          parent_id: parentId,
          fields: { sprite: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "orientation":
        return this.addBlock({
          type: "get_orientation",
          parent_id: parentId,
          fields: { target: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "styleOf":
        return this.addBlock({
          type: "style_of_sprite",
          parent_id: parentId,
          fields: { sprite: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
      case "appearanceOf":
        return this.addBlock({
          type: "appearance_of_sprite",
          parent_id: parentId,
          fields: {
            sprite: stringLiteralValue(call.arguments[0], this),
            appearance: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "effectOf":
        return this.addBlock({
          type: "effect_of_sprite",
          parent_id: parentId,
          fields: {
            sprite: stringLiteralValue(call.arguments[0], this),
            effect: effectCode(stringLiteralValue(call.arguments[1], this)),
          },
          is_output: true,
        });
      case "keyPressed":
        return this.addBlock({
          type: "check_key",
          parent_id: parentId,
          fields: {
            key: keyboardCode(stringLiteralValue(call.arguments[0], this)),
            type: call.arguments[1] ? stringLiteralValue(call.arguments[1], this) : "down",
          },
          is_output: true,
        });
      case "mouseTrigger":
        return this.compileMouseTrigger(call, parentId);
      case "mouseX":
        return this.compileFieldOutput(parentId, "get_mouse_info", { type: "x" });
      case "mouseY":
        return this.compileFieldOutput(parentId, "get_mouse_info", { type: "y" });
      case "answer":
        return this.addBlock({ type: "get_answer", parent_id: parentId, is_output: true });
      case "choiceValue":
        return this.compileFieldOutput(parentId, "get_choice_and_index", {
          type: stringLiteralValue(call.arguments[0], this),
        });
      case "timerValue":
        return this.addBlock({ type: "timer", parent_id: parentId, is_output: true });
      case "timeNow":
        return this.compileFieldOutput(parentId, "get_time", {
          time: stringLiteralValue(call.arguments[0], this),
        });
      case "stageInfo":
        return this.compileFieldOutput(parentId, "get_stage_info", {
          type: stringLiteralValue(call.arguments[0], this),
        });
      case "touching":
        return this.addBlock({
          type: "bump_into",
          parent_id: parentId,
          fields: {
            sprite: stringLiteralValue(call.arguments[0], this),
            sprite1: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "touchingColor":
        return this.addBlock({
          type: "bump_into_color",
          parent_id: parentId,
          fields: {
            sprite: stringLiteralValue(call.arguments[0], this),
            color: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "outOfBoundary":
        return this.compileFieldOutput(parentId, "out_of_boundary", {
          boundary: stringLiteralValue(call.arguments[0], this),
        });
      case "cloneCount":
        return this.compileFieldOutput(parentId, "get_clone_num", {
          sprite: stringLiteralValue(call.arguments[0], this),
        });
      case "currentCloneIndex":
        return this.addBlock({
          type: "get_current_clone_index",
          parent_id: parentId,
          is_output: true,
        });
      case "cloneProperty":
        return this.compileCloneProperty(call, parentId);
      case "touchingBodyPart":
        return this.addBlock({
          type: "bump_into_body_part",
          parent_id: parentId,
          fields: {
            sprite: stringLiteralValue(call.arguments[0], this),
            body_part: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "bodyPartAppearance":
        return this.addBlock({
          type: "get_appearance_of_part",
          parent_id: parentId,
          fields: {
            body_part: stringLiteralValue(call.arguments[0], this),
            appearance: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "faceTiltAngle":
        return this.addBlock({
          type: "get_tilt_angle_of_face",
          parent_id: parentId,
          is_output: true,
        });
      case "getList":
        return this.compileListGetByNameArg(parentId, call.arguments[0]);
      case "listItem":
        return this.compileListItem(call, parentId);
      case "listLength":
        return this.compileListUnaryExpression(call, parentId, "list_length", 0);
      case "listIndexOf":
        return this.compileListValueExpression(call, parentId, "list_index_of", 0, 1);
      case "listContains":
        return this.compileListValueExpression(call, parentId, "list_is_exist", 0, 1);
      case "tempList":
        return this.compileTempList(call, parentId);
      case "eq":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "logic_compare",
          fields: { OP: "EQ" },
          leftInput: "A",
          rightInput: "B",
        });
      case "neq":
        return this.compileCompare(call, parentId, "NEQ");
      case "gt":
        return this.compileCompare(call, parentId, "GT");
      case "gte":
        return this.compileCompare(call, parentId, "GTE");
      case "lt":
        return this.compileCompare(call, parentId, "LT");
      case "lte":
        return this.compileCompare(call, parentId, "LTE");
      case "and":
        return this.compileLogicOperation(call, parentId, "and");
      case "or":
        return this.compileLogicOperation(call, parentId, "or");
      case "not":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "logic_negate",
          input: "logic",
        });
      case "bool":
        return this.compileBoolean(call, parentId);
      case "add":
        return this.compileArithmetic(call, parentId, "add");
      case "sub":
        return this.compileArithmetic(call, parentId, "minus");
      case "mul":
        return this.compileArithmetic(call, parentId, "multiply");
      case "pow":
        return this.compileArithmetic(call, parentId, "power");
      case "mod":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "math_modulo",
          leftInput: "A",
          rightInput: "B",
        });
      case "randInt":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "random_num",
          leftInput: "A",
          rightInput: "B",
        });
      case "divisibleBy":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "divisible_by",
          leftInput: "A",
          rightInput: "B",
        });
      case "div":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "math_arithmetic",
          fields: { type: "divide" },
          leftInput: "A",
          rightInput: "B",
        });
      case "floor":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_round",
          fields: { type: "round_down" },
          input: "num",
        });
      case "round":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_round",
          fields: { type: "round" },
          input: "num",
        });
      case "ceil":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_round",
          fields: { type: "round_up" },
          input: "num",
        });
      case "numberProperty":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_number_property",
          fields: { type: stringLiteralValue(call.arguments[1], this) },
          input: "num",
        });
      case "mathFunc":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_function",
          fields: { type: mathFunctionCode(stringLiteralValue(call.arguments[0], this)) },
          input: "num",
          argumentIndex: 1,
        });
      case "trig":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "math_trig",
          fields: { type: stringLiteralValue(call.arguments[0], this) },
          input: "num",
          argumentIndex: 1,
        });
      case "join":
        return this.compileJoin(call, parentId);
      case "toString":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "convert_type",
          fields: { type: "string" },
          input: "text",
        });
      case "toNumber":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "convert_type",
          fields: { type: "number" },
          input: "text",
        });
      case "toBoolean":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "convert_type",
          fields: { type: "boolean" },
          input: "text",
        });
      case "length":
        return this.compileUnaryExpressionCall(call, parentId, {
          type: "text_length",
          input: "text",
        });
      case "selectText":
        return this.compileTextSelect(call, parentId);
      case "splitText":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "text_split",
          leftInput: "TEXT_TO_SPLIT",
          rightInput: "SPLIT_TEXT",
        });
      case "contains":
        return this.compileBinaryExpressionCall(call, parentId, {
          type: "text_contain",
          leftInput: "A",
          rightInput: "B",
        });
      default: {
        const method = this.compileMethodCall(call, parentId);
        if (method) return method;
      }
        if (this.functionProcedures.has(name)) {
          return this.compileFunctionProcedureCall(call, parentId, true);
        }
        if (this.inlineFunctions.has(name)) {
          return this.compileInlineExpressionFunction(call, parentId, name);
        }
        this.unsupported(call, `Unsupported expression call: ${name || "<unknown>"}`);
    }
  }

  // Math.* follows the official converter: trig in radians (math_trig_rad),
  // abs/sqrt/log/exp via math_function, rounding via math_round.
  compileMathCall(call, method, parentId) {
    const args = call.arguments;
    const unary = (type, fields, argument = args[0]) => (parent) => {
      const id = this.addBlock({ type, parent_id: parent, fields, is_output: true });
      this.connectInput(id, typeof argument === "function" ? argument(id) : this.compileExpression(argument, id), "num", "value");
      return id;
    };
    const arity = (n) => {
      if (args.length !== n) this.unsupported(call, `Math.${method} expects ${n} argument${n === 1 ? "" : "s"}`);
    };
    switch (method) {
      case "floor": case "ceil": case "round":
        arity(1);
        return unary("math_round", { type: { floor: "round_down", ceil: "round_up", round: "round" }[method] })(parentId);
      case "abs": case "sqrt": case "exp": case "log": case "log10":
        arity(1);
        return unary("math_function", { type: mathFunctionCode({ log: "ln", log10: "log" }[method] ?? method) })(parentId);
      case "sin": case "cos": case "tan": case "asin": case "acos": case "atan":
        arity(1);
        return unary("math_trig_rad", { type: method })(parentId);
      case "trunc":
        arity(1);
        return this.compileTruncate((parent) => this.compileExpression(args[0], parent), parentId);
      case "pow": {
        arity(2);
        const id = this.addBlock({ type: "math_arithmetic", parent_id: parentId, fields: { type: "power" }, is_output: true });
        this.connectInput(id, this.compileExpression(args[0], id), "A", "value");
        this.connectInput(id, this.compileExpression(args[1], id), "B", "value");
        return id;
      }
      case "max": case "min": {
        if (args.length < 1) this.unsupported(call, `Math.${method} needs at least one argument`);
        const pick = (items, parent) => {
          if (items.length === 1) return this.compileExpression(items[0], parent);
          // a > b ? a : b  (operands are evaluated twice; keep them side-effect free)
          const id = this.addBlock({ type: "logic_ternary", parent_id: parent, is_output: true });
          const cmp = this.addBlock({ type: "logic_compare", parent_id: id, fields: { OP: method === "max" ? "GT" : "LT" }, is_output: true });
          this.connectInput(cmp, this.compileExpression(items[0], cmp), "A", "value");
          this.connectInput(cmp, pick(items.slice(1), cmp), "B", "value");
          this.connectInput(id, cmp, "condition", "value");
          this.connectInput(id, this.compileExpression(items[0], id), "ifTrue", "value");
          this.connectInput(id, pick(items.slice(1), id), "ifFalse", "value");
          return id;
        };
        return pick(Array.from(args), parentId);
      }
      case "random": {
        arity(0);
        // random_num returns integers: draw 0..999999999 and scale to [0, 1).
        const id = this.addBlock({ type: "math_arithmetic", parent_id: parentId, fields: { type: "divide" }, is_output: true });
        const rand = this.addBlock({ type: "random_num", parent_id: id, is_output: true });
        this.connectInput(rand, this.addBlock({ type: "math_number", parent_id: rand, fields: { NUM: "0" }, is_output: true }), "A", "value");
        this.connectInput(rand, this.addBlock({ type: "math_number", parent_id: rand, fields: { NUM: "999999999" }, is_output: true }), "B", "value");
        this.connectInput(id, rand, "A", "value");
        this.connectInput(id, this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: "1000000000" }, is_output: true }), "B", "value");
        return id;
      }
      default:
        this.unsupported(call, `Unsupported Math function: Math.${method}`);
    }
  }

  // Rounds toward zero: x < 0 ? ceil(x) : floor(x). `value(parent)` builds x.
  compileTruncate(value, parentId) {
    const id = this.addBlock({ type: "logic_ternary", parent_id: parentId, is_output: true });
    const cmp = this.addBlock({ type: "logic_compare", parent_id: id, fields: { OP: "LT" }, is_output: true });
    this.connectInput(cmp, value(cmp), "A", "value");
    this.connectInput(cmp, this.addBlock({ type: "math_number", parent_id: cmp, fields: { NUM: "0" }, is_output: true }), "B", "value");
    this.connectInput(id, cmp, "condition", "value");
    for (const [input, type] of [["ifTrue", "round_up"], ["ifFalse", "round_down"]]) {
      const round = this.addBlock({ type: "math_round", parent_id: id, fields: { type }, is_output: true });
      this.connectInput(round, value(round), "num", "value");
      this.connectInput(id, round, input, "value");
    }
    return id;
  }

  compileVariableGet(parentId, nameArg) {
    return this.addBlock({
      type: "variables_get",
      parent_id: parentId,
      fields: { variable: stringLiteralValue(nameArg, this) },
      is_output: true,
    });
  }

  compileInlineExpressionFunction(call, parentId, name) {
    return this.withInlineFunctionCall(call, name, () => {
      const fn = this.inlineFunctions.get(name);
      if (!ts.isBlock(fn.body)) {
        return this.compileExpression(fn.body, parentId);
      }
      const statements = Array.from(fn.body.statements);
      return this.compileInlineExpressionFunctionBlock(call, parentId, name, statements);
    });
  }

  compileInlineExpressionFunctionBlock(call, parentId, name, statements) {
    const returnStatement = statements.at(-1);
    if (!returnStatement || !ts.isReturnStatement(returnStatement) || !returnStatement.expression) {
      this.unsupported(call, `Expression function ${name} must end with a return expression`);
    }
    const localBindings = new Map();
    this.expressionBindings.push(localBindings);
    try {
      statements.slice(0, -1).forEach((statement) => {
        if (!ts.isVariableStatement(statement)) {
          this.unsupported(statement, `Expression function ${name} supports only local declarations before return`);
        }
        statement.declarationList.declarations.forEach((declaration) => {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            this.unsupported(declaration, "Inline function locals must be initialized simple names");
          }
          const localName = declaration.name.text;
          if (this.lookupExpressionBinding(localName)) {
            this.unsupported(declaration.name, `Inline function local shadowing is not supported: ${localName}`);
          }
          if (expressionContainsIdentifier(declaration.initializer, localName)) {
            this.unsupported(declaration.initializer, `Inline function local cannot reference itself: ${localName}`);
          }
          localBindings.set(localName, declaration.initializer);
        });
      });
      return this.compileExpression(returnStatement.expression, parentId);
    } finally {
      this.expressionBindings.pop();
    }
  }

  withInlineFunctionCall(call, name, compile) {
    if (this.inlineCallStack.includes(name)) {
      this.unsupported(call, `Recursive inline function calls are not supported: ${name}`);
    }
    const fn = this.inlineFunctions.get(name);
    const args = this.functionArguments(fn, call);
    const bindings = new Map();
    fn.params.forEach((param, index) => {
      bindings.set(param, args[index]);
    });
    this.inlineCallStack.push(name);
    this.expressionBindings.push(bindings);
    try {
      return compile();
    } finally {
      this.expressionBindings.pop();
      this.inlineCallStack.pop();
    }
  }

  lookupExpressionBinding(name) {
    for (let index = this.expressionBindings.length - 1; index >= 0; index -= 1) {
      const binding = this.expressionBindings[index].get(name);
      if (binding) {
        return binding;
      }
    }
    return null;
  }

  lookupRangeBinding(name) {
    for (let index = this.rangeBindings.length - 1; index >= 0; index -= 1) {
      if (this.rangeBindings[index] === name) {
        return true;
      }
    }
    return false;
  }

  compileCompare(call, parentId, operator) {
    return this.compileBinaryExpressionCall(call, parentId, {
      type: "logic_compare",
      fields: { OP: operator },
      leftInput: "A",
      rightInput: "B",
    });
  }

  compileReceivedBroadcast(call, parentId) {
    const id = this.addBlock({
      type: "received_broadcast",
      parent_id: parentId,
      is_output: true,
    });
    const messageId = this.compileBroadcastMessage(call.arguments[0], id);
    this.connectInput(id, messageId, "message", "value");
    return id;
  }

  compileLogicOperation(call, parentId, operator) {
    return this.compileBinaryExpressionCall(call, parentId, {
      type: "logic_operation",
      fields: { type: operator },
      leftInput: "A",
      rightInput: "B",
    });
  }

  compileArithmetic(call, parentId, operator) {
    return this.compileBinaryExpressionCall(call, parentId, {
      type: "math_arithmetic",
      fields: { type: operator },
      leftInput: "A",
      rightInput: "B",
    });
  }

  compileBoolean(call, parentId) {
    return this.addBlock({
      type: "logic_boolean",
      parent_id: parentId,
      fields: { BOOL: booleanLiteralValue(call.arguments[0], this) ? "true" : "false" },
      is_output: true,
    });
  }

  compileJoin(call, parentId) {
    const id = this.addBlock({
      type: "text_join",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${call.arguments.length}"></mutation>`,
      is_output: true,
    });
    call.arguments.forEach((argument, index) => {
      const childId = this.compileExpression(argument, id);
      this.connectInput(id, childId, `ADD${index}`, "value");
    });
    return id;
  }

  compileTextSelect(call, parentId) {
    const hasEnd = call.arguments.length > 2;
    const id = this.addBlock({
      type: "text_select",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${hasEnd ? 1 : 0}"></mutation>`,
      is_output: true,
    });
    const textId = this.compileExpression(call.arguments[0], id);
    const startId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, textId, "text", "value");
    this.connectInput(id, startId, "start_index", "value");
    if (hasEnd) {
      const endId = this.compileExpression(call.arguments[2], id);
      this.connectInput(id, endId, "end_index", "value");
    }
    return id;
  }

  compileBinaryExpressionCall(call, parentId, spec) {
    const id = this.addBlock({
      type: spec.type,
      parent_id: parentId,
      ...(spec.fields ? { fields: spec.fields } : {}),
      ...(spec.mutation ? { mutation: spec.mutation } : {}),
      is_output: true,
    });
    const leftId = this.compileExpression(call.arguments[0], id);
    const rightId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, leftId, spec.leftInput, "value");
    this.connectInput(id, rightId, spec.rightInput, "value");
    return id;
  }

  compileTemplateExpression(expression, parentId) {
    const parts = [];
    if (expression.head.text) parts.push({ text: expression.head.text });
    for (const span of expression.templateSpans) {
      parts.push({ expression: span.expression });
      if (span.literal.text) parts.push({ text: span.literal.text });
    }
    return this.compileTextJoin(parts, parentId);
  }

  // parts: [{ text }] literal pieces or [{ expression }] TS expressions.
  compileTextJoin(parts, parentId) {
    const id = this.addBlock({
      type: "text_join",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${parts.length}"></mutation>`,
      is_output: true,
    });
    parts.forEach((part, index) => {
      const childId = "text" in part
        ? this.addBlock({ type: "text", parent_id: id, fields: { TEXT: part.text }, is_output: true })
        : this.compileExpression(part.expression, id);
      this.connectInput(id, childId, `ADD${index}`, "value");
    });
    return id;
  }

  compilePropertyAccessExpression(expression, parentId) {
    const propertyName = expression.name.text;
    if (propertyName === "length" && (this.isArrayExpression(expression.expression) || isStringExpression(expression.expression))) {
      return this.compileLength(expression.expression, parentId);
    }
    if (ts.isIdentifier(expression.expression) && expression.expression.text === "Math") {
      const constants = { PI: Math.PI, E: Math.E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E };
      if (!(propertyName in constants)) {
        this.unsupported(expression.name, `Unsupported Math constant: Math.${propertyName}`);
      }
      return this.addBlock({ type: "math_number", parent_id: parentId, fields: { NUM: String(constants[propertyName]) }, is_output: true });
    }
    if (ts.isIdentifier(expression.expression) && this.enumValues.has(expression.expression.text)) {
      const members = this.enumValues.get(expression.expression.text);
      if (!members.has(propertyName)) {
        this.unsupported(expression.name, `Unknown enum member: ${expression.expression.text}.${propertyName}`);
      }
      const value = members.get(propertyName);
      return typeof value === "number"
        ? this.addBlock({ type: "math_number", parent_id: parentId, fields: { NUM: String(value) }, is_output: true })
        : this.addBlock({ type: "text", parent_id: parentId, fields: { TEXT: value }, is_output: true });
    }
    return this.compileObjectAccess(expression, parentId);
  }

  compileObjectLiteral(expression, parentId) {
    const id = this.addBlock({ type: "_object_literal", parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${expression.properties.length}"></mutation>`, is_output: true });
    expression.properties.forEach((property, index) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        this.unsupported(property, "Object methods, accessors and spread are not supported; use data properties");
      }
      const name = property.name;
      if (ts.isComputedPropertyName(name)) this.unsupported(name, "Computed literal keys are not supported; assign obj[key] after construction");
      const key = name.text;
      if (!key || key === "__proto__") this.unsupported(name, "Empty object keys and __proto__ are not supported by Kitten N object literals");
      const keyId = this.addBlock({ type: "text", parent_id: id, fields: { TEXT: key }, is_output: true });
      this.connectInput(id, keyId, `key${index}`, "value");
      this.connectInput(id, this.compileExpression(ts.isShorthandPropertyAssignment(property) ? name : property.initializer, id), `value${index}`, "value");
    });
    return id;
  }

  objectKey(expression) {
    return ts.isPropertyAccessExpression(expression) ? ts.factory.createStringLiteral(expression.name.text) : expression.argumentExpression;
  }

  compileObjectAccess(expression, parentId) {
    if (expression.questionDotToken) this.unsupported(expression, "Optional property access is not supported");
    const id = this.addBlock({ type: "_object_get", parent_id: parentId,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" computed="true"></mutation>', is_output: true });
    this.connectInput(id, this.compileExpression(expression.expression, id), "obj", "value");
    this.connectInput(id, this.compileExpression(this.objectKey(expression), id), "key", "value");
    return id;
  }

  compileObjectAssignment(expression, parentId) {
    const left = expression.left;
    const spec = assignmentOperatorSpec(expression.operatorToken.kind);
    // Cache reference components so objExpr()[keyExpr()] += rhs runs each once.
    const n = this.nextId;
    const obj = ts.factory.createIdentifier(`__objectTarget${n}`);
    const key = ts.factory.createIdentifier(`__objectKey${n}`);
    const assign = (target, value) => this.compileAssignmentExpression(ts.factory.createBinaryExpression(target, ts.SyntaxKind.EqualsToken, value), parentId);
    const first = assign(obj, left.expression);
    const second = assign(key, this.objectKey(left));
    this.connectNext(first, second);
    const id = this.addBlock({ type: "_object_set", parent_id: parentId,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" computed="true"></mutation>' });
    this.connectInput(id, this.compileExpression(obj, id), "obj", "value");
    this.connectInput(id, this.compileExpression(key, id), "key", "value");
    const operators = { add: ts.SyntaxKind.PlusToken, minus: ts.SyntaxKind.MinusToken, multiply: ts.SyntaxKind.AsteriskToken,
      divide: ts.SyntaxKind.SlashToken, mod: ts.SyntaxKind.PercentToken, power: ts.SyntaxKind.AsteriskAsteriskToken };
    const value = spec.kind === "assign" ? expression.right : ts.factory.createBinaryExpression(
      ts.factory.createElementAccessExpression(obj, key), operators[spec.operator], expression.right);
    this.connectInput(id, this.compileExpression(value, id), "value", "value");
    this.connectNext(second, id);
    return first;
  }

  compileElementAccessExpression(expression, parentId) {
    if (!this.isArrayExpression(expression.expression) && !isStringExpression(expression.expression)) {
      return this.compileObjectAccess(expression, parentId);
    }
    if (ts.isIdentifier(expression.expression) && ts.isStringLiteral(expression.argumentExpression)) {
      const varName = `${expression.expression.text}_${expression.argumentExpression.text}`;
      if (this.globalVariables.has(varName)) {
        return this.addBlock({
          type: "variables_get",
          parent_id: parentId,
          fields: { variable: varName },
          is_output: true,
        });
      }
    }
    // s[i] is a character; anything else is read as a list (a[i] -> item i + 1).
    const target = expression.expression;
    if (isStringExpression(target)) {
      const id = this.addBlock({
        type: "text_select",
        parent_id: parentId,
        mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>',
        is_output: true,
      });
      this.connectInput(id, this.compileExpression(target, id), "text", "value");
      this.connectInput(id, this.compilePlusOne(expression.argumentExpression, id), "start_index", "value");
      this.connectInput(id, this.compilePlusOne(expression.argumentExpression, id), "end_index", "value");
      return id;
    }
    const id = this.addBlock({ type: "list_item", parent_id: parentId, fields: { item: "any" }, is_output: true });
    this.connectInput(id, this.compileExpression(target, id), "list", "value");
    this.connectInput(id, this.compilePlusOne(expression.argumentExpression, id), "list_index", "value");
    return id;
  }

  // JS index (0-based) -> block position (1-based).
  compilePlusOne(node, parentId) {
    const value = constantNumber(node);
    if (value !== null) {
      return this.addBlock({ type: "math_number", parent_id: parentId, fields: { NUM: String(value + 1) }, is_output: true });
    }
    const id = this.addBlock({ type: "math_arithmetic", parent_id: parentId, fields: { type: "add" }, is_output: true });
    this.connectInput(id, this.compileExpression(node, id), "A", "value");
    this.connectInput(id, this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: "1" }, is_output: true }), "B", "value");
    return id;
  }

  isArrayExpression(node) {
    node = stripParens(node);
    if (this.helperCalls.get(node)?.factoryArgs) return true;
    if (ts.isArrayLiteralExpression(node)) return true;
    if (ts.isIdentifier(node)) return this.arrayVariables.has(node.text) || node.text.startsWith("__arr");
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (["map", "filter"].includes(method)) return true;
        if (["concat", "slice", "reverse", "sort"].includes(method) && this.isArrayExpression(node.expression.expression)) return true;
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "split") return true;
      return name === "splitText" || name === "tempList" || forOfListName(node) !== null && ts.isPropertyAccessExpression(node.expression);
    }
    return false;
  }

  compileLength(target, parentId) {
    if (this.isArrayExpression(target)) {
      const id = this.addBlock({ type: "list_length", parent_id: parentId, is_output: true });
      this.connectInput(id, this.compileExpression(target, id), "list", "value");
      return id;
    }
    const id = this.addBlock({ type: "text_length", parent_id: parentId, is_output: true });
    this.connectInput(id, this.compileExpression(target, id), "text", "value");
    return id;
  }

  // Statement-position method calls and internal list primitives used by the
  // helpers. Returns undefined when the call is not one of these.
  compileMethodStatement(call, parentId) {
    const name = calleeName(call.expression);
    const listBlock = (type, list, fields, inputs) => {
      const id = this.addBlock({ type, parent_id: parentId, ...(fields ? { fields } : {}) });
      this.connectInput(id, this.compileExpression(list, id), "list", "value");
      for (const [input, build] of inputs) this.connectInput(id, build(id), input, "value");
      return id;
    };
    const chainAll = (ids) => {
      ids = ids.filter(Boolean);
      for (let i = 1; i < ids.length; i++) this.connectNext(this.chainTail(ids[i - 1]), ids[i]);
      return ids[0] ?? null;
    };
    switch (name) {
      case "__listDelete":
        return listBlock("delete_list_item", call.arguments[0], { item: "any" }, [["list_index", (id) => this.compileExpression(call.arguments[1], id)]]);
      case "__listDeleteLast":
        return listBlock("delete_list_item", call.arguments[0], { item: "last" }, []);
    }
    if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
    const target = call.expression.expression;
    const method = call.expression.name.text;
    const synthesized = this.helperCalls.get(call);
    if (synthesized) {
      return this.compileHelperCall(synthesized.name, target, synthesized.extra, parentId, false);
    }
    if (!this.isArrayExpression(target)) {
      if (STRING_METHODS.has(method) || ["indexOf", "lastIndexOf", "startsWith", "endsWith", "includes", "slice", "split"].includes(method)) {
        this.unsupported(call, `${method}() returns a new value and does not change the string; use its result`);
      }
      return undefined;
    }
    const insertAt = (index, value) => listBlock("list_insert_value", target, null, [
      ["list_item_value", (id) => this.compileExpression(value, id)],
      ["list_index", (id) => index(id)],
    ]);
    const number = (value) => (id) => this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: String(value) }, is_output: true });
    switch (method) {
      case "unshift":
        return chainAll(Array.from(call.arguments).reverse().map((value) => insertAt(number(1), value)));
      case "splice": {
        const [start, count, ...items] = call.arguments;
        if (!start) this.unsupported(call, "splice needs a start index");
        const startValue = constantNumber(start);
        if (startValue !== null && startValue < 0) this.unsupported(start, "splice with a negative start is not supported");
        const ids = [];
        const deletes = this.addBlock({ type: "repeat_n_times", parent_id: parentId });
        this.connectInput(deletes, count ? this.compileExpression(count, deletes) : this.compileLength(target, deletes), "times", "value");
        const del = this.addBlock({ type: "delete_list_item", parent_id: deletes, fields: { item: "any" } });
        this.connectInput(del, this.compileExpression(target, del), "list", "value");
        this.connectInput(del, this.compilePlusOne(start, del), "list_index", "value");
        this.connectInput(deletes, del, "DO", "statement");
        ids.push(deletes);
        items.slice().reverse().forEach((item) => ids.push(insertAt((id) => this.compilePlusOne(start, id), item)));
        return chainAll(ids);
      }
      case "reverse":
        if (!ts.isIdentifier(target)) this.unsupported(call, "reverse() as a statement needs an array variable");
        return this.compileReverseInPlace(target, parentId);
      case "sort": case "pop": case "shift": {
        const id = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: "__discard" } });
        this.globalVariables.add("__discard");
        this.connectInput(id, this.compileMethodCall(call, id), "value", "value");
        return id;
      }
    }
    return undefined;
  }

  compileReverseInPlace(target, parentId) {
    const id = this.addBlock({ type: "variables_set", parent_id: parentId, fields: { variable: target.text } });
    this.connectInput(id, this.compileHelperCall("__arr_reverse", target, [], id), "value", "value");
    return id;
  }

  // String and array methods: s.includes / slice / substring / charAt /
  // split, a.length via compileLength.
  compileMethodCall(call, parentId) {
    if (!ts.isPropertyAccessExpression(call.expression)) return null;
    const target = call.expression.expression;
    const method = call.expression.name.text;
    const args = call.arguments;
    const literal = (value) => (typeof value === "number" ? ts.factory.createNumericLiteral(value) : ts.factory.createStringLiteral(value));
    const lengthOf = () => ts.factory.createPropertyAccessExpression(target, "length");
    const helper = (name, ...extra) => this.compileHelperCall(name, target, extra, parentId);
    const synthesized = this.helperCalls.get(call);
    if (synthesized) {
      return this.compileHelperCall(synthesized.name, target, synthesized.extra, parentId);
    }
    if (this.isArrayExpression(target)) {
      switch (method) {
        case "indexOf": {
          // list_index_of is 1-based with 0 for missing.
          const id = this.addBlock({ type: "math_arithmetic", parent_id: parentId, fields: { type: "minus" }, is_output: true });
          const find = this.addBlock({ type: "list_index_of", parent_id: id, is_output: true });
          this.connectInput(find, this.compileExpression(target, find), "list", "value");
          this.connectInput(find, this.compileExpression(args[0], find), "list_item_value", "value");
          this.connectInput(id, find, "A", "value");
          this.connectInput(id, this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: "1" }, is_output: true }), "B", "value");
          return id;
        }
        case "lastIndexOf": return helper("__arr_lastIndexOf", args[0]);
        case "join": return helper("__arr_join", args[0] ?? literal(","));
        case "concat": return helper("__arr_concat", args[0]);
        case "slice":
          if (args.some((arg) => { const v = constantNumber(arg); return v !== null && v < 0; })) {
            this.unsupported(call, "slice with negative indices is not supported");
          }
          return helper("__arr_slice", args[0] ?? literal(0), args[1] ?? lengthOf());
        case "reverse": return helper("__arr_reverse");
        case "pop": return helper("__arr_pop");
        case "shift": return helper("__arr_shift");
        case "sort": return helper("__arr_sort");
      }
      if (method === "includes") {
        const id = this.addBlock({ type: "list_is_exist", parent_id: parentId, is_output: true });
        this.connectInput(id, this.compileExpression(target, id), "list", "value");
        this.connectInput(id, this.compileExpression(args[0], id), "list_item_value", "value");
        return id;
      }
      return null;
    }
    switch (method) {
      case "includes": {
        const id = this.addBlock({ type: "text_contain", parent_id: parentId, is_output: true });
        this.connectInput(id, this.compileExpression(target, id), "A", "value");
        this.connectInput(id, this.compileExpression(args[0], id), "B", "value");
        return id;
      }
      case "charAt":
      case "slice":
      case "substring": {
        if (method !== "charAt" && args.some((arg) => { const v = constantNumber(arg); return v !== null && v < 0; })) {
          this.unsupported(call, `${method} with negative indices is not supported`);
        }
        const id = this.addBlock({
          type: "text_select",
          parent_id: parentId,
          mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>',
          is_output: true,
        });
        this.connectInput(id, this.compileExpression(target, id), "text", "value");
        this.connectInput(id, this.compilePlusOne(args[0] ?? ts.factory.createNumericLiteral(0), id), "start_index", "value");
        let endId;
        if (method === "charAt") endId = this.compilePlusOne(args[0], id);
        else if (args[1]) endId = this.compileExpression(args[1], id);
        else endId = this.compileLength(target, id);
        this.connectInput(id, endId, "end_index", "value");
        return id;
      }
      case "indexOf": return helper("__str_indexOf", args[0], args[1] ?? literal(0));
      case "lastIndexOf": return helper("__str_lastIndexOf", args[0]);
      case "startsWith": return helper("__str_startsWith", args[0]);
      case "endsWith": return helper("__str_endsWith", args[0]);
      case "replace": return helper("__str_replace", args[0], args[1]);
      case "replaceAll": return helper("__str_replaceAll", args[0], args[1]);
      case "trim": case "trimStart": case "trimEnd": case "toUpperCase": case "toLowerCase":
        return helper(`__str_${method}`);
      case "repeat": return helper("__str_repeat", args[0]);
      case "padStart": case "padEnd": return helper(`__str_${method}`, args[0], args[1] ?? literal(" "));
      case "concat": return this.compileTextJoin([{ expression: target }, ...Array.from(args, (arg) => ({ expression: arg }))], parentId);
      case "split": {
        const id = this.addBlock({ type: "text_split", parent_id: parentId, is_output: true });
        this.connectInput(id, this.compileExpression(target, id), "TEXT_TO_SPLIT", "value");
        this.connectInput(id, this.compileExpression(args[0], id), "SPLIT_TEXT", "value");
        return id;
      }
      default:
        return null;
    }
  }

  // Official logic_ternary evaluates both branches; `return c ? a : b` is
  // lowered to if/else (see compileReturn) so recursion still terminates.
  compileConditionalExpression(expression, parentId) {
    const id = this.addBlock({
      type: "logic_ternary",
      parent_id: parentId,
      is_output: true,
    });
    this.connectInput(id, this.compileExpression(expression.condition, id), "condition", "value");
    this.connectInput(id, this.compileExpression(expression.whenTrue, id), "ifTrue", "value");
    this.connectInput(id, this.compileExpression(expression.whenFalse, id), "ifFalse", "value");
    return id;
  }

  compileReturn(expression, parentId) {
    let inner = expression;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    if (ts.isConditionalExpression(inner)) {
      const id = this.addBlock({
        type: "controls_if",
        parent_id: parentId,
        mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>',
      });
      this.connectInput(id, this.compileExpression(inner.condition, id), "IF0", "value");
      this.connectInput(id, this.compileReturn(inner.whenTrue, id), "DO0", "statement");
      this.connectInput(id, this.compileReturn(inner.whenFalse, id), "ELSE", "statement");
      return id;
    }
    const retId = this.addReturnValueBlock(parentId);
    this.connectInput(retId, this.compileExpression(expression, retId), "VALUE", "value");
    return retId;
  }

  // Same shape as the editor's return block (mutation + number shadow);
  // without them the editor rewires the VALUE input.
  addReturnValueBlock(parentId) {
    return this.addBlock({
      type: "procedures_2_return_value",
      parent_id: parentId,
      mutation: '<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>',
      shadows: {
        PROCEDURES_2_DEFRETURN_RETURN: "",
        VALUE:
          '<shadow xmlns="http://www.w3.org/1999/xhtml" type="math_number" id="shadow-procedure-return-value" visible="visible"><field constraints="-Infinity,Infinity,0," allow_text="true" name="NUM">0</field></shadow>',
        PROCEDURES_2_DEFRETURN_RETURN_MUTATOR: "",
      },
    });
  }

  compilePrefixUnaryExpression(expression, parentId) {
    const op = expression.operator;
    if (op === ts.SyntaxKind.ExclamationToken) {
      const id = this.addBlock({
        type: "logic_negate",
        parent_id: parentId,
        is_output: true,
      });
      const operandId = this.compileExpression(expression.operand, id);
      this.connectInput(id, operandId, "logic", "value");
      return id;
    }
    if (op === ts.SyntaxKind.MinusToken) {
      const id = this.addBlock({
        type: "math_arithmetic",
        parent_id: parentId,
        fields: { type: "minus" },
        is_output: true,
      });
      const zeroId = this.addBlock({ type: "math_number", parent_id: id, fields: { NUM: "0" }, is_output: true });
      const operandId = this.compileExpression(expression.operand, id);
      this.connectInput(id, zeroId, "A", "value");
      this.connectInput(id, operandId, "B", "value");
      return id;
    }
    if (op === ts.SyntaxKind.PlusToken) {
      return this.compileExpression(expression.operand, parentId);
    }
    if (op === ts.SyntaxKind.TildeToken) {
      const value = constantNumber(expression);
      if (value === null) {
        this.unsupported(expression, "Bitwise operators work only on constant numbers (Kitten N has no bitwise blocks)");
      }
      return this.addBlock({ type: "math_number", parent_id: parentId, fields: { NUM: String(value) }, is_output: true });
    }
    if (op === ts.SyntaxKind.TypeOfKeyword) {
      return this.addBlock({
        type: "text",
        parent_id: parentId,
        fields: { TEXT: "number" },
        is_output: true,
      });
    }
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      const delta = op === ts.SyntaxKind.PlusPlusToken ? 1 : -1;
      if (ts.isIdentifier(expression.operand)) {
        const varName = expression.operand.text;
        const changeId = this.addBlock({
          type: "change_variables",
          parent_id: parentId,
          fields: {
            variable: varName,
            method: delta > 0 ? "increase" : "decrease",
          },
        });
        const valueId = this.addBlock({
          type: "math_number",
          parent_id: changeId,
          fields: { NUM: "1" },
          is_output: true,
        });
        this.connectInput(changeId, valueId, "value", "value");
        return changeId;
      }
    }
    return this.compileExpression(expression.operand, parentId);
  }

  compilePostfixUnaryExpression(expression, parentId) {
    const op = expression.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      const delta = op === ts.SyntaxKind.PlusPlusToken ? 1 : -1;
      if (ts.isIdentifier(expression.operand)) {
        const varName = expression.operand.text;
        const changeId = this.addBlock({
          type: "change_variables",
          parent_id: parentId,
          fields: {
            variable: varName,
            method: delta > 0 ? "increase" : "decrease",
          },
        });
        const valueId = this.addBlock({
          type: "math_number",
          parent_id: changeId,
          fields: { NUM: "1" },
          is_output: true,
        });
        this.connectInput(changeId, valueId, "value", "value");
        return changeId;
      }
    }
    return this.compileExpression(expression.operand, parentId);
  }

  compileArrayLiteralExpression(expression, parentId) {
    // The editor sizes the item inputs from this mutation; without it the
    // ITEMn connections are dropped when the work is opened.
    const id = this.addBlock({
      type: "temporary_list",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${expression.elements.length}"></mutation>`,
      is_output: true,
    });
    for (let i = 0; i < expression.elements.length; i++) {
      const elemId = this.compileExpression(expression.elements[i], id);
      this.connectInput(id, elemId, `ITEM${i}`, "value");
    }
    return id;
  }

  compileNativeBinaryExpression(expression, parentId) {
    const operator = expression.operatorToken.kind;
    // `+` joins text when either side is statically a string; chains like
    // "a" + x + "b" flatten into one join.
    if (operator === ts.SyntaxKind.PlusToken && (isStringExpression(expression.left) || isStringExpression(expression.right))) {
      return this.compileTextJoin(flattenStringConcat(expression).map((part) => (
        ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part) ? { text: part.text } : { expression: part }
      )), parentId);
    }
    if (BITWISE_OPERATORS.has(operator)) {
      const value = constantNumber(expression);
      if (value === null) {
        this.unsupported(expression.operatorToken, "Bitwise operators work only on constant numbers (Kitten N has no bitwise blocks)");
      }
      return this.addBlock({ type: "math_number", parent_id: parentId, fields: { NUM: String(value) }, is_output: true });
    }
    const spec = nativeBinaryExpressionSpec(operator);
    if (!spec) {
      this.unsupported(expression.operatorToken, "Unsupported binary expression operator");
    }
    const id = this.addBlock({
      type: spec.type,
      parent_id: parentId,
      ...(spec.fields ? { fields: spec.fields } : {}),
      is_output: true,
    });
    const leftId = this.compileExpression(expression.left, id);
    const rightId = this.compileExpression(expression.right, id);
    this.connectInput(id, leftId, spec.leftInput, "value");
    this.connectInput(id, rightId, spec.rightInput, "value");
    return id;
  }

  compileUnaryExpressionCall(call, parentId, spec) {
    const id = this.addBlock({
      type: spec.type,
      parent_id: parentId,
      ...(spec.fields ? { fields: spec.fields } : {}),
      is_output: true,
    });
    const childId = this.compileExpression(call.arguments[spec.argumentIndex ?? 0], id);
    this.connectInput(id, childId, spec.input, "value");
    return id;
  }

  compileBroadcastMessage(expression, parentId) {
    return this.addBlock({
      type: "broadcast_input",
      parent_id: parentId,
      fields: { message: stringLiteralValue(expression, this) },
      is_output: true,
      is_shadow: true,
    });
  }

  compileCoordinateOfSprite(call, parentId, coordinate) {
    return this.addBlock({
      type: "coordinate_of_sprite",
      parent_id: parentId,
      fields: {
        sprite: stringLiteralValue(call.arguments[0], this),
        coordinate,
      },
      is_output: true,
    });
  }

  compileFieldOutput(parentId, type, fields) {
    return this.addBlock({
      type,
      parent_id: parentId,
      fields,
      is_output: true,
    });
  }

  compileMouseTrigger(call, parentId) {
    const fields = {
      type: stringLiteralValue(call.arguments[0], this),
    };
    if (call.arguments.length > 1) {
      fields.sprite = stringLiteralValue(call.arguments[1], this);
    }
    return this.addBlock({
      type: "mouse_down",
      parent_id: parentId,
      fields,
      is_output: true,
    });
  }

  compileCloneProperty(call, parentId) {
    const id = this.addBlock({
      type: "get_clone_index_property",
      parent_id: parentId,
      fields: {
        sprite: stringLiteralValue(call.arguments[0], this),
        attribute: stringLiteralValue(call.arguments[2], this),
      },
      is_output: true,
    });
    const indexId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, indexId, "index", "value");
    return id;
  }

  compileListItem(call, parentId) {
    return this.compileListItemByArgs(parentId, call.arguments[0], call.arguments[1], call.arguments[2]);
  }

  compileListItemByArgs(parentId, listNameArg, itemArg, indexArg) {
    const id = this.addBlock({
      type: "list_item",
      parent_id: parentId,
      fields: { item: stringLiteralValue(itemArg, this) },
      is_output: true,
    });
    const indexId = this.compileExpression(indexArg, id);
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    this.connectInput(id, indexId, "list_index", "value");
    return id;
  }

  compileListUnaryExpression(call, parentId, type, listArgumentIndex) {
    return this.compileListUnaryExpressionByNameArg(parentId, type, call.arguments[listArgumentIndex]);
  }

  compileListUnaryExpressionByNameArg(parentId, type, listNameArg) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
      is_output: true,
    });
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    return id;
  }

  compileListValueExpression(call, parentId, type, listArgumentIndex, valueArgumentIndex) {
    return this.compileListValueExpressionByArgs(
      parentId,
      type,
      call.arguments[listArgumentIndex],
      call.arguments[valueArgumentIndex],
    );
  }

  compileListValueExpressionByArgs(parentId, type, listNameArg, valueArg) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
      is_output: true,
    });
    this.connectListInput(id, "list", stringLiteralValue(listNameArg, this));
    const valueId = this.compileExpression(valueArg, id);
    this.connectInput(id, valueId, "list_item_value", "value");
    return id;
  }

  compileListGetByNameArg(parentId, listNameArg) {
    return this.addBlock({
      type: "list_get",
      parent_id: parentId,
      fields: { list: stringLiteralValue(listNameArg, this) },
      is_output: true,
    });
  }

  compileTempList(call, parentId) {
    const id = this.addBlock({
      type: "temporary_list",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${call.arguments.length}"></mutation>`,
      is_output: true,
    });
    call.arguments.forEach((argument, index) => {
      const valueId = this.compileExpression(argument, id);
      this.connectInput(id, valueId, `ITEM${index}`, "value");
    });
    return id;
  }

  connectListInput(parentId, inputName, listName) {
    const listId = this.compileResourceShadow("pure_list_get", "list", listName, parentId);
    this.connectInput(parentId, listId, inputName, "value");
  }

  compileResourceShadow(type, fieldName, value, parentId) {
    return this.addBlock({
      type,
      parent_id: parentId,
      fields: { [fieldName]: value },
      is_output: true,
      is_shadow: true,
    });
  }

  compileBroadcastParamName(expression, parentId) {
    return this.addBlock({
      type: "self_listen_param",
      parent_id: parentId,
      fields: { TEXT: stringLiteralValue(expression, this) },
      is_output: true,
    });
  }

  addBlock(block, sourceNode) {
    const id = `b${this.nextId}`;
    this.nextId += 1;
    this.blocks[id] = { id, ...block };
    const node = sourceNode || this.currentStatementNode;
    if (node && this.sourceFile && node.pos >= 0 && node.getSourceFile?.() === this.sourceFile) {
      const start = node.getStart(this.sourceFile);
      const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(start);
      this.sourceMap[id] = { line: line + 1, column: character };
    }
    return id;
  }

  addBlockWithId(id, block) {
    this.blocks[id] = { id, ...block };
    return id;
  }

  connectNext(parentId, childId) {
    this.addConnection(parentId, childId, { type: "next" });
  }

  connectInput(parentId, childId, inputName, inputType) {
    this.addConnection(parentId, childId, {
      type: "input",
      input_name: inputName,
      input_type: inputType,
    });
  }

  addConnection(parentId, childId, connection) {
    this.connections[parentId] ||= {};
    this.connections[parentId][childId] = connection;
  }

  countConnections() {
    return Object.values(this.connections).reduce(
      (total, children) => total + Object.keys(children).length,
      0,
    );
  }

  unsupported(node, message) {
    const suffix = node && typeof node.pos === "number" && node.pos >= 0 && node.getSourceFile?.() === this.sourceFile
      ? ` at offset ${node.getStart(this.sourceFile)}`
      : "";
    fail(`${message}${suffix}`, nodeLocation(node));
  }
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const targetName = calleeName(expression.expression);
    return targetName ? `${targetName}.${expression.name.text}` : expression.name.text;
  }
  return null;
}

function isMemberCallName(name, memberName) {
  return typeof name === "string" && name.endsWith(`.${memberName}`);
}

function selfApiName(name) {
  return typeof name === "string" && /^self\.[A-Za-z_$][\w$]*$/.test(name) ? name.slice(5) : name;
}

function memberCallName(name) {
  if (typeof name !== "string") {
    return null;
  }
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? null : name.slice(dotIndex + 1);
}

function selfVariableHandleCall(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }
  const receiver = call.expression.expression;
  if (!ts.isCallExpression(receiver) || calleeName(receiver.expression) !== "self.var") {
    return null;
  }
  return {
    methodName: call.expression.name.text,
    nameArg: receiver.arguments[0],
  };
}

function ifEndsWithContinue(statement) {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const body = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement];
  const last = body.at(-1);
  return Boolean(last && ts.isContinueStatement(last) && !last.label);
}

function constantInitialValue(node) {
  const inner = stripParens(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  if (inner.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (inner.kind === ts.SyntaxKind.FalseKeyword) return false;
  const value = constantNumber(inner);
  return value;
}

function isValueMethodCall(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  let root = call.expression.expression;
  while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root) || ts.isElementAccessExpression(root)) {
    root = root.expression;
  }
  return !(ts.isIdentifier(root) && ["self", "console", "Math"].includes(root.text)) && root.kind !== ts.SyntaxKind.ThisKeyword;
}

function forOfListName(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "get" && node.arguments.length === 0) {
    node = node.expression.expression;
  }
  if (ts.isCallExpression(node) && calleeName(node.expression) === "self.list"
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
    return node.arguments[0].text;
  }
  return null;
}

function selfListHandleCall(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }
  const receiver = call.expression.expression;
  if (!ts.isCallExpression(receiver) || calleeName(receiver.expression) !== "self.list") {
    return null;
  }
  return {
    methodName: call.expression.name.text,
    nameArg: receiver.arguments[0],
  };
}

const CALLBACK_METHODS = new Set(["map", "filter", "forEach", "reduce", "find", "findIndex", "some", "every", "sort"]);

// Insertion sort in place; `greater` is the "move right" test.
function sortHelper(name, greater, n) {
  return `function ${name}(__arrL) { for (let __a${n} = 1; __a${n} < __arrL.length; __a${n}++) { const __v${n} = __arrL[__a${n}]; let __b${n} = __a${n} - 1; while (__b${n} >= 0 && ${greater}) { __arrL[__b${n} + 1] = __arrL[__b${n}]; __b${n} = __b${n} - 1; } __arrL[__b${n} + 1] = __v${n}; } return __arrL; }`;
}

const SHARED_HELPERS = {
  __arr_join: { source: `function __arr_join(__arrL, __sep) { let __jS = ""; let __jK = 0; for (const __jX of __arrL) { if (__jK > 0) { __jS = join(__jS, __sep); } __jS = join(__jS, __jX); __jK++; } return __jS; }` },
  __arr_concat: { source: `function __arr_concat(__arrL, __arrB) { const __cO = []; for (const __cX of __arrL) { __cO.push(__cX); } for (const __cY of __arrB) { __cO.push(__cY); } return __cO; }` },
  __arr_slice: { source: `function __arr_slice(__arrL, __sFrom, __sTo) { const __sO = []; for (let __sK = __sFrom; __sK < __sTo; __sK++) { __sO.push(__arrL[__sK]); } return __sO; }` },
  __arr_reverse: { source: `function __arr_reverse(__arrL) { const __rO = []; for (let __rK = __arrL.length - 1; __rK >= 0; __rK--) { __rO.push(__arrL[__rK]); } return __rO; }` },
  __arr_lastIndexOf: { source: `function __arr_lastIndexOf(__arrL, __lV) { for (let __lK = __arrL.length - 1; __lK >= 0; __lK--) { if (__arrL[__lK] === __lV) { return __lK; } } return -1; }` },
  __arr_pop: { source: `function __arr_pop(__arrL) { const __pV = __arrL[__arrL.length - 1]; __listDeleteLast(__arrL); return __pV; }` },
  __arr_shift: { source: `function __arr_shift(__arrL) { const __hV = __arrL[0]; __listDelete(__arrL, 1); return __hV; }` },
  __arr_sort: { source: sortHelper("__arr_sort", "__arrL[__bD] > __vD", "D") },
  __str_indexOf: { source: `function __str_indexOf(__s, __t, __from) { for (let __iK = __from; __iK <= length(__s) - length(__t); __iK++) { if (selectText(__s, __iK + 1, __iK + length(__t)) === __t) { return __iK; } } return -1; }` },
  __str_lastIndexOf: { source: `function __str_lastIndexOf(__s, __t) { for (let __lK = length(__s) - length(__t); __lK >= 0; __lK--) { if (selectText(__s, __lK + 1, __lK + length(__t)) === __t) { return __lK; } } return -1; }` },
  __str_startsWith: { source: `function __str_startsWith(__s, __t) { return selectText(__s, 1, length(__t)) === __t; }` },
  __str_endsWith: { source: `function __str_endsWith(__s, __t) { return selectText(__s, length(__s) - length(__t) + 1, length(__s)) === __t; }` },
  __str_replace: { needs: ["__str_indexOf"], source: `function __str_replace(__s, __a, __b) { const __rI = __str_indexOf(__s, __a, 0); if (__rI < 0) { return __s; } return join(selectText(__s, 1, __rI), __b, selectText(__s, __rI + length(__a) + 1, length(__s))); }` },
  __str_replaceAll: { needs: ["__str_indexOf"], source: `function __str_replaceAll(__s, __a, __b) { let __aO = ""; let __aP = 0; let __aI = __str_indexOf(__s, __a, 0); while (__aI >= 0 && length(__a) > 0) { __aO = join(__aO, selectText(__s, __aP + 1, __aI), __b); __aP = __aI + length(__a); __aI = __str_indexOf(__s, __a, __aP); } return join(__aO, selectText(__s, __aP + 1, length(__s))); }` },
  __str_trimStart: { source: `function __str_trimStart(__s) { let __tA = 1; while (__tA <= length(__s) && contains(" \\t\\n\\r", selectText(__s, __tA, __tA))) { __tA = __tA + 1; } return selectText(__s, __tA, length(__s)); }` },
  __str_trimEnd: { source: `function __str_trimEnd(__s) { let __tB = length(__s); while (__tB >= 1 && contains(" \\t\\n\\r", selectText(__s, __tB, __tB))) { __tB = __tB - 1; } return selectText(__s, 1, __tB); }` },
  __str_trim: { needs: ["__str_trimStart", "__str_trimEnd"], source: `function __str_trim(__s) { return __str_trimEnd(__str_trimStart(__s)); }` },
  __str_repeat: { source: `function __str_repeat(__s, __n) { let __pO = ""; for (let __pK = 0; __pK < __n; __pK++) { __pO = join(__pO, __s); } return __pO; }` },
  __str_padStart: { source: `function __str_padStart(__s, __n, __f) { let __qO = __s; while (length(__qO) < __n && length(__f) > 0) { __qO = join(__f, __qO); } return __qO; }` },
  __str_padEnd: { source: `function __str_padEnd(__s, __n, __f) { let __qE = __s; while (length(__qE) < __n && length(__f) > 0) { __qE = join(__qE, __f); } return __qE; }` },
  __str_toUpperCase: { needs: ["__str_indexOf"], source: `function __str_toUpperCase(__s) { let __uO = ""; for (let __uK = 1; __uK <= length(__s); __uK++) { const __uC = selectText(__s, __uK, __uK); const __uI = __str_indexOf("abcdefghijklmnopqrstuvwxyz", __uC, 0); if (__uI >= 0) { __uO = join(__uO, selectText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", __uI + 1, __uI + 1)); } else { __uO = join(__uO, __uC); } } return __uO; }` },
  __str_toLowerCase: { needs: ["__str_indexOf"], source: `function __str_toLowerCase(__s) { let __wO = ""; for (let __wK = 1; __wK <= length(__s); __wK++) { const __wC = selectText(__s, __wK, __wK); const __wI = __str_indexOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ", __wC, 0); if (__wI >= 0) { __wO = join(__wO, selectText("abcdefghijklmnopqrstuvwxyz", __wI + 1, __wI + 1)); } else { __wO = join(__wO, __wC); } } return __wO; }` },
};

// Method name -> shared helpers it may need (array or string form).
const METHOD_HELPERS = {
  join: ["__arr_join"], concat: ["__arr_concat"], slice: ["__arr_slice"], reverse: ["__arr_reverse"],
  lastIndexOf: ["__arr_lastIndexOf", "__str_lastIndexOf"], pop: ["__arr_pop"], shift: ["__arr_shift"],
  sort: ["__arr_sort"], indexOf: ["__str_indexOf"], startsWith: ["__str_startsWith"], endsWith: ["__str_endsWith"],
  replace: ["__str_replace"], replaceAll: ["__str_replaceAll"], trim: ["__str_trim"], trimStart: ["__str_trimStart"],
  trimEnd: ["__str_trimEnd"], repeat: ["__str_repeat"], padStart: ["__str_padStart"], padEnd: ["__str_padEnd"],
  toUpperCase: ["__str_toUpperCase"], toLowerCase: ["__str_toLowerCase"],
};

const BITWISE_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
]);

function stripParens(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) && !isStringType(node.type)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression;
  }
  return node;
}

function isStringType(type) {
  return type && type.kind === ts.SyntaxKind.StringKeyword;
}

// Statically string-valued: literals, templates, `x as string`, text
// reporters, or a `+` with a string side.
let STRING_VARIABLES = new Set();
const STRING_METHODS = new Set(["replace", "replaceAll", "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase",
  "padStart", "padEnd", "repeat", "charAt", "substring", "join"]);

function isStringExpression(node) {
  node = stripParens(node);
  if (!node) return false;
  if (ts.isIdentifier(node) && STRING_VARIABLES.has(node.text)) return true;
  if (ts.isAsExpression(node) && isStringType(node.type)) return true;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    && ["join", "selectText", "answer", "String"].includes(node.expression.text)) return true;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && STRING_METHODS.has(node.expression.name.text)) return true;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringExpression(node.left) || isStringExpression(node.right);
  }
  return false;
}

function flattenStringConcat(node) {
  const inner = stripParens(node);
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken
    && isStringExpression(inner)) {
    return [...flattenStringConcat(inner.left), ...flattenStringConcat(inner.right)];
  }
  return [node];
}

function constantNumber(node) {
  node = stripParens(node);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node)) {
    const value = constantNumber(node.operand);
    if (value === null) return null;
    switch (node.operator) {
      case ts.SyntaxKind.MinusToken: return -value;
      case ts.SyntaxKind.PlusToken: return value;
      case ts.SyntaxKind.TildeToken: return ~value;
      default: return null;
    }
  }
  if (ts.isBinaryExpression(node)) {
    const a = constantNumber(node.left);
    const b = constantNumber(node.right);
    if (a === null || b === null) return null;
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return a + b;
      case ts.SyntaxKind.MinusToken: return a - b;
      case ts.SyntaxKind.AsteriskToken: return a * b;
      case ts.SyntaxKind.SlashToken: return a / b;
      case ts.SyntaxKind.PercentToken: return a % b;
      case ts.SyntaxKind.AsteriskAsteriskToken: return a ** b;
      case ts.SyntaxKind.AmpersandToken: return a & b;
      case ts.SyntaxKind.BarToken: return a | b;
      case ts.SyntaxKind.CaretToken: return a ^ b;
      case ts.SyntaxKind.LessThanLessThanToken: return a << b;
      case ts.SyntaxKind.GreaterThanGreaterThanToken: return a >> b;
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: return a >>> b;
      default: return null;
    }
  }
  return null;
}

function nativeBinaryExpressionSpec(operator) {
  switch (operator) {
    case ts.SyntaxKind.PlusToken:
      return { type: "math_arithmetic", fields: { type: "add" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.MinusToken:
      return { type: "math_arithmetic", fields: { type: "minus" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.AsteriskToken:
      return { type: "math_arithmetic", fields: { type: "multiply" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.SlashToken:
      return { type: "math_arithmetic", fields: { type: "divide" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.PercentToken:
      return { type: "math_modulo", leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.EqualsEqualsToken:
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return { type: "logic_compare", fields: { OP: "EQ" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.ExclamationEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return { type: "logic_compare", fields: { OP: "NEQ" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.GreaterThanToken:
      return { type: "logic_compare", fields: { OP: "GT" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return { type: "logic_compare", fields: { OP: "GTE" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.LessThanToken:
      return { type: "logic_compare", fields: { OP: "LT" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.LessThanEqualsToken:
      return { type: "logic_compare", fields: { OP: "LTE" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return { type: "logic_operation", fields: { type: "and" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.BarBarToken:
      return { type: "logic_operation", fields: { type: "or" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return { type: "math_arithmetic", fields: { type: "power" }, leftInput: "A", rightInput: "B" };
    case ts.SyntaxKind.QuestionQuestionToken:
      return { type: "logic_operation", fields: { type: "or" }, leftInput: "A", rightInput: "B" };
    default:
      return null;
  }
}

function assignmentOperatorSpec(operator) {
  switch (operator) {
    case ts.SyntaxKind.EqualsToken:
      return { kind: "assign" };
    case ts.SyntaxKind.PlusEqualsToken:
      return { kind: "compound", operator: "add" };
    case ts.SyntaxKind.MinusEqualsToken:
      return { kind: "compound", operator: "minus" };
    case ts.SyntaxKind.AsteriskEqualsToken:
      return { kind: "compound", operator: "multiply" };
    case ts.SyntaxKind.SlashEqualsToken:
      return { kind: "compound", operator: "divide" };
    case ts.SyntaxKind.PercentEqualsToken:
      return { kind: "compound", operator: "mod" };
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
      return { kind: "compound", operator: "power" };
    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
    case ts.SyntaxKind.BarBarEqualsToken:
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return { kind: "assign" };
    default:
      return null;
  }
}

function expressionContainsIdentifier(expression, name) {
  let found = false;
  function visit(node) {
    if (found) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(expression);
  return found;
}

function hasExportModifier(statement) {
  return Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function inlineFunctionName(statement) {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name?.text ?? null;
  }
  if (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1
  ) {
    const declaration = statement.declarationList.declarations[0];
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      ts.isArrowFunction(declaration.initializer)
    ) {
      return declaration.name.text;
    }
  }
  return null;
}

function callbackBody(argument, compiler) {
  if (!argument || !ts.isArrowFunction(argument) || !ts.isBlock(argument.body)) {
    compiler.unsupported(argument, "Expected a block arrow callback");
  }
  return Array.from(argument.body.statements);
}

function isCallbackBody(argument) {
  return argument && ts.isArrowFunction(argument) && ts.isBlock(argument.body);
}

function stringLiteralValue(node, compiler) {
  const visited = new Set();
  while (node && ts.isIdentifier(node) && !visited.has(node)) {
    visited.add(node);
    const bound = compiler.lookupExpressionBinding(node.text) ?? compiler.constStringLiterals?.get(node.text);
    if (!bound) break;
    node = bound;
  }
  if (!node || !ts.isStringLiteral(node)) {
    compiler.unsupported(node, "Expected a string literal");
  }
  return node.text;
}

function arrayStringLiteralValues(node, compiler) {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    compiler.unsupported(node, "Expected an array of string literals");
  }
  return node.elements.map((element) => stringLiteralValue(element, compiler));
}

function objectLiteralOptions(node, compiler) {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    compiler.unsupported(node, "Expected an object literal");
  }
  const options = new Map();
  node.properties.forEach((property) => {
    if (!ts.isPropertyAssignment(property)) {
      compiler.unsupported(property, "Only object property assignments are supported");
    }
    const name = propertyNameText(property.name, compiler);
    if (options.has(name)) {
      compiler.unsupported(property.name, `Duplicate option: ${name}`);
    }
    options.set(name, property.initializer);
  });
  return options;
}

function propertyNameText(name, compiler) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  compiler.unsupported(name, "Only identifier, string, or number option names are supported");
}

// sprite({ costumes: ["a.png", { name: "run", url: "b.png", centerX: 32 }] })
function costumeListOption(node, compiler) {
  if (!ts.isArrayLiteralExpression(node) || node.elements.length === 0) {
    compiler.unsupported(node, "costumes must be a non-empty array of URLs or { name?, url, centerX?, centerY? }");
  }
  const names = new Set();
  return node.elements.map((element) => {
    let costume;
    if (ts.isObjectLiteralExpression(element)) {
      const options = objectLiteralOptions(element, compiler);
      if (!options.has("url")) compiler.unsupported(element, "costume needs a url");
      costume = { url: stringLiteralValue(options.get("url"), compiler) };
      if (options.has("name")) costume.name = stringLiteralValue(options.get("name"), compiler);
      if (options.has("centerX")) costume.centerX = numericLiteralValue(options.get("centerX"), compiler);
      if (options.has("centerY")) costume.centerY = numericLiteralValue(options.get("centerY"), compiler);
    } else {
      costume = { url: stringLiteralValue(element, compiler) };
    }
    if (costume.name !== undefined) {
      if (names.has(costume.name)) compiler.unsupported(element, `Duplicate costume name: ${costume.name}`);
      names.add(costume.name);
    }
    return costume;
  });
}

function optionalStringOption(options, name, defaultValue, compiler, node) {
  const value = options.get(name);
  if (!value) {
    return defaultValue;
  }
  return stringLiteralValue(value, compiler);
}

function optionalNumberOption(options, name, defaultValue, compiler, node) {
  const value = options.get(name);
  if (!value) {
    return defaultValue;
  }
  return numericLiteralValue(value, compiler);
}

function optionalBooleanOption(options, name, defaultValue, compiler, node) {
  const value = options.get(name);
  if (!value) {
    return defaultValue;
  }
  return booleanLiteralValue(value, compiler);
}

// Visits statements, skipping nested loops, switches and functions (whose
// break statements belong to them).
function procedureParamIds(spec) {
  return new Map(spec.params.filter((param) => param.type === "String").map((param) => [param.name, param.id]));
}

function visitOutsideLoops(node, visit) {
  visit(node);
  if (ts.isFunctionLike(node) || ts.isIterationStatement(node, false) || ts.isSwitchStatement(node)) return;
  ts.forEachChild(node, (child) => visitOutsideLoops(child, visit));
}

// Visits a function body without descending into nested functions.
function visitFunctionBody(body, visit) {
  const walk = (node) => {
    visit(node);
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, walk);
  };
  if (ts.isBlock(body)) ts.forEachChild(body, walk);
  else walk(body);
}

function sanitizeIdPart(value) {
  // Non-ASCII names keep their identity: distinct Chinese names must not collapse.
  const sanitized = Array.from(value)
    .map((character) => {
      if (/[A-Za-z0-9_-]/.test(character)) return character;
      const code = character.codePointAt(0);
      return code > 127 ? `u${code.toString(16)}-` : "-";
    })
    .join("");
  return sanitized || "procedure";
}

// Keep the historic ID when free, and never overwrite a previously allocated
// identity (including a literal name that already ends in a numeric suffix).
function allocateResourceId(preferred, used) {
  let id = preferred;
  for (let suffix = 2; used.has(id); suffix++) id = `${preferred}-${suffix}`;
  return id;
}

function escapeXmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function procedureMutation(params) {
  const args = params
    .map((param, index) => (
      `<arg id="${escapeXmlAttribute(param.id)}" name="${escapeXmlAttribute(param.name)}" type="${escapeXmlAttribute(param.type)}"></arg>`
    ))
    .join("");
  return `<mutation xmlns="http://www.w3.org/1999/xhtml">${args}</mutation>`;
}

function procedureDefinitionShadows(params) {
  return Object.fromEntries(params.map((param, index) => [
    `PARAMS${index}`,
    param.type === "String" ? defaultProcedureParamShadow(param) : "",
  ]));
}

function procedureCallShadows(params) {
  return Object.fromEntries(
    params
      .filter((param) => param.type === "String")
      .map((param) => [param.id, defaultProcedureParamShadow(param)]),
  );
}

function defaultProcedureParamShadow(param) {
  return `<shadow xmlns="http://www.w3.org/1999/xhtml" type="math_number" id="shadow-${escapeXmlAttribute(param.id)}" visible="visible"><field constraints="-Infinity,Infinity,0," allow_text="true" name="NUM">0</field></shadow>`;
}

function procedureCallMutation(spec) {
  const args = spec.params
    .map((param) => (
      `<arg id="${escapeXmlAttribute(param.id)}" content="${escapeXmlAttribute(param.name)}" type="${escapeXmlAttribute(param.type)}"></arg>`
    ))
    .join("");
  return `<mutation xmlns="http://www.w3.org/1999/xhtml" def_id="${escapeXmlAttribute(spec.id)}" name="${escapeXmlAttribute(spec.id)}" type="${escapeXmlAttribute(spec.type)}">${args}</mutation>`;
}

function numericLiteralValue(node, compiler) {
  if (node && ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (
    node &&
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  compiler.unsupported(node, "Expected a numeric literal");
}

function booleanLiteralValue(node, compiler) {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node?.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  compiler.unsupported(node, "Expected a boolean literal");
}

/** Compiles a TS/JS entry file (and its relative imports) to a workspace report. Throws CompileError. */
export function compileFile(inputPath) {
  const sourceText = fs.readFileSync(inputPath, "utf8");
  const sourceFile = ts.createSourceFile(
    inputPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  rejectParseDiagnostics(sourceFile);
  return new WorkspaceCompiler(inputPath, sourceFile).compile(sourceFile);
}

const DECLARATIONS = fileURLToPath(new URL("./nekoc.d.ts", import.meta.url));

/** Type-checks an entry file against ts/nekoc.d.ts. Returns diagnostics for user files only. */
export function checkTypes(inputPath) {
  const program = ts.createProgram([DECLARATIONS, inputPath], {
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    allowJs: true,
    checkJs: true,
    lib: ["lib.es2020.d.ts"],
    types: [],
    skipLibCheck: true,
    strict: false,
  });
  const declarations = path.resolve(DECLARATIONS);
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || path.resolve(diagnostic.file.fileName) !== declarations)
    .map((diagnostic) => {
      let location = {};
      if (diagnostic.file) {
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        location = { file: diagnostic.file.fileName, line: line + 1, column: character + 1 };
      }
      return {
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        source: "types",
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ...location,
      };
    });
}

/**
 * Check mode: type check plus Kitten N compatibility (the full compile), no output file.
 * Returns { ok, diagnostics, report } where report is the workspace report when compilation succeeded.
 */
export function checkFile(inputPath, { types = true } = {}) {
  const diagnostics = types ? checkTypes(inputPath) : [];
  let report = null;
  try {
    report = compileFile(inputPath);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    diagnostics.push({
      severity: "error",
      source: error.code.startsWith("TS") ? "syntax" : "compat",
      code: error.code,
      message: error.message,
      ...(error.location ?? { file: inputPath }),
    });
  }
  return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics, report };
}

export function formatDiagnostic(d) {
  const where = d.line ? `${d.file}:${d.line}:${d.column}` : d.file ?? "";
  return `${where}: ${d.severity} ${d.code}: ${d.message}`;
}

function main(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const reportOut = argv.find((arg) => arg.startsWith("--report-out="))?.slice("--report-out=".length);
  const [inputPath, outputPath] = argv.filter((arg) => !arg.startsWith("--"));
  if (flags.has("--check")) {
    if (!inputPath) {
      console.error("usage: node compile-ts.mjs --check [--json] [--no-types] [--report-out=<file>] <input.ts>");
      process.exit(2);
    }
    const result = checkFile(inputPath, { types: !flags.has("--no-types") });
    if (reportOut && result.report) {
      fs.writeFileSync(reportOut, `${JSON.stringify(result.report)}\n`, "utf8");
    }
    if (flags.has("--json")) {
      console.log(JSON.stringify({ ok: result.ok, diagnostics: result.diagnostics }));
    } else {
      result.diagnostics.forEach((d) => console.error(formatDiagnostic(d)));
      if (result.ok) console.error(`${inputPath}: ok`);
    }
    process.exit(result.ok ? 0 : 1);
  }
  if (!inputPath || !outputPath) {
    console.error("usage: node compile-ts.mjs <input.ts> <output.json>\n       node compile-ts.mjs --check [--json] <input.ts>");
    process.exit(2);
  }
  let report;
  try {
    report = compileFile(inputPath);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
