import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { hardwareTypes, implementationBoundary } from "../tools/compat/kn-other-hardware-probe.mjs";

const evidence = JSON.parse(await fs.readFile(new URL("../docs/kn-other-hardware-evidence.json", import.meta.url), "utf8"));
const panelEvidence = JSON.parse(await fs.readFile(new URL("../docs/kn-panel-evidence.json", import.meta.url), "utf8"));
const { panels, cases, events, registeredAudit } = evidence.editor;
const findCase = (name, label) => cases.find(c => c.name === name && c.label === label);

test("all 22 other official hardware types have distinct synchronous, Promise or event boundaries", () => {
  assert.equal(evidence.schema, "nekoc-kn-other-hardware-v1");
  assert.equal(evidence.editor.version, "0.27.4");
  assert.equal(evidence.ok, true);
  assert.ok(Object.values(evidence.checks).every(Boolean));
  assert.deepEqual(evidence.editor.hardwareIds, []);
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(panels.map(p => p.name), hardwareTypes);
  assert.equal(cases.length, 167);
  assert.deepEqual(["reporter", "command", "event"].map(kind => panels.filter(p => p.kind === kind).length), [7, 12, 3]);
  for (const panel of panels) {
    assert.equal(panel.implementationBoundary, implementationBoundary(panel));
    if (panel.kind === "event") {
      assert.equal(cases.some(c => c.name === panel.name), false);
      assert.ok(events.some(e => e.name === panel.name));
      continue;
    }
    const ordinary = cases.filter(c => c.name === panel.name && !["throwing getters", "null arguments"].includes(c.label));
    for (const c of ordinary) {
      assert.equal(c.error, undefined, panel.name);
      assert.equal(c.promise, panel.kind === "command", panel.name);
      assert.deepEqual(c.result, panel.kind === "command" ? { type: "undefined" } : panel.output === "Boolean" ? { type: "boolean", value: false } : { type: "number", value: "NaN" }, panel.name);
      assert.equal(c.boundary, panel.kind === "command" ? "promise-fulfilled" : "synchronous-return");
    }
  }
});

test("guard/property-access and exception boundaries are not confused with child evaluation", () => {
  const keyFirst = new Set(["catbit_button_is_pressed", "wand_button_is_pressed", "wand_coordinate", "wand_rotation"]);
  for (const panel of panels.filter(p => p.kind !== "event")) {
    const access = findCase(panel.name, "argument access"), throwing = findCase(panel.name, "throwing getters"), nullArgs = findCase(panel.name, "null arguments");
    assert.deepEqual(access.argumentReads, keyFirst.has(panel.name) ? ["key"] : []);
    assert.deepEqual(throwing.argumentReads, keyFirst.has(panel.name) ? ["key"] : []);
    if (keyFirst.has(panel.name)) {
      assert.equal(throwing.boundary, "synchronous-throw");
      assert.match(throwing.error, /probe getter key/);
      assert.equal(nullArgs.boundary, "synchronous-throw");
      assert.match(nullArgs.error, /^TypeError:/);
    } else {
      assert.equal(throwing.error, undefined);
      assert.equal(nullArgs.error, undefined);
      assert.deepEqual(throwing.result, access.result);
      assert.deepEqual(nullArgs.result, access.result);
    }
  }
  assert.deepEqual(panels.find(p => p.name === "set_robot_master_motor_power_rotation_duration").inputs, ["power", "times"]);
  assert.deepEqual(panels.find(p => p.name === "set_robot_master_motor_power_rotation_duration").argumentOrder, ["motor", "power", "direction", "times"]);
  assert.deepEqual(panels.find(p => p.name === "set_robot2_master_motor_power_rotation_duration").argumentOrder, ["power", "direction", "times"]);
  assert.ok(evidence.limitations.some(s => s.includes("child-expression")));
});

