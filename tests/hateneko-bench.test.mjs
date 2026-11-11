import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs, compareStates, ignoredPath, compareRun, inputScope, assertWritablePath } from "../tools/bench/hateneko.mjs";

test("HateNeko runner confines writable paths to this worktree dist and bounds counts", () => {
  assert.equal(parseArgs([]).frames, 60);
  for (const value of ["docs/out", "../dist/run", "dist/../docs/run", "dist"]) assert.throws(() => ignoredPath(value));
  for (const args of [["--frames", "0"], ["--warmup", "-1"], ["--repeats", "NaN"], ["--frames", "100000", "--warmup", "1"], ["--copy", "dist/a", "--out", "dist/a/results"], ["--unknown", "x"], ["--input"]]) assert.throws(() => parseArgs(args));
});

const state = () => ({ current_scene_id: "scene", variables: { v: 1, list: [1, "a", true] }, actors: {
  sprite: { id: "sprite", prototype_id: "sprite", x: 0, y: 0, rotation: 90, scale: 100, scale_y: 100, current_style_id: "style", visible: true },
}, entity_variables: { sprite: { local: 2 } } });

test("HateNeko observed-state comparison includes typed lists, actors, locals and scene", () => {
  const hate = () => { const s = state(); s.actors.sprite.rotation = 0; return s; };
  assert.equal(compareStates(state(), hate()).equal, true);
  for (const change of [s => s.variables.list[0] = "1", s => s.variables.v++, s => s.actors.sprite.x++, s => s.actors.sprite.rotation++, s => s.entity_variables.sprite.local++, s => s.current_scene_id = "other", s => delete s.actors.sprite]) {
    const other = hate(); change(other);
    assert.equal(compareStates(state(), other).equal, false);
  }
  const rounded = hate(); rounded.variables.v += 1e-12;
  assert.equal(compareStates(state(), rounded).equal, true);
  assert.equal(compareStates({}, {}).equal, false);
  assert.equal(compareStates(null, state()).equal, false);
});

test("HateNeko clone comparison ignores generated id spelling, not count or state", () => {
  const a = state(), b = state();
  b.actors.sprite.rotation = 0;
  a.actors.cloneA = { ...a.actors.sprite, id: "cloneA" };
  b.actors.cloneB = { ...b.actors.sprite, id: "cloneB" };
  a.entity_variables.cloneA = {}; b.entity_variables.cloneB = {};
  assert.equal(compareStates(a, b).equal, true);
  b.actors.cloneB.visible = false;
  assert.equal(compareStates(a, b).equal, false);
});

test("HateNeko ratios fail closed on errors, state differences and pen scope", () => {
  const n = state(), h = state(); h.actors.sprite.rotation = 0;
  const run = () => ({ runtimes: { nekoc: { status: "ok", final_state: n, frame_ms: [2], warmup_ms: [], summary_ms: { mean: 2 } }, hateneko: { status: "ok", final_state: h, frame_ms: [6], warmup_ms: [], summary_ms: { mean: 6 } } } });
  const work = { synthetic: true, file: "numeric.bcmkn", frames: 1, warmup: 0 };
  const valid = run(); compareRun(valid, work); assert.equal(valid.speedup_h_over_n, 3);
  for (const status of ["failed", "unsupported", "runtime-error", "compile-error"]) {
    const bad = run(); bad.speedup_h_over_n = 999; bad.runtimes.hateneko.status = status;
    compareRun(bad, work); assert.equal(bad.speedup_h_over_n, undefined); assert.equal(bad.comparison.equal, false);
  }
  const pen = run(); compareRun(pen, { ...work, file: "pen.bcmkn" }); assert.equal(pen.speedup_h_over_n, undefined);
  const project = run(); compareRun(project, { ...work, synthetic: false }); assert.equal(project.speedup_h_over_n, undefined);
  const different = run(); different.runtimes.hateneko.final_state = { ...h, variables: {} };
  compareRun(different, work); assert.equal(different.speedup_h_over_n, undefined);
  for (const mean of [0, NaN, Infinity, -1]) {
    const invalid = run(); invalid.runtimes.nekoc.summary_ms.mean = mean;
    compareRun(invalid, work); assert.equal(invalid.speedup_h_over_n, undefined);
  }
  const incomplete = run(); incomplete.runtimes.hateneko.frame_ms = [];
  compareRun(incomplete, work); assert.equal(incomplete.comparison.equal, false);
  const hiddenError = run(); hiddenError.runtimes.hateneko.errors = ["error"];
  compareRun(hiddenError, work); assert.equal(hiddenError.comparison.equal, false);
});

test("HateNeko projection never equates an original actor with its surviving clone", () => {
  const a = state(), b = state();
  const actor = { ...b.actors.sprite, id: "clone", rotation: 0 };
  b.actors = { clone: actor }; b.entity_variables = { clone: { local: 2 } };
  assert.equal(compareStates(a, b).equal, false);
  const malformed = state(); delete malformed.actors.sprite.scale;
  assert.equal(compareStates(malformed, malformed).equal, false);
});

test("HateNeko compatibility scope flags random blocks and declared external images", () => {
  const scope = inputScope({ actors: [{ type: "random", inputs: {} }], styles: { stylesDict: { image: { url: "https://example.com/a.png" } } } });
  assert.deepEqual(scope.random_blocks, ["random"]);
  assert.equal(scope.external_assets, true);
  assert.equal(inputScope({}).external_assets, false);
});

test("HateNeko published evidence rejects empty/partial samples and derives means from raw frames", async () => {
  await mkdir("dist/bench", { recursive: true });
  const scratch = await mkdtemp(path.resolve("dist/bench/hn-evidence-test-"));
  try {
    const h = state(); h.actors.sprite.rotation = 0;
    const run = () => ({ runtimes: {
      nekoc: { status: "ok", final_state: state(), frame_ms: [2], warmup_ms: [], summary_ms: { mean: 999 } },
      hateneko: { status: "ok", final_state: h, frame_ms: [6], warmup_ms: [], summary_ms: { mean: 999 } },
    } });
    const work = runs => ({ file: "numeric.bcmkn", synthetic: true, frames: 1, warmup: 0, runs });
    const partial = run(); partial.runtimes.hateneko.frame_ms = [];
    const suite = { options: { repeats: 1 }, reference: { files: {} }, works: [work([run()]), work([]), work([partial])] };
    const input = path.join(scratch, "raw.json"), output = path.join(scratch, "evidence.json");
    await writeFile(input, JSON.stringify(suite));
    execFileSync(process.execPath, ["tools/bench/hateneko-evidence.mjs", input, output], { stdio: "pipe" });
    const evidence = JSON.parse(await readFile(output, "utf8"));
    assert.equal(evidence.works[0].speedup_h_over_n, 3);
    for (const row of evidence.works.slice(1)) { assert.equal(row.equal_observed_state, false); assert.equal(row.speedup_h_over_n, undefined); }
    assert.deepEqual(JSON.parse(await readFile(input, "utf8")), suite);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("HateNeko refuses writable directory junctions before touching their target", async () => {
  await mkdir("dist/bench", { recursive: true });
  const scratch = await mkdtemp(path.resolve("dist/bench/hn-junction-test-"));
  const target = path.join(scratch, "readonly"), link = path.join(scratch, "link");
  try {
    await mkdir(target);
    await writeFile(path.join(target, "sentinel"), "unchanged");
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertWritablePath(path.join(link, "out.json")), /junction\/symlink/);
    assert.equal(await readFile(path.join(target, "sentinel"), "utf8"), "unchanged");
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
