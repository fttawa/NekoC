import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";
import { propertyFixtures } from "../tools/compat/k4-partial-properties-fixtures.mjs";
import { partialEffectsFixtures } from "../tools/compat/k4-partial-effects-fixtures.mjs";
import { partialMiscFixtures } from "../tools/compat/k4-partial-misc-fixtures.mjs";

for (const [category, generate] of [["properties", propertyFixtures], ["effects", partialEffectsFixtures], ["misc", partialMiscFixtures]]) {
  test(`partial ${category}: original fixtures and official evidence hashes stay reproducible`, async () => {
    const evidence = JSON.parse(await fs.readFile(`docs/kitten4-partial-${category}-evidence.json`, "utf8"));
    const fixtures = await generate();
    assert.deepEqual(Object.keys(fixtures).sort(), Object.keys(evidence.cases).sort());
    for (const [name, value] of Object.entries(fixtures)) {
      const project = value.project ?? value;
      const file = `tests/fixtures/kitten4/partial-${category}-${name}.bcm`;
      const content = await fs.readFile(file, "utf8");
      assert.deepEqual(JSON.parse(content), project, file);
      // Ignore checkout newline policy while preserving the recorded JSON bytes.
      const canonical = JSON.stringify(project, null, 2) + "\n";
      assert.equal(createHash("sha256").update(canonical).digest("hex"), evidence.cases[name].sha256, file);
    }
    assert.ok(evidence.assets.some(asset => asset.sha256 === "0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160"));
  });
}
