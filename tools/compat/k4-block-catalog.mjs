#!/usr/bin/env node
// Read-only static inventory. Never execute the player entrypoint or its factories.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import ts from "typescript";
import { drawingMainPaths, physicsMainPaths, propertyMainPaths, serviceTypes } from "./k4-partial-6-scope.mjs";
import { round7MainPaths } from "./k4-partial-7-scope.mjs";
import { round8MainPaths } from "./k4-partial-8-scope.mjs";

export function webpackModules(source) {
  let modules;
  vm.runInNewContext(source, { webpackJsonp: { push(chunk) {
    if (modules) throw new Error("Unexpected multiple webpack chunks");
    modules = chunk[1];
  } } }, { timeout: 5000 });
  if (!modules || Object.values(modules).some(value => typeof value !== "function")) {
    throw new Error("No webpack factory table");
  }
  return modules;
}

// Whole tables, including the legacy tables merged into F/lt/ht and every Ht
// merge input. Helpers, action ids and metadata objects are not domain blocks.
export const DOMAIN_TABLES = {
  oiyH: ["text_indexOf"],
  Tn6a: ["incompatible_block", "self_go_forward", "self_change_x", "self_appear",
    "self_gradually_appear", "start_as_a_mirror", "dispose", "self_distance_to", "get",
    "play_video", "self_enable_physics", "get_mobile_slope_value", "self_pen_down",
    "set_camera_status", "wood_block_get", "clone", "physics2_enable_force", "controller_shadow"],
  TL4g: ["cloud_variables_get"],
  xQfl: ["get_audios"],
  ls7Z: ["set_digital_port_status", "led_light_on", "microbit_when_press_key"],
  fhSb: ["wood_block_get"], // Player override, installed after Tn6a.
};
const REGISTRY_MODULES = ["TL4g", "Tn6a", "VlbI", "fhSb", "tSBa", "xQfl"];

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}
function key(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}
function factoryAst(id, factory) {
  if (!factory) throw new Error(`Missing official module ${id}`);
  const text = `(${factory.toString()})`;
  const ast = ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error(`Unparseable official factory ${id}`);
  return ast;
}

export function officialInventory(source, options = {}) {
  const modules = webpackModules(source), rows = new Map();
  const domainTables = options.domainTables ?? DOMAIN_TABLES;
  const compilerModule = options.compilerModule ?? "Qeyy";
  const expectedRegistries = options.registryModules ?? REGISTRY_MODULES;
  const audit = { tables: [], responders: [], compilerTables: [], registryModules: [] };
  function add(type, module, offset, registration, table) {
    const row = rows.get(type) ?? { type, official: [] };
    row.official.push({ module, offset, registration, ...(table ? { table } : {}) });
    rows.set(type, row);
  }
  // Parse all factories: fail closed if a new registry writer is introduced,
  // and find responder declarations wherever they occur (not only two modules).
  for (const [id, factory] of Object.entries(modules)) {
    if (!domainTables[id] && id !== compilerModule && !/domain_function|responder_blocks/.test(factory.toString())) continue;
    const ast = factoryAst(id, factory), anchors = domainTables[id] ?? [], found = new Set();
    let registryWriter = false;
    walk(ast, node => {
      if (ts.isPropertyAssignment(node) && key(node.name) === "domain_function") registryWriter = true;
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment);
        const hits = anchors.filter(anchor => properties.some(p => key(p.name) === anchor));
        if (hits.length) {
          for (const anchor of hits) {
            if (found.has(anchor)) throw new Error(`Ambiguous table ${id}/${anchor}`);
            found.add(anchor);
          }
          if (properties.length !== node.properties.length || properties.some(p =>
            !key(p.name) || !(ts.isFunctionExpression(p.initializer) || ts.isArrowFunction(p.initializer)))) {
            throw new Error(`Non-function/dynamic property in ${id}/${hits[0]}`);
          }
          audit.tables.push({ module: id, anchor: hits[0], offset: node.getStart(ast) - 1, count: properties.length });
          for (const property of properties) add(key(property.name), id, property.getStart(ast) - 1, "domain", hits[0]);
        }
      }
      if (ts.isPropertyAssignment(node) && key(node.name) === "responder_blocks") {
        if (!ts.isArrayLiteralExpression(node.initializer)) throw new Error(`Dynamic responders in ${id}`);
        audit.responders.push({ module: id, offset: node.getStart(ast) - 1, count: node.initializer.elements.length });
        for (const responder of node.initializer.elements) {
          const property = responder.properties?.find(p => p.name && key(p.name) === "id");
          if (!property || !ts.isStringLiteral(property.initializer)) throw new Error(`Dynamic responder id in ${id}`);
          add(property.initializer.text, id, property.getStart(ast) - 1, "responder");
        }
      }
    });
    if (registryWriter) audit.registryModules.push(id);
    if (found.size !== anchors.length) throw new Error(`Missing domain table in ${id}: ${anchors.filter(a => !found.has(a))}`);
  }
  for (const id of Object.keys(domainTables)) if (!modules[id]) throw new Error(`Missing official module ${id}`);
  audit.registryModules.sort();
  if (JSON.stringify(audit.registryModules) !== JSON.stringify([...expectedRegistries].sort())) {
    throw new Error(`Re-audit domain registry writers: ${audit.registryModules.join(", ")}`);
  }
  // Compiler enum declarations are parsed, not evaluated. Repeated ids retain
  // their own offset in each enum; BlockOutputType is deliberately excluded.
  const ast = factoryAst(compilerModule, modules[compilerModule]);
  walk(ast, node => {
    if (!ts.isCallExpression(node)) return;
    let factory = node.expression;
    while (ts.isParenthesizedExpression(factory)) factory = factory.expression;
    if (!ts.isFunctionExpression(factory)) return;
    const names = new Set();
    for (const arg of node.arguments) walk(arg, child => {
      if (ts.isPropertyAccessExpression(child) && child.name.text.endsWith("_BLOCKS")) names.add(child.name.text);
    });
    if (!names.size) return;
    if (names.size !== 1) throw new Error("Ambiguous compiler table");
    const name = [...names][0];
    let count = 0;
    walk(factory.body, child => {
      if (!ts.isBinaryExpression(child) || child.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          !ts.isStringLiteral(child.right) || !ts.isElementAccessExpression(child.left)) return;
      const inner = child.left.argumentExpression;
      if (!ts.isBinaryExpression(inner) || !ts.isPropertyAccessExpression(inner.left) ||
          inner.left.name.text !== child.right.text || !ts.isNumericLiteral(inner.right)) {
        throw new Error(`Re-audit compiler enum ${name}`);
      }
      add(child.right.text, compilerModule, inner.left.name.getStart(ast) - 1, `compiler:${name}`);
      count++;
    });
    if (!count) throw new Error(`Empty compiler table ${name}`);
    audit.compilerTables.push({ module: compilerModule, name, offset: node.getStart(ast) - 1, count });
  });
  if (!audit.compilerTables.length) throw new Error("No compiler block tables");
  return { rows: [...rows.values()].sort((a, b) => a.type.localeCompare(b.type, "en")), audit };
}

