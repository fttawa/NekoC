#!/usr/bin/env node
// Only the ignored, marker-owned copy may be modified by the vendor compiler.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, cp, realpath, stat, unlink, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { summarize } from "./run.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function ignoredPath(value) {
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(path.join(root, "dist") + path.sep)) throw new Error("Outputs must be below this worktree's dist/");
  return resolved;
}
export async function assertWritablePath(target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Writable path must be in this worktree");
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Writable path contains a junction/symlink: ${current}`); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
}
const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
export function parseArgs(args) {
  const o = { ref: "E:/nekoc-wt/_ref/hateneko", copy: "dist/hateneko-run", out: "dist/bench/hateneko", love: "D:/Tools/love-11.5-win64/lovec.exe", python: "python", binary: "target/release/perf-bench.exe", frames: 60, warmup: 10, repeats: 3, timeout: 120000 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (key === "prepare-only") { o.prepareOnly = true; continue; }
    if (key === "resume") { o.resume = true; continue; }
    if (!["ref", "copy", "out", "love", "python", "binary", "frames", "warmup", "repeats", "timeout", "input"].includes(key) || !args[i + 1]) throw new Error(`Invalid option ${args[i]}`);
    o[key] = args[++i];
  }
  for (const key of ["frames", "warmup", "repeats", "timeout"]) {
    o[key] = Number(o[key]);
    if (!Number.isSafeInteger(o[key]) || o[key] < (key === "warmup" ? 0 : 1) || o[key] > 1000000) throw new Error(`Invalid ${key}`);
  }
  if (o.frames + o.warmup > 100000) throw new Error("Too many frames");
  o.out = ignoredPath(o.out); o.copy = ignoredPath(o.copy);
  if (o.out === o.copy || o.out.startsWith(o.copy + path.sep) || o.copy.startsWith(o.out + path.sep)) throw new Error("Copy and output must be disjoint");
  return o;
}

// Scoped observation, not a proof of pixel, task or intermediate-state equivalence.
export function compareStates(a, b) {
  const differences = [];
  for (const state of [a, b]) {
    const dict = value => value && typeof value === "object" && !Array.isArray(value);
    const validActor = actor => dict(actor) && ["id", "prototype_id", "current_style_id"].every(k => typeof actor[k] === "string")
      && ["x", "y", "rotation", "scale", "scale_y"].every(k => Number.isFinite(actor[k])) && typeof actor.visible === "boolean"
      && dict(state.entity_variables?.[actor.id]);
    if (!dict(state) || typeof state.current_scene_id !== "string" || !dict(state.variables) || !dict(state.actors) || !dict(state.entity_variables)
      || !Object.values(state.actors).every(validActor)) {
      return { equal: false, differences: [{ key: "state", reason: "missing or malformed snapshot" }] };
    }
  }
  function visit(x, y, key) {
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return;
    if (Object.is(x, y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      if (Array.isArray(x) && x.length !== y.length && differences.length < 30) differences.push({ key: `${key}.length`, nekoc: x.length, hateneko: y.length });
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) visit(x[k], y[k], `${key}.${k}`);
    } else if (differences.length < 30) differences.push({ key, nekoc: x ?? null, hateneko: y ?? null });
  }
  function scope(s, native) {
    // Runtime-generated clone ids differ; retain their state as a multiset.
    const actors = Object.values(s.actors ?? {}).map(actor => ({
      prototype_id: actor.prototype_id, x: actor.x, y: actor.y,
      original_id: actor.id === actor.prototype_id ? actor.id : null,
      // oracle_snapshot is a K4-facing rotation (90 - VM heading). H records
      // its direction register directly. Compare registers, not rendered angles.
      heading: native ? 90 - actor.rotation : actor.rotation,
      current_style_id: actor.current_style_id, scale: actor.scale, scale_y: actor.scale_y, visible: actor.visible,
      variables: s.entity_variables?.[actor.id] ?? {},
    })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    return { current_scene_id: s.current_scene_id, variables: s.variables, actors };
  }
  visit(scope(a, true), scope(b, false), "state");
  return { equal: !differences.length, differences };
}

async function treeFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${p}`);
    if (entry.isDirectory()) files.push(...await treeFiles(p));
    else files.push(p);
  }
  return files.sort();
}
async function fingerprint(dir) {
  const files = {};
  for (const file of await treeFiles(dir)) files[path.relative(dir, file).replaceAll("\\", "/")] = hash(await readFile(file));
  return files;
}
async function prepare(o) {
  // Lexical confinement alone is insufficient if a parent was replaced by a junction.
  for (const target of [o.copy, o.out]) await assertWritablePath(target);
  try { await treeFiles(o.out); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const ref = await realpath(o.ref);
  for (const target of [o.copy, o.out, path.join(root, "dist/bench")]) if (overlaps(ref, target)) throw new Error("Reference and writable paths overlap");
  const before = await fingerprint(ref);
  const marker = path.join(o.copy, ".hnbench-owned.json");
  try {
    await stat(o.copy);
    const owned = JSON.parse(await readFile(marker, "utf8"));
    if (owned.root !== root || owned.ref !== ref) throw new Error("Not our vendor copy");
    await treeFiles(o.copy); // Refuse junctions/symlinks inside an existing owned copy too.
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    try { await stat(o.copy); throw new Error("Copy exists without ownership marker"); } catch (e2) { if (e2.code !== "ENOENT") throw e2; }
    await cp(ref, o.copy, { recursive: true, errorOnExist: true, force: false });
    await writeFile(marker, JSON.stringify({ root, ref }));
  }
  // Verify the actual executable/compiler tree, not just the ownership marker.
  // works/builds are vendor-generated outputs; all implementation files must match.
  const implementation = key => !/^(?:player\/works\/|builds\/)/.test(key)
    && !["player/main.lua", "player/conf.lua"].includes(key);
  for (const [key, digest] of Object.entries(before)) if (implementation(key)) {
    if (hash(await readFile(path.join(o.copy, key))) !== digest) throw new Error(`Vendor copy differs from reference: ${key}; use a new --copy directory`);
  }
  for (const file of await treeFiles(o.copy)) {
    const key = path.relative(o.copy, file).replaceAll("\\", "/");
    if (implementation(key) && !before[key] && ![".hnbench-owned.json", "player/hnbench_probe.lua"].includes(key)
      && !/^hnbench_\d+\.bcmkn$/.test(key)) throw new Error(`Unexpected vendor implementation file: ${key}`);
  }
  const original = await readFile(path.join(ref, "player/main.lua"), "utf8");
  await writeFile(path.join(o.copy, "player/main.lua"), `require("hnbench_probe")\n${original}`);
  await cp(path.join(root, "tools/bench/hateneko-probe.lua"), path.join(o.copy, "player/hnbench_probe.lua"));
  const conf = await readFile(path.join(ref, "player/conf.lua"), "utf8");
  await writeFile(path.join(o.copy, "player/conf.lua"), `${conf}\nSTARTUP.work = os.getenv("HNBENCH_WORK") or STARTUP.work\nlocal original_conf = love.conf\nfunction love.conf(t) original_conf(t); t.window.fullscreen = false; t.window.vsync = 0 end\n`);
  const executed = {};
  for (const key of Object.keys(before).filter(implementation)) executed[key] = before[key];
  for (const key of ["player/main.lua", "player/conf.lua", "player/hnbench_probe.lua"]) executed[key] = hash(await readFile(path.join(o.copy, key)));
  return { ref, before, executed };
}
export function assertIdle() {
  if (process.platform !== "win32") throw new Error("Process interference guard currently requires Windows");
  const script = "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cargo|rustc|perf-bench|lovec|love)\\.exe$' } | Select-Object ProcessId,Name,CommandLine) | ConvertTo-Json -Compress";
  const output = execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
  const parsed = output ? JSON.parse(output) : [];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  if (processes.length) throw new Error(`Other build/benchmark processes present; retry when idle: ${JSON.stringify(processes.map(p => ({ ...p, CommandLine: p.CommandLine?.slice(0, 500) })))}`);
  return { checked_at: new Date().toISOString(), processes };
}
async function ownedWorks() {
  const result = [];
  for (const dir of ["projects", "tests/fixtures"]) for (const file of await treeFiles(path.join(root, dir))) if (file.endsWith(".bcmkn")) result.push(file);
  return result;
}
function invoke(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
}
export function inputScope(project) {
  const blockTypes = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.type === "string" && (value.inputs || value.fields)) blockTypes.add(value.type);
    Object.values(value).forEach(walk);
  }
  walk(project);
  return { random_blocks: [...blockTypes].filter(t => /random/.test(t)).sort(),
    external_assets: Object.values(project.styles?.stylesDict ?? {}).some(s => /^https?:/.test(s.url ?? "")) || Object.values(project.audios?.audiosDict ?? {}).some(s => /^https?:/.test(s.url ?? "")),
    sampled_input: "no synthesized pointer/keyboard input; OS focus/pointer events still possible in Love window" };
}
export function compareRun(run, work) {
  const n = run.runtimes.nekoc, h = run.runtimes.hateneko;
  delete run.speedup_h_over_n;
  const valid = result => result?.status === "ok" && !result.errors?.length && !result.missing_primitives?.length
    && Array.isArray(result.frame_ms) && result.frame_ms.length === work.frames
    && Array.isArray(result.warmup_ms) && result.warmup_ms.length === work.warmup
    && [...result.frame_ms, ...result.warmup_ms].every(v => Number.isFinite(v) && v >= 0);
  run.comparison = valid(n) && valid(h) ? compareStates(n.final_state, h.final_state) : { equal: false, reason: "load/run/unsupported/incomplete samples" };
  if (run.comparison.equal && work.synthetic && path.basename(work.file) !== "pen.bcmkn"
    && Number.isFinite(n.summary_ms?.mean) && n.summary_ms.mean > 0
    && Number.isFinite(h.summary_ms?.mean) && h.summary_ms.mean > 0) run.speedup_h_over_n = h.summary_ms.mean / n.summary_ms.mean;
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { ref, before, executed } = await prepare(o);
  await mkdir(o.out, { recursive: true });
  const { writeKnFixtures } = await import("./kn-fixtures.mjs");
  const fixtures = await writeKnFixtures(path.join(o.out, "fixtures"));
  const editorOutput = invoke(process.execPath, ["tools/editor-compat.mjs", ...fixtures, "--channel", "msedge", "--out", path.join(o.out, "editor.json")], { cwd: root, timeout: 600000 });
  if (!JSON.parse(editorOutput).ok) throw new Error("Official editor check failed");
  if (o.prepareOnly) { console.log(`Prepared ${fixtures.length} editor-valid fixtures in ${o.out}`); return; }
  let report = { schema: "nekoc-hateneko-v1", date: new Date().toISOString(), options: o,
    host: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, node: process.version },
    revision: invoke("git", ["rev-parse", "HEAD"]).trim(), reference: { directory: ref, version: (await readFile(path.join(ref, "VERSION"), "utf8")).trim(), files: before },
    probe_sha256: hash(await readFile("tools/bench/hateneko-probe.lua")), binary_sha256: hash(await readFile(o.binary)), executed_files: executed,
    love_version: invoke(o.love, ["--version"]).trim(), works: [] };
  if (o.resume) {
    const saved = JSON.parse(await readFile(path.join(o.out, "results.json"), "utf8"));
    for (const key of ["binary_sha256", "probe_sha256", "love_version"]) if (saved[key] !== report[key]) throw new Error(`Resume ${key} mismatch`);
    for (const key of ["frames", "warmup", "repeats", "input", "timeout"]) if (saved.options[key] !== o[key]) throw new Error(`Resume ${key} mismatch`);
    if (JSON.stringify(saved.reference.files) !== JSON.stringify(before)) throw new Error("Resume vendor fingerprint mismatch");
    if (saved.executed_files && JSON.stringify(saved.executed_files) !== JSON.stringify(executed)) throw new Error("Resume executed tree mismatch");
    saved.resumed_at ??= [];
    saved.resumed_at.push(new Date().toISOString());
    report = saved;
    report.executed_files = executed;
    for (const work of report.works) for (const run of work.runs) compareRun(run, work);
  }
  const files = o.input ? [path.resolve(o.input)] : [...fixtures, ...await ownedWorks()];
  const manifest = await Promise.all(files.map(async file => ({ file: path.relative(root, file), sha256: hash(await readFile(file)), synthetic: fixtures.includes(file) })));
  if (o.resume) {
    const savedManifest = report.input_manifest;
    if (savedManifest && JSON.stringify(savedManifest) !== JSON.stringify(manifest)) throw new Error("Resume full input manifest mismatch");
    // Migrate the first local interrupted report only after reconstructing its
    // entire repository-owned input manifest from the recorded git revision.
    if (!savedManifest) {
      if (o.input) throw new Error("Legacy single-input reports cannot resume");
      const committed = invoke("git", ["ls-tree", "-r", "--name-only", report.revision, "--", "projects", "tests/fixtures"]).trim().split(/\r?\n/).filter(f => f.endsWith(".bcmkn")).sort();
      const current = manifest.filter(m => !m.synthetic);
      if (committed.length !== current.length) throw new Error("Legacy resume full input count mismatch");
      for (const [i, file] of committed.entries()) {
        const bytes = execFileSync("git", ["show", `${report.revision}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
        if (current[i].file.replaceAll("\\", "/") !== file || current[i].sha256 !== hash(bytes)) throw new Error("Legacy resume committed input mismatch");
      }
      if (report.works.filter(w => w.synthetic).length !== fixtures.length) throw new Error("Legacy resume missing fixture identity");
    }
    for (const [i, work] of report.works.entries()) for (const key of ["file", "sha256", "synthetic"]) if (work[key] !== manifest[i]?.[key]) throw new Error("Resume input identity mismatch");
  }
  report.input_manifest = manifest;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index], name = `hnbench_${index}`;
      const digest = hash(await readFile(file));
      const existing = report.works[index];
      if (existing && (existing.file !== path.relative(root, file) || existing.sha256 !== digest)) throw new Error("Resume input mismatch");
      const work = existing ?? { file: path.relative(root, file), sha256: digest, synthetic: fixtures.includes(file), runs: [] };
      work.scope = inputScope(JSON.parse(await readFile(file, "utf8")));
      const frames = work.synthetic ? o.frames : Math.min(o.frames, 12);
      const warmup = work.synthetic ? o.warmup : 0;
      const timeout = work.synthetic ? o.timeout : Math.min(o.timeout, 20000);
      work.frames = frames; work.warmup = warmup; work.timeout = timeout;
      if (!existing) report.works.push(work);
      const repetitions = work.synthetic ? o.repeats : 1;
      if (work.runs.length === repetitions && work.runs.every(r => r.runtimes.nekoc && r.runtimes.hateneko)) continue;
      const inputCopy = path.join(o.copy, `${name}.bcmkn`);
      await cp(file, inputCopy);
      delete work.compile_error;
      try {
        const started = performance.now();
        work.compile_log = invoke(o.python, ["tools/kn.py", "compile", inputCopy, "--no-assets"], { cwd: path.join(o.copy, "player"), timeout: o.timeout, env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" } });
        work.compile_wall_ms = performance.now() - started;
        work.compiled_sha256 = hash(await readFile(path.join(o.copy, `player/works/${name}.lua`)));
      } catch (e) { work.compile_error = e.message; }
      work.runs = work.runs.filter(r => r.runtimes.nekoc && r.runtimes.hateneko);
      for (let repeat = work.runs.length; repeat < repetitions; repeat++) {
        const run = { repeat, idle_checks: [], runtimes: {} };
        work.runs.push(run);
        for (const runtime of (repeat % 2 ? ["hateneko", "nekoc"] : ["nekoc", "hateneko"])) {
          if (runtime === "hateneko" && work.compile_error) { run.runtimes[runtime] = { status: "compile-error", error: work.compile_error }; continue; }
          run.idle_checks.push(assertIdle());
          try {
            let result;
            if (runtime === "nekoc") result = JSON.parse(invoke(path.resolve(o.binary), [file, "--frames", String(frames), "--warmup", String(warmup)], { timeout }));
            else {
              const output = path.join(o.out, `${index}-${repeat}-love.json`);
              await unlink(output).catch(e => { if (e.code !== "ENOENT") throw e; });
              let log, error;
              try { log = invoke(o.love, [path.join(o.copy, "player")], { cwd: path.join(o.copy, "player"), timeout, env: { ...process.env, HNBENCH_OUT: output, HNBENCH_WORK: name, HNBENCH_FRAMES: String(frames), HNBENCH_WARMUP: String(warmup), KN_YIELD_PROBE: "0" } }); }
              catch (e) { error = e; log = String(e.stdout ?? "") + String(e.stderr ?? ""); }
              await writeFile(path.join(o.out, `${index}-${repeat}-love.log`), log ?? "");
              try { result = JSON.parse(await readFile(output, "utf8")); } catch { throw error ?? new Error("Love produced no result"); }
              if (error && !result.errors?.length) throw error;
            }
            result.status = result.errors?.length ? "runtime-error" : result.missing_primitives?.length ? "unsupported" : "ok";
            if (result.status === "ok" && (result.frame_ms?.length !== frames || result.warmup_ms?.length !== warmup)) throw new Error(`Incorrect update count: ${result.frame_ms?.length}`);
            if (result.frame_ms?.length) result.summary_ms = summarize(result.frame_ms);
            run.runtimes[runtime] = result;
          } catch (e) { run.runtimes[runtime] = { status: "failed", error: e.message }; }
        }
        const n = run.runtimes.nekoc, h = run.runtimes.hateneko;
        compareRun(run, work);
        console.log(work.file, repeat, n.status, h.status, run.comparison.equal ? "equal-observed-state" : "NOT-EQUAL");
        await writeFile(path.join(o.out, "results.json"), JSON.stringify(report, null, 2));
      }
    }
  } finally {
    const after = await fingerprint(ref);
    report.reference.unchanged = JSON.stringify(before) === JSON.stringify(after);
    await writeFile(path.join(o.out, "results.json"), JSON.stringify(report, null, 2));
    if (!report.reference.unchanged) throw new Error("Read-only reference fingerprint changed");
  }
  if (report.works.some(w => w.runs.some(r => !r.comparison?.equal))) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
