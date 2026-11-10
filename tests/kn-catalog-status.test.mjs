import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dispatchEvidence, inventory, statuses, coverageMarkdown } from "../tools/compat/kn-catalog-status.mjs";
import { catalogTypes } from "../tools/compat/kn-catalog-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("inventory uses dispatch arms, not comments or incidental strings", () => {
  const result = dispatchEvidence(`
// "comment" => ignored
let name = "not-a-dispatch";
"first" | "second" => value,
"guarded" if condition => value,
"multi"
| "line" => value,
/* "comment2" => ignored */
`, "fixture.rs");
  assert.deepEqual([...result.keys()], ["first", "second", "guarded", "multi", "line"]);
  assert.match(result.get("first")[0], /^fixture\.rs:\d+$/);
});

test("snapshot is exactly 300 unique names with mutually exclusive conservative statuses", () => {
  assert.equal(catalogTypes.length, 300);
  assert.equal(new Set(catalogTypes).size, 300);
  const result = inventory(root);
  assert.equal(result.catalogCount, 300);
  assert.deepEqual(result.rows.map(row => row.type), catalogTypes);
  assert.equal(Object.values(result.counts).reduce((a, b) => a + b, 0), 300);
  for (const row of result.rows) {
    assert.ok(statuses.includes(row.status));
    assert.notEqual(row.status, "VM 已实现");
    assert.equal(row.status === "缺失", row.vm.length === 0, row.type);
    assert.ok(row.compiler.includes("build_nested_block"));
    assert.ok(row.risk.length > 0);
  }
  for (const type of ["microbit_math_map", "ai_chat_ask", "user_id_get", "setTimeout", "_object_set"]) {
    assert.equal(result.rows.find(row => row.type === type).status, "缺失", type);
  }
  assert.equal(result.rows.find(row => row.type === "get_orientation").status, "固定值占位");
  for (const type of ["appearance_of_sprite", "mouse_down", "self_dialog_wait"]) {
    assert.equal(result.rows.find(row => row.type === type).status, "部分语义", type);
  }
  for (const type of ["procedures_2_defnoreturn", "traverse_number_param"]) {
    assert.equal(result.rows.find(row => row.type === type).status, "元数据", type);
  }
});

test("field arms and traversal-only type mentions never become VM evidence", () => {
  let source = fs.readFileSync(new URL("../src/engine.rs", import.meta.url), "utf8");
  source = source.replace('"random_num" | "math_arithmetic" | "math_modulo" | "math_arithmetic_power" =>',
    '"ai_chat_ask" | "math_arithmetic" | "math_modulo" | "math_arithmetic_power" =>');
  source = source.replace('"width" => ExprOp::Constant(self.program.width)',
    '"ai_chat_ask" => ExprOp::Constant(self.program.width)');
  assert.ok(source.includes('"set_scale" => Op::Scale'), "fixture needs actual scale dispatch");
  source = source.replace('"set_scale" => Op::Scale', '"future_scale" => Op::Scale');
  const result = inventory(root, undefined, source);
  assert.equal(result.rows.find(row => row.type === "ai_chat_ask").status, "缺失");
  assert.equal(result.rows.find(row => row.type === "set_scale").status, "缺失", "dormant root ignore is not support");
});

test("coverage document has all 300 rows and current classifications; no parity claim", () => {
  const result = inventory(root);
  const document = fs.readFileSync(new URL("../docs/kn-block-coverage.md", import.meta.url), "utf8");
  const rows = [...document.matchAll(/^\| (\d+) \| `([^`]+)` \| ([^|]+) \|/gm)];
  assert.equal(rows.length, 300);
  assert.deepEqual(rows.map(row => row[2]), catalogTypes);
  assert.deepEqual(rows.map(row => row[3].trim()), result.rows.map(row => row.status));
  const tableRows = text => text.split("\n").filter(line => /^\| \d+ \|/.test(line));
  assert.deepEqual(tableRows(document), tableRows(coverageMarkdown(result)), "Regenerate report: implementation locations or test references changed");
  for (const [status, count] of Object.entries(result.counts)) {
    assert.ok(document.includes(`| ${status} | ${count} |`), `Regenerate report: ${status}`);
  }
  assert.match(document, /完整语义支持的项数为 0/);
  assert.match(document, /kncat-official-evidence\.md/);
  assert.match(document, /不是 stub 支持/);
  assert.match(coverageMarkdown(result), /全量逐项表（300 行）/);
});
