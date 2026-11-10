import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runErrorFixtures } from "../tools/compat/k4-run-error-fixtures.mjs";
import { readJson, runOracle } from "../tools/compat/k4-oracle.mjs";

test("run error fixtures reproduce exactly and official evidence pins their hashes", async () => {
  const evidence = await readJson("docs/kitten4-run-error-evidence.json");
  const projects = await runErrorFixtures();
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(projects));
  for (const [name, project] of Object.entries(projects)) {
    const text = await readFile(`tests/fixtures/kitten4/runerr-${name}.bcm`, "utf8");
    assert.equal(text, JSON.stringify(project, null, 2) + "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), evidence.cases[name].sha256);
  }
});

test("run error probes reproduce recorded official values", { skip: !process.env.K4_ORACLE_INTEGRATION }, async () => {
  const evidence = await readJson("docs/kitten4-run-error-evidence.json");
  for (const [name, project] of Object.entries(await runErrorFixtures())) {
    const result = await runOracle(project, { frames: 4, seed: 6, randomSource: "nekoc" });
    assert.deepEqual(result.frames.map(f => f.variables), evidence.cases[name].variables, name);
  }
});