export function officialCatalog(source, options) { return officialInventory(source, options).rows; }

export function corpusFrequency(directory) {
  const counts = new Map();
  const files = fs.readdirSync(directory).filter(f => f.endsWith(".bcm")).sort();
  let workspaceOwners = 0, compiledOwners = 0;
  function record(type) { if (typeof type === "string") counts.set(type, (counts.get(type) ?? 0) + 1); }
  for (const file of files) {
    const project = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8").replace(/^\uFEFF/, ""));
    const owners = [...Object.entries(project.theatre?.actors ?? {}), ...Object.entries(project.theatre?.scenes ?? {})];
    const withWorkspace = new Set();
    for (const [ownerKey, owner] of owners) {
      let workspace = owner.block_data_json;
      if (typeof workspace === "string") workspace = JSON.parse(workspace);
      if (!workspace || typeof workspace !== "object" || !workspace.blocks || typeof workspace.blocks !== "object") continue;
      withWorkspace.add(owner.id ?? ownerKey);
      withWorkspace.add(ownerKey);
      workspaceOwners++;
      // Empty workspaces are authoritative too. Shadow backups, mutation data,
      // and next/input references cannot introduce a second occurrence.
      for (const block of Object.values(workspace.blocks)) record(block?.type);
    }
    for (const entity of project.compile_result ?? []) {
      if (withWorkspace.has(entity.id)) continue;
      compiledOwners++;
      // Map values are roots with nested next_block/child_block/params ASTs,
      // not a flat workspace. Procedures can reference the same ids as roots.
      const seen = new Set();
      const pending = [entity];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== "object") continue;
        if (typeof value.type === "string" && typeof value.id === "string" && !seen.has(value.id)) {
          record(value.type); seen.add(value.id);
        }
        for (const [key, child] of Object.entries(value)) if (key !== "mutation" && key !== "shadows") pending.push(child);
      }
    }
  }
  return { files: files.length, workspaceOwners, compiledOwners, counts };
}

// Small Rust lexical reader: comments, strings and braces must not change a
// function boundary. This is a dispatch audit, not a general Rust parser.
export function rustTokens(source) {
  const tokens = [];
  let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) { at++; continue; }
    if (source.startsWith("//", at)) { const end = source.indexOf("\n", at); at = end < 0 ? source.length : end; continue; }
    if (source.startsWith("/*", at)) {
      let depth = 1; at += 2;
      while (at < source.length && depth) {
        if (source.startsWith("/*", at)) { depth++; at += 2; }
        else if (source.startsWith("*/", at)) { depth--; at += 2; }
        else at++;
      }
      if (depth) throw new Error("Unclosed Rust comment");
      continue;
    }
    const start = at, raw = source.slice(at).match(/^r(#+)?"/);
    if (raw) {
      const closing = `"${raw[1] ?? ""}`, end = source.indexOf(closing, at + raw[0].length);
      if (end < 0) throw new Error("Unclosed raw string");
      at = end + closing.length;
      tokens.push({ value: source.slice(start + raw[0].length, end), string: true, start, end: at });
      continue;
    }
    if (source[at] === '"') {
      at++;
      while (at < source.length && source[at] !== '"') { at += source[at] === "\\" ? 2 : 1; }
      if (at >= source.length) throw new Error("Unclosed Rust string");
      at++;
      tokens.push({ value: source.slice(start + 1, at - 1), string: true, start, end: at });
      continue;
    }
    const character = source.slice(at).match(/^'(?:\\.|[^'\r\n])'/);
    if (character) { at += character[0].length; tokens.push({ value: "<char>", start, end: at }); continue; }
    const word = source.slice(at).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    at += word ? word[0].length : (source.startsWith("=>", at) || source.startsWith("==", at) ? 2 : 1);
    tokens.push({ value: source.slice(start, at), start, end: at });
  }
  return tokens;
}
function closing(tokens, start) {
  const pair = { "{": "}", "(": ")", "[": "]" }, stack = [];
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.string) continue;
    if (pair[token.value]) stack.push(pair[token.value]);
    else if (["}", ")", "]"].includes(token.value)) {
      if (stack.pop() !== token.value) throw new Error("Unbalanced Rust delimiter");
      if (!stack.length) return i;
    }
  }
  throw new Error("Unclosed Rust delimiter");
}
export function rustFunction(source, name, occurrence = 0) {
  const tokens = rustTokens(source);
  const at = tokens.findIndex((token, i) => token.value === "fn" && tokens[i + 1]?.value === name && occurrence-- === 0);
  if (at < 0) throw new Error(`Missing Rust function ${name}`);
  const open = tokens.findIndex((token, i) => i > at && token.value === "{");
  const end = closing(tokens, open);
  return { tokens: tokens.slice(open + 1, end), start: tokens[at].start, end: tokens[end].end };
}
function location(source, file, token, label) {
  return `${file}:${source.slice(0, token.start).split("\n").length} (${label})`;
}
function selector(tokens) { return tokens.map(t => t.value).join(""); }
export function rustDispatch(source, name, file = "fixture.rs", options = {}) {
  const all = rustTokens(source);
  const count = all.filter((t, i) => t.value === "fn" && all[i + 1]?.value === name).length;
  if (!count) throw new Error(`Missing Rust function ${name}`);
  const tokens = Array.from({ length: count }, (_, i) => rustFunction(source, name, i).tokens).flat();
  const result = new Map();
  const isKind = value => options.selectors ? options.selectors.includes(value) :
    /^(?:kind(?:\.as_str\(\))?|native\.as_str\(\))$/.test(value);
  const add = (token, label) => {
    if (!token.string) return;
    const entries = result.get(token.value) ?? [];
    entries.push(location(source, file, token, label));
    result.set(token.value, entries);
  };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === "match") {
      const open = tokens.findIndex((t, j) => j > i && t.value === "{");
      if (open < 0 || !isKind(selector(tokens.slice(i + 1, open)))) continue;
      const end = closing(tokens, open);
      let cursor = open + 1;
      while (cursor < end) {
        while (tokens[cursor]?.value === ",") cursor++;
        const armStart = cursor;
        while (cursor < end && tokens[cursor].value !== "=>") {
          if (!tokens[cursor].string && ["{", "(", "["].includes(tokens[cursor].value)) cursor = closing(tokens, cursor);
          cursor++;
        }
        if (cursor >= end) break;
        const guard = tokens.slice(armStart, cursor).findIndex(t => t.value === "if");
        const patterns = tokens.slice(armStart, guard < 0 ? cursor : armStart + guard);
        if (patterns.every(t => t.string || t.value === "|")) for (const t of patterns) if (t.string) add(t, name);
        cursor++;
        if (tokens[cursor]?.value === "{") cursor = closing(tokens, cursor) + 1;
        else {
          while (cursor < end && tokens[cursor].value !== ",") {
            if (!tokens[cursor].string && ["{", "(", "["].includes(tokens[cursor].value)) cursor = closing(tokens, cursor);
            cursor++;
          }
        }
      }
    }
    if (tokens[i].value === "matches" && tokens[i + 1]?.value === "!" && tokens[i + 2]?.value === "(") {
      const end = closing(tokens, i + 2);
      let comma = i + 3;
      while (comma < end && tokens[comma].value !== ",") comma++;
      if (!isKind(selector(tokens.slice(i + 3, comma)))) continue;
      for (let j = comma + 1; j < end && tokens[j].value !== "if"; j++) if (tokens[j].string) add(tokens[j], name);
    }
    if (tokens[i].value === "kind" && tokens[i + 1]?.value === "==" && tokens[i + 2]?.string) add(tokens[i + 2], name);
  }
  return result;
}

