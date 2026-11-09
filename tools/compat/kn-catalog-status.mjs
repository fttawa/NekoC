#!/usr/bin/env node
// Static, conservative dispatch inventory, not a claim of full semantic parity.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function dispatchEvidence(source, file) {
  // Comments cannot turn an unsupported block into an implemented block.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, s => " ".repeat(s.length));
  const evidence = new Map();
  // Only quoted match-arm patterns at the start of a line, with optional guards.
  // Field selectors on nested matches are filtered by the catalog caller below.
  const arm = /^\s*((?:"[^"\n]+"\s*\|\s*)*"[^"\n]+")\s*(?:if\s[^=]*?)?=>/gm;
  for (const match of clean.matchAll(arm)) {
    const line = clean.slice(0, match.index).split("\n").length;
    for (const literal of match[1].matchAll(/"([^"\n]+)"/g)) {
      const entries = evidence.get(literal[1]) ?? [];
      entries.push(`${file}:${line}`);
      evidence.set(literal[1], entries);
    }
  }
  return evidence;
}

function filesUnder(root, suffix) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(name, suffix) : name.endsWith(suffix) ? [name] : [];
  }).sort();
}

export function inventory(root, reference, engineSource) {
  const catalog = JSON.parse(fs.readFileSync(path.join(reference, "kn_spec/block_catalog.json"), "utf8"));
  const engine = engineSource ?? fs.readFileSync(path.join(root, "src/engine.rs"), "utf8");
  const compiler = fs.readFileSync(path.join(root, "src/bcmkn_compiler.rs"), "utf8");
  // Fail closed if the type-agnostic import path changes. It clones *all* fields,
  // including type, without a block whitelist (not TS API emission support).
  if (!compiler.includes("let mut nested = block.as_object().cloned().unwrap_or_default();") ||
      !compiler.includes("Ok(Value::Object(nested))")) {
    throw new Error("Re-audit bcmkn_compiler::build_nested_block before classifying readable types");
  }
  const evidence = dispatchEvidence(engine, "src/engine.rs");
  // Non-dispatch definitions/loop parameters are consumed as compiler metadata.
  for (const type of ["procedures_2_defnoreturn", "procedures_2_defreturn", "traverse_number_param"]) {
    const at = engine.split("\n").findIndex(line => line.includes(`"${type}"`)) + 1;
    if (!at) throw new Error(`Re-audit metadata support for ${type}`);
    evidence.set(type, [`src/engine.rs:${at} (compiler metadata)`]);
  }
  const frequencies = new Map();
  const projects = ["samples", "projects"].flatMap(dir => filesUnder(path.join(root, dir), ".bcmkn"));
  function count(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.type === "string" && catalog[value.type]) {
      frequencies.set(value.type, (frequencies.get(value.type) ?? 0) + 1);
    }
    Object.values(value).forEach(count);
  }
  for (const file of projects) count(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
  const lua = filesUnder(path.join(reference, "rt/impl"), ".lua");
  const rows = Object.entries(catalog).map(([type, definition]) => {
    const vm = evidence.get(type) ?? [];
    // The expression compiler normalizes these shadow block names explicitly.
    if (type.startsWith("math_number_with_") || type === "math_number_not_allow_text") {
      const at = engine.split("\n").findIndex(line => line.includes('kind.starts_with("math_number_with_")')) + 1;
      vm.push(`src/engine.rs:${at} (number-shadow normalization)`);
    }
    const referenceFunctions = lua.filter(file => fs.readFileSync(file, "utf8").includes(`M.${type}`))
      .map(file => path.relative(reference, file).replaceAll("\\", "/"));
    return { type, status: vm.length ? "VM 已实现" : "编译器能读但 VM 报不支持",
      occurrences: frequencies.get(type) ?? 0, event: definition.isEvent,
      vm, compiler: "src/bcmkn_compiler.rs::build_nested_block (generic field-preserving import)",
      reference: referenceFunctions };
  }).sort((a, b) => b.occurrences - a.occurrences || a.type.localeCompare(b.type));
  return { catalogCount: rows.length, projectCount: projects.length,
    scope: "显式 VM 分派覆盖；不代表所有字段/子选项均已实现。编译器能读指原生 JSON/工作区导入，不代表 TS API 会生成。游离积木被忽略不算 VM 支持。",
    counts: Object.fromEntries(["VM 已实现", "编译器能读但 VM 报不支持", "完全未知"].map(s => [s, rows.filter(r => r.status === s).length])), rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reference, output] = process.argv.slice(2);
  if (!reference) throw new Error("Usage: node tools/compat/kn-catalog-status.mjs <HateNeko player directory> [output.json]");
  const result = inventory(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), reference);
  const text = JSON.stringify(result, null, 2) + "\n";
  if (output) fs.writeFileSync(output, text);
  else process.stdout.write(text);
}
