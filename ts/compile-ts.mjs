import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const [inputPath, outputPath] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

class WorkspaceCompiler {
  constructor(source, sourceFile) {
    this.source = source;
    this.sourceFile = sourceFile;
    this.entryPath = path.resolve(source);
    this.nextId = 1;
    this.blocks = {};
    this.connections = {};
    this.scriptCount = 0;
    this.procedureSpecs = new Map();
    this.procedures = [];
    this.inlineFunctions = new Map();
    this.expressionBindings = [];
    this.inlineCallStack = [];
    this.loadedModules = new Set();
    this.globalVariables = new Set();
  }

  compile(sourceFile) {
    this.loadImports(sourceFile, this.entryPath);

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
      if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        this.registerProcedureSpec(statement.expression);
      }
    });

    sourceFile.statements.forEach((statement) => {
      if (ts.isImportDeclaration(statement)) {
        return;
      }
      if (this.isInlineFunctionDefinition(statement)) {
        return;
      }
      if (this.isGlobalVariableDeclaration(statement)) {
        return;
      }
      if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        this.compileTopLevelCall(statement.expression);
        return;
      }
      this.unsupported(statement, "Only top-level DSL calls are supported");
    });

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
    if (this.loadedModules.has(resolvedPath)) {
      return;
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
    this.loadImports(moduleSourceFile, resolvedPath);
    const exports = this.collectModuleExports(moduleSourceFile);
    const requested = this.importedNames(importNode);
    requested.forEach((name) => {
      const statement = exports.get(name);
      if (!statement) {
        this.unsupported(importNode, `Module ${resolvedPath} does not export ${name}`);
      }
      this.registerInlineFunction(statement);
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
      this.globalVariables.add(declaration.name.text);
    });
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
        return param.name.text;
      }),
      body,
    });
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
    switch (name) {
      case "defineProc":
        return this.compileProcedureDefinition(call, false);
      case "defineReporter":
        return this.compileProcedureDefinition(call, true);
      case "onStart":
        return this.compileNextHat(call, "on_running_group_activated", 0);
      case "onClick":
        return this.compileNextHat(call, "start_on_click", 0);
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

  compileProcedureDefinition(call, returnsValue) {
    const procedureName = stringLiteralValue(call.arguments[0], this);
    const spec = this.lookupProcedureSpec(call, procedureName);
    const body = callbackBody(call.arguments[2], this);
    const savedBlocks = this.blocks;
    const savedConnections = this.connections;
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
  }

  compileNextHat(call, type, callbackIndex) {
    const body = callbackBody(call.arguments[callbackIndex], this);
    const entryId = this.addBlock({
      type,
      parent_id: null,
    });
    this.scriptCount += 1;
    const first = this.compileStatementList(body, entryId);
    if (first) {
      this.connectNext(entryId, first);
    }
  }

  compileKeyHat(call) {
    const key = stringLiteralValue(call.arguments[0], this);
    const keyType = stringLiteralValue(call.arguments[1], this);
    const entryId = this.addBlock({
      type: "on_keydown",
      parent_id: null,
      fields: { key, type: keyType },
    });
    this.scriptCount += 1;
    const body = callbackBody(call.arguments[2], this);
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

    statements.forEach((statement) => {
      const blockId = this.compileStatement(statement, parentIdForChildren);
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

  compileStatement(statement, parentId) {
    if (ts.isExpressionStatement(statement)) {
      return this.compileStatementExpression(statement.expression, parentId);
    }
    if (ts.isIfStatement(statement)) {
      return this.compileNativeIfStatement(statement, parentId);
    }
    if (ts.isWhileStatement(statement)) {
      return this.compileNativeWhileStatement(statement, parentId);
    }
    this.unsupported(statement, "Only expression, if, and while statements are supported");
  }

  compileStatementExpression(expression, parentId) {
    if (ts.isCallExpression(expression)) {
      return this.compileStatementCall(expression, parentId);
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return this.compileAssignmentExpression(expression, parentId);
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
    switch (name) {
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
          scope: stringLiteralValue(call.arguments[0], this),
        });
      case "changeEffect":
        return this.compileSignedValueStatement(call, parentId, "self_change_effect", "value", 1, {
          scope: stringLiteralValue(call.arguments[0], this),
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
        return this.compileFieldStatement(parentId, "show_hide_variables", {
          show_hide: "show",
          variable: stringLiteralValue(call.arguments[0], this),
        });
      case "hideVariable":
        return this.compileFieldStatement(parentId, "show_hide_variables", {
          show_hide: "hide",
          variable: stringLiteralValue(call.arguments[0], this),
        });
      case "showList":
        return this.compileFieldStatement(parentId, "show_hide_list", {
          show_hide: "show",
          list: stringLiteralValue(call.arguments[0], this),
        });
      case "hideList":
        return this.compileFieldStatement(parentId, "show_hide_list", {
          show_hide: "hide",
          list: stringLiteralValue(call.arguments[0], this),
        });
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
      case "setPenColor":
        return this.compileFieldStatement(parentId, "self_set_pen_color", {
          color: stringLiteralValue(call.arguments[0], this),
        });
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
        return this.compileFieldStatement(parentId, "mirror", {
          sprite: stringLiteralValue(call.arguments[0], this),
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
      default:
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
    if (!ts.isIdentifier(expression.left)) {
      this.unsupported(expression.left, "Only simple variable assignments are supported");
    }
    const variableName = expression.left.text;
    this.globalVariables.add(variableName);
    const id = this.addBlock({
      type: "variables_set",
      parent_id: parentId,
      fields: { variable: variableName },
    });
    const valueId = this.compileExpression(expression.right, id);
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileChangeVar(call, parentId) {
    const [nameArg, valueArg] = call.arguments;
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
    const valueId = this.compileExpression(valueArg, id);
    this.connectInput(id, valueId, "value", "value");
    return id;
  }

  compileScriptVars(call, parentId) {
    const paramCount = call.arguments.length;
    const id = this.addBlock({
      type: "script_variables",
      parent_id: parentId,
      mutation: `<mutation xmlns="http://www.w3.org/1999/xhtml" items="${paramCount}"></mutation>`,
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
    return this.compileStatementBlock(call, parentId, "repeat_forever", 0);
  }

  compileRepeatTimes(call, parentId) {
    const id = this.addBlock({
      type: "repeat_n_times",
      parent_id: parentId,
    });
    const timesId = this.compileExpression(call.arguments[0], id);
    this.connectInput(id, timesId, "times", "value");
    const body = callbackBody(call.arguments[1], this);
    const firstChild = this.compileStatementList(body, id);
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
    const firstChild = this.compileStatementList(body, id);
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

    const firstChild = this.compileStatementList(this.statementBodyStatements(statement.statement), id);
    if (firstChild) {
      this.connectInput(id, firstChild, "DO", "statement");
    }

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
    const firstChild = this.compileStatementList(body, id);
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
    const id = this.addBlock({
      type: returnsValue ? "procedures_2_callreturn" : "procedures_2_callnoreturn",
      parent_id: parentId,
      fields: { NAME: spec.name },
      mutation: procedureCallMutation(spec),
      shadows: {
        NAME: "",
        ...procedureCallShadows(spec.params),
      },
      ...(returnsValue ? { is_output: true } : {}),
    });

    let valueArgumentIndex = 1;
    spec.params.forEach((param, paramIndex) => {
      if (param.type !== "String") {
        return;
      }
      const argument = call.arguments[valueArgumentIndex];
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
    const id = this.addBlock({
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
      fields: { scope: stringLiteralValue(call.arguments[0], this) },
    });
  }

  compileValueStatement(call, parentId, type, inputName, argumentIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
    });
    const valueId = this.compileExpression(call.arguments[argumentIndex], id);
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
    return this.compileValueStatementWithFields(call, parentId, type, inputName, argumentIndex, {
      ...extraFields,
      increase: change < 0 ? "decrease" : "increase",
    });
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
      const timeId = this.compileExpression(call.arguments[1], id);
      this.connectInput(id, timeId, "time", "value");
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
    const valueId = this.compileResourceShadow(
      resourceType,
      fieldName,
      stringLiteralValue(call.arguments[argumentIndex], this),
      id,
    );
    this.connectInput(id, valueId, inputName, "value");
    return id;
  }

  compileListAppend(call, parentId) {
    const id = this.addBlock({ type: "list_append", parent_id: parentId });
    const valueId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, valueId, "list_item_value", "value");
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    return id;
  }

  compileListInsert(call, parentId) {
    const id = this.addBlock({ type: "list_insert_value", parent_id: parentId });
    const valueId = this.compileExpression(call.arguments[2], id);
    const indexId = this.compileExpression(call.arguments[1], id);
    this.connectInput(id, valueId, "list_item_value", "value");
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    this.connectInput(id, indexId, "list_index", "value");
    return id;
  }

  compileListReplace(call, parentId) {
    const id = this.addBlock({
      type: "replace_list_item",
      parent_id: parentId,
      fields: { item: stringLiteralValue(call.arguments[1], this) },
    });
    const indexId = this.compileExpression(call.arguments[2], id);
    const valueId = this.compileExpression(call.arguments[3], id);
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    this.connectInput(id, indexId, "list_index", "value");
    this.connectInput(id, valueId, "list_item_value", "value");
    return id;
  }

  compileListDelete(call, parentId) {
    const id = this.addBlock({
      type: "delete_list_item",
      parent_id: parentId,
      fields: { item: stringLiteralValue(call.arguments[1], this) },
    });
    const indexId = this.compileExpression(call.arguments[2], id);
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    this.connectInput(id, indexId, "list_index", "value");
    return id;
  }

  compileListCopy(call, parentId) {
    const id = this.addBlock({ type: "list_copy", parent_id: parentId });
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    this.connectListInput(id, "target_list", stringLiteralValue(call.arguments[1], this));
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

    const valueId = this.compileExpression(call.arguments[valueArgumentIndex], id);
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
    if (!expression) {
      this.unsupported(expression, "Missing expression");
    }
    if (ts.isIdentifier(expression)) {
      const boundExpression = this.lookupExpressionBinding(expression.text);
      if (boundExpression) {
        return this.compileExpression(boundExpression, parentId);
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
    this.unsupported(expression, "Unsupported expression");
  }

  compileExpressionCall(call, parentId) {
    const name = calleeName(call.expression);
    switch (name) {
      case "getVar":
        return this.addBlock({
          type: "variables_get",
          parent_id: parentId,
          fields: { variable: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
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
        return this.addBlock({
          type: "procedures_2_parameter",
          parent_id: parentId,
          fields: { param_name: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
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
            effect: stringLiteralValue(call.arguments[1], this),
          },
          is_output: true,
        });
      case "keyPressed":
        return this.addBlock({
          type: "check_key",
          parent_id: parentId,
          fields: {
            key: stringLiteralValue(call.arguments[0], this),
            type: stringLiteralValue(call.arguments[1], this),
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
        return this.addBlock({
          type: "list_get",
          parent_id: parentId,
          fields: { list: stringLiteralValue(call.arguments[0], this) },
          is_output: true,
        });
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
          fields: { type: stringLiteralValue(call.arguments[0], this) },
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
      default:
        if (this.inlineFunctions.has(name)) {
          return this.compileInlineExpressionFunction(call, parentId, name);
        }
        this.unsupported(call, `Unsupported expression call: ${name || "<unknown>"}`);
    }
  }

  compileInlineExpressionFunction(call, parentId, name) {
    return this.withInlineFunctionCall(call, name, () => {
      const fn = this.inlineFunctions.get(name);
      if (!ts.isBlock(fn.body)) {
        return this.compileExpression(fn.body, parentId);
      }
      const statements = Array.from(fn.body.statements);
      if (
        statements.length !== 1 ||
        !ts.isReturnStatement(statements[0]) ||
        !statements[0].expression
      ) {
        this.unsupported(call, `Expression function ${name} must contain one return expression`);
      }
      return this.compileExpression(statements[0].expression, parentId);
    });
  }

  withInlineFunctionCall(call, name, compile) {
    if (this.inlineCallStack.includes(name)) {
      this.unsupported(call, `Recursive inline function calls are not supported: ${name}`);
    }
    const fn = this.inlineFunctions.get(name);
    if (call.arguments.length !== fn.params.length) {
      this.unsupported(
        call,
        `Function ${name} expects ${fn.params.length} arguments but got ${call.arguments.length}`,
      );
    }
    const bindings = new Map();
    fn.params.forEach((param, index) => {
      bindings.set(param, call.arguments[index]);
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

  compileNativeBinaryExpression(expression, parentId) {
    const spec = nativeBinaryExpressionSpec(expression.operatorToken.kind);
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
    const id = this.addBlock({
      type: "list_item",
      parent_id: parentId,
      fields: { item: stringLiteralValue(call.arguments[1], this) },
      is_output: true,
    });
    const indexId = this.compileExpression(call.arguments[2], id);
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[0], this));
    this.connectInput(id, indexId, "list_index", "value");
    return id;
  }

  compileListUnaryExpression(call, parentId, type, listArgumentIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
      is_output: true,
    });
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[listArgumentIndex], this));
    return id;
  }

  compileListValueExpression(call, parentId, type, listArgumentIndex, valueArgumentIndex) {
    const id = this.addBlock({
      type,
      parent_id: parentId,
      is_output: true,
    });
    this.connectListInput(id, "list", stringLiteralValue(call.arguments[listArgumentIndex], this));
    const valueId = this.compileExpression(call.arguments[valueArgumentIndex], id);
    this.connectInput(id, valueId, "list_item_value", "value");
    return id;
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

  addBlock(block) {
    const id = `b${this.nextId}`;
    this.nextId += 1;
    this.blocks[id] = { id, ...block };
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
    const suffix = node && typeof node.pos === "number"
      ? ` at offset ${node.getStart(this.sourceFile)}`
      : "";
    fail(`${message}${suffix}`);
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
    default:
      return null;
  }
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

function stringLiteralValue(node, compiler) {
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

function sanitizeIdPart(value) {
  const sanitized = value
    .split("")
    .map((character) => (/[A-Za-z0-9_-]/.test(character) ? character : "-"))
    .join("");
  return sanitized || "procedure";
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
  return `<mutation xmlns="http://www.w3.org/1999/xhtml" def_id="${escapeXmlAttribute(spec.id)}" name="${escapeXmlAttribute(spec.name)}" type="${escapeXmlAttribute(spec.type)}">${args}</mutation>`;
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

function main() {
  if (!inputPath || !outputPath) {
    fail("usage: node compile-ts.mjs <input.ts> <output.json>");
  }

  const sourceText = fs.readFileSync(inputPath, "utf8");
  const sourceFile = ts.createSourceFile(
    path.basename(inputPath),
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const compiler = new WorkspaceCompiler(inputPath, sourceFile);
  const report = compiler.compile(sourceFile);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main();
