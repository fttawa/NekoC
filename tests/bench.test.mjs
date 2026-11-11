import test from "node:test";
import assert from "node:assert/strict";
import { fixtures } from "../tools/bench/fixtures.mjs";
import { parseArgs, summarize, scoreProject } from "../tools/bench/run.mjs";
import { compare } from "../tools/bench/compare.mjs";
import { checkedRun } from "../tools/bench/paired-run.mjs";
import { readJson, runOracle } from "../tools/compat/k4-oracle.mjs";

test("performance evidence contains measured hashes, finite timings and no embedded works", async () => {
  const evidence = await readJson("docs/performance-evidence.json");
  assert.equal(evidence.comparison.length, 7);
  for (const row of evidence.comparison) {
    assert.equal(row.status, "equal-final-state");
    assert.ok(row.before_ms > 0 && row.after_ms > 0 && Number.isFinite(row.speedup));
  }
  for (const rows of [evidence.before, evidence.after, evidence.official]) for (const row of rows) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(row.frame_mean_ms > 0 && row.import_ms > 0);
    assert.equal(row.compile_result, undefined);
    assert.equal(row.theatre, undefined);
  }
});

test("official performance instrumentation preserves variables and counts exact updates", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const project = (await fixtures()).numeric;
  const normal = await runOracle(project, { frames: 4 });
  const measured = await runOracle(project, { frames: 4, warmup: 1, measurePerformance: true });
  assert.equal(measured.performance.frame_ms.length, 3);
  assert.equal(measured.performance.warmup_ms.length, 1);
  assert.deepEqual(measured.performance.final_state.variables, normal.frames.at(-1).variables);
  assert.ok(measured.performance.frame_ms.every(n => n >= 0 && Number.isFinite(n)));
  assert.ok(measured.performance.renderer_memory.renderers.every(p => p.peak_rss_bytes > 0));
});

test("speed comparison fails closed on different work, errors or final states", () => {
  const suite = value => ({ works: [{ name: "a", sha256: "hash", runs: [{ status: "ok", final_state: { variables: { v: value } }, summary_ms: { mean: 2 } }] }] });
  assert.equal(compare(suite(1), suite(1))[0].speedup, 1);
  assert.equal(compare(suite(1), suite(2))[0].status, "state-mismatch");
  const other = suite(1); other.works[0].sha256 = "other";
  assert.equal(compare(suite(1), other)[0].status, "input-mismatch");
  other.works[0].sha256 = "hash"; other.works[0].runs[0].status = "unverified";
  assert.equal(compare(suite(1), other)[0].status, "unverified");
  const config = suite(1); config.works[0].runs[0].seed = 2;
  assert.equal(compare(suite(1), config)[0].status, "configuration-mismatch");
  assert.throws(() => compare({ ...suite(1), options: { frames: 1 } }, { ...suite(1), options: { frames: 2 } }));
});

test("string concatenation evidence preserves measured pairs and differential scope", async () => {
  const evidence = await readJson("docs/string-concat-evidence.json");
  assert.equal(evidence.native_pair.length, 7);
  for (const row of evidence.native_pair) {
    assert.equal(row.status, "equal-final-state");
    assert.ok([row.before_ms, row.after_ms].every(n => Number.isFinite(n) && n > 0));
  }
  assert.equal(evidence.configuration.repeats, 7);
  assert.equal(evidence.official_string_pair.status, "equal-final-state");
  assert.ok(evidence.official_string_pair.nekoc_ms <= 0.46);
  for (const [samples, median] of [
    [evidence.official_string_pair.official_run_means_ms, evidence.official_string_pair.official_ms],
    [evidence.official_string_pair.nekoc_run_means_ms, evidence.official_string_pair.nekoc_ms],
  ]) {
    assert.equal(samples.length, evidence.configuration.repeats);
    assert.equal(summarize(samples).median, median);
  }
  assert.equal(evidence.jit_differential.complete, 52);
  assert.equal(evidence.jit_differential.differences, 0);
  assert.equal(evidence.jit_differential.original_errors, 1);
  for (const hash of [evidence.string_input_sha256, evidence.official_bundle_sha256, ...Object.values(evidence.binaries), ...Object.values(evidence.rebuilt_binaries), ...Object.values(evidence.raw_sha256)]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.compile_result, undefined);
  assert.equal(evidence.theatre, undefined);
});

