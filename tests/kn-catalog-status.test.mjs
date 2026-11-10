import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dispatchEvidence, inventory, statuses, officialCategories, coverageMarkdown } from "../tools/compat/kn-catalog-status.mjs";
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
    assert.ok(officialCategories[row.officialCategory], row.type);
    assert.equal(row.panelEvidence, "docs/kn-panel-evidence.json");
  }
  // New paths must keep their explicit limitations, rather than being promoted
  // to a parity claim. Truly unsupported types are checked independently below.
  for (const type of ["_object_literal", "_object_get", "_object_set"]) {
    const row = result.rows.find(row => row.type === type);
    assert.ok(row.vm.length > 0, type);
    assert.match(row.risk, /未验证/, type);
  }
  // A future service backend must not turn offline fallback into full support.
  for (const type of ["setTimeout", "setInterval", "clearTimeout", "clearInterval"]) {
    const row = result.rows.find(row => row.type === type);
    assert.ok(row.vm.length > 0, type);
    assert.equal(row.status, "部分语义", type);
  }
  for (const type of ["username_get", "user_id_get", "get_voice_answer", "recognize_body_part", "get_position_of_body_part", "move_to_body_part",
    "ai_chat_answer", "ai_text_result", "ai_text_result_check", "get_face_detection_result", "get_object_detection_result", "check_gender", "check_emotion", "check_face_shape", "microbit_math_map",
    "microbit_button_is_pressed", "microbit_logo_is_pressed", "microbit_is_gesture", "microbit_led_is_plot", "microbit_pin_digital_read", "microbit_pin_analog_read"]) {
    const row = result.rows.find(row => row.type === type);
    assert.ok(row.vm.length > 0, type);
    assert.equal(row.status, "部分语义", type);
    assert.match(row.risk, /未实现/, type);
  }
  for (const type of ["get_voice_volume"]) {
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

test("official panel evidence remains separate from VM support or retirement claims", () => {
  const result = inventory(root);
  assert.equal(Object.values(result.panelCounts).reduce((a,b) => a+b,0),300);
  for (const [type, category] of [["global_animation","panel-default"],
    ["set_system_preset","panel-configurable-default-hidden"],
    ["get_sprite_property","code-api-alias-not-block"],
    ["wand_coordinate","hardware-extension-config-not-installed"]]) {
    const row = result.rows.find(r => r.type === type);
    assert.equal(row.officialCategory, category);
    if (["global_animation", "set_system_preset"].includes(type)) {
      assert.equal(row.status, "部分语义");
      assert.ok(row.vm.length > 0);
    } else {
      assert.equal(row.status, "缺失");
      assert.deepEqual(row.vm, []);
    }
  }
  assert.match(coverageMarkdown(result), /两者均0/);
});

test("round five panel additions stay partial and ordinary microphone volume stays missing", () => {
  const result = inventory(root);
  const added = ["ai_chat_ask", "ai_text_actor", "ai_text_photo", "enable_face_detect_by_actor",
    "enable_face_detect_by_photo", "enable_object_detect_by_actor", "enable_object_detect_by_photo",
    "evaluate_actor_style", "evaluate_camera", "evaluate_photo", "get_evaluate_class_accuracy",
    "get_evaluate_class_name", "global_animation", "new_conversation", "open_close_webcam",
    "open_hide_camera", "set_camera_alpha", "set_system_preset", "set_webcam_alpha",
    "show_hide_ranking", "translate", "translate_result", "update_ranking", "user_info_of_th",
    "user_ranking_info", "voice_recognition"];
  assert.equal(added.length, 26);
  for (const type of added) {
    const row = result.rows.find(r => r.type === type);
    assert.equal(row.status, "部分语义", type);
    assert.match(row.risk, /仅/, type);
    assert.match(row.officialCategory, /^panel-(default|configurable-default-hidden)$/);
  }
  const visibleMissing = result.rows.filter(row => row.status === "缺失" &&
    ["panel-default", "panel-configurable-default-hidden"].includes(row.officialCategory));
  assert.deepEqual(visibleMissing.map(row => row.type), ["get_voice_volume"]);
});

test("field arms and traversal-only type mentions never become VM evidence", () => {
  let source = fs.readFileSync(new URL("../src/engine.rs", import.meta.url), "utf8");
  source = source.replace('"random_num" | "math_arithmetic" | "math_modulo" | "math_arithmetic_power" =>',
     '"get_voice_volume" | "math_arithmetic" | "math_modulo" | "math_arithmetic_power" =>');
  source = source.replace('"width" => ExprOp::Constant(self.program.width)',
     '"get_voice_volume" => ExprOp::Constant(self.program.width)');
  assert.ok(source.includes('"set_scale" => Op::Scale'), "fixture needs actual scale dispatch");
  source = source.replace('"set_scale" => Op::Scale', '"future_scale" => Op::Scale');
  const result = inventory(root, undefined, source);
  assert.equal(result.rows.find(row => row.type === "get_voice_volume").status, "缺失");
  assert.equal(result.rows.find(row => row.type === "set_scale").status, "缺失", "dormant root ignore is not support");
});

test("coverage document has all 300 rows and current classifications; no parity claim", () => {
  const result = inventory(root);
  const document = fs.readFileSync(new URL("../docs/kn-block-coverage.md", import.meta.url), "utf8");
  const rows = [...document.matchAll(/^\| (\d+) \| `([^`]+)` \| ([^|]+) \|/gm)];
  assert.equal(rows.length, 300);
  assert.deepEqual(rows.map(row => row[2]), catalogTypes);
  assert.deepEqual(rows.map(row => row[3].trim()), result.rows.map(row => row.status));
  // 实现位置里的行号会随合并漂移，只比较文件路径，避免每次合并都要重新生成表格
  const tableRows = text => text.split(/\r?\n/)
    .filter(line => /^\| \d+ \|/.test(line))
    .map(line => line.replace(/(`[^`\s]+\.[A-Za-z0-9]+):\d+`/g, "$1`"));
  assert.deepEqual(tableRows(document), tableRows(coverageMarkdown(result)), "Regenerate report: implementation files or test references changed");
  for (const [status, count] of Object.entries(result.counts)) {
    assert.ok(document.includes(`| ${status} | ${count} |`), `Regenerate report: ${status}`);
  }
  assert.match(document, /完整语义支持的项数为 0/);
  assert.match(document, /kncat-official-evidence\.md/);
  assert.match(document, /不是 stub 支持/);
  assert.match(coverageMarkdown(result), /全量逐项表（300 行）/);
});
