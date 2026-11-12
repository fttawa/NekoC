import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compactNativeWorks } from "../tools/bench/kn-evidence.mjs";

test("KN compact evidence recomputes raw timings and final-state equality, retaining regressions", () => {
  const sample = value => ({ runtime: "nekoc", frame_ms: Array(60).fill(value), warmup_ms: Array(10).fill(0),
    final_state: { variables: { log: 1 } }, summary_ms: { mean: 999 } });
  const report = { works: Array.from({ length: 7 }, (_, index) => ({ name: `${index}.bcmkn`, sha256: "input",
    runs: Array.from({ length: 5 }, (_, repeat) => ({ repeat, before: sample(1), after: sample(2), final_state_equal: false })) })) };
  const result = compactNativeWorks(report);
  assert.equal(result[0].before_ms, 1);
  assert.equal(result[0].after_ms, 2);
  assert.equal(result[0].change_percent, 100);
  assert.equal(result[0].final_state_equal, true);
  report.works[0].runs[0].after.final_state.variables.log = 2;
  assert.equal(compactNativeWorks(report)[0].final_state_equal, false);
  assert.throws(() => compactNativeWorks({ works: [] }), /Incomplete/);
  report.works[0].runs.pop();
  assert.throws(() => compactNativeWorks(report), /Incomplete/);
});

test("archived KN regression evidence retains five paired runs and all seven controls", async () => {
  const evidence = JSON.parse(await readFile(new URL("../docs/knperf-evidence.json", import.meta.url)));
  assert.equal(evidence.schema, "nekoc-knperf-evidence-v1");
  for (const suite of evidence.native_ab) {
    assert.equal(suite.works.length, 7);
    assert.match(suite.raw_sha256, /^[a-f0-9]{64}$/);
    for (const work of suite.works) {
      assert.equal(work.runs.length, 5);
      const median = side => work.runs.map(run => run[side].mean).sort((a, b) => a - b)[2];
      assert.equal(work.before_ms, median("before_ms"));
      assert.equal(work.after_ms, median("after_ms"));
      assert.equal(work.change_percent, (work.after_ms / work.before_ms - 1) * 100);
    }
  }
  const boundary = evidence.native_ab.find(suite => suite.name === "warp-introduction");
  assert.ok(boundary);
  const numeric = boundary.works.find(work => work.name === "numeric.bcmkn");
  assert.ok(numeric.change_percent > 300);
  assert.equal(numeric.final_state_equal, true);
  for (const diagnostic of evidence.diagnostics ?? []) {
    assert.equal(diagnostic.status, "ok");
    assert.equal(diagnostic.workload.certified, true);
    assert.equal(diagnostic.workload.equivalent, false);
    assert.equal(diagnostic.updates.length, 70);
    assert.ok(diagnostic.updates.every(update => update.tail_calls === diagnostic.workload.tail_per_update
      && update.boundary_returns === 0 && update.completed_batch));
  }
  if (evidence.official) {
    assert.equal(typeof evidence.official.complete, "boolean");
    if (evidence.official.complete) {
      assert.equal(evidence.official.works.length, 7);
      assert.equal(evidence.official.completed_runs, 21);
      assert.equal(evidence.official.bundles_unchanged, true);
      assert.equal(evidence.official.harness_unchanged, true);
    }
    for (const work of evidence.official.works) for (const run of work.runs) {
      assert.notEqual(run.comparison?.status, "comparable", "native per-update workload evidence is not implemented");
    }
  }
});
