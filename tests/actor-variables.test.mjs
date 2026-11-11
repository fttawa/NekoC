import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

test("actor-variable fixtures reproduce exactly without external works", () => {
  const files = ["tests/fixtures/kitten4/actor-variables.bcm", "tests/fixtures/kitten4/actor-variables-deleted.bcm", "tests/fixtures/actor-variables.bcmkn", "tests/fixtures/actor-variables-deleted.bcmkn"];
  const before = files.map(f => readFileSync(f, "utf8"));
  execFileSync(process.execPath, ["tools/probe-actor-variables.mjs", "generate"]);
  files.forEach((f, i) => assert.equal(readFileSync(f, "utf8"), before[i], f));
});

test("official actor-variable observations name exact fixture bytes and runtime values", () => {
  const report = JSON.parse(readFileSync("docs/actor-variables-official.json", "utf8"));
  assert.equal(report.cases.length, 4);
  for (const c of report.cases) {
    assert.equal(createHash("sha256").update(readFileSync(c.fixture)).digest("hex"), c.sha256);
    assert.deepEqual(c.errors, []);
    assert.equal(c.failure, undefined);
    const vars = c.beforeDelete || c.snapshot.variables;
    for (const [id, value] of Object.entries({ inherited: 41, cloneChanged: 99, original: 41, cloneRead: 99, otherRead: "other-value", done: 1 })) assert.equal(vars[id], value);
    if (c.scenario === "deleted") {
      if (c.platform === "k4") assert.equal(c.snapshot.error.error_string, "该编号的克隆体不存在");
      else assert.equal(c.snapshot.variables.afterDelete, "NaN");
    } else if (c.platform === "k4") assert.equal(c.snapshot.error.show_error, false);
  }
  assert.equal(report.editorCompat.ok, true);
});
