#!/usr/bin/env node
// Official KN benchmark runner.
//
// This runner is deliberately separate from official.mjs (the K4 oracle) and
// kn-ab.mjs (the native before/after runner).  It reads the locally archived
// official KN bundles without copying or modifying them, then drives the live
// official editor with a virtual requestAnimationFrame clock.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeKnFixtures } from "./kn-fixtures.mjs";
import { assertIdle, assertWritablePath, ignoredPath } from "./hateneko.mjs";
import { loadPlaywright } from "../probe-kitten4.mjs";
import { summarize } from "./run.mjs";
import { sourceEvidence } from "../semantics-kn-warp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OFFICIAL_URL = "https://kn.codemao.cn/editor";
const EXPECTED_BUNDLES = {
  "main.8ccf2442.js": {
    sha256: "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165",
    required: true,
  },
  "crc_libs.8196dbd1.js": {
    sha256: "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7",
    required: true,
  },
  // Also mandatory locally: no runtime dependency may fall back to fetching.
  "main-vendors.07f7dd7e.js": {
    sha256: "38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68",
    required: true,
  },
};
const FIXTURE_NAMES = ["numeric", "list", "string", "clones", "broadcast", "recursion", "pen"];
// Hash the exact first-party project structure, not just a permissive block
// whitelist: another hat/conditional could preserve the tail count but alter
// useful work. Changes to kn-fixtures require a fresh audit of these pins.
const WORKLOAD_CONTRACTS = {
  numeric: { tailPerUpdate: 4000, astHash: "bcf9ad6514c85f1e121cc993fb53f8586ecacb3ae9e3f8d3dc619321cc0be0c4" },
  list: { tailPerUpdate: 1000, astHash: "6c7ee4fda5894d3e2a651fe218947dfe2718fe6ae56d74ad9146c8ac187dd8bd" },
  string: { tailPerUpdate: 2000, astHash: "254c97ae3953e68e0370ca21b39e62e766161df031606d31ef73c3a229751498" },
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function blocksOf(project) {
  const result = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.type === "string") result.push(value);
    Object.values(value).forEach(visit);
  };
  visit(project);
  return result;
}

export function workloadContract(name, project, frames) {
  const spec = WORKLOAD_CONTRACTS[name];
  if (!spec || project?.toolType !== "KN") return { certified: false, reason: "fixture is outside numeric/list/string contract" };
  const blocks = blocksOf(project);
  const repeat = blocks.filter(block => block.type === "repeat_n_times");
  const repeatCounts = repeat.map(block => Number(block.inputs?.times?.fields?.NUM));
  const forbidden = blocks.filter(block => /^(?:procedures_|wait|broadcast|clone|mirror|pen|self_pen|play_audio|set_audio|set_timer)/.test(block.type));
  const digest = sha256(Buffer.from(JSON.stringify(project)));
  const fixedAst = digest === spec.astHash && repeatCounts.length === 1 && repeatCounts[0] === spec.tailPerUpdate
    && !forbidden.length && blocks.some(block => block.type === "repeat_forever") && blocks.some(block => block.type === "warp");
  return { certified: fixedAst, name, ast_sha256: digest,
    tail_per_update: spec.tailPerUpdate, expected_tail_total: spec.tailPerUpdate * frames,
    forbidden_blocks: forbidden.map(block => block.type), repeat_counts: repeatCounts,
    fixed_ast: fixedAst, no_async_or_calls: !forbidden.length,
    reason: fixedAst ? "fixed repository-owned AST; one synchronous warp loop; no calls/async" : "AST contract mismatch" };
}

export function certifyWorkload(contract, diagnostic, warmup, frames) {
  if (!contract?.fixed_ast || !diagnostic?.ok || diagnostic.deterministic !== true) return {
    certified: false,
    equivalent: false,
    reason: diagnostic?.error || contract?.reason || "workload contract is not eligible",
  };
  const all = diagnostic.updates ?? [];
  const measured = all.slice(warmup);
  const expected = contract.tail_per_update;
  const maxStep = Math.max(0, ...all.map(update => update.max_step_tail ?? 0));
  const tails = measured.map(update => update.tail_calls);
  const completed = measured.filter(update => update.tail_calls === expected && update.completed_batch === true).length;
  const exact = all.length === warmup + frames && measured.length === frames
    && all.every(update => update.tail_calls === expected && update.completed_batch === true
      && update.boundary_returns === 0 && Number.isSafeInteger(update.max_step_tail)
      && update.max_step_tail > 0) && completed === frames
    && maxStep < 30000 && (diagnostic.errors ?? []).length === 0;
  return {
    certified: exact,
    equivalent: false,
    name: contract.name,
    ast_sha256: contract.ast_sha256,
    tail_per_update: expected,
    expected_tail_total: expected * frames,
    observed_tail_total: measured.reduce((sum, update) => sum + update.tail_calls, 0),
    per_update_tail_calls: tails,
    completed_batches: completed,
    expected_batches: frames,
    max_single_step_tail: maxStep,
    boundary_unit: "warped OptiRunner.step_iteration_yield calls; one call is one observed warp-loop boundary",
    deterministic: diagnostic.deterministic === true,
    no_async_or_calls: contract.no_async_or_calls,
    reason: exact ? "independent official diagnostic matched fixed AST batch on every measured update" : "official diagnostic did not prove every fixed batch",
  };
}

