import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures, encodeValue, validateObservation, matchingEditorCheck } from "../tools/semantics-kitten-n.mjs";

test("KN probes are reproducible native projects with unique block IDs", async () => {
  const first = fixtures();
  assert.deepEqual(fixtures(), first);
  for (const [name, project] of Object.entries(first)) {
    assert.equal(project.toolType, "KN");
    assert.deepEqual(JSON.parse(await readFile(new URL(`./fixtures/kn-semantics/${name}.bcmkn`, import.meta.url), "utf8")), project);
    const ids = new Set();
    function walk(value) {
      if (!value || typeof value !== "object") return;
      if (value.type && value.id?.startsWith("knsem-")) {
        assert.ok(!ids.has(value.id), `${name}: duplicate ${value.id}`);
        ids.add(value.id);
      }
      Object.values(value).forEach(walk);
    }
    walk(project);
    assert.ok(ids.size > 5);
    assert.equal(project.variables.variablesDict.done.value, 0);
    assert.ok(Object.values(project.variables.variablesDict).every(v => ["any", "list"].includes(v.type)));
  }
});

test("oracle encoding does not conflate non-finite numbers, text or null", () => {
  assert.deepEqual(encodeValue([NaN, Infinity, -Infinity, "NaN", null, [1]]), [
    { $number: "NaN" }, { $number: "Infinity" }, { $number: "-Infinity" }, "NaN", null, [1],
  ]);
});

test("archived official observations cover the exact checked-in fixtures", async () => {
  const report = JSON.parse(await readFile(new URL("../docs/kn-semantics-official.json", import.meta.url), "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.editorCompat.ok, true);
  assert.deepEqual(Object.keys(report.cases), Object.keys(fixtures()));
  for (const [name, result] of Object.entries(report.cases)) {
    assert.equal(result.equal, true, name);
    assert.doesNotThrow(() => validateObservation(result, fixtures()[name]));
    assert.deepEqual(result.variables, result.nekoc.variables);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.variables.done, 1);
    const bytes = await readFile(new URL(`../${result.fixture}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), result.sha256, name);
    assert.ok(result.runtimeBundle.sha256);
    assert.ok(result.mainBundle.sha256);
    assert.ok(report.editorCompat.projects.some(p => matchingEditorCheck(p, result)));
  }
});

test("archive validation rejects trusted flags with mismatched or missing evidence", async () => {
  const report = JSON.parse(await readFile(new URL("../docs/kn-semantics-official.json", import.meta.url), "utf8"));
  const result = report.cases.scheduling;
  for (const change of [
    r => { r.nekoc.variables.trace = "INTENTIONAL_MISMATCH"; },
    r => { r.pageErrors.push("runtime error"); },
    r => { delete r.variables; },
    r => { r.error = "timeout"; },
    r => { r.variables.done = 0; r.nekoc.variables.done = 0; },
    r => { delete r.runtimeBundle; },
    r => { delete r.variables.trace; delete r.nekoc.variables.trace; },
  ]) {
    const altered = structuredClone(result);
    change(altered);
    assert.throws(() => validateObservation(altered, fixtures().scheduling));
  }
  const editor = report.editorCompat.projects.find(p => p.input === result.fixture);
  assert.equal(matchingEditorCheck({ ...editor, sha256: "stale" }, result), false);
});
