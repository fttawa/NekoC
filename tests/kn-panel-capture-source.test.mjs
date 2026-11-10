import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const evidence = JSON.parse(await fs.readFile(new URL("../docs/kn-panel-capture-evidence.json", import.meta.url)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("官方身份、六种插槽与 Promise 类型可离线核验", () => {
  assert.equal(evidence.ok, true);
  assert.equal(evidence.editor.version, "0.27.4");
  assert.deepEqual(evidence.pageErrors, []);
  const blocks = evidence.editor.availability;
  assert.equal(Object.keys(blocks).length, 6);
  for (const name of ["set_camera_alpha", "set_webcam_alpha"]) assert.equal(blocks[name].inputs[0].name, "camera_alpha");
  for (const name of ["open_hide_camera", "open_close_webcam"]) assert.equal(blocks[name].inputs[0].fields[0].name, "camera_status");
  assert.deepEqual(blocks.voice_recognition.inputs[0].fields[0], { name: "type", value: "zh", options: [["中文", "zh"], ["英文", "en"]] });
  for (const call of evidence.editor.calls) {
    assert.equal(call.promise, true);
    assert.deepEqual(call.order, ["returned", "after-register", "settled"]);
  }
});

test("实际 alpha setter 被动转发：合法值夹取，非 number 不写入", () => {
  for (const name of ["set_camera_alpha", "set_webcam_alpha"]) {
    const calls = evidence.editor.calls.filter(c => c.name === name);
    assert.equal(calls.length, 11);
    assert.deepEqual(calls.map(c => c.alphaWrites), [[0], [0], [0.375], [1], [1], [1], [0], [], [], [], []]);
    assert.ok(calls.every(c => c.before.cameraStatus === "turn_off" && c.after.cameraStatus === "turn_off"));
  }
  const close = evidence.editor.calls.filter(c => c.branch === "camera-already-off");
  assert.equal(close.length, 2);
  assert.ok(close.every(c => !c.alphaWrites.length && c.result.type === "undefined"));
});

test("语音只承诺显式占用与未登录分支，不假定权限结果", () => {
  const volume = evidence.editor.calls.filter(c => c.name === "get_voice_volume");
  assert.equal(volume.length, 1);
  assert.equal(volume[0].before.recordEnable, false);
  assert.deepEqual(volume[0].result, { type: "number", value: "NaN" });
  const recognize = evidence.editor.calls.filter(c => c.name === "voice_recognition");
  assert.equal(recognize.length, 3);
  assert.deepEqual(recognize.map(c => c.result), Array(3).fill({ type: "undefined" }));
  assert.ok(recognize.filter(c => c.branch === "unauthenticated").every(c => c.after.loginVisible === true));
  assert.ok(!evidence.editor.calls.some(c => c.args.camera_status?.value === "turn_on"));
});

test("可选 dist 官方原始字节与定位 hash 核验", async t => {
  const main = evidence.bundles.find(b => b.name.startsWith("main."));
  let bytes;
  try { bytes = await fs.readFile(new URL(`../dist/kn-panel-capture/${main.name}`, import.meta.url)); }
  catch (e) { if (e.code === "ENOENT") return t.skip("第三方 bundle 不入库"); throw e; }
  assert.equal(hash(bytes), main.sha256);
  for (const location of evidence.sourceLocations) {
    assert.equal(location.bundleSha256, main.sha256);
    const excerpt = bytes.subarray(location.byteOffset).toString("utf8").slice(0, location.characters);
    assert.equal(hash(excerpt), location.excerptSha256, location.symbol);
  }
});
