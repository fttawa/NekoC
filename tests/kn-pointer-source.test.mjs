import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { check, source } from "../tools/compat/kn-pointer-source.mjs";

test("KN pointer source contract pins the official identity and three distinct anchors", () => {
  assert.equal(source.sha256.length, 64);
  assert.deepEqual(source.anchors.map(a => a.byteOffset), [1158568, 1576944, 1720624]);
  assert.throws(() => check(Buffer.from("not official code")), /identity changed/);
  const doc = fs.readFileSync("docs/kn-pointer.md", "utf8");
  assert.ok(doc.includes(source.sha256));
  assert.ok(doc.includes("未验证"));
});

test("locally downloaded official KN pointer anchors match byte-for-byte", {
  skip: !fs.existsSync("dist/kncat3/main.8ccf2442.js"),
}, () => {
  assert.equal(check(fs.readFileSync("dist/kncat3/main.8ccf2442.js")).ok, true);
});
