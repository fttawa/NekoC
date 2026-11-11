import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { corpusFrequency, mappingStatus, markdownReport, officialInventory, rustDispatch,
  rustFunction, webpackModules } from "../tools/compat/k4-block-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-k4-catalog-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
// Entirely synthetic factories; no official source copied into tests.
const bundle = `webpackJsonp.push([[0], {
  domain: function() {
    const base = { first: function() {}, "second": function() {} };
    const legacy = { old_name: function() {} };
    const helper = { private_helper: function() {} };
    const merged = Object.assign({}, base, legacy);
    register({ domain_function: merged });
    return { id: "action-not-a-block", responder_blocks: [{ id: "hat" }] };
  },
  override: function() { return { first: function() {} }; },
  compiler: function(t, e) {
    (function(x) { x[x.first=1]="first"; x[x.structure=2]="structure"; })(e.ONE_BLOCKS || (e.ONE_BLOCKS={}));
    (function(x) { x[x.first=1]="first"; })(e.TWO_BLOCKS || (e.TWO_BLOCKS={}));
    (function(x) { x[x.number=1]="number"; })(e.BlockOutputType || (e.BlockOutputType={}));
  }
}]);`;
const options = { domainTables: { domain: ["first", "old_name"], override: ["first"] },
  compilerModule: "compiler", registryModules: ["domain"] };

test("catalog unions merged domain/legacy tables, overrides, responders and every compiler table", () => {
  const result = officialInventory(bundle, options);
  assert.deepEqual(result.rows.map(r => r.type), ["first", "hat", "old_name", "second", "structure"]);
  assert.equal(result.audit.tables.length, 3);
  assert.equal(result.audit.compilerTables.length, 2);
  const first = result.rows.find(r => r.type === "first");
  assert.equal(first.official.length, 4);
  const compilerLocations = first.official.filter(e => e.module === "compiler");
  assert.notEqual(compilerLocations[0].offset, compilerLocations[1].offset);
  const modules = webpackModules(bundle);
  for (const row of result.rows) for (const evidence of row.official) {
    const at = modules[evidence.module].toString().slice(evidence.offset);
    assert.ok(at.startsWith(row.type) || at.startsWith(`"${row.type}"`) || at.startsWith('id:'), `${row.type}@${evidence.offset}`);
  }
});

test("catalog fails closed on missing/ambiguous tables, new registry writers and dynamic responders", () => {
  assert.throws(() => officialInventory(bundle, { ...options, domainTables: { domain: ["absent"] } }), /Missing domain table/);
  assert.throws(() => officialInventory(bundle, { ...options, registryModules: [] }), /Re-audit domain registry/);
  assert.throws(() => officialInventory(bundle.replace('id: "hat"', 'id: dynamic'), options), /Dynamic responder id/);
  assert.throws(() => officialInventory(bundle.replace('private_helper:', 'first:'), options), /Ambiguous table/);
  assert.throws(() => officialInventory(bundle.replace('old_name: function() {}', 'old_name: 1'), options), /Non-function/);
  assert.throws(() => webpackModules("void 0"), /No webpack/);
});

test("Rust function boundaries survive comments, nested blocks, strings and raw strings", () => {
  const source = `fn selected(kind: &str) { /* { nested /* } */ } */
    let raw = r#"{ not a boundary }"#;
    let ordinary = "\\\"}";
    match kind { "one" => { let c = '}'; }, "two" => value, }
  }
  // No Equality comment is needed.
  fn unrelated() { "outside" => bogus }
  `;
  const selected = rustFunction(source, "selected");
  assert.ok(!source.slice(selected.start, selected.end).includes("unrelated"));
  assert.deepEqual([...rustDispatch(source, "selected").keys()], ["one", "two"]);
  assert.throws(() => rustFunction(source, "absent"), /Missing Rust function/);
});