export function nativeWorkloadEvidence(native, contract) {
  if (!native || native.status !== "ok") return { certified: false, equivalent: false, reason: "native run unavailable" };
  if (native.deterministic !== true) return { certified: false, equivalent: false, reason: "native result is not deterministic=true" };
  if (!Number.isSafeInteger(native.instructions) || native.instructions < 0) {
    return { certified: false, equivalent: false, reason: "native instruction evidence is absent" };
  }
  return {
    certified: false,
    equivalent: false,
    instructions: native.instructions,
    active_frames: native.active_frames,
    reason: "native reports total instructions, not the official warp-tail unit; a coordinated per-update batch/tail diagnostic is still required",
    required_diagnostic: "per-update completed batch count, total warp-tail count, and max single-step tail with the same unit",
    contract: contract?.name ?? null,
  };
}

export function parseArgs(argv) {
  const o = {
    out: "dist/bench/official-kn",
    frames: 60,
    warmup: 10,
    repeats: 3,
    dt: 1 / 60,
    budget: 4096,
    timeout: 120000,
    channel: "msedge",
    bundleDir: process.env.KN_OFFICIAL_BUNDLE_DIR || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prepare-only") { o.prepareOnly = true; continue; }
    if (arg === "--diagnostic") { o.diagnostic = true; continue; }
    const key = arg.replace(/^--/, "");
    if (!arg.startsWith("--") || !["out", "fixtures", "input", "bundle-dir", "frames", "warmup", "repeats", "dt", "budget", "timeout", "channel", "native-binary", "native-wall-clock-binary"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error(`Invalid option ${arg}`);
    }
    const value = argv[++i];
    o[key] = value;
    if (key === "bundle-dir") o.bundleDir = value;
    if (key === "native-binary") o.nativeBinary = value;
    if (key === "native-wall-clock-binary") o.nativeWallClockBinary = value;
  }
  for (const key of ["frames", "warmup", "repeats", "budget"]) {
    o[key] = Number(o[key]);
    if (!Number.isSafeInteger(o[key]) || o[key] < (key === "warmup" ? 0 : 1) || o[key] > 100000) throw new Error(`Invalid ${key}`);
  }
  o.timeout = Number(o.timeout);
  if (!Number.isSafeInteger(o.timeout) || o.timeout < 1 || o.timeout > 3600000) throw new Error("Invalid timeout");
  o.dt = Number(o.dt);
  if (!Number.isFinite(o.dt) || o.dt <= 0 || o.dt > 1) throw new Error("Invalid dt");
  if (o.frames + o.warmup > 100000) throw new Error("Too many total frames");
  if (o.input && o.fixtures) throw new Error("--input and --fixtures are mutually exclusive");
  o.out = ignoredPath(o.out);
  if (!o.bundleDir) throw new Error("Explicit --bundle-dir or KN_OFFICIAL_BUNDLE_DIR is required; official bundles are local-only");
  o.bundleDir = path.resolve(root, o.bundleDir);
  if ((o.nativeBinary || o.nativeWallClockBinary) && o.dt !== 1 / 60) throw new Error("Native perf-bench only supports dt=1/60");
  return o;
}

export function bundleManifest(directory) {
  return Object.fromEntries(Object.entries(EXPECTED_BUNDLES).map(([name, spec]) => [name,
    { path: path.resolve(directory, name), expectedSha256: spec.sha256, required: spec.required }]));
}

export async function readOfficialBundles(directory) {
  const manifest = bundleManifest(directory);
  const result = {};
  for (const [name, item] of Object.entries(manifest)) {
    try {
      const bytes = await readFile(item.path);
      const digest = sha256(bytes);
      if (digest !== item.expectedSha256) throw new Error(`${name} SHA-256 mismatch: ${digest}`);
      result[name] = { path: item.path, bytes: bytes.length, sha256: digest, body: bytes };
    } catch (error) {
      if (item.required || error.code !== "ENOENT") throw new Error(`Official KN bundle unavailable: ${item.path}; ${error.message}`);
    }
  }
  for (const name of Object.keys(EXPECTED_BUNDLES).filter(n => EXPECTED_BUNDLES[n].required)) {
    if (!result[name]) throw new Error(`Official KN bundle unavailable: ${path.join(directory, name)}`);
  }
  return result;
}

export function exposeLoader(bytes) {
  const marker = "var __webpack_exports__=", original = bytes.toString("utf8");
  if (original.split(marker).length !== 2) throw new Error("Official webpack loader changed");
  return original.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`);
}

export { summarize };

export function schedulerScript(dt, budget) {
  return `(() => {
    let nextId = 1;
    let now = performance.now();
    let queue = new Map();
    const pending = new Map();
    const nativeRequest = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let held = false;
    const stepMs = ${JSON.stringify(dt * 1000)};
    const maxCallbacks = ${budget};
    window.__knBenchScheduler = {
      stepping: false,
      tick: 0,
      hold() {
        held = true;
        now = performance.now();
        for (const [id, item] of pending) { nativeCancel(item.handle); queue.set(id, item.callback); }
        pending.clear();
      },
      step() {
        this.tick++;
        now += stepMs;
        const callbacks = [...queue.entries()];
        if (callbacks.length > maxCallbacks) throw new Error('rAF callback safety budget exceeded');
        this.stepping = true;
        try { for (const [id, callback] of callbacks) { if (queue.delete(id)) callback(now); } }
        finally { this.stepping = false; }
        return { callbacks: callbacks.length, queued: queue.size, now };
      },
      queued() { return queue.size; },
      now() { return now; },
    };
    window.requestAnimationFrame = callback => {
      const id = nextId++;
      if (held) queue.set(id, callback);
      else {
        const handle = nativeRequest(timestamp => { pending.delete(id); callback(timestamp); });
        pending.set(id, { handle, callback });
      }
      return id;
    };
    window.cancelAnimationFrame = id => { const item = pending.get(id); if (item) nativeCancel(item.handle); pending.delete(id); queue.delete(id); };
  })();`;
}

const pageInstall = ({ dt, frames, warmup, budget, diagnostic = false, diagnosticExpectedTail = null }) => ({
  dt, frames, warmup, budget, diagnostic, diagnosticExpectedTail,
});

export function projectionScript() {
  return ({ frames, warmup, dt, budget, diagnostic = false, diagnosticExpectedTail = null }) => {
    const req = window.__nekocRequire;
    const core = req(26921).cG.get_instance().getHeart().core;
    const runtime = core.get_runtime_manager();
    const manager = runtime.run_mgr ?? runtime;
    const bcm = req(91107).BcmInstance;
    const encode = (value, seen = new Set()) => {
      if (value === undefined) return { $undefined: true };
      if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) };
      if (Object.is(value, -0)) return { $number: "-0" };
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return { $cycle: true };
      seen.add(value);
      const result = Array.isArray(value)
        ? Array.from(value, item => encode(item, seen))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, seen)]));
      seen.delete(value);
      return result;
    };
    const sample = {
      frame_ms: [], warmup_ms: [], updates: 0, update_frames: [], done: false,
      errors: [], configuration: { dt, frames, warmup, budget, deterministic: true },
    };
    const workloadDiagnostic = diagnostic ? {
      ok: true, deterministic: true, expected_tail_per_update: diagnosticExpectedTail,
      updates: [], errors: [], total_tail_calls: 0, total_boundary_returns: 0,
    } : null;
    const original = manager.update;
    let lastTick = -1;
    if (typeof original !== "function") throw new Error("Official KN RuntimeManager.update is unavailable");
    manager.update = function (...args) {
      if (!window.__knBenchScheduler?.stepping) return undefined;
      if (lastTick === window.__knBenchScheduler.tick) throw new Error("More than one VM update requested in one controlled rAF batch");
      if (sample.done) return undefined;
      lastTick = window.__knBenchScheduler.tick;
      const before = this.frames;
      const updateDiagnostic = workloadDiagnostic ? { frame_before: before, tail_calls: 0, boundary_returns: 0, steps: [], max_step_tail: 0 } : null;
      const previousDiagnostic = workloadDiagnostic?.current;
      if (workloadDiagnostic) workloadDiagnostic.current = updateDiagnostic;
      const started = diagnostic ? 0 : performance.now();
      let value;
      try { value = original.apply(this, args); }
      catch (error) { sample.errors.push(String(error?.stack || error)); workloadDiagnostic?.errors.push(String(error?.stack || error)); throw error; }
      finally { if (workloadDiagnostic) workloadDiagnostic.current = previousDiagnostic; }
      const elapsed = diagnostic ? null : performance.now() - started;
      const frameChanged = this.frames !== before;
      if (updateDiagnostic) {
        updateDiagnostic.frame_after = this.frames;
        updateDiagnostic.completed_batch = frameChanged && (diagnosticExpectedTail == null || updateDiagnostic.tail_calls === diagnosticExpectedTail)
          && updateDiagnostic.max_step_tail < 30000;
        workloadDiagnostic.updates.push(updateDiagnostic);
        workloadDiagnostic.total_tail_calls += updateDiagnostic.tail_calls;
        workloadDiagnostic.total_boundary_returns += updateDiagnostic.boundary_returns;
      }
      if (frameChanged) {
        sample.updates++;
        sample.update_frames.push(this.frames);
        if (!diagnostic) {
          if (sample.warmup_ms.length < warmup) sample.warmup_ms.push(elapsed);
          else sample.frame_ms.push(elapsed);
          if (sample.frame_ms.length === frames) sample.done = true;
        }
        if (diagnostic && sample.updates === warmup + frames) sample.done = true;
      }
      return value;
    };
    const config = core.get_util().config.get();
    if (config.max_warp_iterations_per_interpreter_step !== 30000 || config.max_procedure_calls_per_interpreter_step !== 50000 || config.user_debug_mode) {
      throw new Error("Official KN scheduling defaults changed");
    }
    config.deterministic = { seconds_per_update: dt };
    const bus = core.get_event_bus();
    if (!bus.error?.runtime?.immediate?.sub) throw new Error("Missing official runtime error channel");
    bus.error.runtime.immediate.sub(error => {
      const message = String(error?.error?.message || error?.error || error);
      sample.errors.push(message);
      workloadDiagnostic?.errors.push(message);
    });
    if (workloadDiagnostic) {
      const find = name => {
        for (const [id, factory] of Object.entries(req.m)) if (factory.toString().includes(`e.${name}=`)) {
          const exports = req(id); if (exports[name]) return exports[name];
        }
        throw new Error(`Missing official export: ${name}`);
      };
      const Runner = find("OptiRunner");
      const originalStep = Runner.prototype.step;
      const originalBoundary = Runner.prototype.step_iteration_yield;
      Runner.prototype.step = function (...args) {
        const step = { tail_calls: 0, boundary_returns: 0 };
        const previous = workloadDiagnostic.current_step;
        workloadDiagnostic.current_step = step;
        let value;
        try { value = originalStep.apply(this, args); }
        finally {
          workloadDiagnostic.current_step = previous;
          if (workloadDiagnostic.current) {
            workloadDiagnostic.current.steps.push(step);
            workloadDiagnostic.current.max_step_tail = Math.max(workloadDiagnostic.current.max_step_tail, step.tail_calls);
          }
        }
        return value;
      };
      Runner.prototype.step_iteration_yield = function (...args) {
        const warped = !!(args[0] || this.current_frame?.is_warped);
        const answer = originalBoundary.apply(this, args);
        if (workloadDiagnostic.current && warped) {
          workloadDiagnostic.current.tail_calls++;
          if (answer) workloadDiagnostic.current.boundary_returns++;
          if (workloadDiagnostic.current_step) {
            workloadDiagnostic.current_step.tail_calls++;
            if (answer) workloadDiagnostic.current_step.boundary_returns++;
          }
        }
        return answer;
      };
    }
    const projection = () => {
      const variables = {}, entityVariables = {}, definitions = {};
      const data = core.get_runtime_data();
      const stage = req(54174).V.core;
      const store = stage.actors;
      if (typeof store.get_actor_ids !== "function" || typeof data.get_sprite_clones !== "function") throw new Error("Missing live actor/clone enumeration API");
      const prototypes = {};
      for (const id of Object.keys(bcm.getBcm().actors.actorsDict)) for (const liveId of [id, ...(data.get_sprite_clones(id) ?? [])]) prototypes[liveId] = id;
      const ids = store.get_actor_ids();
      if (ids.some(id => !prototypes[id])) throw new Error("Unmapped live actor prototype");
      if (Object.keys(prototypes).some(id => id !== prototypes[id] && !ids.includes(id))) throw new Error("Runtime clone absent from live actor enumeration");
      for (const id of ids) entityVariables[id] = {};
      for (const [id, definition] of Object.entries(bcm.variablesDict ?? {})) {
        const global = definition.isGlobal ?? definition.is_global;
        const owner = definition.currentEntityId ?? definition.current_entity;
        definitions[id] = { isGlobal: !!global, ...(owner ? { owner } : {}) };
        if (global) variables[id] = encode(manager.get_variable(id));
        else if (owner) for (const liveId of [...ids.filter(candidate => prototypes[candidate] === owner),
          ...(bcm.getBcm().scenes.scenesDict[owner] ? [owner] : [])]) {
          entityVariables[liveId] ??= {};
          entityVariables[liveId][id] = encode(manager.get_variable(id, undefined, liveId));
        }
      }
      const actors = {};
      for (const id of ids) {
        const found = store.get_actor(id);
        if (found?.is_error?.(found.value)) throw new Error(`Live actor unavailable: ${id}`);
        const actor = found?.value ?? found;
        const position = actor.get_position();
        const scale = actor.get_scale();
        const prototype = prototypes[id];
        const style = actor.get_current_style()?.style_id;
        // Stage rotation is VM heading in radians; native oracle_snapshot uses
        // the K4-facing 90-heading convention. Canonicalize only geometric -0;
        // variable values retain the tagged representation above.
        const rotation = 90 - actor.get_rotation() * 180 / Math.PI;
        const coordinate = value => Object.is(value, -0) ? 0 : value;
        actors[id] = encode({ id, prototype_id: prototype, x: coordinate(position?.x), y: coordinate(position?.y), rotation: coordinate(rotation),
          scale: scale.x * 100, scale_y: scale.y * 100,
          current_style_id: style, visible: actor.get_visible() });
      }
      sample.variable_definitions = definitions;
      return { current_scene_id: stage.scenes.get_current_scene(), variables,
        entity_variables: entityVariables, actors };
    };
    window.__knBench = { sample, projection, manager, config, runtime, core, workloadDiagnostic };
    return { config: encode(config), manager_frames: manager.frames };
  };
}

export function normalizeProjection(state) {
  const dict = value => value && typeof value === "object" && !Array.isArray(value);
  if (!dict(state) || typeof state.current_scene_id !== "string" || !dict(state.variables) || !dict(state.entity_variables) || !dict(state.actors)) return null;
  const actors = [];
  for (const [id, actor] of Object.entries(state.actors)) {
    if (!dict(actor) || actor.id !== id || typeof actor.prototype_id !== "string" || typeof actor.current_style_id !== "string"
      || typeof actor.visible !== "boolean" || !["x", "y", "rotation", "scale", "scale_y"].every(key => Number.isFinite(actor[key]))
      || !dict(state.entity_variables[id])) return null;
    actors.push({ prototype_id: actor.prototype_id, original: actor.id === actor.prototype_id,
      x: actor.x, y: actor.y, rotation: actor.rotation, scale: actor.scale, scale_y: actor.scale_y,
      current_style_id: actor.current_style_id, visible: actor.visible, variables: state.entity_variables[id] });
  }
  const sceneVariables = Object.fromEntries(Object.entries(state.entity_variables).filter(([id]) => !Object.hasOwn(state.actors, id)));
  return { current_scene_id: state.current_scene_id, variables: state.variables, actors, scene_variables: sceneVariables };
}

export function sameProjection(a, b) {
  const left = normalizeProjection(a), right = normalizeProjection(b);
  if (!left || !right) return false;
  const equal = (x, y) => {
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    }
    if (Object.is(x, y)) return true;
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((value, i) => equal(value, y[i]));
    if (x && y && typeof x === "object" && typeof y === "object") {
      if (Array.isArray(x) !== Array.isArray(y)) return false;
      const keys = Object.keys(x);
      return keys.length === Object.keys(y).length && keys.every(key => Object.hasOwn(y, key) && equal(x[key], y[key]));
    }
    return false;
  };
  if (!equal(left.variables, right.variables) || !equal(left.scene_variables, right.scene_variables) || left.current_scene_id !== right.current_scene_id || left.actors.length !== right.actors.length) return false;
  const remaining = [...right.actors];
  for (const actor of left.actors) {
    const index = remaining.findIndex(other => equal(actor, other));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

export function ratioIfComparable(official, native, work) {
  if (work.name === "pen" || work.brush_boundary) return { status: "unverified", reason: "brush boundary is not comparable" };
  if (official?.status !== "ok" || native?.status !== "ok") return { status: "unverified", reason: "load/run error" };
  if (official.configuration?.deterministic !== true || official.deterministic !== true || native.deterministic !== true
      || official.configuration.dt !== 1 / 60) return { status: "unverified", reason: "deterministic clocks not aligned" };
  const valid = run => Array.isArray(run.frame_ms) && Array.isArray(run.warmup_ms)
    && run.frame_ms.length === work.frames && run.warmup_ms.length === work.warmup
    && [...run.frame_ms, ...run.warmup_ms].every(value => Number.isFinite(value) && value >= 0)
    && !run.errors?.length && !run.page_errors?.length;
  if (!valid(official) || !valid(native)) return { status: "unverified", reason: "incomplete/invalid samples or runtime errors" };
  const ambiguous = value => value == null || typeof value === "number" && !Number.isFinite(value)
    || value && typeof value === "object" && (Object.hasOwn(value, "$number") || Object.hasOwn(value, "$undefined") || Object.hasOwn(value, "$cycle") || Object.values(value).some(ambiguous));
  if ([official, native].some(run => ambiguous(run.final_state?.variables) || ambiguous(run.final_state?.entity_variables))) {
    return { status: "unverified", reason: "native legacy JSON cannot certify nullish/nonfinite/cyclic values" };
  }
  if (!sameProjection(official.final_state, native.final_state)) return { status: "state-mismatch" };
  if (official.workload?.certified !== true || native.workload?.certified !== true
      || official.workload.equivalent !== true || native.workload.equivalent !== true) return { status: "unverified", reason: "equal workload not established" };
  if (![official.summary_ms?.mean, native.summary_ms?.mean].every(value => Number.isFinite(value) && value > 0)) return { status: "unverified", reason: "invalid timing" };
  // Means are derived from raw samples, never trusted from cached summaries.
  return { status: "comparable", ratio_official_over_native: summarize(official.frame_ms).mean / summarize(native.frame_ms).mean };
}

async function checkEditor(files, out, channel, bundleDir) {
  const report = path.join(out, "editor.json");
  execFileSync(process.execPath, [path.join(root, "tools/editor-compat.mjs"), ...files, "--channel", channel, "--bundle-dir", bundleDir, "--out", report], { cwd: root, encoding: "utf8", timeout: 600000, stdio: "pipe" });
  const parsed = JSON.parse(await readFile(report, "utf8"));
  if (!parsed.ok) throw new Error(`Official KN editor compatibility failed; see ${report}`);
  return report;
}

export async function runOne(input, options, bundles, repeat, checkpoint) {
  const source = await readFile(input, "utf8");
  const result = { status: "unverified", repeat, input: path.relative(root, input).replaceAll("\\", "/"), input_sha256: sha256(source),
    deterministic: true,
    bundles: Object.fromEntries(Object.entries(bundles).map(([name, item]) => [name, { path: item.path, bytes: item.bytes, sha256: item.sha256 }])),
    page_errors: [], console_errors: [], errors: [], frame_ms: [], warmup_ms: [], loaded_bundles: {}, diagnostic: options.diagnostic === true };
  let browser, page;
  const project = JSON.parse(source);
  const contract = workloadContract(path.basename(input, ".bcmkn"), project, options.frames);
  const projectUrl = "https://kn.codemao.cn/__nekoc_official_kn_bench__.bcmkn";
  try {
    browser = await loadPlaywright().chromium.launch({ headless: true, channel: options.channel });
    result.browser_version = browser.version();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => result.page_errors.push(String(error?.stack || error)));
    page.on("console", message => { if (message.type() === "error") result.console_errors.push(message.text()); });
    await page.addInitScript({ content: schedulerScript(options.dt, options.budget) });
    await page.route(projectUrl, route => route.fulfill({ status: 200, contentType: "application/json", body: source }));
    await page.route(/\/static\/js\/(main|crc_libs|main-vendors)\.[\w-]+\.js(?:\?.*)?$/, async route => {
      const name = path.basename(new URL(route.request().url()).pathname);
      const local = bundles[name];
      if (!local || !Object.hasOwn(EXPECTED_BUNDLES, name) || sha256(local.body) !== EXPECTED_BUNDLES[name].sha256) {
        result.errors.push(`Missing or unpinned local official bundle: ${name}`); return route.abort();
      }
      let body = local.body;
      result.loaded_bundles[name] = { url: route.request().url(), sha256: sha256(body), bytes: body.length, source: "local-read-only" };
      if (name.startsWith("main.")) {
        try { body = exposeLoader(body); }
        catch (error) { result.errors.push(error.message); return route.abort(); }
      }
      await route.fulfill({ status: 200, headers: { "content-type": "application/javascript", "access-control-allow-origin": "*" }, body });
    });
    await page.goto(`${OFFICIAL_URL}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: options.timeout });
    await page.waitForFunction(name => window.__nekocRequire && document.querySelector("canvas") && window.__nekocRequire(91107).BcmInstance.getBcm().projectName === name &&
      (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), project.projectName, { timeout: options.timeout });
    for (const [name, spec] of Object.entries(EXPECTED_BUNDLES).filter(([, item]) => item.required)) {
      if (result.loaded_bundles[name]?.sha256 !== spec.sha256) throw new Error(`Pinned bundle was not loaded: ${name}`);
    }
    await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
    const complete = page.getByText(/^完成$/).last();
    if (await complete.isVisible()) await complete.dispatchEvent("click");
    await page.evaluate(() => window.__knBenchScheduler.hold());
    result.runtime_configuration = await page.evaluate(projectionScript(), pageInstall({ ...options,
      diagnosticExpectedTail: contract.fixed_ast ? contract.tail_per_update : null }));
    await page.getByText(/^开始$/).last().dispatchEvent("click");
    const total = options.warmup + options.frames;
    for (let i = 0; i < total; i++) {
      const state = await page.evaluate(() => {
        const before = window.__knBench.sample.updates;
        const step = window.__knBenchScheduler.step();
        const after = window.__knBench.sample.updates;
        return { before, after, step, queued: window.__knBenchScheduler.queued(), sample: window.__knBench.sample,
          diagnostic: window.__knBench.workloadDiagnostic };
      });
      if (checkpoint) await checkpoint({ ...result, ...state.sample, status: "incomplete", errors: [...result.errors, ...state.sample.errors] });
      if (state.after !== i + 1) throw new Error(`Expected one official update per fixed frame; frame ${i + 1} produced ${state.after - state.before}`);
      if (state.step.callbacks > options.budget) throw new Error(`Fixed rAF budget exceeded: ${state.step.callbacks}`);
    }
    const observation = await page.evaluate(() => {
      const config = window.__knBench.core.get_util().config.get();
      if (config.deterministic?.seconds_per_update !== window.__knBench.sample.configuration.dt) throw new Error("Deterministic configuration changed during run");
      return { sample: window.__knBench.sample, final_state: window.__knBench.projection(), diagnostic: window.__knBench.workloadDiagnostic };
    });
    const errors = result.errors;
    Object.assign(result, observation.sample, { errors: [...errors, ...observation.sample.errors], final_state: observation.final_state });
    if (options.diagnostic) {
      result.workload_diagnostic = observation.diagnostic;
      if (result.updates !== options.frames + options.warmup || !result.workload_diagnostic) throw new Error("Incomplete official workload diagnostic");
    } else {
      result.summary_ms = summarize(result.frame_ms);
      if (result.frame_ms.length !== options.frames || result.warmup_ms.length !== options.warmup || !normalizeProjection(result.final_state)) throw new Error("Incomplete samples or final observation projection");
    }
    result.status = result.errors.length || result.page_errors.length ? "runtime-error" : "ok";
    // A fixed frame count is not a workload certificate.  Keep this explicit so
    // callers cannot accidentally publish a cross-kernel ratio from equal ticks.
    result.workload = options.diagnostic
      ? certifyWorkload(contract, result.workload_diagnostic, options.warmup, options.frames)
      : { certified: false, equivalent: false, reason: "official KN completed fixed updates; per-loop work equivalence not certified" };
  } catch (error) {
    result.errors.push(String(error?.stack || error));
    result.status = "unverified";
    try {
      const sample = await page.evaluate(() => window.__knBench?.sample);
      if (sample) Object.assign(result, sample, { errors: [...result.errors, ...sample.errors] });
      result.final_state = await page.evaluate(() => window.__knBench?.projection());
      result.workload_diagnostic = await page.evaluate(() => window.__knBench?.workloadDiagnostic);
    } catch (snapshotError) { result.errors.push(`Partial projection failed: ${snapshotError.message}`); }
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  return result;
}

