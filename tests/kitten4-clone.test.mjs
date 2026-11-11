import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures } from "../tools/clone-kitten4.mjs";

test("self-authored clone fixtures regenerate exactly", async () => {
  for (const [name, project] of Object.entries(await fixtures())) {
    assert.equal(await readFile(`tests/fixtures/kitten4/clone-${name}.bcm`, "utf8"), JSON.stringify(project, null, 2) + "\n");
  }
});

test("official lifecycle evidence matches the tested workspace hashes", async () => {
  const report = JSON.parse(await readFile("tests/fixtures/kitten4/clone-official.json", "utf8"));
  assert.equal(report.ok, true);
  for (const [name, value] of Object.entries(report.cases)) {
    assert.equal(value.applicationVersion, "4.11.20");
    assert.deepEqual(value.workspaceIssues, []);
    assert.deepEqual(value.pageErrors, []);
    assert.equal(value.sha256, createHash("sha256").update(await readFile(value.fixture)).digest("hex"));
    assert.ok(value.checkpoints.length);
    assert.ok(value.checkpoints.every(p => name === "mirrorSelf" ? p.state.error.show_error : !p.state.error.show_error));
  }
  const previous = JSON.parse(await readFile("tests/fixtures/kitten4/split-semantics-official.json", "utf8"));
  for (const name of ["when-split", "keys-split"]) {
    const value = previous.cases[name];
    assert.equal(value.sha256, createHash("sha256").update(await readFile(value.fixture)).digest("hex"));
  }
});
