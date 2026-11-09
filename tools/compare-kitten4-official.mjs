#!/usr/bin/env node
// Published Kitten 4 player vs this checkout's /play. Outputs stay under dist/.
// cargo build --release --bin web
// node tools/compare-kitten4-official.mjs dist/official-compare dist/kitten4-corpus/*.bcm --seconds 4
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash("sha256").update(value).digest("hex");

export function parseArgs(argv) {
  const args = [...argv];
  const index = args.indexOf("--seconds");
  const seconds = index < 0 ? 4 : Number(args.splice(index, 2)[1]);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) throw Error("--seconds must be between 0 and 300");
  const [out, ...files] = args;
  if (!out || !files.length) throw Error("Usage: compare-kitten4-official.mjs <out-dir> <work.bcm... | corpus-dir> [--seconds 4]");
  return { out: path.resolve(out), files, seconds };
}

export function normalizeNeko(raw) {
  return {
    actors: Object.fromEntries(Object.entries(raw.actors).map(([id, a]) => [id, {
      x: a.x, y: a.y,
      // debug_snapshot is the raw VM heading. Binary frame.direction has already
      // subtracted costume_turn (90 for K4); do NOT subtract that a second time.
      angle: 90 - a.direction,
      visible: a.visible, scaleX: a.scale * a.size_x / 100,
      scaleY: a.scale * a.size_y / 100, costume: a.costume,
    }])),
    variables: raw.variables, lists: raw.lists,
  };
}

export function compareStates(official, nekoc, epsilon = 1e-6) {
  const differences = [];
  function visit(a, b, key) {
    if (typeof a === "number" && typeof b === "number") {
      let delta = b - a;
      if (key.endsWith(".angle")) delta = ((delta + 180) % 360 + 360) % 360 - 180;
      if (Math.abs(delta) > epsilon) differences.push({ field: key, official: a, nekoc: b, delta });
    } else if (a === undefined || b === undefined) {
      differences.push({ field: key, official: a ?? null, nekoc: b ?? null, missing: a === undefined ? "official" : "nekoc" });
    } else if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
      for (const child of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[child], b[child], key ? `${key}.${child}` : child);
    } else if (a !== b) differences.push({ field: key, official: a, nekoc: b });
  }
  visit(official, nekoc, "");
  return differences;
}

export function summarize(differences) {
  const fields = {};
  for (const diff of differences) {
    const group = diff.field.startsWith("actors.") ? diff.field.split(".").slice(2).join(".") || "missingActor" : diff.field.split(".")[0];
    const entry = fields[group] ??= { count: 0, maxAbsDelta: null };
    entry.count++;
    if (diff.delta !== undefined) entry.maxAbsDelta = Math.max(entry.maxAbsDelta ?? 0, Math.abs(diff.delta));
  }
  return fields;
}

// Executed in the official page. No vendor module is replaced. Only update is
// wrapped once to observe the boundary immediately BEFORE the first VM tick.
// vxpV.ft -> manager.update is synchronous during run; a post-click evaluate
// would already be too late. The wrapper forwards this/arguments/return unchanged.
export function installOfficialProbe({ actorIds, variableIds, listIds }) {
  let req;
  window.webpackJsonp.push([["nekoc-compare"], {
    "nekoc-compare": (module, exports, require) => { req = require; },
  }, [["nekoc-compare"]]]);
  const candidates = Object.keys(req.m).filter(id => /get_actor_by_id/.test(String(req.m[id])));
  let stage, stageModule;
  for (const id of candidates) {
    try {
      const value = typeof req(id).a === "function" && req(id).a();
      if (value?.get_actor_by_id) { stage = value; stageModule = id; break; }
    } catch { /* A signature match need not be a stage singleton. */ }
  }
  if (!stage) throw Error("Official stage module signature not found");
  const heart = req("KmiX").b(), manager = heart.get_runtime_manager();
  const copy = value => JSON.parse(JSON.stringify(value, (_, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) return { nonfinite: String(v) };
    if (v === undefined) return { undefined: true };
    return v;
  }));
  const read = () => {
    const actors = {};
    for (const id of actorIds) {
      const actor = stage.get_actor_by_id(id);
      if (!actor) continue; // Explicitly reported as missing by the comparator.
      const position = actor.get_position(), scale = actor.get_scale();
      actors[id] = { x: position.x, y: position.y, angle: actor.get_rotation() * 180 / Math.PI,
        visible: actor.get_visible(), scaleX: scale.x * 100, scaleY: scale.y * 100,
        costume: actor.get_current_style()?.style_id ?? null };
    }
    return copy({ actors,
      variables: Object.fromEntries(variableIds.map(id => [id, manager.get_global_variable(id)])),
      lists: Object.fromEntries(listIds.map(id => [id, manager.get_global_variable(id)])),
    });
  };
  const probe = window.nekoOfficialProbe = { read, zero: null, zeroError: null,
    evidence: { stageModule, scripts: [...document.scripts].map(s => s.src).filter(Boolean),
      update: String(manager.update), getGlobalVariable: String(manager.get_global_variable) } };
  const original = manager.update;
  manager.update = function (...args) {
    manager.update = original;
    try {
      probe.zero = read();
      probe.zeroFrames = manager.get_elapsed_frames();
    } catch (error) { probe.zeroError = String(error); }
    return Reflect.apply(original, this, args);
  };
  return probe.evidence;
}

