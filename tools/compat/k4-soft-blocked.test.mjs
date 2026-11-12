// Original arithmetic regression assertions, not a port of the vendor sampler.
// They make the observed zero-progress condition executable without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = variant => JSON.parse(readFileSync(new URL(`../../docs/kitten4-soft-blocked-${variant}-evidence.json`, import.meta.url)));

test("hardware budget and observed rectangle state imply a zero-progress boundary walk", () => {
  const report = read("rectangle"), max = Math.floor((Math.floor(report.environment.uniformVectors / 5) - 1) / 2);
  assert.equal(max, 101);
  assert.equal(report.status, "watchdog-timeout");
  assert.equal(report.frames, 0);
  assert.equal(report.pauses.length, 3);
  for (const pause of report.pauses) {
    const frame = pause.stack[0], state = frame.samplingState;
    assert.equal(frame.function, "generate_position_data");
    assert.equal(state.cachedMaxAnchors, max);
    assert.equal(state.outlineLength, 40);
    assert.equal(Math.floor(state.outlineLength / (max / 2)), 0);
    assert.equal(state.increment, 0);
    assert.ok(state.interiorAnchorCount < max);
    assert.equal(state.pointCount, 26);
    assert.equal(state.boundaryAnchorCount, 1);
    // A zero increment cannot move the visited index, regardless of elapsed time.
    assert.equal(0 + state.increment, 0);
  }
});

test("native wall clock reproduces the same stalled initialization, while control completes", () => {
  const real = read("rectangle-real-clock"), control = read("coast");
  assert.equal(real.projectSha256, read("rectangle").projectSha256);
  assert.equal(real.status, "watchdog-timeout");
  assert.equal(real.frames, 0);
  assert.equal(real.pauses.length, 3);
  assert.ok(real.pauses.every(pause => pause.stack[0].samplingState.increment === 0));
  assert.equal(control.status, "completed");
  assert.equal(control.frames, 2);
  assert.deepEqual(control.errors, []);
});

test("observed soft model separates rigid iterations, particle substeps and render triangles", () => {
  const evidence = read("model");
  for (const [name, strength] of [["coast", 2.5], ["impact-25", 3.75], ["impact-90", 0.5]]) {
    const item = evidence.cases[name], frame = item.frames.at(-1);
    assert.equal(item.officialFrames, 3);
    assert.deepEqual(item.errors, []);
    assert.equal(frame.step.velocityIterations, 8);
    assert.equal(frame.step.positionIterations, 3);
    assert.equal(frame.step.particleIterations, 1);
    assert.equal(frame.radius, 1.2);
    assert.equal(frame.elasticStrength, 0.25);
    assert.equal(frame.groupStrength, strength);
    assert.equal(frame.adapterStrength, strength);
    assert.deepEqual(frame.triadStrengthKinds, ["function"]);
    assert.equal(frame.triadCount, 152);
    assert.equal(frame.filter.triangles, 65);
    assert.equal(frame.filter.transformMatrixValues, frame.filter.triangles * 6);
    assert.equal(frame.filter.triangleValues, frame.filter.triangles * 6);
  }
});
