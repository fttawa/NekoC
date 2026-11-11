import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const sha = s => createHash("sha256").update(s).digest("hex");
const evidence = JSON.parse(fs.readFileSync("docs/kn-panel-services-evidence.json", "utf8"));
test("KN panel services evidence retains typed official offline results and scope", () => {
  assert.equal(evidence.ok, true);
  assert.equal(evidence.version, "0.27.4");
  assert.deepEqual(evidence.pageErrors, []);
  assert.equal(evidence.bundle.sha256, "58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165");
  assert.equal(evidence.sourceLocations.length, 13);
  assert.equal(evidence.calls.length, 19);
  assert.equal(evidence.blockedRequests.length, 4);
  for (const call of evidence.calls) {
    assert.equal(call.promise, true);
    assert.deepEqual(call.result, call.name === "translate_result" ? { type: "string", value: "" } :
      ["user_ranking_info", "user_info_of_th"].includes(call.name) ? { type: "number", value: "NaN" } : { type: "undefined" });
  }
});
test("KN panel services official source anchors remain byte-accurate", t => {
  const file = "dist/kn-panel5/main.js";
  if (!fs.existsSync(file)) return t.skip("optional original official bundle not downloaded");
  const source = fs.readFileSync(file, "utf8");
  assert.equal(sha(source), evidence.bundle.sha256);
  for (const row of evidence.sourceLocations) {
    const index = source.indexOf(row.anchor);
    assert.ok(index >= 0, row.symbol);
    assert.equal(Buffer.byteLength(source.slice(0, index)), row.byteOffset, row.symbol);
    assert.equal(sha(source.slice(index, index + row.excerptCharacters)), row.excerptSha256, row.symbol);
  }
});
