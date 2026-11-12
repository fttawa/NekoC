import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures, sourceEvidence, compactObservation, validateObservation, validateBaseline } from "../tools/semantics-kn-warp.mjs";

const root = new URL("../", import.meta.url);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(await fs.readFile(new URL("docs/kn-warp-official.json", root), "utf8"));
const observation = name => report.cases[`${name}/deterministic`];

test("archive rejects missing/truncated observations and mislabeled baselines", () => {
  for (const [name, value] of Object.entries(report.cases)) validateObservation(name, value);
  const key = "boundary-30002/default", valid = report.cases[key];
  for (const damage of [
    r => { r.steps = []; },
    r => { r.steps.pop(); },
    r => { r.steps.at(-1).after.done = 0; },
    r => { r.mode = "deterministic"; },
    r => { r.steps[0].deterministic = true; },
    r => { delete r.runtimeBundle; },
  ]) {
    const value = structuredClone(valid); damage(value);
    assert.throws(() => validateObservation(key, value));
  }
  const parallel = structuredClone(report.cases["parallel/default"]);
  parallel.variables.other = 1;
  assert.throws(() => validateObservation("parallel/default", parallel));
  const reference = report.cases["reporter-local-warp/default"];
  validateBaseline(report.baseline, reference);
  for (const damage of [
    r => { r.mode = "default"; },
    r => { r.fixture = "wrong"; },
    r => { r.inspection.instrumentation = "wrapper"; },
    r => { r.variables.inside = 0; },
  ]) {
    const baseline = structuredClone(report.baseline);
    damage(baseline.cases["reporter-local-warp/baseline"]);
    assert.throws(() => validateBaseline(baseline, reference));
  }
});

