import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures, validateOfficial } from "../tools/semantics-kn-value-types.mjs";

const evidenceUrl = new URL("../docs/kn-value-types-official.json", import.meta.url);
const evidence = async () => JSON.parse(await readFile(evidenceUrl, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("value-type fixtures are deterministic, unique-ID native KN projects", async () => {
  const cases = fixtures();
  assert.deepEqual(fixtures(), cases);
  for (const [name, project] of Object.entries(cases)) {
    const bytes = await readFile(new URL(`./fixtures/kn-value-types/${name}.bcmkn`, import.meta.url));
    assert.deepEqual(JSON.parse(bytes), project);
    assert.equal(project.toolType, "KN");
    const ids = new Set();
    const walk = value => {
      if (!value || typeof value !== "object") return;
      if (value.type && value.id?.startsWith("knvt-")) {
        assert.ok(!ids.has(value.id), `${name}: duplicate ${value.id}`);
        ids.add(value.id);
      }
      Object.values(value).forEach(walk);
    };
    walk(project);
    assert.ok(ids.size >= 15);
  }
});

test("official evidence is tied to exact fixtures and passing editor checks", async () => {
  const report = await evidence();
  validateOfficial(report, fixtures(), report.editorCompat);
  for (const result of Object.values(report.cases)) {
    assert.equal(hash(await readFile(new URL(`../${result.fixture}`, import.meta.url))), result.sha256);
  }
  for (const change of [
    r => { delete r.cases["initial-lists"].variables.first; },
    r => { r.cases["initial-lists"].sha256 = "stale"; },
    r => { r.cases["initial-lists"].fixture = "other.bcmkn"; },
    r => { r.cases["initial-lists"].pageErrors.push("runtime failure"); },
    r => { delete r.cases["initial-lists"].runtimeBundle; },
    r => { r.editorCompat.projects[0].sha256 = "stale"; },
  ]) {
    const altered = structuredClone(report);
    change(altered);
    assert.throws(() => validateOfficial(altered, fixtures(), altered.editorCompat));
  }
});

test("official list and conversion observations preserve types, not display text alone", async () => {
  const { cases } = await evidence();
  assert.equal(cases["initial-lists"].variables.first, "1");
  assert.equal(cases["initial-lists"].variables.worldFirst, "3333333333333333");
  assert.deepEqual(cases["initial-lists"].variables.source, cases["initial-lists"].variables.copied);
  assert.deepEqual(cases["runtime-lists"].variables.runtime, ["1", "33333333333333333", 1]);
  const nested = cases["nested-conversion"].variables;
  for (const id of ["joined", "convertedText", "convertedNumber"]) assert.equal(nested[id], "1,猫,2,3");
  assert.equal(nested.singletonNumber, 2);
  assert.deepEqual(cases["missing-object"].variables, {
    done: 1, object: {}, missing: 0, missingText: "", missingNumber: "undefined",
    runtime: [{ $undefined: true }], listMissing: { $number: "NaN" },
  });
});

test("exact original projects confirm the disputed initial list types", async () => {
  const { originalInputs } = await evidence();
  assert.equal(originalInputs.ok, true);
  for (const result of Object.values(originalInputs.cases)) {
    assert.equal(hash(await readFile(new URL(`../${result.fixture}`, import.meta.url))), result.sha256);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.matchesSource, true);
  }
  const eisei = originalInputs.cases.eisei.lists["kn-list-ep_bank_color"];
  assert.equal(eisei.length, 1435);
  assert.equal(eisei.head[0], "1");
  assert.deepEqual(eisei.headTypes, ["string", "string", "string"]);
  const world = originalInputs.cases.pencraft.lists["kn-list-world"];
  assert.equal(world.length, 192);
  assert.equal(world.head[0], "3333333333333333");
  assert.deepEqual(world.headTypes, ["string", "string", "string"]);
});

test("list_item converts undefined, but not explicit null, for indexed and last reads", async () => {
  const { cases } = await evidence();
  const actual = cases["nullish-list-item"].variables;
  assert.deepEqual(actual.nullSource, [null]);
  assert.deepEqual(actual.runtime, [{ $undefined: true }]);
  for (const id of ["nullAny", "nullLast"]) assert.equal(actual[id], 0);
  for (const id of ["nullAnyText", "nullLastText", "directMissingText", "nullListText", "undefinedListText"]) assert.equal(actual[id], "");
  for (const id of ["undefinedAny", "undefinedLast"]) assert.deepEqual(actual[id], { $number: "NaN" });
  for (const id of ["undefinedAnyText", "undefinedLastText"]) assert.equal(actual[id], "NaN");
});
