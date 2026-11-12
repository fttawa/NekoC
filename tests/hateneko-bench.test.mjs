import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs, compareStates, ignoredPath, compareRun, inputScope, assertWritablePath, assertCompleteSuite, normalizationScope, manifestWorks } from "../tools/bench/hateneko.mjs";

test("HateNeko runner confines writable paths to this worktree dist and bounds counts", () => {
  assert.equal(parseArgs([]).frames, 60);
  assert.equal(parseArgs(["--compat-only"]).compatOnly, true);
  assert.throws(() => parseArgs(["--compat-only", "--input", "project.bcmkn"]));
  assert.throws(() => parseArgs(["--manifest", "docs/kncompat-hateneko-evidence.json"]));
  for (const value of ["docs/out", "../dist/run", "dist/../docs/run", "dist"]) assert.throws(() => ignoredPath(value));
  for (const args of [["--frames", "0"], ["--warmup", "-1"], ["--repeats", "NaN"], ["--frames", "100000", "--warmup", "1"], ["--copy", "dist/a", "--out", "dist/a/results"], ["--unknown", "x"], ["--input"]]) assert.throws(() => parseArgs(args));
});

test("published compatibility evidence requires complete exact paired manifest, not matching states", () => {
  const input = { file: "original.bcmkn", sha256: "digest", synthetic: false };
  const suite = { input_manifest: [input], reference: { unchanged: true }, options: { repeats: 3 }, works: [
    { ...input, runs: [{ repeat: 0, runtimes: { nekoc: { status: "ok" }, hateneko: { status: "unsupported" } } }] },
  ] };
  assert.doesNotThrow(() => assertCompleteSuite(suite));
  for (const change of [
    r => { r.works = []; }, r => { r.input_manifest = []; }, r => { r.reference.unchanged = false; },
    r => { r.works[0].sha256 = "stale"; }, r => { r.works[0].runs = []; },
    r => { delete r.works[0].runs[0].runtimes.hateneko; }, r => { r.works[0].runs[0].repeat = 1; },
  ]) {
    const altered = structuredClone(suite); change(altered);
    assert.throws(() => assertCompleteSuite(altered));
  }
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

test("single-input observations do not generate or editor-check unrelated synthetic benchmarks", async () => {
  const source = await readFile(new URL("../tools/bench/hateneko.mjs", import.meta.url), "utf8");
  assert.match(source, /const fixtures = o\.compatOnly \|\| o\.input \? \[\] : await writeKnFixtures/);
});

test("explicit compatibility manifest pins the historical 41 exact original inputs", async () => {
  const files = await manifestWorks("docs/kncompat-hateneko-evidence.json");
  assert.equal(files.length, 41);
  assert.ok(files.every(file => path.isAbsolute(file) && file.endsWith(".bcmkn")));
  await mkdir("dist/bench", { recursive: true });
  const scratch = await mkdtemp(path.resolve("dist/bench/hn-manifest-test-"));
  const file = path.join(scratch, "manifest.json");
  try {
    for (const works of [[], [{ file: "../escape.bcmkn", sha256: "x" }],
      [{ file: "projects/C:/escape.bcmkn", sha256: "x" }], [{ file: "tests/fixtures/../escape.bcmkn", sha256: "x" }],
      [{ file: "tests/fixtures/audio.bcmkn", sha256: "stale" }]]) {
      await writeFile(file, JSON.stringify({ works }));
      await assert.rejects(manifestWorks(file));
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("HateNeko optional private normalization removes only redundant declared defaults", () => {
  const n = state(), h = state(); h.actors.sprite.rotation = 0;
  h.variables.local = 5;
  const options = normalizationScope({ variables: { variablesDict: {
    local: { isGlobal: false, currentEntityId: "sprite", value: 5 },
    v: { isGlobal: true, value: 1 },
  } } }, { normalizePrivate: true });
  const before = structuredClone(h);
  assert.equal(compareStates(n, h).equal, false);
  assert.equal(compareStates(n, h, options).equal, true);
  assert.deepEqual(h, before);
  h.variables.local = 6;
  assert.equal(compareStates(n, h, options).equal, false);
  h.variables.local = 5; delete h.entity_variables.sprite.local;
  assert.equal(compareStates(n, h, options).equal, false);
  h.entity_variables.sprite.local = 99;
  assert.equal(compareStates(n, h, options).equal, false);
  h.entity_variables.sprite.local = 2; h.variables.v = 999;
  assert.equal(compareStates(n, h, options).equal, false);
  h.variables.v = 1;
  n.actors.cloneA = { ...n.actors.sprite, id: "cloneA" };
  h.actors.cloneB = { ...h.actors.sprite, id: "cloneB" };
  n.entity_variables.cloneA = { local: 99 }; h.entity_variables.cloneB = { local: 99 };
  assert.equal(compareStates(n, h, options).equal, true);
  delete h.entity_variables.cloneB.local;
  assert.equal(compareStates(n, h, options).equal, false);
  h.entity_variables.cloneB.local = 98;
  assert.equal(compareStates(n, h, options).equal, false);
});

test("HateNeko exclusions are explicit, preserve raw mismatch and never grant a speed ratio", () => {
  const n = state(), h = state(); h.actors.sprite.rotation = 0; h.variables.v = 99;
  const work = { file: "numeric.bcmkn", synthetic: true, frames: 1, warmup: 0, normalization: { excludeVariables: ["v"] } };
  const run = { runtimes: Object.fromEntries([["nekoc", n], ["hateneko", h]].map(([name, final_state]) => [name, {
    status: "ok", final_state, frame_ms: [2], warmup_ms: [], summary_ms: { mean: 2 },
  }])) };
  compareRun(run, work);
  assert.equal(run.comparison.equal, false);
  assert.equal(run.normalized_comparison.equal, true);
  assert.equal(run.speedup_h_over_n, undefined);
  run.runtimes.hateneko.status = "unsupported";
  compareRun(run, work);
  assert.equal(run.normalized_comparison.equal, false);
  delete work.normalization;
  compareRun(run, work);
  assert.equal(run.normalized_comparison, undefined);
  const args = parseArgs(["--normalize-private", "--exclude-variables", "dt,now", "--project-frames", "600", "--interpreter"]);
  assert.equal(args.projectFrames, 600);
  assert.equal(args.normalizePrivate, true);
  assert.equal(args.interpreter, true);
  assert.deepEqual(args.excludeVariables, ["dt", "now"]);
  for (const args of [["--project-frames", "0"], ["--project-frames", "100001"], ["--project-frames", "NaN"], ["--exclude-variables", "dt,"]]) assert.throws(() => parseArgs(args));
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
    // Explicit exclusions only affect a second projection and are replayable
    // without mutating raw observations or blessing failed samples.
    const different = run(); different.runtimes.hateneko.final_state.variables.v = 99;
    const raw = { ...suite, works: [work([different])] };
    await writeFile(input, JSON.stringify(raw));
    execFileSync(process.execPath, ["tools/bench/hateneko-evidence.mjs", input, output, "--exclude-variables", "v"], { stdio: "pipe" });
    const replay = JSON.parse(await readFile(output, "utf8"));
    assert.equal(replay.works[0].equal_observed_state, false);
    assert.equal(replay.works[0].equal_normalized_state, true);
    assert.equal(replay.works[0].speedup_h_over_n, undefined);
    assert.deepEqual(replay.replay_normalization.excludeVariables, ["v"]);
    assert.deepEqual(JSON.parse(await readFile(input, "utf8")), raw);
    for (const flags of [["--exclude-variables"], ["--exclude-variables", "v,"], ["--unknown"]]) {
      assert.throws(() => execFileSync(process.execPath, ["tools/bench/hateneko-evidence.mjs", input, output, ...flags], { stdio: "pipe" }));
    }
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
