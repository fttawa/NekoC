#!/usr/bin/env node
// Read-only static inventory. Never execute the player entrypoint or its factories.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import ts from "typescript";

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
  for (const [module, helper] of [["common", "lower_common"], ["devices", "lower_devices"], ["audio_aliases", "lower_audio_alias"]]) {
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
  const partialTypes = new Set(["get_2", "get_3", "get", "self_change_effect_3", "self_change_effect", "self_change_effect_2",
    "self_set_effect_2", "self_set_effect", "self_clear_effects", "get_clone_index_property", "set_scene_transition",
    "self_set_role_camp", "get_stage_info", "self_set_draggable", "image_stamp", "stamp"]);
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
    const status = degraded ? "设备降级" : stub ? "stub" : evidence.length ? "已实现" : "缺失";
    let semantics = status === "已实现" ? "mapped-not-parity" : status === "缺失" ? "unsupported" : status === "stub" ? "no-effect" : "offline/device";
    const limitations = [];
    if (status === "缺失") limitations.push("未找到 K4 导入/VM lowering；保留不透明块不等于可执行支持");
    if (stub) limitations.push("is_stub 明确列出：无效果或固定返回值；不视为完整实现");
    if (degraded) limitations.push("本地无对应设备/登录服务；固定值、空值或无效果，不代表真实设备语义");
    if (aliases.has(row.type)) limitations.push("legacy alias 归一化；继承目标积木的字段、子选项与运行时限制");
    const cloud = /cloud_|ranking/.test(row.type);
    if (cloud && evidence.length) { semantics = "partial"; limitations.push("云值/榜单使用本地状态或可选后端；不保证官方联网、权限、持久化和排名 UI 一致"); }
    if ((row.type.startsWith("physics2_") || /^(?:self_(?:enable_physics|disable_physics|set_friction|set_restitution|set_boundary|set_mass|set_density)|set_actor_as|allow_rotate|get_physics_property|set_velocity)$/.test(row.type)) && evidence.length) {
      if (!stub) semantics = "partial";
      limitations.push("刚体兼容层：求解器/轮廓与官方不同；软体/弹性并未实现，见 kitten4-physics.md");
    }
    if (partialTypes.has(row.type) && evidence.length) {
      if (status === "已实现") semantics = "partial";
      limitations.push(row.type === "get_2" ? "仅坐标 0/1 与方向 3；其他属性走后续 lowering 或仍不支持" :
        ["get", "get_3"].includes(row.type) ? "仅显式属性/角色局部变量；未列出的属性仍不支持" :
        "存在字段、效果、渲染或平台子选项边界；映射存在不能证明全语义一致");
    }
    if (row.type === "self_change_effect_3") limitations.push("scope=7 降级为 noop（条件 stub，不是全积木 stub）");
    if (row.type === "wood_block_get") limitations.push("官方 fhSb 玩家覆盖也返回 NaN，不执行 Python；这不是 Python 功能支持");
    if (row.type === "set_costume_by_id") {
      semantics = "partial";
      limitations.push("仅字段 style_id literal；动态 style_id 输入保持 opaque 并明确拒绝编译（编辑器可达性未验证）");
    }
    if (row.type === "set_entity_show_hide") {
      semantics = "partial";
      limitations.push("角色/分组/场景显隐与有限正时长并发渐变已有源码推导回归；点击状态清理、取消/删克隆、竞争渐变和非有限时长未验证；删除引用沿用通用 noop 策略（官方悬空 UUID 行为未验证）");
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
      limitations.push("FIRST/LAST 与空 needle 的 1-based UTF-16 位置已回归；原始非字符串 VALUE 的 JS TypeError 路径未对齐");
    }
    if (row.official.some(e => e.module === "ls7Z")) {
      limitations.push("官方此离线包 ls7Z 本身为提示/noop/NaN；本地省略硬件 toast UI，事件不触发；不能据此声称硬件控制已支持，逐项分类见 kitten4-devices.md");
      if (["is_digital_port_status", "get_analog_port_value"].includes(row.type)) {
        limitations.push("官方提示后返回 undefined：仅命令上下文降级；表达式上下文明确拒绝编译，不伪造 NaN/0");
      }
    }
    if (row.official.every(e => e.registration.startsWith("compiler:"))) limitations.push("仅编译器结构表证据，不表示存在普通 domain handler");
    if (status === "已实现") limitations.push("静态分派证据；未逐字段、错误路径、时序与官方差分验证");
    // Helpful VM anchors for special rewrites without blanket string matching.
    const target = { set_actor_as: "kitten4_legacy_", set_velocity: "kitten4_set_velocity", set_entity_show_hide: "kitten4_entity_visibility" }[row.type];
    if (target && evidence.length) evidence.push(...engineAt(target));
    return { ...row, status, semantics, mapping: [...new Set(evidence)], limitations };
  });
}

export function markdownReport(report) {
  const lines = ["# Kitten 4 官方积木覆盖清单", "", "<!-- Generated by tools/compat/k4-block-catalog.mjs; metadata only, no official source or project contents. -->", "",
    "## 范围与口径", "",
    `- 官方边界：只读本地离线播放器的 \`${report.bundle}\`，SHA-256：\`${report.sha256}\`。不是编辑器全版本或线上服务全集。`,
    `- 枚举 **${report.count}** 个唯一 block type；注册域、responder 与编译器结构表取并集；重复注册保留每一处证据。`,
    "- 官方定位为 webpack **模块 factory `function` 开头起算的 0-based JavaScript UTF-16 字符 offset**（不是字节或整包偏移）。domain 指属性名，responder 指 id 属性，compiler 指枚举成员名。",
    "- 状态“已实现”仅表示有显式导入/执行映射，不表示语义全等；`mapped-not-parity` 仍未逐字段核对。`partial` 是已知子选项、云后端、渲染或物理差异；stub 为明确无效果，设备降级为本地固定值/无设备语义；缺失不因官方也有 noop 而冒充支持。",
    "- `is_stub` 严格限制在该函数的 kind 分派；`physics2_set_flexibility` 虽先经 physics2 通路仍按显式 stub/物理软体限制标注。`scope=7` 等条件分支不把整个积木误标为 stub。未设置 K4_PLAYER_DIR 的普通 JS 单测不需要官方包、外部内核或 Cargo；设置后另启只读集成校验。",
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
    "- 第二轮：先补语料 10 次的 self_shake（保留时序/物理 partial），再按常用类别补文本、旧启动/条件/点击/弹窗入口；原始缺失项频率均为 0，未宣称有编辑器面板使用统计。详见 kitten4-second-round.md 与 tests/kitten4_catalog.rs。",
    "- 第二轮设备项仅支持官方离线无设备语义：ls7Z 逐项显式映射，不伪装真实硬件支持；另补手机轴、震动、摄像头 motion/方向及透明度降级。见 kitten4-devices.md。视频积木不改；扫码 UI/语音/MIDI 等继续公开为缺失。",
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
  const report = { bundle, sha256: crypto.createHash("sha256").update(source).digest("hex"), corpus,
    files: frequency.files, workspaceOwners: frequency.workspaceOwners, compiledOwners: frequency.compiledOwners,
    count: rows.length, counts: Object.fromEntries(["已实现", "stub", "缺失", "设备降级"].map(s => [s, rows.filter(r => r.status === s).length])),
    audit: inventory.audit, rows };
  const output = process.argv[3];
  if (output) fs.writeFileSync(output, output.endsWith(".md") ? markdownReport(report) : JSON.stringify(report, null, 2) + "\n");
  else console.log(JSON.stringify(report, null, 2));
}
