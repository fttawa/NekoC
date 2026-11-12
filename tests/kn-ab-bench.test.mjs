import test from "node:test";
import assert from "node:assert/strict";
import { sameState, validateResume, validateSample } from "../tools/bench/kn-ab.mjs";

const sample = () => ({ runtime: "nekoc", frame_ms: Array(60).fill(1), warmup_ms: Array(10).fill(2), final_state: { variables: { log: 1 } } });
test("native KN AB rejects incomplete and invalid samples", () => {
  assert.equal(validateSample(sample()).summary_ms.mean, 1);
  for (const change of [{ runtime: "official" }, { frame_ms: [] }, { warmup_ms: [] }, { frame_ms: Array(60).fill(NaN) }, { frame_ms: Array(60).fill(-1) }]) {
    assert.throws(() => validateSample({ ...sample(), ...change }));
  }
  assert.equal(sameState(undefined, undefined), false);
  assert.equal(sameState({ value: 1 }, { value: "1" }), false);
});

test("native KN AB resumes only complete pairs of the same binaries, inputs and options", () => {
  const identity = { schema: "nekoc-kn-native-ab-v1", binaries: { before: "hash-a", after: "hash-b" }, options: { frames: 60 } };
  const input = { name: "numeric.bcmkn", file: "dist/numeric.bcmkn", sha256: "input-hash" };
  const saved = { ...identity, works: [{ ...input, runs: [{ repeat: 0, before: sample(), after: sample(), final_state_equal: false }] }] };
  assert.equal(validateResume(structuredClone(saved), identity, [input]).works[0].runs[0].final_state_equal, true);
  for (const change of [{ schema: "old" }, { host: { cpu: "different" } }, { binaries: {} }, { options: {} }, { works: [...saved.works, ...saved.works] },
    { works: [{ ...input, sha256: "changed", runs: [] }] },
    { works: [{ ...input, runs: [{ repeat: 1, before: sample(), after: sample() }] }] },
    { works: [{ ...input, runs: [{ repeat: 0, before: sample() }] }] }]) {
    assert.throws(() => validateResume({ ...structuredClone(saved), ...change }, identity, [input]));
  }
});
