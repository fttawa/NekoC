import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { checkProject, projectBlocks, readManifest } from "../tools/compat/kn-share-player-check.mjs";
import { exposeNativeHandles, instrumentBundle, publicUrl } from "../tools/compat/kn-share-player-refresh.mjs";

const block = (type, rest = {}) => ({ id: type, type, ...rest });
const project = (actorBlocks = [], sceneBlocks = [], procedureBlocks = []) => ({
  toolType: "KN",
  scenes: { scenesDict: { scene: { nekoBlockJsonList: sceneBlocks } } },
  actors: { actorsDict: { actor: { nekoBlockJsonList: actorBlocks } } },
  procedures: { proceduresDict: { procedure: { nekoBlockJsonList: procedureBlocks, params: [{ type: "String" }] } } },
  variables: { variablesDict: { value: { type: "Number" } } },
});

test("refresh fails closed if the registry/loader changes and only instruments registrations", () => {
  const source = 'a.prototype.register=function(r){var x=r.id,y=r.namespace;};var __webpack_exports__={};';
  const result = instrumentBundle(source);
  assert.equal(result.locations.registryRegisterCharOffset, 0);
  assert.ok(result.source.includes("id:r.id,namespace:r.namespace"));
  assert.ok(result.source.includes("window.__knShareRequire=__webpack_require__"));
  assert.throws(() => instrumentBundle("_object_literal"), /changed/);
  assert.throws(() => instrumentBundle(source + "var __webpack_exports__={};"), /changed/);
  assert.throws(() => instrumentBundle(source.replace(";var __webpack", ";" + source.slice(0, source.indexOf("var __webpack")) + "var __webpack")), /changed/);
  assert.throws(() => exposeNativeHandles(source), /initializer changed/);
  assert.throws(() => publicUrl("https://codemao.cn.evil.test/main.js"), /public KN URL/);
  assert.throws(() => publicUrl("http://kn.codemao.cn/player"), /public KN URL/);
  assert.throws(() => publicUrl("https://user:secret@kn.codemao.cn/player"), /public KN URL/);
  assert.equal(publicUrl("https://creation.bcmcdn.com/neko/main.js").hostname, "creation.bcmcdn.com");
});

