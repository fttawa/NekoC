import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { k4fixFixtures, FRAMES } from "../tools/compat/k4-fix-fixtures.mjs";
import { readJson, runOracle } from "../tools/compat/k4-oracle.mjs";
import { visualWork } from "../tools/compat/k4-visual.mjs";
import { command } from "../tools/compat/k4-diff.mjs";
import path from "node:path";

test("JS timer rounding reference includes exact and near decimal ties", () => {
  assert.deepEqual([0.125, 1.125, 1.005, 2.675, 0.145, 0.285, 0.033, 0.066].map(x => Number(x.toFixed(2))),
    [0.13, 1.13, 1, 2.67, 0.14, 0.28, 0.03, 0.07]);
});

test("k4fix probes are self-authored and pinned to official observations", async () => {
  const evidence = await readJson("docs/kitten4-fix-evidence.json");
  const projects = await k4fixFixtures();
  assert.equal(evidence.frames, FRAMES);
  assert.deepEqual(Object.keys(projects), Object.keys(evidence.cases));
  for (const [name, project] of Object.entries(projects)) {
    const text = await readFile(`tests/fixtures/kitten4/k4fix-${name}.bcm`, "utf8");
    assert.equal(text, JSON.stringify(project, null, 2) + "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), evidence.cases[name].sha256);
    assert.deepEqual(evidence.cases[name].errors, []);
    assert.equal(evidence.cases[name].variables.length, FRAMES);
  }
  // The two timer probes run one script on either side of the 4.1.1 boundary.
  const last = name => evidence.cases[name].variables.at(-1).result;
  assert.deepEqual(last("timer-new"), [0, 0, 0, 0, 0.03, 0.07, 0.1]);
  assert.deepEqual(last("timer-boundary"), last("timer-new"));
  assert.deepEqual(last("timer-legacy"), [0, 0.033, 0.066, 0.066, 0.1, 0.133, 0.166]);
  assert.deepEqual(last("timer-noncanonical"), last("timer-legacy"));
  assert.deepEqual(last("mouse"), [null, null]);
});

test("k4fix official probes reproduce under the virtual clock", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const evidence = await readJson("docs/kitten4-fix-evidence.json");
  for (const [name, project] of Object.entries(await k4fixFixtures())) {
    const clocks = [];
    const trace = await runOracle(project, { frames: FRAMES, seed: 1, virtualTime: true,
      onFrame: async page => clocks.push(await page.evaluate(() => [Date.now(), new Date().valueOf()])) });
    // The evidence is JSON: compare through the same serialization (NaN -> null).
    assert.deepEqual(JSON.parse(JSON.stringify(trace.frames.map(f => f.variables))), evidence.cases[name].variables, name);
    assert.deepEqual(trace.errors, []);
    for (const [now, date] of clocks) {
      assert.equal(now, date);
      assert.ok(Number.isInteger(now));
    }
    assert.deepEqual(trace.frames.map(f => Object.fromEntries(Object.entries(f.actors).map(([id, actor]) => [id, actor.scale]))), evidence.cases[name].scales);
  }
});

const visual = { skip: !(process.env.K4_ORACLE_INTEGRATION && process.env.K4_VISUAL_INTEGRATION), timeout: 600000 };

test("render-only trace keeps real deltas without duplicate variable snapshots", visual, async () => {
  const exe = path.resolve(`target/debug/k4-trace${process.platform === "win32" ? ".exe" : ""}`);
  const args = ["tests/fixtures/kitten4/k4fix-fill.bcm", "--render", "--frames", "3"];
  const full = JSON.parse(await command(exe, args));
  const compact = JSON.parse(await command(exe, [...args, "--render-only"]));
  assert.deepEqual(compact.project, full.project);
  assert.deepEqual(compact.trace.frames, []);
  assert.equal(full.trace.frames.length, 3);
  for (let i = 0; i < 3; i++) {
    // execute_us is a wall-clock measurement, not VM state.
    delete compact.frames[i].frame.execute_us;
    delete full.frames[i].frame.execute_us;
    assert.deepEqual(compact.frames[i], full.frames[i]);
  }
});

test("pen fill probe matches official canvas pixels", visual, async () => {
  const work = await visualWork("tests/fixtures/kitten4/k4fix-fill.bcm",
    { captureFrames: [1, 30, 60], artifactsDir: "dist/k4fix/pixel-regression", seed: 1, pixelTolerance: 8 });
  assert.equal(work.status, "captured", work.error);
  for (const frame of work.frames) assert.equal(frame.changedPercent, 0, `frame ${frame.frame}`);
});

test("stage dialog overlay is composited into the NekoC capture", visual, async () => {
  const work = await visualWork("tests/fixtures/kitten4/k4fix-dialog.bcm",
    { captureFrames: [1, 30], artifactsDir: "dist/k4fix/pixel-regression", seed: 1, pixelTolerance: 8 });
  assert.equal(work.status, "captured", work.error);
  for (const frame of work.frames) {
    assert.ok(frame.overlay, `frame ${frame.frame} captured without the DOM overlay`);
    // Fonts and button glyphs differ; the panel itself must not be missing (>20%).
    assert.ok(frame.changedPercent < 3, `frame ${frame.frame}: ${frame.changedPercent}`);
  }
});

test("renderer errors after load cannot enter the captured distribution", visual, async () => {
  const source = await readFile("web/renderer.js", "utf8");
  const file = "dist/k4fix/error-regression/renderer-error.js";
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source + `\nconst apply = StageRenderer.prototype.apply;
StageRenderer.prototype.apply = function(...args) {
  apply.apply(this, args); this.onError('injected post-load renderer failure');
};\n`);
  const work = await visualWork("tests/fixtures/kitten4/k4fix-fill.bcm",
    { captureFrames: [1], artifactsDir: "dist/k4fix/error-regression", rendererSource: path.resolve(file) });
  assert.equal(work.status, "unverified");
  assert.match(work.error, /injected post-load renderer failure/);
});
