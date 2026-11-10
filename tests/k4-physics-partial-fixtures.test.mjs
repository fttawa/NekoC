import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { physicsPartialFixtures } from "../tools/compat/k4-physics-partial-fixtures.mjs";

test("partial physics probes are original, reproducible and bound to offline evidence", async () => {
  const evidence = JSON.parse(await readFile("docs/kitten4-physics-partial-evidence.json", "utf8"));
  for (const [name, project] of Object.entries(physicsPartialFixtures())) {
    const bytes = await readFile(`tests/fixtures/kitten4/partial-physics-${name}.bcm`);
    assert.deepEqual(JSON.parse(bytes), project, name);
    assert.equal(createHash("sha256").update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest("hex"), evidence.cases[name].sha256, name);
    assert.equal(evidence.cases[name].frameCount, 30);
    assert.deepEqual(evidence.cases[name].errors, []);
    assert.equal(evidence.cases[name].variables.done, 1);
  }
  // Guard against a script-only false positive when the optional physics
  // library was never loaded (the real offline player can return all zeros).
  assert.equal(evidence.cases["modern-flags"].variables.beforeSpeed, 2);
  assert.equal(evidence.cases["modern-flags"].variables.sensorTickSpeed, 6);
  assert.equal(evidence.cases["modern-disable-both"].variables.bothWriteSpeed, 3);
  assert.equal(evidence.cases["modern-speed"].variables.dynamicWriteSpeed, 6);
});
