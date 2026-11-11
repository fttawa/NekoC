import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateObservation, matchingEditorCheck, encodeValue } from "../tools/semantics-kitten-n.mjs";

test("object observation and editor check bind the exact independent fixture", async () => {
  const report = JSON.parse(await readFile(new URL("../docs/kn-objects-official.json", import.meta.url)));
  assert.equal(report.ok, true);
  for (const result of Object.values(report.cases)) {
  const bytes=await readFile(new URL(`../${result.fixture}`,import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),result.sha256);
  assert.doesNotThrow(()=>validateObservation(result,JSON.parse(bytes)));
  assert.ok(report.editorCompat.projects.some(p=>matchingEditorCheck(p,result)));
  }
  assert.deepEqual(encodeValue({a:[undefined,NaN,Infinity,null]}),{a:[{$undefined:true},{$number:"NaN"},{$number:"Infinity"},null]});
});
