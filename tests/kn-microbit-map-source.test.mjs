import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const e = JSON.parse(await fs.readFile(new URL("docs/kn-microbit-map-evidence.json", root), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("official lazy microbit execution identity is retained without third-party bodies", () => {
  assert.equal(e.schema, "nekoc-kn-microbit-map-official-v1");
  assert.equal(e.editor.version, "0.27.4");
  assert.equal(e.editor.domainFactoryModule, 20592);
  assert.equal(e.editor.domainName, "microbit_math_map");
  assert.equal(e.ok, true);
  assert.ok(Object.values(e.checks).every(Boolean));
  assert.deepEqual(e.pageErrors, []);
  assert.equal(e.sourceLocations.length, 4);
  const map = e.sourceLocations.find(l => l.symbol === "microbit_math_map");
  assert.equal(map.bundle, "entry_hardware.481194e4.chunk.js");
  assert.equal(map.bundleUrl, "https://creation.bcmcdn.com/neko/web/release/static/js/entry_hardware.481194e4.chunk.js");
  assert.equal(map.bundleSha256, "7259df6bc25c81905028a569ca5e99fba5091ca4fbddd29c2ec92ac15c75842d");
  assert.equal(map.byteOffset, 205131);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "functionSource", "modules", "anchor"].includes(key));
      walk(child);
    }
  };
  walk(e);
});

test("actual official function returns typed NaN without hardware, not an unconditional map", () => {
  assert.deepEqual(e.editor.hardwareIds, []);
  assert.equal(e.editor.hasMicrobit, false);
  assert.equal(e.editor.calls.length, 7);
  for (const c of e.editor.calls) {
    assert.equal(c.error, undefined);
    assert.equal(c.promise, false);
    assert.deepEqual(c.result, { type: "number", value: "NaN" }, c.label);
  }
  assert.deepEqual(e.editor.guardedResult, { result: { type: "number", value: "NaN" }, getterReads: 0 });
  assert.deepEqual(e.editor.inputSockets, [
    { name: "value", defaultValue: "0" }, { name: "fromStart", defaultValue: "0" },
    { name: "fromEnd", defaultValue: "1023" }, { name: "toStart", defaultValue: "1" }, { name: "toEnd", defaultValue: "10" },
  ]);
  assert.ok(e.limitations.some(l => l.includes("input elision")));
  assert.ok(e.limitations.some(l => l.includes("source-only")));
});

test("optional original CDN bytes reproduce all four official execution anchors", async t => {
  for (const name of new Set(e.sourceLocations.map(l => l.bundle))) {
    let bytes;
    try { bytes = await fs.readFile(new URL("dist/kn-microbit-map/" + name, root)); }
    catch (err) { if (err.code === "ENOENT") return t.skip("Run microbit map probe to retain source bytes"); throw err; }
    for (const row of e.sourceLocations.filter(l => l.bundle === name)) {
      assert.equal(sha256(bytes), row.bundleSha256);
      assert.equal(sha256(bytes.subarray(row.byteOffset).toString("utf8").slice(0, row.excerptCharacters)), row.excerptSha256, row.symbol);
    }
  }
});