test("Rust dispatch excludes nested field matches, comments, strings and guard literals", () => {
  const source = `fn dispatch(kind: &str) {
    // "comment" => ignored
    let incidental = "not_a_type";
    match kind.as_str() {
      "first" | "second" => { match field(block, "selector") { "field_value" => (), _ => () } }
      "guarded" if field(block, "condition") == "not_a_type" => foo("payload"),
      "last" => (),
      _ => return,
    }
    if kind == "equality" { }
    if matches!(kind.as_str(), "listed" | "also_listed") { }
    if matches!(field(block, "scope"), "not_a_type") { }
  }`;
  assert.deepEqual([...rustDispatch(source, "dispatch").keys()],
    ["first", "second", "guarded", "last", "equality", "listed", "also_listed"]);
});

test("is_stub only sees kind patterns within its own function", () => {
  const source = `
    fn is_stub(kind: &str) -> bool {
      // "commented_stub" => true
      let unrelated = "not_stub";
      matches!(kind, "video_stub" | "voice_stub")
    }
    fn cloud_list() { let type_name = "cloud_variables_set"; }
    fn lower_block(kind: &str) {
      if is_stub(kind) || (kind == "effect" && field(block, "scope") == "7") { }
    }
  `;
  assert.deepEqual([...rustDispatch(source, "is_stub").keys()], ["video_stub", "voice_stub"]);
  assert.deepEqual([...rustDispatch(source, "lower_block").keys()], ["effect"]);
});

test("frequency gives even empty workspaces priority and de-duplicates compiled AST ids", t => {
  const directory = temporary(t);
  const a = { id: "a", type: "root", next_block: { id: "b", type: "child" },
    params: { value: { id: "c", type: "reporter" } }, shadows: { id: "s", type: "backup" } };
  fs.writeFileSync(path.join(directory, "synthetic.bcm"), JSON.stringify({
    theatre: { actors: {
      workspace: { id: "workspace", block_data_json: { blocks: {
        first: { type: "workspace_type", mutation: { type: "mutation" }, shadows: { type: "backup" } },
        second: { type: "workspace_type" },
      } } },
      empty: { block_data_json: JSON.stringify({ blocks: {} }) },
    } },
    compile_result: [
      { id: "workspace", compiled_block_map: { a } },
      { id: "empty", compiled_block_map: { a } },
      { id: "compiled", compiled_block_map: { a, b: a.next_block }, procedures: { repeated: a } },
    ],
  }));
  fs.writeFileSync(path.join(directory, "ignore.json"), "{}");
  const result = corpusFrequency(directory);
  assert.equal(result.files, 1);
  assert.equal(result.workspaceOwners, 2);
  assert.equal(result.compiledOwners, 1);
  assert.deepEqual(Object.fromEntries(result.counts), { workspace_type: 2, root: 1, child: 1, reporter: 1 });
});

test("mapping regression: if/matches/aliases/cloud are implemented, precise stubs and no prefix guesses", () => {
  const types = ["bump", "bump_into_color", "set_actor_as", "set_entity_show_hide", "set_velocity", "cloud_variables_set",
    "change_cloud_variable", "cloud_lists_get_value", "self_change_x", "set_costume_by_id", "multiline_text", "get",
    "get_choice", "play_video", "set_camera_status", "wood_block_get", "self_change_effect_3", "physics2_set_flexibility",
    "physics2_set_speed", "physics2_get_property", "physics2_unknown", "cloud_lists_unknown", "get_orientation"];
  const rows = mappingStatus(root, types.map(type => ({ type, official: [] })));
  const by = Object.fromEntries(rows.map(row => [row.type, row]));
  for (const type of types.slice(0, 12)) assert.equal(by[type].status, "已实现", type);
  assert.match(by.self_change_x.mapping[0], /src\/kitten4\/aliases\.rs:\d+/);
  assert.equal(by.get_choice.status, "已实现");
  assert.equal(by.play_video.status, "已实现");
  assert.equal(by.set_camera_status.status, "设备降级");
  assert.equal(by.wood_block_get.status, "设备降级");
  assert.equal(by.self_change_effect_3.status, "已实现");
  assert.equal(by.self_change_effect_3.semantics, "partial");
  assert.equal(by.physics2_set_flexibility.status, "已实现");
  assert.equal(by.physics2_set_flexibility.semantics, "partial");
  assert.equal(by.physics2_set_speed.status, "已实现");
  assert.equal(by.physics2_get_property.status, "已实现");
  assert.equal(by.physics2_unknown.status, "缺失");
  assert.equal(by.cloud_lists_unknown.status, "缺失");
  // Only an export-side translation mentions this KN name: not K4 import evidence.
  assert.equal(by.get_orientation.status, "设备降级");
});

