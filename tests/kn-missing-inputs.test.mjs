import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { missingInputsProject } from "../tools/kn-missing-inputs.mjs";

test("official KN missing arithmetic slots are NaN, not synthesized zero shadows", async () => {
  const report = JSON.parse(await readFile(new URL("../docs/kn-missing-inputs-official.json", import.meta.url), "utf8"));
  const source = JSON.stringify(missingInputsProject(), null, 2) + "\n";
  assert.equal(report.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(report.ok, true);
  assert.deepEqual(report.pageErrors, []);
  assert.ok(report.runtimeBundle.sha256);
  assert.ok(report.mainBundle.sha256);
  assert.equal(report.editorCompat.ok, true);
  const checked = report.editorCompat.projects[0];
  assert.equal(checked.sha256, report.sha256);
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.pageErrors, []);
  assert.equal(checked.ok, true);
  assert.equal(report.variables.done, 1);
  for (const op of ["add", "minus", "multiply", "divide", "power"]) {
    for (const slot of ["A", "B", "both"]) assert.deepEqual(report.variables[`${op}_${slot}`], { $number: "NaN" });
  }
});
