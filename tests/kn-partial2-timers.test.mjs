import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { timerProjects, fixturePath, validateArchive } from "../tools/compat/kn-partial2-timers-probe.mjs";

const evidence = JSON.parse(await readFile(new URL("../docs/kn-partial2-timers-official.json", import.meta.url), "utf8"));

test("two native timer projects are paired, typed, editor-checked and bound to original fixture bytes", async () => {
  await validateArchive(evidence);
  assert.equal(evidence.officialUrl, "https://kn.codemao.cn/editor");
  assert.ok(Number.isFinite(Date.parse(evidence.verifiedAt)));
  assert.match(evidence.nekocBinary.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(evidence.cases), ["main", "clear"]);
  for (const [name, project] of Object.entries(timerProjects())) {
    const result = evidence.cases[name];
    const bytes = await readFile(new URL(`../${fixturePath(name)}`, import.meta.url));
    assert.equal(bytes.toString(), JSON.stringify(project, null, 2) + "\n");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), result.sha256);
    assert.deepEqual(result.variables, { before: 1, after: 1, callback_hits: 0, done: 1, text_delay: "25", text_id: "999999999" });
    assert.deepEqual(result.nekoc.variables, result.variables);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.mainBundle.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
    assert.equal(result.runtimeBundle.sha256, "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7");
    const checks = evidence.editorCompat.projects.filter(p => p.input === result.fixture);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].sha256, result.sha256);
    assert.equal(checks[0].editorVersion, "0.27.4");
    assert.equal(checks[0].projectVersion, "0.27.4");
    assert.deepEqual(checks[0].issues, []);
    assert.deepEqual(checks[0].pageErrors, []);
    const calls = result.nativeObservation.calls;
    if (name === "main") {
      assert.deepEqual(calls.map(c => c.type), [...Array(4).fill("setTimeout"), ...Array(4).fill("setInterval")]);
      assert.deepEqual(calls.map(c => c.delay), [0, 20, 150, "25", 0, 20, 150, "25"]);
    } else {
      assert.deepEqual(calls.map(c => c.type), ["setTimeout", "setInterval", ...Array(3).fill("clearTimeout"), ...Array(3).fill("clearInterval")]);
      for (const type of ["clearTimeout", "clearInterval"]) {
        const socket = type === "clearTimeout" ? "timeoutId" : "intervalId";
        const clearCalls = calls.filter(c => c.type === type);
        assert.deepEqual(clearCalls.map(c => c[socket]), [0, 999999999, "999999999"]);
        assert.ok(clearCalls.every(c => c.keys.join() === socket && c.result.$undefined === true));
      }
    }
  }
});

test("local function firing/cancellation evidence is not confused with dropped native callbacks", () => {
  const [fire, ...rows] = evidence.domain.rows;
  assert.equal(fire.timeout, 1);
  assert.ok(fire.intervalBeforeClear > 0);
  assert.equal(fire.intervalAfterClear, fire.intervalBeforeClear);
  assert.equal(new Set(rows.slice(0, 4).map(r => `${r.register}/${r.cancel}`)).size, 4);
  assert.ok(rows.slice(0, 4).every(r => r.fired === 0));
  assert.ok(rows.slice(4).every(r => r.executed === false));
  for (const result of Object.values(evidence.cases)) {
    for (const c of result.nativeObservation.calls.filter(c => c.type.startsWith("set"))) {
      assert.equal(c.callbackType, "undefined");
      assert.deepEqual(c.keys, ["delay"]);
    }
  }
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "functionSource", "modules", "callbackSource"].includes(key));
      walk(child);
    }
  };
  walk(evidence);
});

test("archiving refuses missing observations, false pairing and stale editor checks", async () => {
  for (const mutate of [
    r => { r.cases.main.equal = false; },
    r => { r.cases.main.nekoc.variables.callback_hits = 1; },
    r => { r.cases.main.nekoc.variables.callback_hits = r.cases.main.variables.callback_hits = 1; },
    r => { r.cases.clear.variables.done = 0; },
    r => { delete r.cases.clear; },
    r => { r.cases.clear.sha256 = "0".repeat(64); },
    r => { r.editorCompat.projects[0].sha256 = "0".repeat(64); },
    r => { r.editorCompat.projects[0].issues.push({ kind: "changed_connection" }); },
    r => { r.domain.rows.pop(); },
    r => { r.domain.rows[1].fired = 1; },
    r => { r.domain.rows[1].socket = "intervalId"; },
    r => { r.cases.clear.nativeObservation.calls[2].timeoutId = 1; },
    r => { r.cases.main.nativeObservation.calls.pop(); },
    r => { r.cases.main.nativeObservation.calls[0].callbackType = "function"; },
    r => { delete r.nekocBinary; },
  ]) {
    const bad = structuredClone(evidence);
    mutate(bad);
    await assert.rejects(validateArchive(bad));
  }
});