test("share snapshot is sorted, unique, pinned and not an editor string inventory", async () => {
  const manifest = await readManifest();
  assert.deepEqual(manifest.blocks, [...new Set(manifest.blocks)].sort());
  assert.ok(manifest.blocks.length > 200);
  assert.ok(manifest.sources.every(source => /^https:\/\//.test(source.url) && /^[a-f0-9]{64}$/.test(source.sha256)));
  for (const type of ["variables_set", "math_number", "repeat_n_times", "procedures_2_callreturn"]) {
    assert.ok(manifest.blocks.includes(type), type);
  }
  for (const type of ["_object_literal", "_object_get", "_object_set"]) {
    assert.ok(!manifest.blocks.includes(type), type);
    assert.equal(checkProject(project([block(type)]), manifest).ok, false);
  }
  // EVENT_BLOCKS alone is not enough: compile_event still invokes a domain.
  for (const type of ["block_on_break", "mouse_on_emit", "player_position_on_change", "logic_ternary", "math_trig_rad"]) {
    assert.ok(!manifest.blocks.includes(type), type);
  }
});

test("walk scenes, actors, procedures, nested inputs, statements, next and shadows", async () => {
  const manifest = await readManifest();
  const p = project([
    block("on_running_group_activated", {
      fields: { annotation: { type: "not_an_opcode" } },
      mutation: { type: "also_data" },
      inputs: { value: block("_object_get") },
      shadows: { value: block("future_shadow") },
      statements: { DO: block("_object_set", { shield: true }) },
      next: block("_object_literal"),
    }),
  ], [block("_object_get")], [block("procedures_2_defnoreturn", {
    inputs: { PARAMS0: block("procedures_2_stable_parameter") },
    statements: { STACK: block("future_procedure") },
  })]);
  const result = checkProject(p, manifest);
  assert.equal(result.ok, false);
  assert.equal(result.blockCount, 9);
  assert.equal(result.metadataBlockCount, 1);
  assert.equal(result.unsupported.find(item => item.type === "_object_get").count, 2);
  assert.deepEqual(result.unsupported.map(item => item.type).sort(),
    ["_object_get", "_object_literal", "_object_set", "future_procedure", "future_shadow"].sort());
  assert.ok(result.unsupported.find(item => item.type === "future_procedure").occurrences[0].location.includes("/procedures/"));
  assert.equal(projectBlocks(p).filter(item => item.owner === "scene").length, 1);
});

test("unknown types fail closed; executable names in project metadata are ignored", async () => {
  const manifest = await readManifest();
  assert.equal(checkProject(project([block("math_number")]), manifest).ok, true);
  assert.equal(checkProject(project(), manifest).ok, true);
  assert.throws(() => projectBlocks({}), /Kitten N/);
  assert.throws(() => projectBlocks({ ...project(), toolType: "KITTEN4" }), /Kitten N/);
});

test("XML fallback shadows are checked even when an active input is present", async () => {
  const manifest = await readManifest();
  const p = project([block("variables_set", {
    inputs: { value: block("math_number") },
    shadows: { value: '<shadow type="future&amp;shadow"><field name="type">text</field></shadow>' },
  })]);
  const result = checkProject(p, manifest);
  assert.equal(result.blockCount, 3);
  assert.equal(result.unsupported[0].type, "future&shadow");
});

test("XML shadows decode numeric entities without reading comments or data-type attributes", async () => {
  const manifest = await readManifest();
  const p = project([block("variables_set", { shadows: { value:
    '<shadow id="xml-block" note="a > b" type="_object_&#x67;&#101;t">'
      + '<!-- <block type="comment"/> --><![CDATA[<block type="cdata"/>]]>'
      + '<block data-type="annotation"/></shadow>',
  } })]);
  const result = checkProject(p, manifest);
  assert.equal(result.blockCount, 2);
  assert.equal(result.unsupported[0].type, "_object_get");
  assert.equal(result.unsupported[0].occurrences[0].id, "xml-block");
});

test("a socket named type is a map key, not a block discriminator", async () => {
  const manifest = await readManifest();
  const p = project([block("variables_set", { shadows: { type: '<shadow type="_object_get"/>', value: '<shadow type="text"/>' } })]);
  const result = checkProject(p, manifest);
  assert.equal(result.blockCount, 3);
  assert.deepEqual(result.unsupported.map(item => item.type), ["_object_get"]);
});

test("long next chains and large flat workspaces do not exhaust the call stack", async () => {
  const manifest = await readManifest();
  let chain = block("_object_get");
  for (let i = 0; i < 10000; i++) chain = block("variables_set", { next: chain });
  const result = checkProject(project([chain, ...Array.from({ length: 10000 }, () => block("math_number"))]), manifest);
  assert.equal(result.blockCount, 20001);
  assert.equal(result.unsupported[0].count, 1);
});

test("CLI emits JSON and exits 0 / 1 / 2 without networking", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nekoc-kn-share-"));
  try {
    const input = path.join(dir, "probe.bcmkn");
    const run = args => spawnSync(process.execPath, ["tools/compat/kn-share-player-check.mjs", ...args], { encoding: "utf8" });
    await fs.writeFile(input, JSON.stringify(project([block("math_number")])));
    let result = run([input]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    await fs.writeFile(input, JSON.stringify(project([block("_object_get")])));
    result = run([input]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).unsupported[0].type, "_object_get");
    await fs.writeFile(input, "not json");
    result = run([input]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(run([]).status, 2);
    assert.equal(run(["--help"]).status, 0);
    assert.equal(run([path.join(dir, "absent.bcmkn")]).status, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("audit keeps live registry differences, structural exemptions and controlled failures separate", async () => {
  const audit = JSON.parse(await fs.readFile(new URL("../docs/compatibility/kn-share-player-audit.json", import.meta.url), "utf8"));
  const manifest = await readManifest();
  assert.equal(audit.editorOnlyDomains.length, 178);
  assert.equal(audit.editorOnlyAfterStructuralExemptions.length, 176);
  assert.ok(audit.editorOnlyDomains.includes("math_number"));
  assert.ok(!audit.editorOnlyAfterStructuralExemptions.includes("math_number"));
  assert.ok(!audit.editorOnlyAfterStructuralExemptions.includes("text"));
  assert.deepEqual(audit.editorOnlyAfterStructuralExemptions,
    audit.editorOnlyDomains.filter(type => !manifest.blocks.includes(type)));
  assert.deepEqual(audit.compiler.unsupported,
    ["_object_get", "_object_literal", "_object_set", "logic_ternary", "math_trig_rad"]);
  for (const c of audit.controlledExecution.cases.filter(c => c.type.startsWith("_object_"))) {
    assert.equal(c.errors[0].category, "HEART.CLIENT");
    assert.equal(c.errors[0].number, 6);
    assert.equal(c.errors[0].ns_id, c.type);
    assert.equal(c.errors[0].caught_at, "compile_domain_functions");
  }
  assert.equal(audit.editorProbeCheck.ok, true);
  assert.equal(audit.editorProbeCheck.projects.length, 7);
  // A separate guard: the maintained Markdown must not omit part of the list.
  const markdown = await fs.readFile(new URL("../docs/compatibility/kn-share-player.md", import.meta.url), "utf8");
  const names = markdown.split(/```text\r?\n/)[1].split("```")[0].trim().split(/\s+/).sort();
  assert.deepEqual(names, audit.editorOnlyAfterStructuralExemptions.slice().sort());
});
