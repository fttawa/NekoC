import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const e = JSON.parse(await fs.readFile(new URL("../docs/kn-conversion-evidence.json", import.meta.url), "utf8"));
test("KN conversion evidence is official, typed and contains no runtime bodies", () => {
  assert.equal(e.schema, "nekoc-kn-conversion-v1");
  assert.equal(e.ok, true);
  assert.equal(e.editor.version, "0.27.4");
  assert.deepEqual(e.pageErrors, []);
  assert.equal(e.editor.calls.length, 63);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "functionSource", "modules"].includes(key));
      walk(child);
    }
  };
  walk(e);
  for (const c of e.editor.calls) {
    assert.equal(c.error, undefined);
    assert.ok(["number", "string", "boolean"].includes(c.result.type));
    if (c.target === "boolean") assert.equal(c.result.type, "boolean");
  }
  const result = (label, target) => e.editor.calls.find(c => c.label === label && c.target === target).result;
  assert.deepEqual(result("null", "string"), { type: "string", value: "null" });
  assert.deepEqual(result("empty array", "number"), { type: "number", value: 0 });
  assert.deepEqual(result("singleton number", "number"), { type: "number", value: 12 });
  assert.deepEqual(result("two items", "number"), { type: "string", value: "1,2" });
  assert.deepEqual(result("undefined", "number"), { type: "string", value: "undefined" });
});

test("optional original official bytes bind conversion evidence to its source location", async t => {
  assert.equal(e.sourceLocations.length, 1);
  const row = e.sourceLocations[0];
  assert.equal(row.byteOffset, 1633578);
  assert.equal(row.bundleSha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
  let bytes;
  try { bytes = await fs.readFile(new URL("../dist/kn-conversion/" + row.bundle, import.meta.url)); }
  catch (err) { if (err.code === "ENOENT") return t.skip("Run kn-conversion-probe.mjs for local source bytes"); throw err; }
  const hash = x => createHash("sha256").update(x).digest("hex");
  assert.equal(hash(bytes), row.bundleSha256);
  assert.equal(hash(bytes.subarray(row.byteOffset).toString("utf8").slice(0, row.excerptCharacters)), row.excerptSha256);
});