export function mappingStatus(root, rows) {
  const file = "src/kitten4.rs", source = fs.readFileSync(path.join(root, file), "utf8");
  const aliasFile = "src/kitten4/aliases.rs", alias = fs.readFileSync(path.join(root, aliasFile), "utf8");
  const direct = rustDispatch(source, "translate", file, { selectors: ["native.as_str()"] });
  // The earlier match in translate is export-only. Keep only evidence inside
  // the native dispatch, whose exact syntax is deliberately a fail-closed anchor.
  const translate = rustFunction(source, "translate");
  const native = translate.tokens.findIndex((t, i) => t.value === "match" &&
    selector(translate.tokens.slice(i + 1, i + 7)) === "native.as_str(){");
  if (native < 0) throw new Error("Re-audit translate native dispatch");
  const nativeLine = source.slice(0, translate.tokens[native].start).split("\n").length;
  for (const [type, entries] of direct) {
    const kept = entries.filter(entry => Number(entry.match(/:(\d+) /)[1]) >= nativeLine);
    if (kept.length) direct.set(type, kept); else direct.delete(type);
  }
  const lower = rustDispatch(source, "lower_block", file);
  const aliases = rustDispatch(alias, "lower_legacy_alias", aliasFile);
  // These are explicit VM-boundary dispatches, not all strings in a module.
  // Require the corresponding call in lower_block before counting evidence.
  const extensions = new Map();
  for (const [module, helper] of [["common", "lower_common"], ["devices", "lower_devices"], ["audio_aliases", "lower_audio_alias"], ["third", "lower_third"], ["media_devices", "lower_media_devices"], ["effects", "lower_effect"]]) {
    const extensionFile = `src/kitten4/${module}.rs`;
    if (!source.includes(`${module}::${helper}(block`)) continue;
    const extension = fs.readFileSync(path.join(root, extensionFile), "utf8");
    for (const [type, locations] of rustDispatch(extension, helper, extensionFile)) {
      extensions.set(type, [...(extensions.get(type) ?? []), ...locations]);
    }
  }
  const stubs = rustDispatch(source, "is_stub", file);
  const engineFile = "src/engine.rs", engine = fs.readFileSync(path.join(root, engineFile), "utf8");
  const physicsFile = "src/engine/physics.rs", physics = fs.readFileSync(path.join(root, physicsFile), "utf8");
  const lowerTokens = rustFunction(source, "lower_block").tokens;
  const hasPrefix = prefix => lowerTokens.some((t, i) => t.value === "starts_with" && lowerTokens[i + 2]?.value === prefix);
  const physicsEvidence = hasPrefix("physics2_") ? rustDispatch(physics, "parse", physicsFile) : new Map();
  // The reporter bypasses Command::parse; require explicit VM dispatch too.
  const propertyAt = engine.indexOf('"physics2_get_property" =>');
  if (propertyAt >= 0 && hasPrefix("physics2_")) {
    physicsEvidence.set("physics2_get_property", [location(engine, engineFile, { start: propertyAt }, "physics2_get_property")]);
  }
  const special = new Map();
  for (const [type, helper] of [["bump", "lower_bump"], ["bump_into_color", "lower_node"], ["when", "lower_when"]]) {
    const fn = rustFunction(source, helper);
    special.set(type, [location(source, file, { start: fn.start }, helper)]);
  }
  const deviceTypes = new Set(["get_running_device", "check_running_device", "username_get", "user_id_get", "connected_users_get",
    "get_voice_volume", "enable_voice_detection", "wood_block_get", "wood_block_set", "set_camera_status", "get_orientation",
    "get_mobile_slope_value", "get_mobile_rocker_value", "mobile_vibrate", "get_camera_data", "set_camera_opcity"]);
  const partialTypes = new Set(["self_change_effect_3", "self_change_effect", "self_change_effect_2",
    "self_set_effect_2", "self_set_effect", "self_clear_effects", "get_clone_index_property", "set_scene_transition",
    "image_stamp", "stamp"]);
  const thirdMedia = rustDispatch(fs.readFileSync(path.join(root, "src/kitten4/media_devices.rs"), "utf8"), "lower_media_devices");
  const thirdPhysics = new Set(["self_texture", "set_force", "set_force_by_vector", "set_gravity", "set_gravity_by_orientation", "set_velocity_by_vector"]);
  function engineAt(literal) {
    const at = engine.indexOf(`"${literal}"`);
    return at < 0 ? [] : [location(engine, engineFile, { start: at }, literal)];
  }
  return rows.map(row => {
    let evidence = [...(direct.get(row.type) ?? []), ...(lower.get(row.type) ?? []), ...(aliases.get(row.type) ?? []), ...(extensions.get(row.type) ?? []), ...(special.get(row.type) ?? [])];
    if (row.type.startsWith("physics2_") && physicsEvidence.has(row.type)) {
      evidence.push(...physicsEvidence.get(row.type));
    }
    // Only actual cloud-list suffixes, never an arbitrary prefix wildcard.
    if (/^cloud_lists_(get|get_value|length|is_exist|index_of)$/.test(row.type) &&
        lowerTokens.some((t, i) => t.value === "strip_prefix" && lowerTokens[i + 2]?.value === "cloud_lists_")) {
      const fn = rustFunction(source, "cloud_list");
      evidence.push(location(source, file, { start: fn.start }, "cloud_list"));
    }
    const stub = stubs.has(row.type);
    if (stub) evidence.push(...stubs.get(row.type));
    const degraded = (deviceTypes.has(row.type) || row.official.some(e => e.module === "ls7Z")) && (stub || evidence.length);
    let status = degraded ? "设备降级" : stub ? "stub" : evidence.length ? "已实现" : "缺失";
    let semantics = status === "已实现" ? "mapped-not-parity" : status === "缺失" ? "unsupported" : status === "stub" ? "no-effect" : "offline/device";
    const limitations = [];
    if (status === "缺失") limitations.push("未找到 K4 导入/VM lowering；保留不透明块不等于可执行支持");
    if (stub) limitations.push("is_stub 明确列出：无效果或固定返回值；不视为完整实现");
    if (degraded) limitations.push("本地无对应设备/登录服务；固定值、空值或无效果，不代表真实设备语义");
    if (aliases.has(row.type)) limitations.push("legacy alias 归一化；继承目标积木的字段、子选项与运行时限制");
    const cloud = /cloud_|ranking/.test(row.type);
    if (cloud && evidence.length) { semantics = "partial"; limitations.push("云值/榜单使用本地状态或可选后端；不保证官方联网、权限、持久化和排名 UI 一致"); }
    if ((thirdPhysics.has(row.type) || row.type.startsWith("physics2_") || /^(?:self_(?:enable_physics|disable_physics|set_friction|set_restitution|set_boundary|set_mass|set_density)|set_actor_as|allow_rotate|get_physics_property|set_velocity)$/.test(row.type)) && evidence.length) {
      if (!stub) semantics = "partial";
      limitations.push("刚体兼容层：求解器/轮廓与官方不同；flexibility 实现硬体 strength adapter，软体粒子形变仍未实现，见 kitten4-third-physics.md");
    }
    if (partialTypes.has(row.type) && evidence.length) {
      if (status === "已实现") semantics = "partial";
      limitations.push(row.type === "get_2" ? "仅坐标 0/1 与方向 3；其他属性走后续 lowering 或仍不支持" :
        ["get", "get_3"].includes(row.type) ? "仅显式属性/角色局部变量；未列出的属性仍不支持" :
        "存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致");
    }
    if (["stamp", "image_stamp", "set_scene_transition"].includes(row.type) && evidence.length) {
      limitations.push("第二轮 18 份原创夹具官方实测：严格尺寸/10000 上限、场景错误、原图无角色滤镜/alpha、目的矩形 floor、过渡别名与任意 direction 已补齐；字体/像素、颜色 raster 与真实过渡动画仍有限制，见 kitten4-partial-drawing.md");
    }
    if (cloud && evidence.length) {
      limitations.push("第二轮 7 份原创夹具/56 帧离线实测：数组增减 primitive 转换、列表别名、严格索引与 undefined 项读取已回归；在线权限/并发/重连及孤立 surrogate 未验证，见 kitten4-partial-cloud-2.md");
      limitations.push("k4cloud新增5件原创夹具138个连续官方update，17个类型均有真实block事件；公私标量/全部列表操作、PIXI监视器与DOM排行榜loading壳均已取证，双VM逐帧回归已通过，见 k4cloud-offline.md、k4cloud-coverage.md。在线服务、监视器布局/交互及排行榜壳仍未认证");
    }
    if (["set_actor_as", "physics2_enable_force", "set_velocity", "physics2_set_actor_as", "physics2_set_speed"].includes(row.type) && evidence.length) {
      limitations.push("第二轮 7 份原创物理夹具/210 帧官方实测：旧 exit 即时 static 清速、新 forceable/ticker 延迟和禁用动态体保速已修正；不声明跨求解器等价，见 kitten4-physics-partial.md");
    }
    if (["physics2_enable_force", "physics2_set_gravity", "physics2_set_speed", "set_velocity", "set_velocity_by_vector", "physics2_set_force", "physics2_set_mass", "physics2_set_roughness", "physics2_set_resilience", "physics2_set_boundary"].includes(row.type) && evidence.length) {
      limitations.push("第三轮 11 份原创夹具/660 帧官方轨迹：首次世界初始化、自由落体积分、20px/tick 向量限速、边界摩擦与全不透明矩形轮廓已修正；接触仍有误差，复杂轮廓/软体未对齐，见 kitten4-physics-trajectory-3.md");
    }
    if (row.type === "set_scene_transition" && evidence.length) {
      limitations.push("第三轮 12 份原创夹具/780 帧：slide/bounce/fade 位置与 alpha、非法名称显示已回归；distort 截图扭曲与完成回调调度未对齐，见 kitten4-partial-transition-3.md");
    }
    if (["stamp", "image_stamp"].includes(row.type) && evidence.length) {
      limitations.push("第三轮 11 份原创画笔夹具：起点圆盘/闭合线、半透明叠色、零坐标重复落笔、填充与印章交错已实测；复杂字体/纹理和跨帧量化仍未验证，见 kitten4-partial-pen-3.md");
    }
    if (["self_change_effect_3", "self_change_effect", "self_change_effect_2", "self_set_effect_2", "self_set_effect", "self_clear_effects"].includes(row.type)) {
      limitations.push("8 种 scope、严格 number、别名增减、纹理尺寸 clamp、场景及小数 reporter 经 11 份原创夹具/1794 状态观察实测；ASCII 状态已支持但像素渲染、ELASTIC 与 iOS 仍未验证，见 kitten4-partial-effects.md");
    }
    if (["get_stage_info", "self_set_draggable"].includes(row.type) && evidence.length) {
      semantics = "offline-oracle-verified";
      limitations.push("固定离线包积木本体分支已有原创夹具实测及双 VM 回归；舞台尺寸/严格 draggable 字段、克隆继承与场景错误见 kitten4-partial-misc.md；不扩大为浏览器手势或物理引擎完全一致");
    }
    if (row.type === "self_set_role_camp" && evidence.length) {
      semantics = "offline-oracle-verified";
      limitations.push("第四轮任意字符串（含 camp_green/空串/Unicode）、四阵营动态碰撞、克隆独立继承及重启逐帧对齐；初始 group 被官方加载器忽略，场景错误沿用既有官方证据；见 kitten4-partial-camp-4.md。不扩大为物理碰撞求解器全等");
    }
    if (row.type === "wood_block_get") limitations.push("官方 fhSb 玩家覆盖也返回 NaN，不执行 Python；这不是 Python 功能支持");
    if (row.type === "set_costume_by_id") {
      semantics = "partial";
      limitations.push("第四轮独立动态 ID 命令：字段优先、动态文本/数组键、角色与场景全局纹理及错误尾部已有25份原创官方探针；显式 null、复杂对象/数组、资源加载与平台重建仍未验证，保留 partial，见 kitten4-partial-costume-4.md");
    }
    if (row.type === "set_entity_show_hide") {
      semantics = "partial";
      limitations.push("第五轮17份原创夹具408官方帧：渐变尾部update相位、竞争alpha斜率叠加、取消调用方冻结、隐藏清理held指针、零/负/NaN/Infinity时长已实测；见 kitten4-partial-visibility-5.md。第五轮曾记录的克隆删除一帧差异已由第七轮修复；场景/悬空UUID/非60Hz与完整手势边界未验证");
    }
    if (row.type === "self_shake" && evidence.length) {
      semantics = "partial";
      limitations.push("5 单位四方向逐更新抖动、阻塞及归位已有源码推导回归；与官方任务队列的逐帧相位/结束续接、物理刚体受力、竞争移动及取消未验证");
    }
    if (["play_audio", "play_audio_and_wait", "set_volume_or_rate", "change_volume_or_rate", "stop_all_audios"].includes(row.type) && evidence.length) {
      semantics = "partial";
      limitations.push("legacy 音频已回归：动态目标及有符号增量已纠偏；严格 ID、非有限增量、内部 lock/improvise、微信录音分支仍有限制，见 kitten4-audio-aliases.md");
    }
    if (row.type === "text_indexOf" && evidence.length) {
      semantics = "partial";
      limitations.push("第二轮原创离线实测验证 FIRST/LAST、空 needle 的 1-based UTF-16 位置、FIND 转型、数组 VALUE 严格搜索和非字符串/非数组错误；孤立 surrogate、无效 END 与 nullish 参数未验证，见 kitten4-partial-text-2.md");
    }
    if (thirdMedia.has(row.type) && evidence.length) {
      semantics = "partial";
      limitations.push("媒体/设备 host 契约：MIDI 时长、阻塞请求、完成结果与显式事件已有回归；viewer 尚未接入摄像头/录音/语音识别/MIDI/设备硬件，不能宣称实际设备效果；现有 TTS language 已接线但音色不等价，翻译仅离线失败 fallback，见 kitten4-third-media.md");
      if (["get_voice_answer", "get_recognition_result", "midi_get", "translate_result"].includes(row.type)) {
        limitations.push("第二轮原创官方离线实测默认 voice/scan、falsy translate 与 midi 对象最终值；异步帧相位、在线及实际设备未验证，见 kitten4-partial-text-2.md");
      }
    }
    if (["block_on_break", "mouse_on_emit", "player_position_on_change", "incompatible_block", "incompatible_output_block"].includes(row.type) && evidence.length) {
      limitations.push("实现该固定官方包的抛错边界（枚举旧事件无 domain handler）；不是可工作的新增事件，不静默执行或忽略");
    }
    if (["get", "get_2", "get_3"].includes(row.type) && evidence.length) {
      semantics = "partial";
      limitations.push("get/get_2/get_3 统一原生属性：原22夹具外，第五轮补全局列表引用与双向修改、执行时惰性未知UUID槽、空造型编号/名称；8夹具96官方帧与40对零差异画布见 kitten4-partial-properties-5.md；非有限状态、删除竞争、iOS ASCII及其他资源加载边界仍未验证");
    }
    if (row.type === "get_clone_index_property" && evidence.length) {
      limitations.push("严格索引类型与范围、场景/缺克隆错误及全属性已有离线官方实测；第五轮新增UUID列表引用与惰性槽逐帧/像素证据见 kitten4-partial-properties-5.md；继承属性/效果、删除竞争与跨平台边界仍有限制");
    }
    if (row.official.some(e => e.module === "ls7Z")) {
      limitations.push("官方此离线包 ls7Z 本身为提示/noop/NaN；本地省略硬件 toast UI，事件不触发；不能据此声称硬件控制已支持，逐项分类见 kitten4-devices.md");
      if (["is_digital_port_status", "get_analog_port_value"].includes(row.type)) {
        limitations.push("官方提示后返回 undefined：仅命令上下文降级；表达式上下文明确拒绝编译，不伪造 NaN/0");
      }
    }
    if (row.official.every(e => e.registration.startsWith("compiler:"))) limitations.push("仅编译器结构表证据，不表示存在普通 domain handler");
    if (status === "已实现" && semantics !== "offline-oracle-verified") {
      const probed = ["get", "get_2", "get_3", "get_clone_index_property", "self_set_role_camp",
        "self_change_effect_3", "self_change_effect", "self_change_effect_2", "self_set_effect_2", "self_set_effect", "self_clear_effects",
        "stamp", "image_stamp", "set_scene_transition", "set_actor_as", "physics2_enable_force", "set_velocity", "physics2_set_actor_as", "physics2_set_speed",
        "text_indexOf", "set_costume_by_id", "get_voice_answer", "get_recognition_result", "midi_get", "translate_result",
        ...(cloud ? [row.type] : [])];
      limitations.push(probed.includes(row.type) ? "已有指定输入离线实测；完整剩余边界见专项说明，不声称全语义一致" :
        "静态分派证据；未逐字段、错误路径、时序与官方差分验证");
    }
    let unverifiedBoundaries;
    if (physicsMainPaths.has(row.type) && evidence.length && !stub) {
      semantics = "main-path-verified";
      unverifiedBoundaries = [
        "未验证边界：复杂轮廓、软体、拖拽/设备输入、多场景与非60Hz组合；允许旋转只验证自由刚体开关，不证明碰撞角冲量相同",
        "已知差异：Rapier与LiquidFun接触求解器不等价，既有bounce最大位置误差2.797382832px、friction为0.703993056px；不是已验证的完整物理兼容",
        "未验证边界：精确60Hz等待截止点存在浮点相位差，.04秒控制夹具不覆盖该边界",
      ];
      limitations.push("第六轮硬体控制主路径：10份原创夹具400个官方update，其中9件360帧位置/旋转/全部变量双VM一致；modern-membership当时仅有界回归，第七轮已修漏积分并严格重放。见 kitten4-partial-physics-6.md、kitten4-partial-physics-7.md。不是求解器全集认证");
    }
    if (serviceTypes.has(row.type) && evidence.length && !stub) {
      status = "设备降级";
      semantics = "partial";
      limitations.push("B类设备/服务降级：仅本地状态、失败fallback或显式宿主请求；不虚构设备/在线成功，逐项无设备行为见 kitten4-partial-6.md");
    }
    if (cloudDataTypes.has(row.type) && evidence.length && !stub) {
      status = "已实现";
      semantics = "offline-oracle-verified";
      unverifiedBoundaries = ["仅固定官方包匿名离线数据分支；未验证在线身份/权限、服务端数据、重连与孤立UTF-16 surrogate；本机共享后端是独立测试协议，不是官方联网认证"];
      limitations.push("离线数据积木本体：k4cloud 5项、kitten4_cloud 11项、kitten4_partial_cloud_2 7项双VM回归通过；0/[]初值、公私计算、类型/长度/索引、列表别名逐帧约束。显隐和排行榜五项仍partial，不声明舞台像素全等");
    }
    if (propertyMainPaths.has(row.type) && evidence.length && !stub) {
      semantics = "main-path-verified";
      unverifiedBoundaries = ["未验证边界：删除竞争/悬空UUID、异步资源加载、非有限几何、iOS/ASCII与复杂对象输入；不是全属性平台全集认证"];
      limitations.push("第六轮活实体/活克隆与已加载造型主路径：8份原创夹具192官方update、双VM384帧状态与192对画布changedPixels=0（RGB容差8）；见 kitten4-partial-properties-6.md。显隐及删除生命周期另由第七轮专项约束，不扩展成任意删除竞争认证");
    }
    if (drawingMainPaths.has(row.type) && evidence.length && !stub) {
      semantics = "main-path-verified";
      unverifiedBoundaries = ["未验证边界：平台字体/RTL、极端资源、翻转/多倍率、ELASTIC、颜色检测raster与任意并发；不是所有字体/纹理及滤镜shader认证"];
      limitations.push("第六轮主路径：文字三align/旋转/半透明跨帧36对RGB全等；图像源alpha/pivot/旋转24帧超差0；all-scope clear后10帧超差0，见 kitten4-partial-effects-6.md。设置阶段pixelate/twist/ASCII仍有真实差异，其setter不升级");
    }
    const round7 = round7MainPaths.get(row.type);
    if (round7 && evidence.length && !stub) {
      semantics = "main-path-verified";
      unverifiedBoundaries = [round7.boundary];
      limitations.push(`第七轮主路径：${round7.scope}；见 ${round7.evidence}。边界不计作完整语义认证`);
    }
    const round8=round8MainPaths.get(row.type);
    if(round8&&evidence.length&&!stub){
      semantics='main-path-verified';unverifiedBoundaries=[round8.boundary];
      // Earlier negative results remain in historical documents, not as stale
      // claims that those exact trajectories still fail in the current VM.
      for(let i=limitations.length-1;i>=0;i--)if(/已知接触求解器差异|已知差异：Rapier与LiquidFun/.test(limitations[i]))limitations.splice(i,1);
      limitations.push(`第八轮主路径：${round8.scope}；见 ${round8.evidence}。${round8.boundary}`);
    }
    if(['self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2'].includes(row.type)){
      limitations.push('第八轮真实VM 34件262对全画布，RGB容差0/1/8分列；ASCII独立/场景及场景/舞台外twist已修复；ripple素材条件未验证、ASCII组合仍有负例，setter仍partial。见 kitten4-partial-effects-8.md');
    }
    if(row.type==='self_shake')limitations.push('第八轮修复帧尾归位和下一update续接，零时钟原点六件240帧双VM全变量/x/y一致；官方原点改变浮点严格阈值，保留partial。见 kitten4-shake-8.md');
    if(row.type==='set_scene_transition')limitations.push('第九轮14件910个连续官方update/全画布：补distort双截图扭曲与100ms延迟，修复完成回调前运行组提前切换；严格端点后下一update激活。纹理栅格仍有残差，none启动顺序有负例，真实时钟/竞争切场未验证，仍partial。见 kitten4-partial-transition-9.md');
    if(row.type==='self_shake')limitations.push('第九轮4夹具×4原点共640官方update；新增显式shake时钟原点配置，同原点JIT/解释器全部typed变量与坐标逐帧一致，重启保留配置；真实墙钟原点默认不同及物理/并发边界仍partial。见 kitten4-shake-9.md');
    if(['physics2_set_texture','physics2_set_flexibility'].includes(row.type))limitations.push('第九轮4件420官方update记录粒子与组身份，修复重复soft幂等及scale帧尾重建清速；未实现粒子求解/soft滤镜。impact25/90的刚体点位误差下界分别3.386681/16.340179px，矩形输入首帧超时未验证，不升级。见 kitten4-partial-physics-9.md');
    if(['self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2'].includes(row.type))limitations.push('第九轮修复ASCII最终投影的多余POT复制；9件64对完整画布中60对RGB容差8零超差，twist与舞台外组合负例消除；全链仍65像素、hue仍1像素负例，ripple缺素材例外，仍partial。见 kitten4-partial-effects-9.md');
    // Helpful VM anchors for special rewrites without blanket string matching.
    const target = { set_actor_as: "kitten4_legacy_", set_velocity: "kitten4_set_velocity", set_entity_show_hide: "kitten4_entity_visibility" }[row.type];
    if (target && evidence.length) evidence.push(...engineAt(target));
    return { ...row, status, semantics, mapping: [...new Set(evidence)], limitations,
      ...(unverifiedBoundaries ? { unverifiedBoundaries } : {}) };
  });
}