test("markdown contains full rows and audit metadata, never factory or corpus contents", () => {
  const { rows, audit } = officialInventory(bundle, options);
  const report = { bundle: "synthetic.js", sha256: "hash", corpus: "synthetic-corpus", files: 1,
    workspaceOwners: 1, compiledOwners: 0, count: rows.length, counts: { "缺失": rows.length }, audit,
    rows: rows.map(row => ({ ...row, status: "缺失", semantics: "unsupported", occurrences: 0, mapping: [], limitations: ["bounded"] })) };
  const markdown = markdownReport(report);
  for (const row of rows) assert.ok(markdown.includes(`| \`${row.type}\` |`));
  assert.ok(markdown.includes("UTF-16"));
  assert.ok(!markdown.includes("private_helper"));
  assert.ok(!markdown.includes("function()"));
});

test("partial work removes only measured block-body limits and retains renderer and backend gaps", () => {
  const types = ["get_stage_info", "self_set_draggable", "self_set_role_camp", "get", "get_2", "get_3",
    "get_clone_index_property", "self_set_effect_2", "self_change_effect_3", "self_clear_effects", "physics2_set_speed", "cloud_variables_get"];
  const rows = mappingStatus(root, types.map(type => ({ type, official: [] })));
  for (const row of rows) {
    assert.equal(row.status, "已实现", row.type);
    assert.equal(row.semantics, types.slice(0, 3).includes(row.type) ? "offline-oracle-verified" : "partial", row.type);
    assert.ok(!row.limitations.some(s => s.includes("scope=7 降级为 noop")));
  }
});

test("second round scans explicit module dispatches without swallowing unrelated types", () => {
  const types = ["text_indexOf", "text_append", "text_implicit", "days_after_2000", "start_on_click_2",
    "controls_if_no_else", "self_on_tap", "show_stage_dialog", "self_shake", "get_camera_data",
    "set_camera_opcity", "get_mobile_slope_value", "get_mobile_rocker_value", "mobile_vibrate", "not_a_device"];
  const rows = mappingStatus(root, types.map(type => ({ type, official: [] })));
  for (const row of rows.slice(0, 9)) {
    assert.equal(row.status, "已实现", row.type);
    assert.ok(row.mapping.some(m => m.includes("src/kitten4/common.rs")), row.type);
  }
  for (const row of rows.slice(9, 14)) assert.equal(row.status, "设备降级", row.type);
  assert.equal(rows.at(-1).status, "缺失");
  assert.equal(rows.find(row => row.type === "self_shake").semantics, "partial");
  assert.equal(rows.find(row => row.type === "text_indexOf").semantics, "partial");
});

test("third round explicitly maps all formerly missing types and preserves partial boundaries", () => {
  const types = `block_on_break controls_if_dropdown destruct display_recognition_result get_choice
    get_choice_index get_cur_frames get_recognition_result get_voice_answer incompatible_block
    incompatible_output_block midi_get midi_play_note midi_play_num_note midi_wait mouse_on_emit
    on_mobile_click_btn on_mobile_shake on_mobile_slide on_mobile_slope on_shake on_tilt play_ask_record
    player_position_on_change procedures_callnoreturn procedures_callreturn procedures_defnoreturn
    procedures_parameter procedures_return_value reset_timer self_ask_listen self_ask_record self_texture
    set_force set_force_by_vector set_gravity set_gravity_by_orientation set_speaking_language
    set_velocity_by_vector shock_duration shock_for_n_times translate translate_result turn_on_the_camera
    turn_on_the_qrcode_camera voice_recognition physics2_set_flexibility`.split(/\s+/);
  assert.equal(types.length, 47);
  const rows = mappingStatus(root, types.map(type => ({ type, official: [] })));
  for (const row of rows) assert.equal(row.status, "已实现", row.type);
  for (const type of ["voice_recognition", "self_texture", "physics2_set_flexibility", "translate_result"]) {
    assert.equal(rows.find(r => r.type === type).semantics, "partial", type);
  }
  const unknown = mappingStatus(root, [{type:"midi_unknown",official:[]},{type:"procedures_unknown",official:[]}]);
  for (const row of unknown) assert.equal(row.status,"缺失");
});

