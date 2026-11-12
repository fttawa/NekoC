import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { attributes, fixture, projects, validateInspection } from "../tools/compat/kn-partial2-appearance-probe.mjs";
import { validateObservation, matchingEditorCheck } from "../tools/semantics-kitten-n.mjs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const report = JSON.parse(read("docs/kn-partial2-appearance-official.json"));
const generated = projects(JSON.parse(read("samples/kitten-n-0.27.4.bcmkn")));

test("original appearance fixtures have complete paired KN 0.27.4 evidence and editor approval", () => {
  assert.equal(report.officialUrl, "https://kn.codemao.cn/editor");
  assert.equal(report.editorCompat.ok, true);
  assert.equal(report.editorCompat.projects.length, 2);
  for (const kind of ["talk", "think"]) {
    const bytes = read(fixture(kind)), p = JSON.parse(bytes), r = report.cases[kind];
    assert.equal(bytes, JSON.stringify(generated[kind], null, 2) + "\n");
    assert.equal(r.fixture, fixture(kind));
    assert.equal(r.sha256, createHash("sha256").update(bytes).digest("hex"));
    validateObservation(r, p);
    validateInspection(kind, r);
    assert.equal(r.mainBundle.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
    assert.equal(r.runtimeBundle.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
    assert.equal(r.inspection.version, "0.27.4");
    assert.ok(report.editorCompat.projects.some(p => p.editorVersion === "0.27.4" && matchingEditorCheck(p, r)));
    for (const target of ["self", "actor"]) {
      for (const [attribute, expected] of Object.entries({x:1.23,y:-2.35,scale:123.46,width:123.46,height:56.79,direction:25.71,color:349.88,opacity:12.34,brightness:12.35,pixelate:12.35,ripple:12.35,distortion:12.35,grayscale:12.35,style_index:1})) {
        assert.equal(r.variables[`${target}_${attribute}`], expected);
      }
    }
    assert.deepEqual(r.inspection.invalidSelfDistance, { $number: "NaN" });
    assert.equal(r.variables.actor_distance, 0);
  }
});

test("archive gate rejects incomplete dialog and alias observations", () => {
  const valid = report.cases.talk;
  const noDialog = structuredClone(valid);
  noDialog.inspection.dialog.present = false;
  assert.throws(() => validateInspection("talk", noDialog));
  const missingAlias = structuredClone(valid);
  missingAlias.inspection.conversions.pop();
  assert.throws(() => validateInspection("talk", missingAlias));
  const wrongAlias = structuredClone(valid);
  wrongAlias.inspection.conversions[0].type = "get_sprite_property";
  assert.throws(() => validateInspection("talk", wrongAlias));
});

test("official code API conversion is separately observed, not misrepresented as an alias block", () => {
  for (const r of Object.values(report.cases)) {
    assert.equal(r.inspection.registeredAlias, false);
    assert.deepEqual(r.inspection.conversions.map(c => c.attribute), attributes);
    for (const c of r.inspection.conversions) {
      assert.deepEqual(c.errors, []);
      assert.deepEqual(c.warnings, []);
      assert.equal(c.fields.sprite, "--self");
      if (["x", "y"].includes(c.attribute)) { assert.equal(c.type, "coordinate_of_sprite"); assert.equal(c.fields.coordinate, c.attribute); }
      else if (c.attribute === "style_index") assert.equal(c.type, "style_of_sprite");
      else if (["scale", "width", "height", "direction"].includes(c.attribute)) { assert.equal(c.type, "appearance_of_sprite"); assert.equal(c.fields.appearance, c.attribute); }
      else if (c.attribute === "distance") assert.equal(c.type, "distance_to");
      else { assert.equal(c.type, "effect_of_sprite"); assert.equal(c.fields.effect, String(attributes.indexOf(c.attribute) - 7)); }
    }
  }
});

test("real project dialog remains present after the following statements execute", () => {
  for (const [kind, r] of Object.entries(report.cases)) {
    assert.equal(r.variables.after_dialog, 1);
    assert.equal(r.inspection.afterDialog, 1);
    assert.deepEqual(r.inspection.dialog, { present: true, type: kind === "talk" ? "saying" : "thinking", text: kind === "talk" ? "original\u00a0talk\u00a0text" : "界".repeat(90) + "..." });
  }
});

test("typed dialog inputs are separate real-actor domain calls, not project variables", () => {
  for (const r of Object.values(report.cases)) {
    assert.deepEqual(r.inspection.dialogCalls.map(c => [c.label, c.dialog.text]), [
      ["empty", ""], ["number", "42"], ["boolean", "true"],
      ["list", "1,a\u00a0b"], ["object", "[object\u00a0Object]"],
    ]);
  }
});
