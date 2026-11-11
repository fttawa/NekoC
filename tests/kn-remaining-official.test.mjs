import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const evidence = JSON.parse(await fs.readFile(new URL("../docs/kn-remaining-official-evidence.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
test("frozen 45 names each have independent official classification", () => {
  assert.equal(evidence.names.length, 45);
  assert.equal(new Set(evidence.names).size, 45);
  assert.deepEqual(evidence.blocks.map(b => b.name), evidence.names);
  assert.equal(evidence.editor.version, "0.27.4");
  assert.equal(evidence.ok, true);
  assert.ok(Object.values(evidence.checks).every(Boolean));
});
for (const block of evidence.blocks) test(`official remaining: ${block.name}`, () => {
  const cases = evidence.editor.cases.filter(c => c.name === block.name);
  if (block.kind === "event") {
    assert.ok(evidence.editor.events.some(e => e.id === block.name));
    assert.equal(block.eventBodyExecuted, false);
    return;
  }
  if (block.kind === "code-api") {
    assert.equal(block.definitionRegistered, false);
    assert.equal(block.domainIndex, null);
    assert.ok(evidence.editor.conversions.some(c => c.property === "x" && c.types.includes("coordinate_of_sprite") && c.errors.length === 0));
    assert.ok(evidence.editor.conversions.some(c => c.property === "size" && c.errors.length > 0));
    return;
  }
  if (block.name === "get_voice_volume") {
    assert.equal(cases.find(c => c.label === "fresh-default").pendingAfterMs, 3000);
    assert.deepEqual(cases.find(c => c.label === "record-disabled").result, { type: "number", value: "NaN" });
    assert.equal(evidence.native.variablesFinal["voice:value"], "NaN");
    assert.deepEqual(evidence.voicePermission.modalDenied.result, { type: "number", value: 0 });
    assert.deepEqual(evidence.voicePermission.browserDenied.result, { type: "number", value: 0 });
    assert.equal(evidence.voicePermission.browserDenied.gum[0].errorName, "NotAllowedError");
    assert.equal(evidence.voicePermission.browserDenied.domainErrors, 1);
    assert.equal(evidence.voicePermission.browserDenied.permission, false);
    return;
  }
  const defaults = cases.find(c => c.label === "defaults");
  assert.equal(defaults.promise, true);
  assert.deepEqual(defaults.result, block.kind === "reporter" ? { type: "number", value: "NaN" } : { type: "undefined" });
  assert.equal(block.nativeCall.frame, 0);
  assert.equal(block.nativeCall.settledFrame, 1);
  assert.equal(block.nativeCall.settledInsideUpdate, false);
  assert.equal(block.nativeAfterFrame, 1);
  assert.ok(cases.every(c => c.sideEffects.actions === 0 && c.sideEffects.domainErrors === 0 && c.sideEffects.hardwareIds.length === 0));
  assert.ok(cases.filter(c => c.error).every(c => c.errorPhase === "rejection"));
});
test("nested reporters await sequentially, synchronous control does not", () => {
  const [a, b] = evidence.nativeFixture.nestedCallIds.map(id => evidence.native.calls.find(c => c.blockId === id));
  assert.equal(a.frame, 0);
  assert.equal(b.frame, 1);
  assert.equal(evidence.native.variables.find(v => v.variable === "nested:after").frame, 2);
  assert.equal(evidence.native.variables.find(v => v.variable === "sync:after").frame, 0);
  assert.equal(evidence.nativeSetup.editorCompat.ok, true);
  assert.deepEqual(evidence.pageErrors, []);
});
test("local official source anchors and authored fixture hashes, when retained", async t => {
  let checked = 0;
  for (const source of evidence.sourceLocations) {
    let bytes;
    try { bytes = await fs.readFile(new URL(`../dist/kn-remaining-official/${source.bundle}`, import.meta.url)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    assert.equal(hash(bytes), source.bundleSha256);
    assert.equal(hash(bytes.subarray(source.byteOffset).toString("utf8").slice(0, source.excerptCharacters)), source.excerptSha256, source.symbol);
    checked++;
  }
  if (!checked) t.skip("Official bundles only retained in ignored dist; no local source hash verification");
  else assert.equal(checked, evidence.sourceLocations.length);
});