test("second partial round records scoped evidence without clearing unresolved parity boundaries", () => {
  const types = ["set_actor_as", "physics2_enable_force", "set_velocity", "physics2_set_actor_as", "physics2_set_speed",
    "cloud_variables_get", "cloud_variables_set", "change_cloud_variable", "cloud_lists_get",
    "stamp", "image_stamp", "set_scene_transition"];
  const rows = mappingStatus(root, types.map(type => ({ type, official: [] })));
  for (const row of rows) {
    assert.equal(row.status, "已实现", row.type);
    assert.equal(row.semantics, "partial", row.type);
    assert.ok(row.limitations.some(s => s.includes("第二轮") && s.includes("原创")), row.type);
    assert.ok(row.limitations.some(s => s.includes("未验证") || s.includes("限制") || s.includes("不声明")), row.type);
  }
});

test("third partial round retains solver, distort and stamp boundaries despite measured improvements", () => {
  const types = ["physics2_set_gravity", "physics2_set_speed", "set_velocity", "set_velocity_by_vector",
    "physics2_set_force", "physics2_set_mass", "physics2_set_roughness", "physics2_set_resilience",
    "physics2_set_boundary", "stamp", "image_stamp", "set_scene_transition"];
  for (const row of mappingStatus(root, types.map(type => ({ type, official: [] })))) {
    assert.equal(row.status, "已实现", row.type);
    assert.equal(row.semantics, "partial", row.type);
    assert.ok(row.limitations.some(text => text.includes("第三轮") && text.includes("原创")), row.type);
  }
});

test("optional official-package integration: 377 types and audited complete registration tables", {
  skip: !process.env.K4_PLAYER_DIR,
}, () => {
  const file = path.join(process.env.K4_PLAYER_DIR, "src/player/build/player_v2.2d180c468559fbd29528.js.orig");
  const source = fs.readFileSync(file, "utf8"), result = officialInventory(source);
  assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
    "0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160");
  assert.equal(result.rows.length, 377);
  assert.equal(result.audit.tables.length, 25);
  assert.equal(result.audit.compilerTables.length, 8);
  assert.equal(result.audit.responders.reduce((sum, table) => sum + table.count, 0), 11);
  assert.equal(result.audit.tables.filter(t => t.module === "Tn6a").length, 18);
  assert.equal(result.audit.tables.find(t => t.module === "TL4g").count, 20);
  assert.equal(result.audit.tables.find(t => t.module === "xQfl").count, 26);
  assert.equal(result.audit.tables.filter(t => t.module === "ls7Z").reduce((sum, t) => sum + t.count, 0), 74);
  const hardware = mappingStatus(root, result.rows.filter(row => row.official.some(e => e.module === "ls7Z")));
  assert.equal(hardware.length, 74);
  for (const row of hardware) {
    assert.equal(row.status, "设备降级", row.type);
    assert.ok(row.mapping.some(location => location.includes("src/kitten4/devices.rs")), row.type);
  }
  const wood = result.rows.find(row => row.type === "wood_block_get");
  assert.deepEqual(wood.official.map(e => e.module), ["Tn6a", "fhSb"]);
  const modules = webpackModules(source);
  for (const row of result.rows) for (const e of row.official) {
    const text = modules[e.module].toString().slice(e.offset);
    assert.ok(text.startsWith(e.registration === "responder" ? "id:" : row.type), `${row.type}@${e.module}:${e.offset}`);
  }
});