test("event specifications are predicates/actions, not disconnected command return values", () => {
  for (const event of events) {
    assert.equal(event.async, false);
    assert.equal(event.entitySpecific, false);
    if (event.name === "wand_direction_when") {
      assert.equal(event.responderType, "action");
      assert.equal(event.hasTriggerFunction, false);
      assert.deepEqual(event.filterArguments, { value: "key", sub_type: "none" });
    } else {
      assert.equal(event.responderType, "dynamic");
      assert.deepEqual(event.filterArguments, { value: "type", sub_type: "key" });
      assert.deepEqual(event.statefulness, { default_value: "", automatic_transitions: "one_frame", use_sub_type: true });
      assert.deepEqual(event.calls.map(c => c.result), [false, false, true, false].map(value => ({ type: "boolean", value })));
    }
  }
});

test("41 non-panel registered types retain official construction and existing VM paths", () => {
  const expected = panelEvidence.typeGroups["registered-not-in-audited-panels"];
  const rows = registeredAudit.rows.filter(r => r.name !== "get_sprite_property");
  assert.equal(rows.length, 41);
  assert.deepEqual(rows.map(r => r.name), expected);
  assert.deepEqual(evidence.vmAudit.rows.map(r => r.name), expected);
  for (const row of rows) {
    assert.equal(row.definitionRegistered, true, row.name);
    assert.equal(row.constructed, true, row.name);
    assert.ok(evidence.vmAudit.rows.find(r => r.name === row.name).explicitNameLines.length > 0, row.name);
    assert.ok(evidence.sourceLocations.some(l => l.symbol === "registered-reference-" + row.name));
  }
  assert.equal(rows.filter(r => r.conversions.some(c => c.errorCount === 0)).length, 36);
  assert.deepEqual(rows.filter(r => !r.conversions.some(c => c.errorCount === 0)).map(r => r.name), ["_return_statement", "calculate", "get_timer", "reset_timer", "start_on_click"]);
  for (const name of ["_object_get", "_object_set", "_array_literal", "controls_while", "self_listen_value", "traverse_number_value", "traverse_number_param", "on_bump_actor_value", "script_variables_value"]) assert.ok(rows.find(r => r.name === name).conversions.some(c => c.errorCount === 0), name);
});

test("get_sprite_property is a declared API alias, not a registered VM block", () => {
  const alias = registeredAudit.rows.find(r => r.name === "get_sprite_property");
  assert.equal(alias.declarationPresent, true);
  assert.equal(alias.definitionRegistered, false);
  assert.equal(alias.constructed, false);
  assert.equal(alias.domainIndex, null);
  for (const [attribute, type] of [["x", "coordinate_of_sprite"], ["color", "effect_of_sprite"]]) {
    const conversion = registeredAudit.conversions.find(c => c.code === `get_sprite_property('--self', '${attribute}');`);
    assert.deepEqual(conversion.errors, []);
    assert.ok(conversion.types.includes(type));
    assert.ok(!conversion.types.includes("get_sprite_property"));
  }
  const unsupported = registeredAudit.conversions.find(c => c.code === "get_sprite_property('--self', 'size');");
  assert.ok(unsupported.errors.length > 0);
  assert.ok(unsupported.types.includes("get_sprite_property"));
});

test("tracked evidence is metadata only and preserves explicit limits", () => {
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["body", "bodies", "functionSource", "source", "xml", "runtimeFunctions"].includes(key), key);
      walk(child);
    }
  };
  walk(evidence);
  assert.ok(evidence.limitations.some(s => s.includes("scheduling")));
  assert.ok(evidence.limitations.some(s => s.includes("semantic completeness")));
});

test("optional downloaded bytes reproduce every source anchor", async t => {
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const cache = new Map();
  for (const loc of evidence.sourceLocations) {
    let bytes = cache.get(loc.bundle);
    if (!bytes) {
      try { bytes = await fs.readFile(new URL("../dist/kn-other-hardware/" + loc.bundle, import.meta.url)); }
      catch (error) { if (error.code === "ENOENT") return t.skip("Run the independent other-hardware probe for original source bytes"); throw error; }
      cache.set(loc.bundle, bytes);
    }
    assert.equal(hash(bytes), loc.bundleSha256);
    assert.equal(hash(bytes.subarray(loc.byteOffset).toString("utf8").slice(0, loc.excerptCharacters)), loc.excerptSha256, loc.symbol);
  }
});
