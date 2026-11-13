import { test } from "node:test";
import assert from "node:assert/strict";
import { semanticResult } from "../tools/bench/kn-deterministic-ab.mjs";

test("KN deterministic AB removes only nondeterministic measurements", () => {
  const sample = { schema: "nekoc-performance-v1", runtime: "nekoc", deterministic: true,
    frames: 60, warmup: 10, frame_ms: Array(60).fill(1), warmup_ms: Array(10).fill(2), import_ms: 3,
    start_ms: 4, peak_rss_bytes: 5, instructions: 6, pen_lines: 7,
    active_frames: 60, input: "numeric.bcmkn", seed: 1,
    final_state: { variables: { n: 1.000000000000001 } } };
  const { frame_ms, warmup_ms, import_ms, start_ms, peak_rss_bytes, ...expected } = sample;
  assert.deepEqual(semanticResult(sample, { input: sample.input, seed: 1 }), expected);
  assert.throws(() => semanticResult({ ...sample, deterministic: false }), /deterministic/);
  assert.throws(() => semanticResult({ ...sample, frame_ms: null }), /complete/);
  assert.throws(() => semanticResult({ ...sample, warmup_ms: null }), /complete/);
  assert.throws(() => semanticResult({ ...sample, frame_ms: [] }), /complete/);
  assert.throws(() => semanticResult({ ...sample, frame_ms: [NaN] }), /complete/);
  for (const change of [{ frames: 0 }, { schema: "other" }, { runtime: "other" },
    { final_state: null }, { instructions: undefined }, { active_frames: 61 }, { pen_lines: -1 }]) {
    assert.throws(() => semanticResult({ ...sample, ...change }), /complete/);
  }
  assert.throws(() => semanticResult(sample, { input: "other", seed: 1 }), /complete/);
  assert.throws(() => semanticResult(sample, { input: sample.input, seed: 6 }), /complete/);
});
