import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { physicsMainPathFixtures } from "../tools/compat/k4-partial-physics-6-fixtures.mjs";

test("physics main-path evidence binds original workspaces and every sampled update", () => {
  const report = JSON.parse(readFileSync(new URL("../docs/kitten4-partial-physics-6-evidence.json", import.meta.url)));
  const fixtures = physicsMainPathFixtures();
  assert.deepEqual(Object.keys(report.cases), Object.keys(fixtures));
  for (const [name, { project, types }] of Object.entries(fixtures)) {
    const evidence = report.cases[name];
    const text = readFileSync(evidence.fixture, "utf8").replaceAll("\r\n", "\n");
    assert.equal(text, JSON.stringify(project, null, 2) + "\n");
    assert.equal(evidence.sha256, createHash("sha256").update(text).digest("hex"));
    assert.deepEqual(evidence.types, types);
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.diagnostics.pageErrors, []);
    assert.equal(evidence.frames.length, 40);
    assert.equal(evidence.frames.at(-1).variables.done, 1);
  }
});
