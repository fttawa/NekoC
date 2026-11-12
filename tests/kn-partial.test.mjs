import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { cloneProject, fixture } from "../tools/compat/kn-partial-probe.mjs";
import { validateObservation, matchingEditorCheck } from "../tools/semantics-kitten-n.mjs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("KN partial native fixture has complete paired 0.27.4 official evidence", () => {
  const bytes = read(fixture), project = JSON.parse(bytes);
  assert.equal(bytes, JSON.stringify(cloneProject(JSON.parse(read("samples/kitten-n-0.27.4.bcmkn"))), null, 2) + "\n");
  const report = JSON.parse(read("docs/kn-partial-official.json"));
  const result = report.result;
  validateObservation(result, project);
  assert.equal(result.fixture, fixture);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.mainBundle.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
  assert.equal(result.runtimeBundle.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
  assert.equal(report.editorCompat.ok, true);
  assert.equal(report.editorCompat.projects.length, 1);
  assert.equal(report.editorCompat.projects[0].editorVersion, "0.27.4");
  assert.ok(matchingEditorCheck(report.editorCompat.projects[0], result));
  const expected = { x: 1.23, y: -2.35, scale: 123.46, width: 123.46, height: 56.79,
    direction: 25.71, style_index: 1, 0: 349.88, 1: 12.34, 2: 12.35, 3: 12.35, 4: 12.35, 5: 12.35, 6: 12.35 };
  for (const [property, value] of Object.entries(expected)) for (const index of [0, 1]) {
    assert.equal(result.variables[`p_${property}_${index}`], value);
  }
  assert.equal(result.variables.local_0, 99);
  assert.equal(result.variables.local_1, 42);
  for (const name of ["text", "bool", "fraction", "missing", "negative"]) {
    assert.deepEqual(result.variables[`${name}_index`], { $number: "NaN" });
  }
  for (let target = 0; target < 3; target++) for (const state of ["down", "click", "up"]) {
    assert.equal(result.variables[`mouse_${target}_${state}`], false);
  }
});

test("KN partial local calls and held pointer evidence remain separate from native result", () => {
  const { result } = JSON.parse(read("docs/kn-partial-official.json"));
  assert.equal(result.domainCalls.length, 8);
  for (const call of result.domainCalls) {
    assert.deepEqual(call.result, call.type === "mouse_down" ? false : call.scene ? { $undefined: true } : { $number: "NaN" });
  }
  assert.deepEqual(result.pointerSamples.map(s => s.label), ["before", "held", "released"]);
  assert.equal(result.pointerSamples[0].values["--screen:down"], false);
  assert.equal(result.pointerSamples[1].values["--screen:down"], true);
  assert.equal(result.pointerSamples[2].values["--screen:down"], false);
});
