import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { physicsRemainingFixtures } from "../tools/compat/k4-partial-physics-7-fixtures.mjs";

test("remaining physics evidence binds original inputs, full update series and loaded physics", () => {
  const report = JSON.parse(readFileSync("docs/kitten4-partial-physics-7-evidence.json"));
  const fixtures = physicsRemainingFixtures();
  assert.deepEqual(Object.keys(report.cases).sort(), Object.keys(fixtures).sort());
  for (const [name, { project, types, frames }] of Object.entries(fixtures)) {
    const evidence = report.cases[name];
    const text = readFileSync(evidence.fixture, "utf8").replaceAll("\r\n", "\n");
    assert.equal(text, JSON.stringify(project, null, 2) + "\n", name);
    assert.equal(evidence.sha256, createHash("sha256").update(text).digest("hex"));
    assert.deepEqual(evidence.types, types);
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.diagnostics.pageErrors, []);
    assert.ok(evidence.diagnostics.assets.some(x => x.sha256 === "6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6"));
    assert.equal(evidence.frames.length, frames);
    assert.equal(evidence.frames.at(-1).variables.done, 1, name);
  }
});

test("boundary probes expose present and absent right edges instead of claiming solver equality", () => {
  const cases = JSON.parse(readFileSync("docs/kitten4-partial-physics-7-evidence.json")).cases;
  for (const prefix of ["modern", "legacy"]) {
    for (const mode of ["not_bound", "bottom_bound"]) assert.equal(cases[`${prefix}-boundary-${mode}`].frames.at(-1).variables.crossed, 675);
    for (const mode of ["all_bounds", "left_right_bottom_bounds"]) assert.equal(cases[`${prefix}-boundary-${mode}`].frames.at(-1).variables.crossed, 629.85);
  }
  assert.ok(cases["filter-edge"].frames.at(-1).actor.x > 700);
});
