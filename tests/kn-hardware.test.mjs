import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const e = JSON.parse(await fs.readFile(new URL("../docs/kn-hardware-evidence.json", import.meta.url), "utf8"));

test("microbit offline profile is bound to actual official panels and synchronous typed calls", () => {
  assert.equal(e.schema, "nekoc-kn-disconnected-microbit-summary-v1");
  assert.equal(e.version, "0.27.4");
  assert.deepEqual(e.hardwareIds, []);
  assert.equal(e.hasMicrobit, false);
  assert.deepEqual(e.pageErrors, []);
  assert.ok(Object.values(e.checks).every(Boolean));
  assert.equal(e.reporters.length, 7);
  assert.equal(e.reporters.reduce((n,r) => n + r.cases.length, 0), e.caseCount);
  assert.equal(e.caseCount, 37);
  for (const r of e.reporters) {
    assert.equal(r.promise, false);
    for (const c of r.cases) {
      assert.equal(c.error, undefined);
      assert.equal(c.promise, false);
      assert.deepEqual(c.result, r.result, r.name);
    }
  }
  const led = e.reporters.find(r => r.name === "microbit_led_is_plot");
  assert.deepEqual(led.inputs, ["x", "y"]);
  assert.deepEqual(led.argumentReads, []);
  assert.deepEqual(led.result, { type: "boolean", value: false });
});

test("optional original microbit bytes reproduce all seven function hashes", async t => {
  for (const r of e.reporters) {
    const source = r.source;
    let bytes;
    try { bytes = await fs.readFile(new URL("../dist/kn-hardware/" + source.bundle, import.meta.url)); }
    catch (err) { if (err.code === "ENOENT") return t.skip("Run kn-hardware-probe.mjs for source bytes"); throw err; }
    const hash = value => createHash("sha256").update(value).digest("hex");
    assert.equal(hash(bytes), source.bundleSha256);
    assert.equal(hash(bytes.subarray(source.byteOffset).toString("utf8").slice(0, source.excerptCharacters)), source.excerptSha256, r.name);
  }
});
