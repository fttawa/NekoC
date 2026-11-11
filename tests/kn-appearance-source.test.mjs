// Default gate uses only committed original observations, never ignored downloads.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const evidence = JSON.parse(fs.readFileSync(new URL("../docs/kn-appearance-evidence.json", import.meta.url)));
const hashes = [
  "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165",
  "38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68",
  "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7",
];
test("committed official identities and source locations", () => {
  assert.deepEqual(evidence.bundles.map(b => b.sha256), hashes);
  for (const b of evidence.bundles) assert.match(b.url, /^https:\/\/creation\.bcmcdn\.com\/neko\/web\/release\/static\/js\//);
  assert.equal(evidence.sourceLocations.length, 9);
  for (const loc of evidence.sourceLocations) {
    assert.ok(Number.isSafeInteger(loc.byteOffset) && loc.byteOffset > 0);
    assert.ok(evidence.bundles.some(b => path.basename(new URL(b.url).pathname) === loc.bundle));
  }
  assert.deepEqual(evidence.sourceLocations.slice(0, 4).map(l => l.byteOffset), [1897852, 1569626, 1667073, 1560338]);
});
test("committed registration and conversion observations", () => {
  const o = evidence.observations;
  assert.deepEqual(o.pageErrors, []);
  assert.deepEqual(o.registered, { appearance_of_sprite: true, self_dialog_wait: true, get_sprite_property: false, procedures_2_actor_param: true });
  assert.match(o.unregisteredError, /Unknown block type get_sprite_property/);
  assert.equal(o.conversions[0].blockType, "appearance_of_sprite");
  assert.equal(o.conversions[0].appearance, "height");
  assert.deepEqual(o.conversions[0].errors, []);
  assert.equal(o.conversions[1].unsupportedAttribute, "camp");
  assert.equal(o.conversions[1].errorCount, 1);
});
test("committed real official property and bubble helper observations", () => {
  const o = evidence.observations;
  assert.deepEqual(o.propertyInput.scale, { x: 1.23456, y: 0.56789 });
  assert.deepEqual(o.properties, { 1: 100, x: 1.23, y: -2.35, scale: 123.46, width: 123.46, height: 56.79, direction: 25.71 });
  assert.deepEqual(o.dialog.tasks, [{ lifetime: 250, blocking: true }]);
  assert.deepEqual(o.dialog.calls, [["probe-actor", "a\u00a0b", "saying"], ["probe-actor", "x".repeat(90) + "...", "thinking"], ["probe-actor", "timed", "saying"]]);
});

// Explicit opt-in: downloading/running the browser probe is never a test side effect.
const local = process.env.KN_APPEARANCE_LOCAL_DIR || "dist/kncat";
const optedIn = process.env.KN_APPEARANCE_LOCAL === "1";
test("optional downloaded bundle identity and source anchors", { skip: !optedIn }, () => {
  for (const b of evidence.bundles) {
    const file = path.join(local, path.basename(new URL(b.url).pathname));
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), b.sha256);
  }
  const source = fs.readFileSync(path.join(local, "main.8ccf2442.js"));
  for (const [offset, anchor] of [
    [1897852, "function _(e,t){var n,i,o,c,u=!1"],
    [1569626, "function B(e,t,n,r,i,a,o)"],
    [1667073, "ACTOR_PARAM,(function(e,t,n,i,a,o)"],
    [1560338, ".getCloneIndexProperty,(function"],
  ]) assert.equal(source.subarray(offset, offset + Buffer.byteLength(anchor)).toString(), anchor);
});
test("optional local browser report agrees with committed observations", { skip: !optedIn }, () => {
  const report = JSON.parse(fs.readFileSync(path.join(local, "appearance-dialog-oracle.json")));
  const t = report.tests, o = evidence.observations;
  assert.deepEqual(report.pageErrors, o.pageErrors);
  assert.deepEqual(Object.fromEntries(Object.entries(t.registered).map(([k, v]) => [k, v.ok])), o.registered);
  assert.equal(t.registered.get_sprite_property.error, o.unregisteredError);
  assert.deepEqual(t.properties, o.properties);
  assert.deepEqual(t.dialog, o.dialog);
  assert.match(t.conversions[0].result.xml, /type="appearance_of_sprite"/);
  assert.match(t.conversions[0].result.xml, /name="appearance">height</);
  assert.deepEqual(t.conversions[0].result.errors, []);
  assert.equal(t.conversions[1].result.errors.length, o.conversions[1].errorCount);
});
