import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { bundleManifest, certifyWorkload, exposeLoader, nativeArgs, nativeWorkloadEvidence, parseArgs, projectionScript, ratioIfComparable, readOfficialBundles, sameProjection, schedulerScript, summarize, workloadContract } from "../tools/bench/official-kn.mjs";

test("official KN runner has an independent seven-fixture contract", () => {
  assert.throws(() => parseArgs([]), /Explicit --bundle-dir/);
  const options = parseArgs(["--bundle-dir", "D:/read-only-kn-bundles"]);
  assert.equal(options.frames, 60);
  assert.equal(options.warmup, 10);
  assert.equal(options.repeats, 3);
  assert.equal(options.dt, 1 / 60);
  assert.equal(options.budget, 4096);
  assert.deepEqual(nativeArgs("fixture.bcmkn", options), ["fixture.bcmkn", "--warmup", "10", "--frames", "60", "--deterministic"]);
  assert.deepEqual(nativeArgs("fixture.bcmkn", options, false), ["fixture.bcmkn", "--warmup", "10", "--frames", "60"]);
  assert.ok(options.out.includes("dist"));
  assert.throws(() => parseArgs(["--frames", "0"]));
  assert.throws(() => parseArgs(["--dt", "0"]));
  assert.throws(() => parseArgs(["--input", "a", "--fixtures", "b"]));
  assert.throws(() => parseArgs(["--bundle-dir", "dist/bundles", "--out", "../outside"]));
  assert.throws(() => parseArgs(["--bundle-dir", "dist/bundles", "--native-wall-clock-binary", "native.exe", "--dt", "0.1"]));
  assert.equal(Object.keys(bundleManifest("dist/kn-official")).length, 3);
});

