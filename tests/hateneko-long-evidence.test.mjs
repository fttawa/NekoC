import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compactState, validateLongSuite, milestone, completeMilestone } from "../tools/bench/hateneko-long-evidence.mjs";

test("long observations retain complete short lists and hash every item of large lists", () => {
  const list = Array.from({ length: 33 }, (_, i) => i === 17 ? "17" : i);
  const state = { current_scene_id: "scene", actors: {}, entity_variables: {}, variables: { ids: [66, 15], list } };
  const before = structuredClone(state), output = compactState(state);
  assert.deepEqual(output.variables.ids, [66, 15]);
  assert.equal(output.variables.list.length, 33);
  assert.equal(output.variables.list.sha256, createHash("sha256").update(JSON.stringify(list)).digest("hex"));
  assert.deepEqual(output.variables.list.first, [0, 1, 2]);
  assert.deepEqual(state, before);
  assert.equal(compactState(null), null);
});

test("long evidence recomputes comparisons and rejects short or mismatched budgets", () => {
  const input = { file: "projects/tiny-lm/tiny_lm.bcmkn", sha256: "digest", synthetic: false };
  const work = { ...input, frames: 600, warmup: 0, runs: [{ repeat: 0, comparison: { equal: true }, runtimes: {
    nekoc: { status: "ok", frame_ms: [], warmup_ms: [] }, hateneko: { status: "ok", frame_ms: [], warmup_ms: [] },
  } }] };
  const suite = { input_manifest: [input], options: { projectFrames: 600 }, reference: { unchanged: true }, binary_unchanged: true, works: [work] };
  validateLongSuite(suite);
  assert.equal(work.runs[0].comparison.equal, false);
  for (const count of [undefined, 0, 12, 601]) {
    const invalid = structuredClone(suite); invalid.options.projectFrames = count;
    assert.throws(() => validateLongSuite(invalid));
  }
  assert.throws(() => validateLongSuite({ ...suite, binary_unchanged: false }));
  assert.throws(() => validateLongSuite({ ...suite, binary_unchanged: undefined }));
  assert.equal(milestone(input.file, { variables: { "kn-var-lm_status": "READY" } }), false);
  assert.equal(milestone(input.file, null), false);
  assert.equal(milestone(input.file, { variables: { "kn-var-lm_status": "DONE / EOS", "kn-var-lm_running": 0,
    "kn-var-lm_generated": 1, "kn-list-lm_generated_ids": [66] } }), true);
  const runtime = { status: "ok", frame_ms: Array(600).fill(0), warmup_ms: [], final_state: {
    variables: { "kn-var-lm_status": "DONE / EOS", "kn-var-lm_running": 0,
      "kn-var-lm_generated": 1, "kn-list-lm_generated_ids": [66] },
  } };
  assert.equal(completeMilestone(work, runtime), true);
  for (const mutate of [r => r.frame_ms = [], r => r.frame_ms[0] = -1, r => r.frame_ms[0] = NaN,
    r => r.frame_ms[0] = Infinity, r => r.warmup_ms = [0], r => r.errors = ["error"], r => r.missing_primitives = ["missing"], r => r.status = "unsupported"]) {
    const invalid = structuredClone(runtime); mutate(invalid);
    assert.equal(completeMilestone(work, invalid), false);
  }
});
