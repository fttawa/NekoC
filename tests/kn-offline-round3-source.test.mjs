// Authored observations, optional verification of original third-party bytes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const evidence = JSON.parse(await fs.readFile(new URL("docs/kn-offline-round3-evidence.json", root), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const calls = (name, phase = "initial") => evidence.editor.calls.filter(c => c.name === name && c.phase === phase);

test("round 3 archive binds original official bytes and excludes third-party bodies", () => {
  assert.equal(evidence.schema, "nekoc-kn-offline-round3-v1");
  assert.equal(evidence.editor.version, "0.27.4");
  assert.equal(evidence.editorUrl, "https://kn.codemao.cn/editor");
  assert.equal(evidence.ok, true);
  assert.ok(Object.values(evidence.checks).every(Boolean));
  assert.deepEqual(evidence.pageErrors, []);
  const main = evidence.bundles.find(b => b.name === "main.8ccf2442.js");
  assert.equal(main.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
  assert.equal(main.url, "https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js");
  assert.equal(evidence.sourceLocations.length, 21);
  for (const row of evidence.sourceLocations) {
    assert.equal(row.bundleSha256, main.sha256);
    assert.equal(row.bundleUrl, main.url);
    assert.ok(row.byteOffset > 0 && row.excerptCharacters >= 500);
    assert.match(row.excerptSha256, /^[0-9a-f]{64}$/);
  }
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["source", "runtimeFunctions", "modules", "anchor"].includes(key), key);
      walk(child);
    }
  };
  walk(evidence);
});

test("field-only empty-cache reporters preserve NaN and text types", () => {
  for (const name of ["ai_chat_answer", "ai_text_result", "get_face_detection_result", "get_object_detection_result", "check_gender", "check_emotion", "check_face_shape"]) {
    const block = evidence.editor.availability[name];
    assert.equal(block.registered, true, name);
    assert.equal(block.output, true, name);
    assert.ok(block.inputs.every(i => i.type !== 1 && i.type !== 3), name + " must not discard input evaluation");
    const rows = calls(name);
    assert.ok(rows.length > 0);
    for (const c of rows) {
      assert.deepEqual(c.result, name === "ai_chat_answer" ? { type: "string", value: "" } : { type: "number", value: "NaN" }, name);
      assert.equal(c.cacheReads.length, 1, name);
      assert.ok(!c.error && !c.result.pending, name);
    }
  }
  assert.deepEqual(calls("get_face_detection_result").map(c => c.args.type), ["age", "emotion", "gender", "faceShape", "not-a-field"]);
  assert.deepEqual(calls("get_face_detection_result", "seeded").map(c => c.result), [{ type: "number", value: 12 }, { type: "string", value: "男生" }, { type: "string", value: "高兴" }, { type: "string", value: "方脸" }]);
  for (const name of ["check_gender", "check_emotion", "check_face_shape"]) assert.deepEqual(calls(name, "seeded")[0].result, { type: "boolean", value: true });
  assert.deepEqual(calls("ai_chat_answer", "seeded")[0].result, { type: "string", value: "probe chat" });
  assert.deepEqual(calls("get_object_detection_result", "seeded")[0].result, { type: "string", value: "probe object" });
});

test("OCR named argument adapter is actually exercised; empty string is not absent cache", () => {
  const block = evidence.editor.availability.ai_text_result_check;
  assert.ok(block.inputs.some(i => i.type === 1 && i.name === "text"));
  assert.ok(block.inputs.flatMap(i => i.fields).some(f => f.name === "options"));
  assert.equal(calls("ai_text_result_check").length, 6);
  for (const row of calls("ai_text_result_check")) assert.deepEqual(row.result, { type: "boolean", value: false });
  assert.deepEqual(calls("ai_text_result_check", "seeded").map(c => c.result.value), [true, false, true, false, true, false]);
  for (const phase of ["seeded-empty", "seeded-NaN"]) assert.deepEqual(calls("ai_text_result", phase)[0].result, { type: "number", value: "NaN" });
  assert.deepEqual(calls("ai_text_result_check", "seeded-empty").map(c => c.result.value), [true, false]);
  assert.deepEqual(calls("ai_text_result_check", "seeded-NaN").map(c => c.result.value), [false, false]);
});

test("translation/ranking partial branches and unregistered hardware do not imply general support", () => {
  for (const c of calls("translate_result")) {
    assert.equal(c.args.text.trim(), "");
    assert.deepEqual(c.result, { type: "string", value: "" });
  }
  for (const name of ["user_info_of_th", "user_ranking_info"]) {
    assert.deepEqual(calls(name).map(c => c.args.ranking), ["?", "probe-missing-ranking"]);
    for (const c of calls(name)) assert.deepEqual(c.result, { type: "number", value: "NaN" });
  }
  for (const name of ["get_evaluate_class_name", "get_evaluate_class_accuracy", "get_voice_volume", "open_hide_camera", "open_close_webcam", "set_camera_alpha", "set_webcam_alpha"]) assert.equal(calls(name).length, 0, "not invoked: " + name);
  for (const name of ["microbit_temperature", "microbit_button_is_pressed", "catbit_button_is_pressed", "wand_coordinate", "get_robot_master_motor_power"]) {
    assert.equal(evidence.editor.availability[name].registered, false);
    assert.equal(evidence.editor.availability[name].domainIndex, null);
    assert.equal(calls(name).length, 0);
  }
});

test("optional original bytes reproduce all 21 source hashes and byte offsets", async t => {
  const main = evidence.bundles.find(b => b.name.startsWith("main."));
  let bytes;
  try { bytes = await fs.readFile(new URL("dist/kn-offline-round3/" + main.name, root)); }
  catch (e) { if (e.code === "ENOENT") return t.skip("Run official round3 probe to retain source bytes"); throw e; }
  assert.equal(sha256(bytes), main.sha256);
  for (const row of evidence.sourceLocations) assert.equal(sha256(bytes.subarray(row.byteOffset).toString("utf8").slice(0, row.excerptCharacters)), row.excerptSha256, row.symbol);
});
