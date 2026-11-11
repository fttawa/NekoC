#!/usr/bin/env node
// Original declaration probes, derived only from the repository-owned base.
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import { workspace } from "./k4-scheduling-fixtures.mjs";

const b = (id, type, fields = {}, inputs = {}) => ({ id, type, fields, inputs, statements: {} });
const num = n => b("", "math_number", { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const wait = () => b("", "wait", {}, { time: num(0) });
const visible = (id, show, list = false) => b("", list ? "show_hide_list" : "show_hide_variable", { VAR: id, FUNC: show ? "show" : "hide" });

export async function monitorFixtures() {
  const base = await readJson("tests/fixtures/kitten4/runerr-addition.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const actor = Object.keys(base.theatre.actors)[0];
  const scenes = base.theatre.scenes_order;
  for (const entity of [...Object.values(base.theatre.actors), ...Object.values(base.theatre.scenes)]) {
    entity.block_data_json = workspace([], schema);
  }
  base.project_name = "NekoC original initial monitor probe";
  base.application_version = "4.11.19";
  base.size = { width: 640, height: 360 };
  base.cloud_variables = {};
  const variable = (id, value, visible, owner = "", type = "any") => ({
    id, name: `Monitor ${id}`, value, type, is_global: !owner, current_entity: owner,
    visible, theme: "common", scale: 1, position: { x: -300, y: 160 },
  });
  // Intentionally nonlexical declaration order; variable_order disagrees too.
  base.variables = {
    "z-score": variable("z-score", 17, true),
    "a-text": variable("a-text", "initial text", true),
    "m-items": variable("m-items", ["alpha", 23, true], true, "", "list"),
    "private-score": variable("private-score", 31, true, actor),
    "private-items": variable("private-items", ["local", 9], true, actor, "list"),
    "stage-score": variable("stage-score", 45, true, scenes[0]),
    "inactive-score": variable("inactive-score", 57, true, scenes[1]),
    "hidden": variable("hidden", 68, false),
    "unspecified": variable("unspecified", 79, false),
  };
  delete base.variables.unspecified.visible;
  base.variable_order = Object.keys(base.variables).reverse();
  const idle = structuredClone(base);
  const dynamic = structuredClone(base);
  dynamic.project_name += " dynamic";
  dynamic.theatre.actors[actor].block_data_json = workspace([chain(
    b("monitor-start", "start_on_click"), wait(),
    visible("z-score", false), visible("private-items", false, true), visible("hidden", true),
    b("", "variables_set", { VAR: "a-text" }, { VALUE: num(88) }),
    b("", "variables_set", { VAR: "private-score" }, { VALUE: num(99) }),
    wait(), visible("z-score", true), visible("private-items", true, true), visible("hidden", false),
  )], schema);
  return { idle, dynamic };
}

// Read existing official widget state; no mutation of vendor files or functions.
export async function widgetSnapshot(page, project) {
  return page.evaluate(ids => {
    const container = window.__k4OracleRequire("a1xw").a().core.components.get_draggable_container();
    return ids.map(id => {
      const widget = container.get_variable(id) || container.get_list(id);
      return { id, exists: Boolean(widget), visible: widget ? widget.get_visible() : null };
    });
  }, Object.keys(project.variables));
}

async function main() {
  const record = process.argv.includes("--record");
  const evidence = { schema: "nekoc-k4-initial-monitors-v1", cases: {} };
  for (const [name, project] of Object.entries(await monitorFixtures())) {
    await saveJson(`tests/fixtures/kitten4/monitors-${name}.bcm`, project);
    if (!record) continue;
    const widgets = [];
    let initial;
    const trace = await runOracle(project, { frames: 8, seed: 1, virtualTime: true,
      beforeStart: async page => { initial = await widgetSnapshot(page, project); },
      onFrame: async page => { widgets.push(await widgetSnapshot(page, project)); },
    });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = {
      sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
      initial, widgets, variables: trace.frames.map(f => f.variables), errors: trace.errors,
    };
    console.log(name, JSON.stringify(evidence.cases[name]));
  }
  if (record) await saveJson("docs/kitten4-monitor-evidence.json", evidence);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