export async function startServer(file, { executable, timeout = 240000 } = {}) {
  const binary = executable || path.join(root, "target", "release", process.platform === "win32" ? "web.exe" : "web");
  const server = spawn(binary, [path.resolve(file), "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", spawnError;
  server.on("error", error => { spawnError = error; });
  server.stdout.on("data", bytes => { stdout = (stdout + bytes).slice(-32000); });
  server.stderr.on("data", bytes => { stderr = (stderr + bytes).slice(-32000); });
  const closed = once(server, "close").catch(() => {});
  const stop = async () => { if (server.exitCode === null) server.kill(); await closed; };
  const started = Date.now();
  try {
    let base;
    while (Date.now() - started < timeout) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null || server.signalCode !== null) throw Error(`server exited (${server.exitCode ?? server.signalCode})`);
      const match = stdout.match(/NekoC Web Studio: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        base = match[1];
        const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json(), () => null);
        if (health?.ok && health.player_protocol === 2) {
          const startupMs = Date.now() - started;
          return { base, stop, diagnostics: () => ({ stdout, stderr, startupMs, pid: server.pid }) };
        }
      }
      await delay(100);
    }
    throw Error("server readiness timeout (no successful health check)");
  } catch (error) {
    await stop();
    throw Error(`${error}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
}

async function official(browser, id, source, inputText, out, seconds) {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
  const page = await context.newPage(), errors = [], downloads = [], publications = [], network = [];
  page.on("pageerror", error => errors.push(String(error)));
  // Record the actual input served to the official runtime. The publication
  // route below separately retains provenance of the live, unpinned bytes.
  const pending = [];
  page.on("response", response => {
    const resource = response.request().resourceType();
    if (["xhr", "fetch"].includes(resource)) network.push({ url: response.url(), status: response.status() });
    if (/creation\.codemao\.cn/.test(response.url()) || /\.bcm(?:\?|$)/.test(response.url()) || /json/.test(response.headers()["content-type"] || "")) pending.push((async () => {
      try {
        const bytes = await response.body(), value = JSON.parse(bytes.toString().replace(/^\uFEFF/, ""));
        if (value.work_type === "KITTEN") downloads.push({ url: response.url(), sha256: hash(bytes),
          sameProject: JSON.stringify(value.theatre) === JSON.stringify(source.theatre) });
      } catch { /* Unrelated/non-JSON responses are not project evidence. */ }
    })());
  });
  try {
    // A publication may change after the corpus was downloaded. Preserve live
    // provenance but run the SAME corpus in the genuine official runtime.
    await page.route(/^https:\/\/creation\.(?:codemao\.cn|bcmcdn\.com)\/.*\.json(?:\?.*)?$/, async route => {
      const response = await route.fetch({ timeout: 90000 });
      const bytes = await response.body();
      let native = false;
      try { native = JSON.parse(bytes.toString().replace(/^\uFEFF/, "")).work_type === "KITTEN"; } catch {}
      if (!native) return route.fulfill({ response, body: bytes });
      publications.push({ url: route.request().url(), liveSha256: hash(bytes),
        inputSha256: hash(inputText), sameBytes: hash(bytes) === hash(inputText), pinnedToCorpus: true });
      return route.fulfill({ response, contentType: "application/json", body: inputText });
    });
    await page.goto(`https://player.codemao.cn/new/we/${id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.webpackJsonp && document.querySelector(".CUI-player-cover-play-btn"), null, { timeout: 90000 });
    const allVariables = [...Object.entries(source.variables || {}).filter(([, v]) => v.is_global),
      ...Object.entries(source.cloud_variables || {}).map(([id, value]) => [id, { ...value, type: value.type === "public_list" ? "list" : "any" }])];
    const spec = { actorIds: Object.keys(source.theatre.actors),
      variableIds: allVariables.filter(([, v]) => v.type !== "list").map(([id]) => id),
      listIds: allVariables.filter(([, v]) => v.type === "list").map(([id]) => id) };
    const evidence = await page.evaluate(installOfficialProbe, spec);
    await page.locator(".CUI-player-cover-play-btn").click();
    await page.waitForFunction(() => window.nekoOfficialProbe?.zero || window.nekoOfficialProbe?.zeroError, null, { timeout: 180000 });
    const initial = await page.evaluate(() => ({ state: nekoOfficialProbe.zero, frames: nekoOfficialProbe.zeroFrames, error: nekoOfficialProbe.zeroError }));
    if (initial.error) throw Error(initial.error);
    if (initial.frames !== 0) throw Error(`Official initial sample is not frame zero: ${initial.frames}`);
    await page.waitForTimeout(seconds * 1000);
    const later = await page.evaluate(() => ({ state: nekoOfficialProbe.read(), sampledAt: performance.now() }));
    await page.locator("canvas").first().screenshot({ path: path.join(out, `${id}-official.png`), timeout: 30000 });
    await Promise.allSettled(pending);
    if (!publications.length) throw Error("No official project response pinned to the corpus; input identity unverified");
    return { errors, initial, later, evidence, downloads, publications, network };
  } finally { await context.close(); }
}

