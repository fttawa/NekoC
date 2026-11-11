import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { physicsTrajectoryFixtures } from "../tools/compat/k4-physics-trajectory-3-fixtures.mjs";

test("original physics trajectories bind fixtures to 60 real offline updates", () => {
  const report = JSON.parse(readFileSync("docs/kitten4-physics-trajectory-3-evidence.json"));
  const fixtures = physicsTrajectoryFixtures();
  assert.deepEqual(Object.keys(report.cases).sort(), Object.keys(fixtures).sort());
  for (const [name, project] of Object.entries(fixtures)) {
    const evidence = report.cases[name];
    const text = readFileSync(evidence.fixture, "utf8").replaceAll("\r\n", "\n");
    assert.deepEqual(JSON.parse(text), project, name);
    assert.equal(evidence.sha256, createHash("sha256").update(text).digest("hex"), name);
    assert.equal(evidence.frames.length, 60, name);
    assert.deepEqual(evidence.errors, [], name);
    assert.deepEqual(evidence.diagnostics.pageErrors, [], name);
    assert.ok(JSON.stringify(evidence.diagnostics).includes("6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6"), "real physics chunk loaded");
  }
  const position = (name, frame) => report.cases[name].frames[frame - 1].actor;
  assert.equal(position("legacy-limit", 3).x, 20);
  assert.ok(Math.abs(Math.hypot(position("legacy-diagonal-limit", 3).x, position("legacy-diagonal-limit", 3).y) - 20) < 1e-10);
  assert.equal(position("coast", 2).x, 0, "actor publication precedes the next world step");
  assert.ok(Math.abs(position("fall", 3).y + 1 / 18) < 1e-12);
  const shape = JSON.parse(readFileSync("docs/kitten4-physics-trajectory-3-shape-evidence.json"));
  assert.equal(shape.sha256, report.cases.coast.sha256);
  assert.deepEqual(shape.errors, []);
  assert.equal(shape.observations.length, 3);
  for (const observation of shape.observations) {
    assert.deepEqual(observation.texture, { width: 20, height: 20 });
    assert.equal(observation.pointCount, 196);
    const points = observation.shapes[0].vertices;
    const area = Math.abs(points.reduce((sum, p, index) => {
      const next = points[(index + 1) % points.length];
      return sum + p.x * next.y - next.x * p.y;
    }, 0)) / 2;
    assert.ok(Math.abs(area * observation.shapes[0].density - .333) < 1e-12);
  }
});