test("KN warp evidence binds complete observations and editor checks to original fixtures", async () => {
  assert.equal(report.schema, "nekoc-kn-warp-official-v1");
  assert.equal(report.ok, true);
  assert.equal(report.editorCompat.ok, true);
  assert.equal(report.baseline.ok, true);
  const baseline = report.baseline.cases["reporter-local-warp/baseline"];
  assert.equal(baseline.inspection.instrumentation, "none");
  assert.deepEqual(baseline.variables, report.cases["reporter-local-warp/default"].variables);
  assert.equal(Object.keys(report.cases).length, Object.keys(fixtures()).length * 2);
  for (const [name, project] of Object.entries(fixtures())) {
    const file = `tests/fixtures/kn-warp/${name}.bcmkn`;
    const bytes = await fs.readFile(new URL(file, root));
    assert.deepEqual(JSON.parse(bytes.toString()), project);
    const editor = report.editorCompat.projects.find(p => p.input === file);
    assert.equal(editor?.sha256, hash(bytes));
    assert.equal(editor.ok, true);
    assert.deepEqual(editor.issues, []);
    for (const mode of ["default", "deterministic"]) {
      const r = report.cases[`${name}/${mode}`];
      assert.equal(r.fixture, file);
      assert.equal(r.sha256, hash(bytes));
      assert.deepEqual(r.pageErrors, []);
      assert.equal(r.error, undefined);
      assert.equal(r.variables.done, 1);
      assert.equal(r.projectVersion, "0.27.4");
      assert.equal(r.runtimeBundle.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
      assert.equal(r.sourceEvidence.locations.some(x => "excerpt" in x), false);
      assert.equal(r.inspection.config.user_debug_mode, false);
      assert.equal(r.inspection.config.max_warp_iterations_per_interpreter_step, 30000);
      assert.equal(r.steps.every(s => s.deterministic === (mode === "deterministic")), true);
    }
  }
});

test("KN loop-tail count uses old > 30000 then increments, including final body", () => {
  assert.equal(observation("boundary-30001").steps.length, 1);
  const two = observation("boundary-30002");
  assert.deepEqual(two.steps.map(s => [s.frame, s.after.count, s.after.done, s.countAfter]), [[0, 30002, 0, 30002], [1, 30002, 1, 0]]);
  const three = observation("boundary-30003");
  assert.deepEqual(three.steps.map(s => [s.after.count, s.countAfter]), [[30002, 30002], [30003, 1]]);
  for (const name of ["range", "until"]) assert.deepEqual(observation(name).steps.map(s => [s.after.count, s.after.done]), [[30002, 0], [30002, 1]]);
  assert.equal(observation("straight-line").steps[0].calls, 0);
  assert.equal(observation("break").steps[0].calls, 0);
});

test("KN budget is per interpreter step, shared across nested and sibling warp", () => {
  assert.deepEqual(observation("parallel").steps.map(s => [s.frame, s.countAfter]), [[0, 30002], [0, 30002], [1, 1], [1, 1]]);
  assert.deepEqual(observation("nested").steps.map(s => [s.after.count, s.countAfter]), [[30001, 30002], [30002, 2]]);
  assert.deepEqual(observation("siblings").steps.map(s => [s.after.done, s.countAfter]), [[0, 30002], [1, 0]]);
});

test("KN procedures preserve warp context, reset on next step and restore caller context", () => {
  const p = observation("procedure-in-warp");
  assert.deepEqual(p.steps.map(s => [s.after.count, s.after.inside, s.after.outside, s.after.done]), [[30002, 0, 0, 0], [30002, 1, 1, 0], [30002, 1, 2, 0], [30002, 1, 2, 1]]);
  assert.ok(p.steps[0].procedureFrames.includes("knwarp-procedure:true"));
  assert.deepEqual(observation("procedure-local-warp").steps.map(s => s.after.outside), [0, 1, 2, 2]);
  const w = observation("procedure-wait");
  assert.equal(w.steps[0].after.count, 15001);
  assert.equal(w.steps[1].after.count, 45003);
  assert.equal(w.steps[1].countAfter, 30002);
  assert.ok(w.steps[1].frame > w.steps[0].frame);
});

test("official reporter warp resumes across updates; final-value equality is not scheduling proof", () => {
  const r = observation("reporter-local-warp");
  assert.deepEqual(r.steps.map(s => [s.frame, s.after.count, s.after.inside, s.after.done]), [[0, 30002, 0, 0], [1, 30002, 30002, 1]]);
  assert.ok(report.cases["reporter-local-warp/default"].steps.length > 1);
  assert.ok(report.limitations.some(s => s.includes("synchronous local reporters")));
});

test("strict floating-point wall-clock boundary diagnostics and renderer invocation evidence", () => {
  const r = observation("parallel"), diagnostics = r.inspection.boundaryDiagnostics;
  assert.equal(diagnostics.find(d => d.label === "wall-equal-4ms").answer, false);
  assert.equal(diagnostics.find(d => d.label === "wall-over-4ms").answer, true);
  assert.equal(diagnostics.find(d => d.label === "nonwarp-no-increment").newCount, 9);
  assert.ok(r.renders.some(s => s.variables.count === 30002 && s.variables.other === 30002 && s.variables.done === 0));
  assert.ok(report.cases["boundary-30002/default"].steps.some(s => s.countAfter < 30002 && s.after.done === 0));
});

test("source locator refuses missing official anchors", () => {
  assert.throws(() => sourceEvidence(Buffer.from("not an official runtime")), /Official source changed/);
});

test("archive compaction preserves steps, errors and comparisons without mutating raw observations", () => {
  const sample = value => ({ variables: { done: value } });
  const original = { inspection: { config: { user_debug_mode: false }, boundaryDiagnostics: [], manager: { own: ["large"] } },
    steps: [{ after: { done: 0 } }, { after: { done: 1 } }],
    updates: [sample(0), sample(1), sample(1), sample(1)], renders: [sample(0), sample(0), sample(1), sample(1), sample(0)],
    error: "real failure", pageErrors: ["real error"], nekoc: { error: "budget failure" }, finalVariablesEqual: false };
  const snapshot = structuredClone(original), compact = compactObservation(original);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(compact.steps, original.steps);
  assert.deepEqual(compact.updates, original.updates.slice(0, 3));
  assert.deepEqual(compact.renders, [sample(0), sample(1), sample(0)]);
  for (const key of ["error", "pageErrors", "nekoc", "finalVariablesEqual"]) assert.deepEqual(compact[key], original[key]);
  assert.deepEqual(compact.inspection, { config: { user_debug_mode: false }, boundaryDiagnostics: [] });
  assert.equal(compact.archiveSampling.originalRenders, 5);
  const unfinished = { updates: [sample(0), sample(0)], renders: [] };
  assert.deepEqual(compactObservation(unfinished).updates, unfinished.updates);
});
