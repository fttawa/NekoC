import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { conversionProjects, validateArchive } from "../tools/compat/kn-partial-conversion-probe.mjs";
import { matchingVariables } from "../tools/semantics-kitten-n.mjs";

const evidence = JSON.parse(await fs.readFile(new URL("../docs/kn-partial-conversion.json", import.meta.url), "utf8"));
const expected = {
  graphs: {
    self: [0, "", true], self_tail: ["1,", "1,", true], mutual: ["1,2,", "1,2,", true],
    shared: ["7,7", "7,7", true], object_cycle: ["[object Object]", "[object Object]", true],
    array_object: ["[object Object]", "[object Object]", true], object_shadow_valueof: ["[object Object]", "[object Object]", true],
  },
  deep: Object.fromEntries([127, 128, 129, 256].map(depth => [`depth${depth}`, [7, "7", true]])),
  values: {
    null_undefined: [",", ",", true], nested_null: [0, "", true], nan_array: ["NaN", "NaN", true],
    numeric_nan_array: ["NaN", "NaN", true], empty_object: ["[object Object]", "[object Object]", true],
    object_json: ["[object Object]", "[object Object]", true],
  },
};
const targets = ["number", "string", "boolean"];

test("51 exact typed native results are complete, paired and bound to matching editor-checked fixture bytes", async () => {
  assert.equal(evidence.schema, "nekoc-kn-partial-conversion-v1");
  assert.equal(evidence.officialUrl, "https://kn.codemao.cn/editor");
  assert.equal(evidence.ok, true);
  assert.equal(evidence.nativeDifferentialVerified, true);
  assert.deepEqual(Object.keys(evidence.cases).sort(), ["deep", "graphs", "values"]);
  assert.equal(evidence.editorCompat.ok, true);
  assert.equal(evidence.editorCompat.projects.length, 3);
  assert.match(evidence.pairing.binarySha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(evidence.pairing.comparedAt)));
  const projects = conversionProjects();
  let count = 0;
  for (const [name, rows] of Object.entries(expected)) {
    const result = evidence.cases[name];
    assert.equal(result.fixture, `tests/fixtures/kn-partial-conversion/${name}.bcmkn`);
    const bytes = await fs.readFile(new URL(`../${result.fixture}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), result.sha256);
    assert.equal(bytes.toString(), JSON.stringify(projects[name], null, 2) + "\n");
    const variables = { a: 0, b: 0, done: 1 };
    for (const [label, values] of Object.entries(rows)) targets.forEach((target, i) => { variables[`${label}_${target}`] = values[i]; count++; });
    assert.deepEqual(result.variables, variables, name);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.equal, true);
    assert.equal(matchingVariables(result.variables, result.nekoc.variables), true);
    assert.equal(result.mainBundle.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
    assert.equal(result.runtimeBundle.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
    const checks = evidence.editorCompat.projects.filter(p => p.input === result.fixture);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].sha256, result.sha256);
    assert.equal(checks[0].editorVersion, "0.27.4");
    assert.equal(checks[0].projectVersion, "0.27.4");
    assert.equal(checks[0].ok, true);
    assert.deepEqual(checks[0].issues, []);
    assert.deepEqual(checks[0].pageErrors, []);
  }
  assert.equal(count, 51);
  assert.deepEqual(evidence.editorCompat.projects.map(p => p.blockCount), [133, 83, 86]);
  // Regression: unwarped graph construction needs 640 frames, but kn-trace
  // runs only 180. Do not "fix" unfinished observations by accepting done=0.
  const deep = Object.values(projects.deep.actors.actorsDict)[0].nekoBlockJsonList[0];
  const warps = [];
  for (let block = deep; block; block = block.next) if (block.type === "warp") warps.push(block);
  assert.deepEqual(warps.map(block => block.statements.DO.inputs.times.fields.NUM), ["127", "128", "129", "256"]);
  assert.ok(warps.every(block => block.statements.DO.type === "repeat_n_times"));
});

test("45 local calls enumerate the exact 15-by-3 typed/error matrix without runtime bodies", () => {
  assert.equal(evidence.local.editorVersion, "0.27.4");
  assert.equal(evidence.local.calls.length, 45);
  const rows = { ...expected.graphs, ...expected.deep,
    object_shadow_tostring: [null, null, true], object_shadow_both: [null, null, true],
    array_shadow_tostring: [null, null, true], object_own_valueof_callable: [17, "[object Object]", true],
  };
  assert.equal(Object.keys(rows).length, 15);
  const seen = new Set();
  for (const call of evidence.local.calls) {
    const key = `${call.label}/${call.target}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
    assert.ok(Object.hasOwn(rows, call.label), key);
    const index = targets.indexOf(call.target);
    assert.notEqual(index, -1);
    const expected = rows[call.label][index];
    if (expected === null) {
      assert.equal(call.error, "TypeError: Cannot convert object to primitive value", key);
      assert.equal(call.result, undefined);
    } else {
      assert.equal(call.error, undefined);
      assert.deepEqual(call.result, { type: typeof expected, value: expected }, key);
    }
  }
  assert.equal(seen.size, 45);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "functionSource", "modules"].includes(key));
      walk(child);
    }
  };
  walk(evidence);
});

test("archive validation rejects forged success flags, incomplete evidence and stale editor checks", async () => {
  await validateArchive(structuredClone(evidence));
  for (const mutate of [
    r => { r.cases.deep.nekoc.variables.done = 0; },
    r => { r.cases.deep.nekoc.variables.depth128_number = 0; },
    r => { r.cases.deep.equal = false; },
    r => { delete r.cases.deep; },
    r => { r.editorCompat.projects[1].sha256 = "0".repeat(64); },
    r => { r.editorCompat.projects[1].issues.push({ kind: "changed_connection" }); },
    r => { r.cases.deep.sha256 = "0".repeat(64); },
    r => { r.local.calls.pop(); },
    r => { r.local.calls[1] = r.local.calls[0]; },
    r => { delete r.pairing; },
  ]) {
    const forged = structuredClone(evidence);
    mutate(forged);
    await assert.rejects(validateArchive(forged));
  }
});