export const cloudDataTypes = new Set(["cloud_variables_get", "cloud_variables_set", "change_cloud_variable",
  "cloud_lists_get", "cloud_lists_get_value", "cloud_lists_length", "cloud_lists_is_exist",
  "cloud_lists_index_of", "cloud_lists_append", "cloud_lists_insert_value", "cloud_lists_replace", "cloud_lists_delete"]);

export function markdownReport(report) {
  const lines = ["# Kitten 4 指定官方离线内核积木覆盖清单", "", "<!-- Generated by tools/compat/k4-block-catalog.mjs; metadata only, no official source or project contents. -->", "",
    "## 范围与口径", "",
    `- 官方边界：只读本地离线播放器的 \`${report.bundle}\`，SHA-256：\`${report.sha256}\`。不是编辑器全版本或线上服务全集。`,
    "- 与在线发布物的身份关系仅限本次取证版本：主包除 DI 暴露外一致，三份公开作品各 60 个受控 update 状态一致；不代表当前在线编辑器全集、原生帧率或网络行为。见 [在线/离线取证](compatibility/k4-online-vs-offline.md)。",
    `- 枚举 **${report.count}** 个唯一 block type；注册域、responder 与编译器结构表取并集；重复注册保留每一处证据。`,
    "- 官方定位为 webpack **模块 factory `function` 开头起算的 0-based JavaScript UTF-16 字符 offset**（不是字节或整包偏移）。domain 指属性名，responder 指 id 属性，compiler 指枚举成员名。",
    "- 状态“已实现”仅表示有显式导入/执行映射，不表示语义全等；`mapped-not-parity` 仍未逐字段核对。`partial` 是已知子选项、云后端、渲染或物理差异；stub 为明确无效果，设备降级为本地固定值/无设备语义；缺失不因官方也有 noop 而冒充支持。",
    "- `offline-oracle-verified` 表示积木本体分支已由指定离线包的原创夹具约束，不表示跨版本、跨平台、浏览器输入或物理求解器全集一致；证据范围见各项专项说明。",
    "- `main-path-verified` 是本轮按任务定义的主路径升级，不是完整语义认证；未验证边界独立列出，已知求解器/渲染差异仍保留。原95项A/B分类、B类无设备行为见 [第六轮](kitten4-partial-6.md)。",
    "- `is_stub` 严格限制在该函数的 kind 分派；flexibility 已实现硬体 strength adapter，但软体粒子仍为 partial。`scope=7` 等条件分支不把整个积木误标为 stub。未设置 K4_PLAYER_DIR 的普通 JS 单测不需要官方包、外部内核或 Cargo；设置后另启只读集成校验。",
    `- 频率来自只读语料 \`${report.corpus}\` 的 ${report.files} 个 .bcm 文件，${report.workspaceOwners} 个 owner 用 workspace，${report.compiledOwners} 个 owner 用 compiled_block_map 回退。每个 owner workspace 优先（包括空 workspace），不双计 compile AST、procedure 视图、shadow 备份或 mutation。频率为出现次数，不是作品数；0 不代表不存在。`,
    "- 文档和 JSON 只包含类型、位置、频率及本仓库限制；不含官方源码片段、作品内容、标题、作者或资源。", "",
    "## 复现", "", "设置 `K4_PLAYER_DIR` 为本地官方 app 目录，然后运行（只读官方包与语料）：", "",
    "```powershell", "$env:K4_PLAYER_DIR='E:\\nekoc-wt\\_ref\\k4player\\Kitten4播放器\\resources\\app'",
    "node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.md",
    "node tools/compat/k4-block-catalog.mjs E:/nekoc/dist/kitten4-corpus docs/kitten4-block-coverage.json",
    "node --test tests/k4-block-catalog.test.mjs", "```", "",
    "Markdown 与同名 JSON 都是生成物；mapping 行号反映生成当时本仓库源码，修改 Rust 后应重新生成。", "",
    "## 汇总", "", "| 状态 | 项数 |", "| --- | ---: |",
    ...Object.entries(report.counts).map(([status, count]) => `| ${status} | ${count} |`), "",
    `已知 partial：${report.rows.filter(r => r.semantics === "partial").length} 项（不是第五种主状态）。`, "",
    "## 本次按频率补齐", "",
    "- 第六轮按离线可验证A类/真实设备服务B类分流，主路径升级与未验证边界分列；物理控制逐update、属性/克隆、效果/绘图专项及固定95项分母见 kitten4-partial-6.md。B类仍为设备降级/partial，不计入主路径升级。",
    "- 第四轮按只读语料频率×成本优先补齐 self_set_role_camp（1336 次）：任意字符串不再受四值表示限制，180 帧官方原创夹具及双 VM 回归见 kitten4-partial-camp-4.md；其他高频物理/滤镜/属性项保留未解决边界。",
    "- 第五轮继续按频率×独立修复成本选择 get_3（2049 次）及克隆属性、显隐（64 次）；补列表引用、惰性 UUID 槽、无造型及显隐逐帧边界，原创状态/像素证据与保留范围见 kitten4-partial-5.md。仍有剩余边界的类型不以终态一致去 partial。",
    "- partial 专项：实际基线为 98 项（任务说明约 67 项已过时）。先核对高频属性、效果、阵营与舞台/拖拽；本轮证据及明确未完成范围见 kitten4-partial-properties.md、kitten4-partial-effects.md、kitten4-partial-misc.md。未完成官方实测的项保留 partial，不以仅有执行映射冒充完成。",
    "- partial 第二轮从 96 项继续按语料高频核对物理、云、印章与场景过渡，另核验文本搜索与媒体默认 reporter；41 份原创夹具经官方离线实测及回归，修复与保留边界见 kitten4-physics-partial.md、kitten4-partial-cloud-2.md、kitten4-partial-drawing.md、kitten4-partial-text-2.md。物理求解器、在线云、字体/图像像素和真实过渡动画仍不完整，保留 partial。",
    "- 第三轮：剩余 46 个类型逐项增加执行映射或固定官方错误边界，最后一个 flexibility stub 实现硬体 adapter；媒体/设备通过明确 host 请求、完成结果和事件 API，不伪装真实设备可用。源码定位、原创回归与未接 viewer 限制见 kitten4-third-round.md、kitten4-third-media.md、kitten4-third-physics.md。",
    "- 高频 partial 优先核对 get_3（2049 次）与其 get/get_2 别名：修复完整属性委派和未知属性 NaN；物理质量/惯量与非法参数的 body 分配边界也有加强。仍保留 partial，不以映射清零声称全语义清零。以下第二轮内容为历史记录。",
    "- 第二轮：先补语料 10 次的 self_shake（保留时序/物理 partial），再按常用类别补文本、旧启动/条件/点击/弹窗入口；原始缺失项频率均为 0，未宣称有编辑器面板使用统计。详见 kitten4-second-round.md 与 tests/kitten4_catalog.rs。",
    "- 第二轮设备项仅支持官方离线无设备语义：ls7Z 逐项显式映射，不伪装真实硬件支持；另补手机轴、震动、摄像头 motion/方向及透明度降级。见 kitten4-devices.md。扫码/语音/MIDI 的第三轮 host 语义见上。",
    "- 第二轮核对五个原本已有的 legacy audio 入口并补回归，修正动态声音输入与旧 change 的符号；只重新分类，不计作新增五项。基线也已支持 play_words_audio/play_words_audio_wait，本轮仅修复覆盖表过期 stub 分类，不计作新增 TTS。见 kitten4-audio-aliases.md。",
    "- `set_entity_show_hide` 在语料出现 64 次，是本次优先补齐的非设备 stub。角色、场景及分组目标分别解析；分组渐变并发进行、调用线程等待，不能用异步 tell 冒充。官方依据为 Tn6a/lt 的该属性与内部 f（属性定位见下表）；回归在 tests/kitten4_visibility.rs。",
    "- 其余高频缺失候选经专用 lowering 核对后为已有支持；没有把物理/云路径误报当作新实现。其后补齐 21 个零频 legacy 别名：坐标 8、渐显隐 2、缩放 2、效果 3、图层 1、造型 3、get 1、multiline_text 1。具体源码分派见 src/kitten4/aliases.rs；回归在 tests/kitten4_catalog.rs，覆盖 workspace/published、原样 roundtrip、解释器/默认 JIT。",
    "- K4 渐显隐边界从同一官方 f 推导：已显示角色的正时长渐显不等待；0 秒只切换可见性；渐隐结束恢复 alpha=1。KN 路径不变。画笔填充、计时器、介绍弹窗均未纳入本次实现。",
    "- 以上新增行为证据为固定离线包的官方源码位置及源码推导回归，未做本次浏览器逐帧实测；完整时序、点击状态、渐变竞争/取消仍未验证。剩余 stub/缺失在完整清单逐项公开，不声称已实现全部 377 种。", "",
    "## 官方注册链审核", "",
    "- tSBa 提供基础 oiyH 域与 IiH9 responders。Tn6a/Xt 注册 m 表及 Ht 合并表；F/lt/ht 的 legacy 子表也计入，不只取第一个对象。Ht 的全部合并输入含动作、外观、克隆、画笔、旧/新物理、视频、移动设备、摄像头、wood、controller 等。",
    "- TL4g（云）与 xQfl（音频）各取完整返回域表；VlbI 把 ls7Z 的三张硬件表合并注册。fhSb 在默认域后覆盖 wood 两项，因此保留两处定位。",
    "- 扫描整个主 chunk 的 domain_function 写入模块并校验 allowlist；responder_blocks 在全模块检索，动作自身 id 不作为积木。Qeyy 的所有 *_BLOCKS 编译器表均纳入，排除 BlockOutputType。",
    "- 这是固定版本的已审核表 manifest，不是对任意新包的证明：新域模块会 fail closed；相同模块新增全新表/动态注册、其他 lazy chunks、enable_test_mode 测试扩展或线上注入仍需重新人工审核。",
    `- 注册写入模块：${report.audit.registryModules.map(id => `\`${id}\``).join("、")}。`, "",
    "### 域表", "", "| 模块 | 表 anchor | 表 offset | 注册数 |", "| --- | --- | ---: | ---: |",
    ...report.audit.tables.map(t => `| ${t.module} | ${t.anchor} | ${t.offset} | ${t.count} |`), "",
    "### Responder 声明", "", "| 模块 | responder_blocks offset | 数量 |", "| --- | ---: | ---: |",
    ...report.audit.responders.map(t => `| ${t.module} | ${t.offset} | ${t.count} |`), "",
    "### 编译器表", "", "| 模块 | 表 | offset | 数量 |", "| --- | --- | ---: | ---: |",
    ...report.audit.compilerTables.map(t => `| ${t.module} | ${t.name} | ${t.offset} | ${t.count} |`), "",
    "## 完整清单（频率降序）", "", "| 官方 type | 官方模块@offset（注册来源） | 状态 / 语义 | 频率 | NekoC mapping 位置 / 限制 |", "| --- | --- | --- | ---: | --- |"];
  const escape = value => String(value).replaceAll("|", "&#124;").replaceAll("\n", " ");
  for (const row of report.rows) lines.push(`| \`${row.type}\` | ${row.official.map(e => `\`${e.module}@${e.offset}\` (${e.registration})`).join("<br>")} | ${row.status}<br>${row.semantics} | ${row.occurrences} | ${[...row.mapping.map(p => `\`${p}\``), ...row.limitations].map(escape).join("<br>")} |`);
  lines.push("", "## 未验证边界（主路径升级项独立列出）", "", "| 类型 | 未验证/已知差异 |", "| --- | --- |");
  for (const row of report.rows.filter(row => row.unverifiedBoundaries)) {
    lines.push(`| \`${row.type}\` | ${row.unverifiedBoundaries.map(escape).join("<br>")} |`);
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const player = process.env.K4_PLAYER_DIR;
  if (!player) throw new Error("K4_PLAYER_DIR is required");
  const bundle = "src/player/build/player_v2.2d180c468559fbd29528.js.orig";
  const source = fs.readFileSync(path.join(player, bundle), "utf8");
  const corpus = process.argv[2] ?? "E:/nekoc/dist/kitten4-corpus";
  const frequency = corpusFrequency(corpus), inventory = officialInventory(source);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const rows = mappingStatus(root, inventory.rows).map(row => ({ ...row, occurrences: frequency.counts.get(row.type) ?? 0 }));
  rows.sort((a, b) => b.occurrences - a.occurrences || a.type.localeCompare(b.type, "en"));
  const report = { bundle, sha256: crypto.createHash("sha256").update(source).digest("hex"),
    sourceScope: "指定官方离线主 chunk；非在线编辑器全集。在线发布物关系见 docs/compatibility/k4-online-vs-offline.md", corpus,
    files: frequency.files, workspaceOwners: frequency.workspaceOwners, compiledOwners: frequency.compiledOwners,
    count: rows.length, counts: Object.fromEntries(["已实现", "stub", "缺失", "设备降级"].map(s => [s, rows.filter(r => r.status === s).length])),
    audit: inventory.audit, rows };
  const output = process.argv[3];
  if (output) fs.writeFileSync(output, output.endsWith(".md") ? markdownReport(report) : JSON.stringify(report, null, 2) + "\n");
  else console.log(JSON.stringify(report, null, 2));
}
