#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export function command(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: root, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`${exe} exited ${code}: ${stderr}`)));
  });
}

export function sameValue(a, b, tolerance = 1e-6) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tolerance;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i], tolerance));
  return Object.is(a, b);
}

// First difference is deterministic: frame order, then sorted actor/variable IDs.
// Raw degrees are retained: 0 and 360 are NOT silently equated (rotation reporters
// may observe the distinction). No name-based actor matching hides clone mismatches.
export function firstDifference(left, right, tolerance = 1e-6) {
  if (left.schema !== "nekoc-k4-trace-v1" || right.schema !== left.schema) throw new Error("Incompatible trace schema");
  const ids = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  for (let i = 0; i < Math.max(left.frames.length, right.frames.length); i++) {
    const a = left.frames[i], b = right.frames[i];
    const diff = (actor, field, l, r) => ({ frame: i + 1, actor, field, nekoc: l ?? null, official: r ?? null });
    if (!a || !b) return diff(null, "frame_count", left.frames.length, right.frames.length);
    if (a.frame !== i + 1 || b.frame !== i + 1) throw new Error(`Invalid frame sequence at ${i + 1}`);
    if (a.current_scene_id !== b.current_scene_id) return diff(null, "current_scene_id", a.current_scene_id, b.current_scene_id);
    for (const id of ids(a.actors, b.actors)) {
      const l = a.actors[id], r = b.actors[id];
      if (!l || !r) return diff(id, "presence", !!l, !!r);
      for (const field of ["x", "y", "rotation", "current_style_id", "scale", "scale_y", "visible"]) {
        if (!sameValue(l[field], r[field], tolerance)) return diff(id, field, l[field], r[field]);
      }
    }
    for (const id of ids(a.variables, b.variables)) {
      if (!sameValue(a.variables[id], b.variables[id], tolerance)) return diff(null, `variables.${id}`, a.variables[id], b.variables[id]);
    }
    for (const owner of ids(a.entity_variables, b.entity_variables)) {
      for (const id of ids(a.entity_variables[owner], b.entity_variables[owner])) {
        const l = a.entity_variables[owner]?.[id], r = b.entity_variables[owner]?.[id];
        if (!sameValue(l, r, tolerance)) return diff(owner, `entity_variables.${id}`, l, r);
      }
    }
  }
  return null;
}

// Compare executable block trees, excluding editor metadata and generated IDs.
// This is structural evidence, NOT proof of bytecode equivalence. Runtime traces
// are compared separately, and both results are reported.
export function executableTrees(project) {
  function block(node) {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(block);
    if (node.type && node.id) {
      const out = { type: node.type };
      for (const key of ["fields", "inputs", "statements", "next", "mutation"]) {
        if (node[key] != null && node[key] !== "" && Object.keys(node[key]).length) out[key] = block(node[key]);
      }
      return out;
    }
    return Object.fromEntries(Object.entries(node).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, block(value)]));
  }
  const out = {};
  for (const [section, dict] of [["scenes", "scenesDict"], ["actors", "actorsDict"], ["procedures", "proceduresDict"]]) {
    for (const [id, entity] of Object.entries(project[section]?.[dict] || {})) out[`${section}/${id}`] = block(entity.nekoBlockJsonList || entity);
  }
  return out;
}

export function mismatchingBlockTypes(left, right, source) {
  const types = new Set(), changedBlocks = [], details = [];
  const workspace = {};
  for (const section of ["scenes", "actors"]) for (const owner of Object.values(source.theatre[section])) Object.assign(workspace, owner.block_data_json?.blocks);
  function index(value, map = new Map()) {
    if (Array.isArray(value)) value.forEach(v => index(v, map));
    else if (value && typeof value === "object") {
      if (value.type && workspace[value.id]) {
        const local = {};
        for (const key of ["type", "fields", "mutation"]) if (value[key] != null && value[key] !== "" && Object.keys(value[key]).length) local[key] = value[key];
        for (const key of ["inputs", "statements"]) if (value[key]) {
          local[key] = Object.fromEntries(Object.entries(value[key]).map(([socket, child]) =>
            [socket, { type: child?.type, id: workspace[child?.id] ? child.id : "generated" }]));
        }
        if (value.next) local.next = { type: value.next.type, id: workspace[value.next.id] ? value.next.id : "generated" };
        map.set(value.id, local);
      }
      Object.values(value).forEach(v => index(v, map));
    }
    return map;
  }
  const a = index(left), b = index(right);
  for (const id of new Set([...a.keys(), ...b.keys()])) if (JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id))) {
    types.add(workspace[id].type); changedBlocks.push(id);
    details.push({ id, type: workspace[id].type, kind: !a.has(id) ? "missing_in_workspace" : !b.has(id) ? "missing_in_compiled" : "changed", workspace: a.get(id), compiled: b.get(id) });
  }
  return { blockTypes: [...types].sort(), changedBlocks, details,
    note: "本地节点或连接不一致的候选积木类型；不递归归罪祖先，结构差异不等于行为差异" };
}

