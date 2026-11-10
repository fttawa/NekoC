import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const hash = v => createHash("sha256").update(v).digest("hex");
const report = JSON.parse(await fs.readFile(new URL("../docs/kn-panel-ai-evidence.json", import.meta.url), "utf8"));

test("official 14 definitions distinguish fields, value sockets and declared output", () => {
  assert.equal(report.ok, true);
  assert.equal(report.offline.version, "0.27.4");
  assert.equal(report.offline.navigatorOnline, false);
  assert.equal(report.definitions.length, 14);
  assert.equal(new Set(report.definitions.map(d => d.type)).size, 14);
  for (const d of report.definitions) {
    assert.equal(Number.isInteger(d.domainIndex), true);
    if (d.type.startsWith("get_evaluate_")) {
      assert.equal(d.output, true);
      assert.deepEqual(d.outputCheck, [d.type.endsWith("name") ? "String" : "Number"]);
      assert.equal(d.previous, false);
    } else {
      assert.equal(d.output, false);
      assert.equal(d.previous && d.next, true);
    }
    const sockets = d.inputs.filter(i => i.type === 1).map(i => i.name);
    assert.deepEqual(sockets, ["ai_chat_ask", "set_system_preset"].includes(d.type) ? ["text"] : []);
  }
});

test("offline actual Promise calls preserve typed results and cache invalidation", () => {
  assert.equal(report.offline.calls.length, 19);
  for (const c of report.offline.calls) {
    assert.equal(c.promise, true, c.type);
    assert.equal(c.error, undefined, c.type);
    assert.deepEqual(c.result, c.type.startsWith("get_evaluate_") ? { type: "number", value: "NaN" } : { type: "undefined" });
    const writes = c.type === "ai_chat_ask" ? [{ key: "_ai_chat_answer_", value: { type: "string", value: "" } }]
      : c.type.startsWith("ai_text_") ? [{ key: "ai_text_result", value: { type: "number", value: "NaN" } }] : [];
    assert.deepEqual(c.writes, writes, c.type);
  }
  assert.deepEqual(report.pageErrors, []);
});

test("every requested block has official source metadata without third-party bodies", () => {
  for (const d of report.definitions) {
    const l = report.locations.find(l => l.symbol === d.type);
    assert.ok(l, d.type);
    assert.equal(l.bundleSha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
    assert.equal(Number.isInteger(l.byteOffset), true);
    assert.match(l.excerptSha256, /^[a-f0-9]{64}$/);
    assert.equal(d.runtimeSource, undefined);
  }
  assert.equal(report.locations.find(l => l.symbol === "chat_guard").byteOffset, 1601837);
});

test("optional local original bundle matches all byte offsets and snippet hashes", async t => {
  let bytes;
  try { bytes = await fs.readFile(new URL("../dist/kn-panel-ai/main.8ccf2442.js", import.meta.url)); }
  catch (e) { if (e.code === "ENOENT") return t.skip("ignored official bundle not present"); throw e; }
  assert.equal(hash(bytes), report.locations[0].bundleSha256);
  for (const l of report.locations) {
    const source = bytes.subarray(l.byteOffset).toString("utf8");
    assert.equal(hash(source.slice(0, l.excerptCharacters)), l.excerptSha256, l.symbol);
  }
});