async function nekoc(browser, file, id, out, seconds) {
  const server = await startServer(file);
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    // /play's normal interactive import has a 60s fetch deadline. Published
    // projects may spend nearly that long in per-script diagnostics, especially
    // under CPU load. Obtain that exact read-only report before navigation with
    // a bounded, longer deadline, then hand it to the unchanged page import path.
    const importStarted = Date.now();
    const projectResponse = await fetch(`${server.base}/api/project`, { signal: AbortSignal.timeout(30000) });
    if (!projectResponse.ok) throw Error(`project HTTP ${projectResponse.status}`);
    const project = await projectResponse.json();
    const imported = await fetch(`${server.base}/api/import-player`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project),
      signal: AbortSignal.timeout(240000),
    });
    const report = await imported.text();
    if (!imported.ok) throw Error(`import HTTP ${imported.status}: ${report.slice(0, 1000)}`);
    const importMs = Date.now() - importStarted;
    await page.route(`${server.base}/api/import-player`, route => {
      if (route.request().method() !== "POST" || JSON.stringify(route.request().postDataJSON()) !== JSON.stringify(project)) {
        return route.abort("failed"); // Never give another project a cached report.
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: report });
    }, { times: 1 });
    await page.goto(`${server.base}/play?compare=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Titles can legitimately stay "Neko · 播放器" for unnamed projects.
    await page.waitForFunction(() => window.nekoPlayDiagnostics && !nekoPlayDiagnostics().busy, null, { timeout: 240000 });
    const ready = await page.evaluate(() => ({ ...nekoPlayDiagnostics(), notice: document.querySelector("#notice-text").textContent }));
    if (!ready.playable) throw Error(`Project not playable: ${ready.notice}`);
    await page.locator("#toggle").click();
    await page.waitForFunction(() => window.nekoCompareZero, null, { timeout: 60000 });
    const initialRaw = await page.evaluate(() => window.nekoCompareZero);
    if (initialRaw.sequence !== 0) throw Error("NekoC initial sample is not frame zero");
    await page.waitForTimeout(seconds * 1000);
    const laterRaw = await page.evaluate(() => window.nekoPlaySnapshot());
    await page.locator("#stage-box").screenshot({ path: path.join(out, `${id}-nekoc.png`), timeout: 30000 });
    return { errors, initial: { state: normalizeNeko(initialRaw), raw: initialRaw },
      later: { state: normalizeNeko(laterRaw), raw: laterRaw }, ready, importMs, server: server.diagnostics() };
  } finally { await context.close(); await server.stop(); }
}

export function summaryTable(reports) {
  const fields = value => Object.entries(value || {}).map(([field, stats]) => `${field}:${stats.count}${stats.maxAbsDelta === null ? "" : ` (max Δ ${Number(stats.maxAbsDelta.toFixed(6))})`}`).join("; ") || "无";
  return ["| 作品 | 截图（官方/NekoC） | 第 0 帧差异数 | 第 0 帧字段 | 延时差异数（参考） | 延时字段 |",
    "| --- | --- | ---: | --- | ---: | --- |",
    ...reports.map(r => `| ${r.id} | ${r.official.initial ? "✓" : "✗"}/${r.nekoc.initial ? "✓" : "✗"} | ${r.differences?.initial.length ?? "失败"} | ${fields(r.summary?.initial)} | ${r.differences?.later.length ?? "失败"} | ${fields(r.summary?.later)} |`)].join("\n") + "\n";
}

async function main() {
  const { out, files: inputs, seconds } = parseArgs(process.argv.slice(2));
  const files = [];
  for (const input of inputs) {
    if (input.endsWith(".bcm")) files.push(path.resolve(input));
    else for (const name of (await readdir(input)).filter(name => name.endsWith(".bcm")).sort()) files.push(path.resolve(input, name));
  }
  if (!files.length) throw Error("No .bcm inputs");
  await mkdir(out, { recursive: true });
  const browser = await loadPlaywright().chromium.launch({ channel: process.env.NEKOC_BROWSER_CHANNEL || "msedge", headless: true,
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const reports = [];
  try {
    for (const file of files) {
      const id = path.basename(file, ".bcm");
      if (!/^\d+$/.test(id)) throw Error(`Published work ID required as filename: ${file}`);
      const bytes = await readFile(file), source = JSON.parse(bytes.toString().replace(/^\uFEFF/, ""));
      console.log(`[${id}] official`);
      const report = { id, name: source.project_name, seconds, inputSha256: hash(bytes),
        initialBoundary: "after start initialization, before first VM scheduler tick (no script instruction executed)",
        scope: "original actors by source ID, all scenes; global variables and lists; clones excluded from strict matching",
        official: await official(browser, id, source, bytes.toString(), out, seconds).catch(error => ({ error: String(error) })) };
      console.log(`[${id}] nekoc`);
      report.nekoc = await nekoc(browser, file, id, out, seconds).catch(error => ({ error: String(error) }));
      if (report.official.initial && report.nekoc.initial) {
        // Clone identities are runtime-specific; keep all raw data but compare originals.
        for (const sample of ["initial", "later"]) {
          report.nekoc[sample].state.actors = Object.fromEntries(Object.entries(report.nekoc[sample].state.actors).filter(([id]) => id in source.theatre.actors));
          for (const section of ["variables", "lists"]) report.nekoc[sample].state[section] = Object.fromEntries(Object.entries(report.nekoc[sample].state[section]).filter(([id]) =>
            source.variables?.[id]?.is_global || id in (source.cloud_variables || {})));
        }
        report.differences = Object.fromEntries(["initial", "later"].map(sample => [sample,
          compareStates(report.official[sample].state, report.nekoc[sample].state)]));
        report.summary = Object.fromEntries(["initial", "later"].map(sample => [sample, summarize(report.differences[sample])]));
      }
      reports.push(report);
      await writeFile(path.join(out, `${id}.json`), JSON.stringify(report, null, 2) + "\n");
      await writeFile(path.join(out, "summary.json"), JSON.stringify(reports.map(({ id, summary, official, nekoc }) => ({ id, summary, officialError: official.error, nekocError: nekoc.error })), null, 2) + "\n");
      await writeFile(path.join(out, "summary.md"), summaryTable(reports));
      console.log(`[${id}] ${JSON.stringify(report.summary || { official: report.official.error, nekoc: report.nekoc.error })}`);
    }
    const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
    const uri = async file => `data:image/png;base64,${(await readFile(file).catch(() => Buffer.alloc(0))).toString("base64")}`;
    const cells = await Promise.all(reports.map(async ({ id }) => `<div style="display:flex;align-items:center;gap:4px"><span style="width:80px">${id}</span><img width="440" height="330" style="object-fit:contain" src="${await uri(path.join(out, `${id}-official.png`))}"><img width="440" height="330" style="object-fit:contain" src="${await uri(path.join(out, `${id}-nekoc.png`))}"></div>`));
    await page.setContent(`<body style="margin:0;background:#222;color:white;font:12px sans-serif">${cells.join("")}</body>`);
    await page.screenshot({ path: path.join(out, "montage.png"), fullPage: true });
    if (reports.some(r => !r.differences)) process.exitCode = 1;
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
