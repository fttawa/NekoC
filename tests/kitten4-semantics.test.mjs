import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures } from "../tools/semantics-kitten4.mjs";

test("self-authored semantic BCMs reproduce exactly and have connected graphs", async () => {
  for (const [name, project] of Object.entries(fixtures())) {
    const stored = JSON.parse(await readFile(new URL(`fixtures/kitten4/semantics-${name}.bcm`, import.meta.url), "utf8"));
    assert.deepEqual(stored, project, name);
    const graph = Object.values(project.theatre.actors)[0].block_data_json;
    for (const [id, children] of Object.entries(graph.connections)) {
      assert.ok(graph.blocks[id]);
      for (const child of Object.keys(children)) {
        assert.ok(graph.blocks[child]);
        assert.equal(graph.blocks[child].parent_id, id);
      }
    }
  }
});

test("archived official results match the exact committed BCM bytes", async () => {
  const report = JSON.parse(await readFile(new URL("fixtures/kitten4/semantics-official.json", import.meta.url), "utf8"));
  assert.equal(report.ok, true);
  assert.equal(Object.keys(report.cases).length, 8);
  for (const [name, result] of Object.entries(report.cases)) {
    const source = await readFile(new URL(`fixtures/kitten4/semantics-${name}.bcm`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), result.sha256, name);
    assert.deepEqual(result.workspaceIssues, []);
    assert.deepEqual(result.pageErrors, []);
    assert.ok(result.checkpoints.length);
    for (const checkpoint of result.checkpoints) assert.equal(checkpoint.state.error.show_error, false);
  }
  const variables = name => report.cases[name].checkpoints.at(-1).state.variables;
  assert.ok(variables("when").originalEnter > 2);
  assert.equal(variables("when").cloneEnter, 0);
  assert.equal(variables("keys").cloneStarted, 1);
  assert.equal(variables("keys").cloneEnter, 0);
  assert.ok(variables("when-split").cloneEnter > 2);
  assert.ok(variables("keys-split").cloneEnter > 1);
  assert.equal(variables("dispose").afterOriginal, 0);
  assert.equal(report.cases.dispose.checkpoints.at(-1).state.actor, null);
  assert.equal(variables("screen").nameA, true);
  assert.deepEqual(variables("costume").literalB, { style_id: "costume-b" });
  assert.equal(variables("costume").literalText, "[object Object]");
  assert.equal(variables("text").index2, "b");
});
