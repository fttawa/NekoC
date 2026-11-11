import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { inventory } from "../tools/compat/kn-catalog-status.mjs";
import { mainPaths, skippedGroups, scopeMarkdown } from "../tools/compat/kn-partial2-scope.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("partial2 partitions the historical remaining 55 types without promoting services", () => {
  const frequency = JSON.parse(read("docs/kn-partial-frequency.json"));
  // The fixed frequency baseline intentionally predates the first two upgrades.
  const historical = frequency.types ?? frequency.rows;
  assert.ok(Array.isArray(historical));
  const result = inventory(root);
  const main = Object.keys(mainPaths);
  const skipped = skippedGroups.flatMap(group => group.types);
  assert.equal(main.length, 8);
  assert.equal(skipped.length, 47);
  assert.equal(new Set([...main, ...skipped]).size, 55);
  const remaining = historical.filter(row => !row.hardware && !["mouse_down", "get_clone_index_property"].includes(row.type));
  assert.deepEqual([...main, ...skipped].sort(), remaining.map(row => row.type).sort());
  for (const row of result.rows) {
    if (main.includes(row.type)) {
      assert.equal(row.status, "有执行路径／未完整验证", row.type);
      assert.match(row.risk, /未验证/, row.type);
      assert.match(row.risk, /kn-partial2/, row.type);
    } else if (skipped.includes(row.type) || row.officialCategory === "hardware-extension-config-not-installed") {
      assert.equal(row.status, "部分语义", row.type);
      assert.match(row.risk, /未实现|未接|未验证/, row.type);
    }
  }
  assert.equal(result.rows.filter(row => row.officialCategory === "hardware-extension-config-not-installed").length, 60);
  assert.equal(result.counts["部分语义"], 107);
  for (const [document, fixtures] of [
    ["docs/kn-partial2-timers-official.json", ["main", "clear"]],
    ["docs/kn-partial2-appearance-official.json", ["talk", "think"]],
  ]) {
    const evidence = JSON.parse(read(document));
    assert.equal(evidence.editorCompat.ok, true, document);
    for (const name of fixtures) {
      const observation = evidence.cases[name];
      assert.equal(observation.equal, true, `${document}/${name}`);
      assert.deepEqual(observation.pageErrors, [], `${document}/${name}`);
      assert.equal(observation.variables.done, 1, `${document}/${name}`);
      assert.equal(observation.nekoc.variables.done, 1, `${document}/${name}`);
    }
  }
});

test("partial2 scope report is reproducible and explicitly reports the missed target", () => {
  const document = read("docs/kn-partial2.md").replaceAll("\r\n", "\n");
  assert.equal(document, scopeMarkdown(inventory(root)));
  assert.match(document, /未达到至少 15 项升级/);
  assert.match(document, /不是本轮新增官方成功实测/);
  assert.match(document, /没有移植 HateNeko 或官方源码/);
  const result = inventory(root);
  const changed = structuredClone(result);
  changed.rows.find(row => row.type === "ai_chat_answer").status = "有执行路径／未完整验证";
  assert.throws(() => scopeMarkdown(changed), /Do not promote an offline service fallback/);
  changed.rows.find(row => row.type === "ai_chat_answer").status = "部分语义";
  changed.rows.find(row => row.type === "convert_type").status = "部分语义";
  assert.throws(() => scopeMarkdown(changed), /Unverified main path classification/);
});
