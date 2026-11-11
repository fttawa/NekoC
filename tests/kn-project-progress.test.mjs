import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const evidence = JSON.parse(await fs.readFile(new URL("docs/kn-project-progress-official.json", root), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("official original progress observations bind exact editor-compatible projects", async () => {
  assert.equal(evidence.schema, "nekoc-kn-project-progress-official-v1");
  assert.equal(evidence.editorUrl, "https://kn.codemao.cn/editor");
  assert.equal(evidence.editorCompat.ok, true);
  for (const result of Object.values(evidence.cases)) {
    assert.equal(sha256(await fs.readFile(new URL(result.fixture, root))), result.sha256);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.settledPageErrors, []);
    assert.equal(result.samples.length, 7);
    const compatible = evidence.editorCompat.projects.find(p => p.sha256 === result.sha256);
    assert.equal(compatible?.ok, true);
    assert.deepEqual(compatible.issues, []);
  }
});

test("fangjie empty chunk index is observed while world initialization progresses", () => {
  const rows = evidence.cases.fangjie.samples.slice(1);
  const length = row => row.variables["kn-list-world"].length;
  assert.ok(rows.at(-1).running);
  assert.ok(length(rows.at(-1)) > length(rows[0]));
  for (const row of rows) {
    assert.equal(row.variables["kn-list-chunk_x"].length, 0);
    assert.equal(row.actors[0].position.y, 0);
  }
  assert.match(evidence.cases.fangjie.settleFailure, /Timeout 300000ms/);
  const settled = evidence.diagnostic.settled;
  assert.equal(settled.variables["kn-list-world"].length, 8);
  assert.equal(settled.variables["kn-list-chunk_x"].length, 64);
  assert.ok(settled.variables["kn-list-chunk_x"].head.every(v => v === 99999));
  assert.equal(settled.actors[0].logicalPosition.y, -65);
});

test("short-world diagnostic is explicitly separate and editor-compatible", async () => {
  assert.equal(evidence.diagnostic.originalSha256, evidence.cases.fangjie.sha256);
  assert.equal(evidence.diagnostic.editorCompat.ok, true);
  assert.deepEqual(evidence.diagnostic.pageErrors, []);
  assert.match(evidence.diagnostic.diagnosticChange, /524287 -> 7/);
});

test("tiny-lm official id stream progresses with semantic work rather than host frames", () => {
  const rows = evidence.cases["tiny-lm"].samples.slice(1);
  assert.ok(rows.some(r => r.variables["kn-list-lm_generated_ids"].length === 0));
  const final = evidence.cases["tiny-lm"].settled;
  assert.equal(final.variables["kn-var-lm_running"], 0);
  assert.equal(final.variables["kn-list-lm_generated_ids"].length, final.variables["kn-var-lm_generated"]);
  assert.deepEqual(final.variables["kn-list-lm_generated_ids"].head.slice(0, 6), [66, 15, 31, 4, 78, 58]);
});

test("native timer callback still absent from actual official domain args", () => {
  assert.ok(Object.values(evidence.timers.checks).every(Boolean));
  assert.deepEqual(evidence.timers.variables, { ready: 1, fired: 0, after: 1 });
  for (const call of evidence.timers.domainCalls) {
    assert.deepEqual(call.keys, ["delay"]);
    assert.equal(call.callbackType, "undefined");
  }
  assert.ok(evidence.timers.nativeCalls.every(c => c.isEmptyFunction));
});

test("optional official source bytes match archived source excerpts", async t => {
  for (const row of evidence.sourceLocations) {
    let bytes;
    try { bytes = await fs.readFile(new URL(`dist/kn-project-progress/${row.bundle}`, root)); }
    catch (e) { if (e.code === "ENOENT") return t.skip("Optional downloaded official bundles absent"); throw e; }
    assert.equal(sha256(bytes), row.bundleSha256);
    assert.equal(sha256(bytes.subarray(row.byteOffset).toString("utf8").slice(0, row.excerptCharacters)), row.excerptSha256);
  }
});