export function nativeArgs(input, options, deterministic = true) {
  return [input, "--warmup", String(options.warmup), "--frames", String(options.frames), ...(deterministic ? ["--deterministic"] : [])];
}

function nativeRun(binary, input, options, deterministic = true) {
  const output = execFileSync(binary, nativeArgs(input, options, deterministic), { cwd: root, encoding: "utf8", timeout: options.timeout, maxBuffer: 64 * 1024 * 1024 });
  const result = JSON.parse(output);
  if (result.runtime !== "nekoc" || result.deterministic !== deterministic || result.frame_ms?.length !== options.frames || result.warmup_ms?.length !== options.warmup) {
    throw new Error(`Incomplete ${deterministic ? "deterministic" : "wall-clock"} native sample`);
  }
  result.summary_ms = summarize(result.frame_ms);
  summarize([...result.frame_ms, ...result.warmup_ms]);
  result.status = "ok";
  result.raw_final_state = structuredClone(result.final_state);
  // Preserve oracle_snapshot's facing angle. Do not infer a 90-degree transform
  // from property reporter conventions; a live official probe must establish it.
  result.workload = { equivalent: false, reason: deterministic ? "native deterministic clock is aligned; per-loop workload equality still not certified" : "default wall-clock diagnostic; never compared with official deterministic timing" };
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await assertWritablePath(options.out);
  // Repeating a suite must use a fresh directory, so a later failed run cannot
  // overwrite the earlier raw samples. Native AB has a separate resume protocol.
  try { await stat(path.join(options.out, "results.json")); throw new Error("Official output already has results.json; use a fresh --out directory"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(options.out, { recursive: true });
  if (!options.input && !options.fixtures) for (const name of FIXTURE_NAMES) await assertWritablePath(path.join(options.out, "fixtures", `${name}.bcmkn`));
  await assertWritablePath(path.join(options.out, "results.json"));
  await assertWritablePath(path.join(options.out, "editor.json"));
  const files = options.input ? [path.resolve(root, options.input)] : options.fixtures
    ? FIXTURE_NAMES.map(name => path.resolve(root, options.fixtures, `${name}.bcmkn`))
    : await writeKnFixtures(path.join(options.out, "fixtures"));
  if (!files.length || (!options.input && files.length !== 7)) throw new Error("Official KN runner requires seven .bcmkn fixtures");
  for (const file of files) await stat(file);
  await readOfficialBundles(options.bundleDir);
  await checkEditor(files, options.out, options.channel, options.bundleDir);
  if (options.prepareOnly) { console.log(`Prepared ${files.length} official KN fixture(s) in ${options.out}`); return; }
  const bundles = await readOfficialBundles(options.bundleDir);
  const report = { schema: "nekoc-kn-official-v1", date: new Date().toISOString(), official_url: OFFICIAL_URL,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    host: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, node: process.version },
    options: { ...options, bundleDir: path.relative(root, options.bundleDir).replaceAll("\\", "/") },
    bundles: Object.fromEntries(Object.entries(bundles).map(([name, item]) => [name, { path: item.path, bytes: item.bytes, sha256: item.sha256 }])),
    harness_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    scheduler_source_evidence: sourceEvidence(bundles["crc_libs.8196dbd1.js"].body),
    ...(options.nativeBinary ? { native_binary: { path: path.resolve(root, options.nativeBinary), sha256: sha256(await readFile(path.resolve(root, options.nativeBinary))) } } : {}),
    ...(options.nativeWallClockBinary ? { native_wall_clock_binary: { path: path.resolve(root, options.nativeWallClockBinary), sha256: sha256(await readFile(path.resolve(root, options.nativeWallClockBinary))) } } : {}),
    method: "Controlled rAF batches; deterministic seconds_per_update; original 30000 iteration/50000 procedure-call budgets; only synchronous manager.update timed; snapshot outside timing",
    limitations: ["Not the default 4ms online scheduler", "No pixel/audio/task-stack or intermediate-state equivalence", "Formal native companion is required to report deterministic=true; default wall-clock native diagnostics, if run separately, are never mixed into this comparison", "Pen synchronous rendering and native output collection have different boundaries; never a ratio", "Editor shell and optional dependencies may use the network; no gameplay input synthesized"], works: [] };
  for (const input of files) {
    const bytes = await readFile(input), name = path.basename(input, ".bcmkn");
    const work = { name, file: path.relative(root, input).replaceAll("\\", "/"), sha256: sha256(bytes), frames: options.frames, warmup: options.warmup, brush_boundary: name === "pen", runs: [] };
    report.works.push(work);
    for (let repeat = 0; repeat < options.repeats; repeat++) {
      const idle = assertIdle();
      const rawPath = path.join(options.out, `${name}-${repeat}-official.json`);
      await assertWritablePath(rawPath);
      try { await stat(rawPath); throw new Error(`Existing raw attempt: ${rawPath}; use a fresh --out directory`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await writeFile(rawPath, JSON.stringify({ status: "incomplete", repeat, input_sha256: work.sha256, frame_ms: [], warmup_ms: [], errors: [] }) + "\n");
      let run;
      try {
        execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", input, JSON.stringify(options), rawPath, String(repeat)],
          { cwd: root, timeout: options.timeout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        run = JSON.parse(await readFile(rawPath, "utf8"));
      } catch (error) {
        let partial = {};
        try { partial = JSON.parse(await readFile(rawPath, "utf8")); } catch {}
        run = { ...partial, status: "unverified", repeat, errors: [...(partial.errors ?? []), String(error.stack || error)], stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), diagnostics_file: rawPath };
      }
      run.idle_checks = [idle];
      try { run.idle_checks.push(assertIdle()); }
      catch (error) { run.status = "unverified"; (run.errors ??= []).push(error.message); }
      if (options.nativeBinary) {
        try {
          run.idle_checks.push(assertIdle());
          if (sha256(await readFile(report.native_binary.path)) !== report.native_binary.sha256) throw new Error("Native binary changed during suite");
          run.native = nativeRun(path.resolve(root, options.nativeBinary), input, options);
          run.idle_checks.push(assertIdle());
          run.native.workload = nativeWorkloadEvidence(run.native, workloadContract(name, JSON.parse(bytes), options.frames));
          run.projection_equal = sameProjection(run.final_state, run.native.final_state);
          run.comparison = ratioIfComparable(run, run.native, work);
        }
        catch (error) { run.native = { status: "unverified", error: String(error?.message || error), stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") }; run.comparison = { status: "unverified", reason: "native run failed" }; }
      }
      if (options.nativeWallClockBinary) {
        try {
          run.idle_checks.push(assertIdle());
          if (sha256(await readFile(report.native_wall_clock_binary.path)) !== report.native_wall_clock_binary.sha256) throw new Error("Native wall-clock binary changed during suite");
          run.native_wall_clock = nativeRun(path.resolve(root, options.nativeWallClockBinary), input, options, false);
          run.idle_checks.push(assertIdle());
        } catch (error) {
          run.native_wall_clock = { status: "unverified", error: String(error?.message || error), stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
        }
      }
      if (sha256(await readFile(input)) !== work.sha256) { run.status = "unverified"; (run.errors ??= []).push("Input changed during measurement"); }
      work.runs.push(run);
      await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(`${name} ${repeat} ${run.status} ${run.summary_ms?.mean?.toFixed(6) ?? "—"} ms`);
    }
  }
  report.bundles_unchanged = (await Promise.all(Object.values(bundles).map(async item => sha256(await readFile(item.path)) === item.sha256))).every(Boolean);
  report.harness_unchanged = sha256(await readFile(fileURLToPath(import.meta.url))) === report.harness_sha256;
  if (report.native_binary) report.native_binary.unchanged = sha256(await readFile(report.native_binary.path)) === report.native_binary.sha256;
  if (report.native_wall_clock_binary) report.native_wall_clock_binary.unchanged = sha256(await readFile(report.native_wall_clock_binary.path)) === report.native_wall_clock_binary.sha256;
  report.summary = report.works.map(work => ({ name: work.name, sha256: work.sha256, status: work.runs.every(run => run.status === "ok") ? "ok" : "unverified",
    official_ms: work.runs.filter(run => run.status === "ok" && run.summary_ms).map(run => run.summary_ms.mean), comparable: work.runs.every(run => run.comparison?.status === "comparable") }));
  await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  if (!report.bundles_unchanged || !report.harness_unchanged || report.native_binary?.unchanged === false || report.native_wall_clock_binary?.unchanged === false || report.works.some(work => work.runs.some(run => run.status !== "ok" || run.native?.status === "unverified" || run.native_wall_clock?.status === "unverified"))) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const task = process.argv[2] === "--worker" ? (async () => {
    const [, input, json, output, repeat] = process.argv.slice(2), options = JSON.parse(json);
    await assertWritablePath(ignoredPath(output));
    const result = await runOne(input, options, await readOfficialBundles(options.bundleDir), Number(repeat),
      partial => writeFile(output, JSON.stringify(partial, null, 2) + "\n"));
    await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  })() : main();
  task.catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