test("paired workers require exact updates and normalize the official configuration", () => {
  const run = () => ({ frame_ms: Array(120).fill(1), warmup_ms: Array(10).fill(2) });
  const official = checkedRun(run(), true);
  assert.equal(official.runtime, "official");
  assert.equal(official.seed, 1);
  assert.equal(official.frames, 120);
  assert.equal(official.warmup, 10);
  const native = { ...run(), runtime: "nekoc", seed: 42 };
  assert.equal(checkedRun(native, false), native);
  assert.equal(native.seed, 42);
  for (const invalid of [{}, { ...run(), frame_ms: [] }, { ...run(), warmup_ms: [] }]) assert.throws(() => checkedRun(invalid, true), /Update count/);
  const invalid = run(); invalid.warmup_ms[0] = NaN;
  assert.throws(() => checkedRun(invalid, true), /Invalid samples/);
});

test("cross-kernel pairs ignore only labels and empty entity maps, not private values", () => {
  const suite = final_state => ({ works: [{ name: "s", sha256: "same", runs: [{ status: "ok", final_state, summary_ms: { mean: 1 } }] }] });
  const official = { ...suite({ frame: 131, variables: { s: "text" }, variable_names: { s: "name" }, entity_variables: {} }), binary: { runtime: "official" } };
  const native = suite({ frame: 130, variables: { s: "text" }, entity_variables: { actor: {} } });
  assert.equal(compare(official, native)[0].status, "equal-final-state");
  native.works[0].runs[0].final_state.entity_variables.actor.s = "private";
  assert.equal(compare(official, native)[0].status, "state-mismatch");
  delete native.works[0].runs[0].final_state.entity_variables.actor.s;
  native.works[0].runs[0].final_state.variables.s = "different";
  assert.equal(compare(official, native)[0].status, "state-mismatch");
  native.works[0].runs[0].final_state.variables.s = "text";
  native.works[0].runs[0].final_state.entity_variables.actor = [];
  assert.equal(compare(official, native)[0].status, "state-mismatch");
  for (const value of [null, Infinity, NaN, undefined, [null]]) {
    native.works[0].runs[0].final_state.entity_variables = {};
    native.works[0].runs[0].final_state.variables.s = value;
    assert.equal(compare(official, native)[0].status, "unverified");
  }
});

test("benchmark CLI rejects invalid counts, runtimes and tracked output paths", () => {
  assert.equal(parseArgs([]).frames, 180);
  for (const args of [["--frames", "0"], ["--warmup", "-1"], ["--repeats", "NaN"], ["--runtime", "fake"], ["--out", "docs/data"], ["--out", "dist/../docs"], ["--input"]]) assert.throws(() => parseArgs(args));
});

test("benchmark statistics keep raw sample ordering and nearest-rank p95", () => {
  const samples = [4, 1, 3, 2];
  assert.deepEqual(summarize(samples), { mean: 2.5, median: 3, p95: 4, max: 4 });
  assert.deepEqual(samples, [4, 1, 3, 2]);
  for (const values of [[], [NaN], [-1], [Infinity]]) assert.throws(() => summarize(values));
});

test("benchmark fixtures are deterministic, bounded, asset-independent repository probes", async () => {
  const a = await fixtures();
  assert.deepEqual(a, await fixtures());
  assert.deepEqual(Object.keys(a), ["numeric", "list", "string", "clones", "broadcast", "recursion", "pen"]);
  for (const p of Object.values(a)) {
    assert.equal(p.compile_result, undefined);
    const actor = Object.values(p.theatre.actors)[0];
    const blocks = Object.values(actor.block_data_json.blocks);
    assert.ok(blocks.some(b => b.type === "repeat_forever"));
    assert.ok(blocks.some(b => b.type === "warp"));
    assert.ok(!JSON.stringify(p.theatre.styles).includes("https://"));
  }
  assert.ok(scoreProject(a.clones).clones > 0);
  assert.ok(scoreProject(a.pen).pen > 0);
  assert.ok(scoreProject(a.numeric).compute > 0);
});
