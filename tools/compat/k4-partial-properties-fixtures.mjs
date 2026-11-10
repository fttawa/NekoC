#!/usr/bin/env node
// Original repository-owned probes; no corpus or official implementation copied.
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import { workspace } from "./k4-scheduling-fixtures.mjs";

const actor = "20000000-0000-4000-8000-000000000001";
const scene = "10000000-0000-4000-8000-000000000001";
const missing = "90000000-0000-4000-8000-000000000099";
const local = "30000000-0000-4000-8000-000000000001";
const global = "30000000-0000-4000-8000-000000000002";
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ id: "", type, fields, inputs, statements });
const num = n => b("math_number", { NUM: String(n) });
const text = s => b("text", { TEXT: s });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const append = value => b("lists_append", {}, { VAR: b("lists_get", { VAR: "result" }), VALUE: value });
const property = (type, sprite, attribute, index = num(0)) => b(type, { sprite, attribute }, type === "get_clone_index_property" ? { index } : {});
const attributes = [...Array.from({ length: 18 }, (_, i) => String(i)), "unknown"];
const wait = () => b("wait", {}, { time: num(0) });

export async function propertyFixtures() {
  const base = await readJson("tests/fixtures/kitten4/semantics-screen.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const specs = {};
  for (const type of ["get", "get_2", "get_3", "get_clone_index_property"]) {
    specs[`${type}-actor`] = [chain(b("start_on_click"),
      b("self_move_to", {}, { x: num(-12.345), y: num(23.456) }),
      b("self_point_towards", {}, { degrees: num(725.555) }),
      ...attributes.map(a => append(property(type, "__self", a))),
      b("self_disappear"), append(property(type, "__self", "8")),
      append(property(type, "__self", local)))];
    specs[`${type}-invalid`] = [chain(b("start_on_click"),
      ...["?", "not-an-entity", missing].map(id => append(property(type, id, "0"))))];
    specs[`${type}-variables`] = [chain(b("start_on_click"),
      append(property(type, "__self", global)),
      append(property(type, "__self", "40000000-0000-4000-8000-000000000099")),
      append(property(type, "__self", local)))];
    if (type !== "get_clone_index_property") {
      specs[`${type}-scene`] = [chain(b("start_on_click"), ...attributes.map(a => append(property(type, scene, a))))];
    }
  }
  for (const [name, index] of Object.entries({ text: text("0"), bool: b("logic_boolean", { BOOL: "TRUE" }),
    fractional: num(0.5), negative: num(-1), nan: b("math_arithmetic", { OP: "DIVIDE" }, { A: num(0), B: num(0) }) })) {
    specs[`clone-index-${name}`] = [chain(b("start_on_click"), append(property("get_clone_index_property", "__self", "0", index)))];
  }
  specs["clone-scene"] = [chain(b("start_on_click"), append(property("get_clone_index_property", scene, "0")))];
  specs["clone-self"] = [chain(b("start_on_click"), b("mirror", { sprite: "__self" }), wait(),
    append(property("get_clone_index_property", actor, "0", num(1)))),
    b("start_as_a_mirror", {}, {}, { DO: chain(b("self_move_to", {}, { x: num(42.125), y: num(-9.875) }),
      append(property("get_3", "__self", "0")), append(property("get_3", actor, "0")),
      append(property("get_clone_index_property", "__self", "0", num(0)))) })];
  const result = {};
  for (const [name, roots] of Object.entries(specs)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC partial properties ${name}`;
    for (const entity of Object.values(project.theatre.scenes)) entity.block_data_json = workspace([], schema);
    project.theatre.actors[actor].block_data_json = workspace(roots, schema);
    project.variables = { result: { id: "result", name: "result", value: [], type: "list", is_global: true, current_entity: actor, visible: false },
      [local]: { id: local, name: "local", value: "local-value", type: "any", is_global: false, current_entity: actor, visible: false } };
    project.variables[global] = { id: global, name: "global", value: 123.456, type: "any", is_global: true, current_entity: actor, visible: false };
    project.variable_order = ["result", local, global];
    result[name] = project;
  }
  return result;
}

async function main() {
  const evidence = { schema: "nekoc-k4-partial-properties-v1", frames: 6, cases: {} };
  for (const [name, project] of Object.entries(await propertyFixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-properties-${name}.bcm`, project);
    if (!process.argv.includes("--record")) continue;
    const record = { sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex") };
    try {
      const trace = await runOracle(project, { frames: evidence.frames, blocks: true });
      evidence.assets = trace.diagnostics.assets;
      record.variables = trace.frames.map(f => f.variables);
    } catch (error) {
      if (!error.diagnostics?.partialTrace?.errors?.length) throw error;
      evidence.assets = error.diagnostics.assets;
      record.errors = error.diagnostics.partialTrace.errors;
      // Domain diagnostics contain original probe IDs only, not third-party data.
      record.execution = error.diagnostics.partialTrace.events.filter(e => e.event === "block");
    }
    evidence.cases[name] = record;
    console.log(name, JSON.stringify(record.variables?.[0] ?? record.errors));
  }
  if (process.argv.includes("--record")) await saveJson("docs/kitten4-partial-properties-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