test("official KN local bundle gate rejects missing or corrupt bytes without network fallback", async () => {
  await mkdir("dist/bench", { recursive: true });
  const directory = await mkdtemp("dist/bench/official-kn-bundle-test-");
  try {
    await assert.rejects(readOfficialBundles(directory), /Official KN bundle unavailable/);
    await writeFile(path.join(directory, "main.8ccf2442.js"), "not an official bundle");
    await assert.rejects(readOfficialBundles(directory), /SHA-256 mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("official KN bundle manifest records all three version gates without embedding bundles", () => {
  const manifest = bundleManifest("D:/read-only-kn-bundles");
  assert.match(manifest["main.8ccf2442.js"].expectedSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest["crc_libs.8196dbd1.js"].expectedSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest["main.8ccf2442.js"].path, path.resolve("D:/read-only-kn-bundles/main.8ccf2442.js"));
  const source = readFileSync(new URL("../tools/bench/official-kn.mjs", import.meta.url), "utf8");
  assert.match(source, /readFile\(item\.path\)/);
  assert.match(source, /body = local\.body/);
  assert.ok(Object.values(manifest).every(item => item.required === true));
  assert.doesNotMatch(source, /route\.(fetch|continue)\(/);
  assert.doesNotMatch(source, /copyFile|cp\([^\n]*main\.8ccf2442/);
});

test("official KN ratio gate fails closed for unequal work and brush", () => {
  const state = { current_scene_id: "scene", variables: { value: 1 }, variable_definitions: {}, entity_variables: {}, actors: {} };
  assert.equal(sameProjection(state, structuredClone(state)), true);
  const work = { name: "numeric", frames: 1, warmup: 0 };
  const run = { status: "ok", configuration: { deterministic: true, dt: 1 / 60 }, deterministic: true, final_state: state, frame_ms: [2], warmup_ms: [], summary_ms: { mean: 2 }, workload: { certified: true, equivalent: false } };
  assert.equal(ratioIfComparable(run, { ...run, summary_ms: { mean: 4 } }, work).status, "unverified");
  assert.equal(ratioIfComparable({ ...run, workload: { equivalent: true } }, { ...run, workload: { equivalent: true }, summary_ms: { mean: 4 } }, { ...work, name: "pen", brush_boundary: true }).status, "unverified");
  const mismatch = structuredClone(state); mismatch.variables.value = 2;
  assert.equal(ratioIfComparable({ ...run, workload: { equivalent: true } }, { ...run, workload: { equivalent: true }, final_state: mismatch }, work).status, "state-mismatch");
  const certified = { ...run, workload: { certified: true, equivalent: true } };
  assert.equal(ratioIfComparable({ ...certified, frame_ms: [6] }, certified, work).ratio_official_over_native, 3);
  for (const change of [{ deterministic: false }, { configuration: {} }, { workload: { equivalent: true } }, { frame_ms: [] }, { errors: ["hidden failure"] }, { frame_ms: [Infinity] }, { summary_ms: { mean: Infinity } }, { status: "failed" }]) {
    assert.equal(ratioIfComparable({ ...certified, ...change }, certified, work).status, "unverified");
  }
  assert.equal(sameProjection({}, {}), false);
  assert.equal(sameProjection(undefined, undefined), false);
});

test("official KN summaries reject incomplete or non-finite raw samples", () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), { mean: 2.5, median: 3, p95: 4, max: 4 });
  for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(values));
});

test("loader exposure changes only the single bootstrap marker", () => {
  const source = "before;var __webpack_exports__=after;";
  assert.equal(exposeLoader(Buffer.from(source)), "before;window.__nekocRequire=__webpack_require__;var __webpack_exports__=after;");
  for (const value of ["no marker", source + source]) assert.throws(() => exposeLoader(Buffer.from(value)));
});

test("controlled rAF transfers pending bootstrap callbacks, fixed dt, cancellation and next-frame callbacks", () => {
  const native = new Map(); let serial = 0;
  const window = { requestAnimationFrame(callback) { native.set(++serial, callback); return serial; }, cancelAnimationFrame(id) { native.delete(id); } };
  vm.runInNewContext(schedulerScript(0.25, 4), { window, performance: { now: () => 10 } });
  const timestamps = [];
  window.requestAnimationFrame(time => { timestamps.push(time); window.requestAnimationFrame(next => timestamps.push(next)); });
  const cancelled = window.requestAnimationFrame(() => assert.fail("cancelled callback"));
  window.cancelAnimationFrame(cancelled);
  assert.equal(native.size, 1);
  window.__knBenchScheduler.hold();
  assert.equal(native.size, 0);
  assert.equal(window.__knBenchScheduler.step().callbacks, 1);
  assert.deepEqual(timestamps, [260]);
  window.__knBenchScheduler.step();
  assert.deepEqual(timestamps, [260, 510]);
  assert.equal(window.__knBenchScheduler.stepping, false);
  assert.equal(window.__knBenchScheduler.step().callbacks, 0);
});

function mockPage() {
  let clock = 0;
  const values = { global: [1, "2"], original: { private: 3 }, clone: { private: 9 } };
  const actor = () => ({ get_position: () => ({ x: 10, y: -20 }), get_scale: () => ({ x: 1.25, y: .5 }),
    get_current_style: () => ({ style_id: "style" }), get_rotation: () => Math.PI / 2, get_visible: () => true });
  const actorObjects = { original: actor(), clone: actor() };
  const manager = { frames: 0, update() { this.frames++; clock += 2; },
    get_variable(id, unused, owner) { return owner ? values[owner][id] : values[id]; } };
  const config = { max_warp_iterations_per_interpreter_step: 30000, max_procedure_calls_per_interpreter_step: 50000, user_debug_mode: false };
  const project = { actors: { actorsDict: { original: {} } }, scenes: { currentSceneId: "scene", scenesDict: { scene: {} } } };
  const bcm = { getBcm: () => project, variablesDict: { global: { isGlobal: true }, private: { isGlobal: false, currentEntityId: "original" } } };
  const stage = { actors: { get_actor_ids: () => Object.keys(actorObjects), get_actor: id => ({ value: actorObjects[id], is_error: () => false }) }, scenes: { get_current_scene: () => "scene" } };
  const core = { get_runtime_manager: () => ({ run_mgr: manager }), get_runtime_data: () => ({ get_sprite_clones: id => id === "original" ? ["clone"] : [] }),
    get_util: () => ({ config: { get: () => config } }), get_event_bus: () => ({ error: { runtime: { immediate: { sub() {} } } } }) };
  const window = { __knBenchScheduler: { stepping: false, tick: 0 }, __nekocRequire: id => ({
    26921: { cG: { get_instance: () => ({ getHeart: () => ({ core }) }) } }, 91107: { BcmInstance: bcm }, 54174: { V: { core: stage } },
  })[id] };
  const context = { window, performance: { now: () => clock } };
  const install = options => vm.runInNewContext(`(${projectionScript().toString()})(${JSON.stringify(options)})`, context);
  return { values, manager, window, config, install };
}

test("official update wrapper has exact warmup/sample counts, ignores uncontrolled callbacks and snapshots all clone-owned values", () => {
  const page = mockPage();
  page.install({ dt: 1 / 60, frames: 2, warmup: 1, budget: 4096 });
  page.manager.update();
  assert.equal(page.manager.frames, 0);
  page.window.__knBenchScheduler.stepping = true;
  for (let i = 0; i < 5; i++) { page.window.__knBenchScheduler.tick++; page.manager.update(); }
  const sample = page.window.__knBench.sample;
  assert.equal(sample.updates, 3);
  assert.deepEqual([...sample.warmup_ms], [2]);
  assert.deepEqual([...sample.frame_ms], [2, 2]);
  assert.equal(page.config.deterministic.seconds_per_update, 1 / 60);
  const final = JSON.parse(JSON.stringify(page.window.__knBench.projection()));
  assert.deepEqual(final.entity_variables, { original: { private: 3 }, clone: { private: 9 } });
  assert.equal(final.actors.clone.prototype_id, "original");
  assert.equal(final.actors.clone.scale, 125);
  assert.equal(final.actors.clone.rotation, 0);
  assert.equal(sameProjection({ ...final, variables: { tagged: { $number: "-0" } } }, { ...final, variables: { tagged: 0 } }), false);
  page.values.global.push(99);
  assert.deepEqual(final.variables.global, [1, "2"]);
  const native = structuredClone(final);
  native.actors.clone.id = "native-clone";
  native.actors["native-clone"] = native.actors.clone; delete native.actors.clone;
  native.entity_variables["native-clone"] = native.entity_variables.clone; delete native.entity_variables.clone;
  assert.equal(sameProjection(final, native), true);
  native.entity_variables["native-clone"].private = 3;
  assert.equal(sameProjection(final, native), false);
});

test("official editor preflight supports pinned local-only bundles", () => {
  const source = readFileSync(new URL("../tools/editor-compat.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(!bundles\) await page\.route/);
  assert.match(source, /local\.readOfficialBundles/);
  assert.match(source, /if \(!item\).*route\.abort/s);
});

test("workload diagnostics cannot grant cross-kernel equivalence from equal frames or instructions", () => {
  assert.equal(parseArgs(["--bundle-dir", "dist/bundles", "--diagnostic"]).diagnostic, true);
  assert.equal(workloadContract("pen", {}, 2).certified, false);
  const contract = { fixed_ast: true, name: "numeric", tail_per_update: 4000, no_async_or_calls: true };
  const update = { tail_calls: 4000, completed_batch: true, max_step_tail: 4000, boundary_returns: 0 };
  const diagnostic = { ok: true, deterministic: true, updates: [update, update, update], errors: [] };
  const certificate = certifyWorkload(contract, diagnostic, 1, 2);
  assert.equal(certificate.certified, true);
  assert.equal(certificate.equivalent, false);
  for (const change of [{ updates: [update] }, { deterministic: false }, { errors: ["error"] },
    { updates: [update, update, { ...update, tail_calls: 3999 }] },
    { updates: [update, update, { ...update, boundary_returns: 1 }] },
    { updates: [update, update, { ...update, max_step_tail: 30002 }] }]) {
    assert.equal(certifyWorkload(contract, { ...diagnostic, ...change }, 1, 2).certified, false);
  }
  assert.equal(nativeWorkloadEvidence({ status: "ok", deterministic: true, instructions: 480120 }, contract).equivalent, false);
  assert.equal(nativeWorkloadEvidence({ status: "ok", deterministic: false }, contract).certified, false);
});

test("official scheduling config drift is rejected rather than silently changing the workload", () => {
  const page = mockPage(); page.config.max_warp_iterations_per_interpreter_step = 999;
  assert.throws(() => page.install({ dt: 1 / 60, frames: 2, warmup: 0, budget: 4096 }), /scheduling defaults changed/);
});

test("official rAF callback safety budget fails closed without consuming a partial frame", () => {
  const window = { requestAnimationFrame() {}, cancelAnimationFrame() {} };
  vm.runInNewContext(schedulerScript(1 / 60, 1), { window, performance: { now: () => 0 } });
  window.__knBenchScheduler.hold();
  let calls = 0;
  window.requestAnimationFrame(() => calls++);
  window.requestAnimationFrame(() => calls++);
  assert.throws(() => window.__knBenchScheduler.step(), /safety budget exceeded/);
  assert.equal(calls, 0);
  assert.equal(window.__knBenchScheduler.queued(), 2);
});

test("official wrapper rejects two manager updates within one controlled frame", () => {
  const page = mockPage();
  page.install({ dt: 1 / 60, frames: 2, warmup: 0, budget: 4096 });
  page.window.__knBenchScheduler.stepping = true;
  page.window.__knBenchScheduler.tick++;
  page.manager.update();
  assert.throws(() => page.manager.update(), /More than one VM update/);
  assert.equal(page.window.__knBench.sample.frame_ms.length, 1);
});

test("native companion always uses the explicit deterministic contract", () => {
  const source = readFileSync(new URL("../tools/bench/official-kn.mjs", import.meta.url), "utf8");
  assert.match(source, /result\.deterministic !== deterministic/);
  assert.match(source, /--deterministic/);
  assert.match(source, /default wall-clock native diagnostics/);
  assert.match(source, /nativeWallClockBinary/);
});
