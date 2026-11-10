// Tracked observations always checked; optional local official bytes never committed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const out = new URL("dist/kn-async-services/", root);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const expected = {
  "main.8ccf2442.js": "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165",
  "main-vendors.07f7dd7e.js": "38183ab8a9620f33fef75f1bd1f90ee26b492e7b6ded8b6b065fc052e7948f68",
  "crc_libs.8196dbd1.js": "462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7",
};
const evidence = JSON.parse(await fs.readFile(new URL("docs/kn-async-services-evidence.json", root), "utf8"));

test("tracked KN evidence binds a valid original fixture to official observations", async () => {
  assert.equal(evidence.schema, "nekoc-kn-async-services-official-v1");
  assert.equal(evidence.editorVersion, "0.27.4");
  const bytes = await fs.readFile(new URL(evidence.fixture.path, root));
  assert.equal(sha256(bytes), evidence.fixture.sha256);
  assert.equal(evidence.editorCompat.ok, true);
  assert.equal(evidence.editorCompat.project.ok, true);
  assert.equal(evidence.editorCompat.project.input, evidence.fixture.path);
  assert.equal(evidence.editorCompat.project.sha256, evidence.fixture.sha256);
  assert.equal(evidence.editorCompat.project.blockCount, 13);
  assert.deepEqual(evidence.editorCompat.project.issues, []);
  assert.deepEqual(evidence.editorCompat.project.pageErrors, []);
  for (const b of evidence.bundles) assert.equal(b.sha256, expected[b.name]);
  assert.equal(evidence.sourceLocations.length, 24);
  for (const row of evidence.sourceLocations) {
    assert.equal(row.bundleSha256, expected[row.bundle]);
    assert.ok(Number.isInteger(row.byteOffset) && row.byteOffset > 0);
    assert.match(row.excerptSha256, /^[a-f0-9]{64}$/);
    assert.equal(row.excerptCharacters, 500);
  }
  assert.equal(evidence.ok, true);
  assert.ok(Object.values(evidence.checks).every(Boolean));
  assert.deepEqual(evidence.pageErrors, []);
  // Archive contains metadata and authored observations, never module/function bodies.
  const forbidden = new Set(["source", "callbackSource", "anchor", "modules", "runtimeFunctions", "text"]);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      // Service arguments legitimately include an authored text query.
      if (key !== "args") assert.ok(!forbidden.has(key), key);
      if (key !== "args") walk(child);
    }
  };
  walk(evidence);
});

test("tracked timer evidence preserves sockets but explicitly does not execute native callbacks", async () => {
  const fixture = JSON.parse(await fs.readFile(new URL(evidence.fixture.path, root), "utf8"));
  const blocks = new Map();
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (node.type) blocks.set(node.id, node);
    Object.values(node).forEach(walk);
  };
  walk(fixture.actors);
  for (const [name, id, callbackId] of [["setTimeout", "kn-services-4", "kn-services-6"], ["setInterval", "kn-services-8", "kn-services-10"]]) {
    const row = evidence.availability[name];
    assert.equal(row.output, false);
    assert.equal(row.previous, true);
    assert.equal(row.next, true);
    assert.equal(row.sockets.find(i => i.name === "callback").type, 3);
    assert.equal(row.sockets.find(i => i.name === "delay").type, 1);
    assert.equal(evidence.timerTypes[name].returnType, "void");
    assert.equal(blocks.get(id).inputs.callback.id, callbackId);
    assert.equal(blocks.get(id).statements, undefined);
    assert.deepEqual(evidence.workspaceImport.find(b => b.id === id), {
      id, type: name, callbackId, callbackType: "variables_set", callbackInputType: 3, callbackVariable: "fired",
    });
    const call = evidence.projectTimer.domainCalls.find(c => c.name === name);
    assert.deepEqual(call.keys, ["delay"]);
    assert.equal(call.callbackType, "undefined");
    assert.equal(call.delay, 137);
  }
  assert.deepEqual(evidence.projectTimer.variables, { ready: 1, fired: 0, after: 1 });
  assert.ok(evidence.projectTimer.nativeCalls.every(c => c.isEmptyFunction));
  const direct = evidence.directTimerCalls;
  assert.equal(direct.timeoutCount, 1);
  assert.ok(direct.intervalCount > 1);
  assert.equal(direct.intervalCount, direct.afterClear);
  assert.equal(direct.canceledCount, 0);
  assert.ok(direct.ids.every(id => id.type === "number" && id.value > 0));
  assert.deepEqual(direct.clearReturn, { type: "undefined" });
  assert.deepEqual(direct.clearIntervalReturn, { type: "undefined" });
  assert.equal(direct.textCallback.executed, false);
  for (const input of ["setTimeout(handler, 100);", "setTimeout('text', 100);"]) {
    assert.equal(evidence.conversionObservations.find(c => c.input === input).callbackStatement, false);
  }
  assert.equal(evidence.localComparison.fixtureSha256, evidence.fixture.sha256);
  assert.equal(evidence.localComparison.equalVariables, true);
  assert.deepEqual(evidence.localComparison.observation.variables, evidence.projectTimer.variables);
});

test("tracked services preserve typed unavailable values instead of blanket zero stubs", () => {
  const result = name => evidence.serviceCalls.find(c => c.name === name).result;
  assert.deepEqual(result("username_get"), { type: "string", value: "未登录用户" });
  assert.deepEqual(result("user_id_get"), { type: "string", value: "0" });
  assert.deepEqual(result("get_voice_answer"), { type: "string", value: "" });
  for (const name of ["get_position_of_body_part", "get_appearance_of_part", "get_tilt_angle_of_face", "check_gender", "check_emotion", "check_face_shape"]) {
    assert.deepEqual(result(name), { type: "number", value: "NaN" }, name);
  }
  for (const name of ["recognize_body_part", "recognize_gesture", "bump_into_body_part", "check_tilt_direction_of_face"]) {
    assert.deepEqual(result(name), { type: "boolean", value: false }, name);
  }
  assert.deepEqual(result("get_voice_volume"), { pending: true });
  // Helper undefined is not a proven block reporter zero or command no-op.
  assert.ok(evidence.hardwareCoreChecks.length >= 5);
  assert.ok(evidence.hardwareCoreChecks.every(c => c.type === "undefined"));
  assert.ok(evidence.hardwareCalls.length >= 15);
  assert.ok(evidence.hardwareCalls.every(c => c.registeredDomain === false));
});

test("optional downloaded official bytes match tracked source locations", async t => {
  for (const [name, hash] of Object.entries(expected)) {
    let bytes;
    try { bytes = await fs.readFile(new URL(name, out)); }
    catch (e) {
      if (e.code === "ENOENT") return t.skip("Optional: run official probe to retain source bytes in dist");
      throw e;
    }
    assert.equal(sha256(bytes), hash, name);
    for (const row of evidence.sourceLocations.filter(l => l.bundle === name)) {
      assert.equal(sha256(bytes.subarray(row.byteOffset).toString("utf8").slice(0, row.excerptCharacters)), row.excerptSha256);
    }
  }
});
