import { test } from "node:test";
import assert from "node:assert/strict";
import { originalCases, allCases, nodeExpected } from "./ts-js-semantics/prepare.mjs";

test("245 synthetic TS/JS probes have explicit, actionable baseline statuses", () => {
  assert.equal(originalCases.length, 245);
  assert.equal(new Set(allCases.map(c => c.id)).size, allCases.length);
  for (const c of allCases) {
    assert.ok(["match", "compile-error", "known-diff"].includes(c.status), c.id);
    if (c.status === "compile-error") assert.ok(c.error.length >= 4, c.id);
    if (c.status === "known-diff") {
      assert.ok(typeof c.node === "string" || typeof c.nodeError === "string", c.id);
      assert.ok(c.error || typeof c.value === "string", c.id);
      if (typeof c.node === "string") assert.equal(nodeExpected(c), c.node, c.id);
    }
  }
});

test("Node oracle registers onStart before dispatch instead of reporting a missing host", () => {
  assert.equal(nodeExpected(originalCases.find(c => c.id === "extra-009")), "104");
  assert.equal(nodeExpected(originalCases.find(c => c.id === "extra-017")), "5");
});
