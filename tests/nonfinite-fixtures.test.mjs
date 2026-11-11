import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "../tools/nonfinite-fixtures.mjs";

test("nonfinite fixtures are reproducible and retain a real negative-zero input", async () => {
  for (const product of ["kitten4", "kn"]) for (const list of [false, true]) {
    const { project, phases } = await fixture(product, list);
    const extension = product === "kn" ? "bcmkn" : "bcm";
    const name = `${product}${list ? "-list" : ""}.${extension}`;
    const saved = await readFile(new URL(`fixtures/nonfinite/${name}`, import.meta.url), "utf8");
    assert.equal(saved, JSON.stringify(project) + "\n");
    assert.ok(saved.includes('"NUM":"-0"'));
    assert.equal(phases.length, 30);
    assert.equal(phases[18].property, "scale");
    assert.equal(phases[18].input, "NaN");
    assert.equal(phases[19].bounce, true);
  }
});