export async function compareWork(input, options) {
  const exe = options.nekoc || path.join(root, "target/debug/k4-trace" + (process.platform === "win32" ? ".exe" : ""));
  const traceArgs = ["--frames", String(options.frames ?? 60), "--seed", String(options.seed ?? 1)];
  const native = async (file, extra = []) => JSON.parse(await command(exe, [path.resolve(file), ...traceArgs, ...extra]));
  let workspaceTrace;
  try { workspaceTrace = await native(input); }
  catch (error) { return { file: input, status: "nekoc-unsupported", error: error.message }; }
  const project = await readJson(input);
  const artifacts = path.join(options.artifactsDir, path.basename(input));
  let compile;
  try {
    const compiled = await runOracle(project, { ...options, command: "compile" });
    const compiledFile = path.join(artifacts, "official.bcm4");
    await saveJson(compiledFile, compiled.project);
    const [compiledTrace, workspaceLowered, compiledLowered, workspaceProgram, compiledProgram] = await Promise.all([
      native(compiledFile, ["--compiled"]), native(input, ["--lowered"]), native(compiledFile, ["--compiled", "--lowered"]),
      native(input, ["--program"]), native(compiledFile, ["--compiled", "--program"]),
    ]);
    const compileDifference = firstDifference(workspaceTrace, compiledTrace);
    const structuralEqual = JSON.stringify(executableTrees(workspaceLowered)) === JSON.stringify(executableTrees(compiledLowered));
    compile = { structuralEqual, programEqual: workspaceProgram.program === compiledProgram.program, firstDifference: compileDifference,
      ...mismatchingBlockTypes(workspaceLowered, compiledLowered, project) };
    await saveJson(path.join(artifacts, "workspace-program.json"), workspaceProgram);
    await saveJson(path.join(artifacts, "compiled-program.json"), compiledProgram);
    await saveJson(path.join(artifacts, "workspace-trace.json"), workspaceTrace);
    await saveJson(path.join(artifacts, "compiled-trace.json"), compiledTrace);
    const official = await runOracle(compiled.project, { ...options, command: "run" });
    await saveJson(path.join(artifacts, "official-trace.json"), official);
    const first = firstDifference(workspaceTrace, official, options.tolerance);
    return { file: input, status: first ? "different" : "equal", firstDifference: first, compile,
      diagnostics: official.diagnostics, artifacts };
  } catch (error) {
    if (error.diagnostics) await saveJson(path.join(artifacts, "failure.json"), error.diagnostics);
    return { file: input, status: "unverified", error: error.message, compile, artifacts };
  }
}

export function markdown(report) {
  return `# Kitten 4 本地对照（前 ${report.frames} 帧）\n\n` +
    `数值容差 ${report.tolerance}；旋转原值比较；无输入事件；随机序列算法不同，随机作品不能据此判定兼容性。\n\n` +
    "| 作品 | 官方对照 | 首次差异（帧 / 角色 / 字段） | 双编译路径行为 | VM 程序完全相同 |\n|---|---|---|---|---|\n" +
    report.works.map(w => `| ${path.basename(w.file)} | ${w.status} | ${w.firstDifference ? `${w.firstDifference.frame} / ${w.firstDifference.actor || "全局"} / ${w.firstDifference.field}` : w.error?.replaceAll("\n", " ").replaceAll("|", "\\|") || "无"} | ${w.compile ? w.compile.firstDifference ? `第 ${w.compile.firstDifference.frame} 帧不同` : "一致" : "未验证"} | ${w.compile ? w.compile.programEqual ? "是" : "否" : "未验证"} |`).join("\n") + "\n";
}

async function main() {
  const argv = process.argv.slice(2), options = { frames: 60, seed: 1, channel: "msedge", tolerance: 1e-6,
    corpus: "dist/kitten4-corpus", artifactsDir: "dist/k4-oracle/diff", out: "dist/k4-oracle/summary.json" };
  const keys = { "--corpus": "corpus", "--input": "input", "--frames": "frames", "--seed": "seed", "--channel": "channel",
    "--player-dir": "playerDir", "--nekoc": "nekoc", "--out": "out", "--artifacts-dir": "artifactsDir", "--timeout-ms": "timeoutMs" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") { console.log("Usage: node tools/compat/k4-diff.mjs [--corpus dist/kitten4-corpus | --input work.bcm] [--frames 60] [--allow-assets] [--player-dir app] [--out report.json] [--nekoc target/debug/k4-trace.exe]"); return; }
    if (argv[i] === "--allow-assets") { options.allowAssets = true; continue; }
    const key = keys[argv[i]];
    if (!key || !argv[i + 1]) throw new Error(`Invalid option: ${argv[i]}`);
    options[key] = argv[++i];
  }
  for (const key of ["frames", "seed", "timeoutMs"]) if (options[key] !== undefined) {
    options[key] = Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === "timeoutMs" ? 1 : 0)) throw new Error(`Invalid ${key}`);
  }
  if (options.seed > 0xffffffff) throw new Error("seed must fit uint32");
  const files = options.input ? [options.input] : (await readdir(options.corpus)).filter(file => /\.bcm4?$/i.test(file)).sort().map(file => path.join(options.corpus, file));
  if (!files.length) throw new Error("No corpus works found (empty corpus is not a passing comparison)");
  if (!options.nekoc) await command("cargo", ["build", "--quiet", "--bin", "k4-trace"]);
  const report = { schema: "nekoc-k4-diff-v1", frames: options.frames, tolerance: options.tolerance, works: [] };
  for (const file of files) {
    console.error(`Comparing ${file}`);
    report.works.push(await compareWork(file, options));
    await saveJson(options.out, report);
    await writeMarkdown(options.out + ".md", markdown(report));
  }
  console.log(markdown(report));
  if (report.works.some(w => w.status !== "equal" || w.compile?.firstDifference)) process.exitCode = 1;
}

async function writeMarkdown(file, text) { const { writeFile } = await import("node:fs/promises"); await writeFile(file, text); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error); process.exitCode = 1;
});
