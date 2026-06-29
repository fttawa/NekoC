#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error(`Usage:
  node tools/oracle-compare.mjs --oracle editor-oracle.json --runtime runtime.json [--out report.json]

Options:
  --oracle <path>      JSON report from tools/editor-oracle.mjs.
  --runtime <path>     JSON snapshot from nekoc run --out.
  --out <path>         Optional JSON report path.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--oracle") args.oracle = argv[++i];
    else if (arg === "--runtime") args.runtime = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function parseEditorVariables(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line, index) => line === "变量" && lines[index + 1] === "列表");
  if (start < 0) return {};

  const variables = {};
  for (let index = start + 2; index < lines.length;) {
    const name = lines[index];
    if (!name || isVariablePanelTerminator(name)) break;
    const separator = lines[index + 1];
    const value = lines[index + 2];
    if (separator !== "：" && separator !== ":") break;
    variables[name] = parseEditorScalar(value);
    index += 3;
  }
  return variables;
}

function isVariablePanelTerminator(line) {
  return /^(作品无列表数据|未获取到变量运行数据|未获取到列表运行数据|输入关键词|支持跨屏幕|控制台|观测|提示|全部)$/.test(line);
}

function parseEditorScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    return Number(value);
  }
  return value;
}

export function compareEditorOracleToRuntime({ oracle, runtime }) {
  const editorVariables = parseEditorVariables(oracle?.state?.textExcerpt || "");
  const runtimeVariables = runtimeVariablesByName(runtime);
  const names = Array.from(
    new Set([...Object.keys(editorVariables), ...Object.keys(runtimeVariables)]),
  ).sort();
  const differences = [];

  for (const name of names) {
    const hasEditor = Object.hasOwn(editorVariables, name);
    const hasRuntime = Object.hasOwn(runtimeVariables, name);
    if (!hasEditor) {
      differences.push({ name, kind: "missing_in_editor", runtime: runtimeVariables[name] });
    } else if (!hasRuntime) {
      differences.push({ name, kind: "missing_in_runtime", editor: editorVariables[name] });
    } else if (!sameRuntimeValue(editorVariables[name], runtimeVariables[name])) {
      differences.push({
        name,
        kind: "changed",
        editor: editorVariables[name],
        runtime: runtimeVariables[name],
      });
    }
  }

  return {
    ok: differences.length === 0,
    editorVariables,
    runtimeVariables,
    differences,
  };
}

function runtimeVariablesByName(runtime) {
  const names = runtime?.variable_names || {};
  const values = runtime?.variables || {};
  const output = {};
  for (const [id, value] of Object.entries(values)) {
    const name = names[id] || id;
    output[name] = normalizeRuntimeValue(value);
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeRuntimeValue(value) {
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

function sameRuntimeValue(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) < 1e-9;
  }
  return Object.is(left, right);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.oracle || !args.runtime) {
    usage();
    process.exit(args.help ? 0 : 2);
  }
  const oraclePath = path.resolve(here, "..", args.oracle);
  const runtimePath = path.resolve(here, "..", args.runtime);
  if (!existsSync(oraclePath)) throw new Error(`Oracle report does not exist: ${oraclePath}`);
  if (!existsSync(runtimePath)) throw new Error(`Runtime snapshot does not exist: ${runtimePath}`);

  const report = compareEditorOracleToRuntime({
    oracle: await readJson(oraclePath),
    runtime: await readJson(runtimePath),
  });
  const output = JSON.stringify(report, null, 2);
  if (args.out) {
    await writeFile(path.resolve(here, "..", args.out), output, "utf8");
  }
  console.log(output);
  if (!report.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
