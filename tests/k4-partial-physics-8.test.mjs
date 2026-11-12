import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { physicsContactFixtures } from "../tools/compat/k4-partial-physics-8-fixtures.mjs";
const report = JSON.parse(readFileSync(new URL("../docs/kitten4-partial-physics-8-evidence.json", import.meta.url)));
test("original contact inputs, including unchanged prior failures, bind to oracle evidence", () => {
  const fixtures = physicsContactFixtures();
  assert.deepEqual(Object.keys(report.cases), Object.keys(fixtures));
  for (const [name, spec] of Object.entries(fixtures)) {
    const evidence = report.cases[name];
    const text = readFileSync(evidence.fixture, "utf8").replace(/\r\n/g, "\n");
    assert.equal(text, JSON.stringify(spec.project, null, 2) + "\n", name);
    assert.equal(createHash("sha256").update(text).digest("hex"), evidence.sha256, name);
    assert.equal(evidence.frames.length, spec.frames, name);
    assert.deepEqual(evidence.errors, [], name);
    assert.deepEqual(evidence.diagnostics.pageErrors, [], name);
    for (const asset of evidence.diagnostics.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});
test("four sides include normal, frictional oblique and below-threshold contacts", () => {
  for (const side of ["bottom", "top", "left", "right"]) {
    for (const variant of ["bounce", "inelastic", "oblique", "low-speed"]) {
      const frames = report.cases[`${side}-${variant}`].frames;
      assert.ok(frames.every(f => [f.actor.x, f.actor.y, f.actor.rotation].every(Number.isFinite)));
      const axis = ["left", "right"].includes(side) ? "x" : "y";
      assert.notEqual(frames.at(-1).actor[axis], frames[0].actor[axis]);
    }
  }
});
test("official configuration observations retain resource identity and continuous-contact facts", () => {
  const config = JSON.parse(readFileSync(new URL("../docs/kitten4-partial-physics-8-config-evidence.json", import.meta.url)));
  for (const [name, c] of Object.entries(config.cases)) {
    assert.equal(c.config.linearSlop, .005, name);
    assert.equal(c.config.polygonRadius, .01, name);
    assert.equal(c.config.baumgarte, .2, name);
    assert.equal(c.config.toiBaumgarte, .75, name);
    assert.equal(c.fixtures[0].threshold, 1, name);
    assert.ok(c.contacts.some(contact => contact.toiCounts.includes(1)), name);
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.pageErrors, []);
    assert.ok(c.assets.some(a => a.sha256 === "6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6"));
  }
});
