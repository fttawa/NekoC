import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { baseline, drawingMainPaths, physicsMainPaths, propertyMainPaths, serviceGroups, serviceTypes } from "../tools/compat/k4-partial-6-scope.mjs";
import { round7MainPaths } from "../tools/compat/k4-partial-7-scope.mjs";
import { round8MainPaths } from "../tools/compat/k4-partial-8-scope.mjs";
import { optionFrequency } from "../tools/compat/k4-partial-6-options.mjs";

test("all 95 original partial types are explicitly partitioned, without promoting device fallback", () => {
  const report = JSON.parse(fs.readFileSync("docs/kitten4-block-coverage.json", "utf8"));
  const rows = new Map(report.rows.map(row => [row.type, row]));
  assert.equal(Object.keys(baseline).length, 95);
  assert.equal(Object.values(baseline).reduce((a, b) => a + b), 8420);
  assert.equal(serviceTypes.size, serviceGroups.flatMap(group => group.types).length);
  for (const type of serviceTypes) {
    assert.ok(Object.hasOwn(baseline, type));
    assert.equal(rows.get(type).status, "设备降级", type);
    assert.equal(rows.get(type).semantics, "partial", type);
  }
  for (const type of [...physicsMainPaths, ...propertyMainPaths, ...drawingMainPaths]) {
    assert.ok(!serviceTypes.has(type));
    const row = rows.get(type);
    assert.equal(row.semantics, "main-path-verified", type);
    assert.ok(row.unverifiedBoundaries.length > 0, type);
  }
  for (const type of ["physics2_enable_force", "physics2_set_actor_as", "physics2_set_texture", "physics2_set_flexibility", "set_entity_show_hide"]) {
    assert.equal(rows.get(type).semantics, round7MainPaths.has(type)||round8MainPaths.has(type) ? "main-path-verified" : "partial", type);
  }
  // The round-6 report is an archived baseline, not rewritten by later rounds.
  assert.match(fs.readFileSync("docs/kitten4-partial-6.md", "utf8"), /本轮 \*\*27项\*\*/);
});

test("option histograms honor empty workspaces and deduplicate ASTs without retaining UUID data", t => {
  fs.mkdirSync("dist", { recursive: true });
  const directory = fs.mkdtempSync("dist/k4-options-test-");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const block = { id: "block", type: "self_set_effect_2", params: { scope: "1", val: { type: "math_number", id: "value", params: { NUM: "23" } } } };
  fs.writeFileSync(path.join(directory, "original.bcm"), JSON.stringify({
    theatre: { actors: { empty: { block_data_json: { blocks: {} } } } },
    compile_result: [
      { id: "empty", compiled_block_map: { block } },
      { id: "other", compiled_block_map: { block }, procedures: { block } },
      { id: "local", compiled_block_map: { block: { id: "uuid", type: "get_3", params: { attribute: "12345678-0000-4000-8000-000000000001" } } } },
    ],
  }));
  assert.deepEqual(optionFrequency(directory).counts, {
    self_set_effect_2: { scope: { "1": 1 } },
    get_3: { attribute: { "<dynamic-or-uuid>": 1 } },
  });
  const evidence = JSON.parse(fs.readFileSync("docs/kitten4-partial-6-options.json", "utf8"));
  assert.equal(evidence.files, 53);
  assert.equal(Object.values(evidence.counts.self_set_effect_2.scope).reduce((a, b) => a + b), 1228);
  assert.equal(Object.values(evidence.counts.get_3.attribute).reduce((a, b) => a + b), 2049);
  assert.equal(evidence.counts.physics2_set_texture.texture_type.soft, 2);
});
