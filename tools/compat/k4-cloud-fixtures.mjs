#!/usr/bin/env node
// Self-authored cloud probes; external works and implementation are not copied.
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
const text = s => b("text", { TEXT: s });
const num = n => b("math_number", { NUM: String(n) });
const get = id => b("cloud_variables_get", { VAR: id });
const set = (id, value) => b("cloud_variables_set", { VAR: id }, { VALUE: value });
const read = (id, value) => b("variables_set", { VAR: id }, { VALUE: value });
const list = (type, fields = {}, inputs = {}) => b(`cloud_lists_${type}`, { VAR: "items", ...fields }, inputs);

export async function cloudFixtures() {
  const base = await readJson("tests/fixtures/kitten4/semantics-screen.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const specs = {
    defaults: [read("public", get("shared")), read("private", get("personal")), read("length", list("length")),
      read("missing", list("get_value", { TYPE: "nth" }, { INDEX: num(2) })),
      read("hidden", b("is_ranking_show_hide", { VAL: "hide" }))],
    writes: [set("shared", text("room/message")), set("personal", num(4)),
      b("change_cloud_variable", { valname: "personal", method: "increase" }, { n: num(3) }),
      read("public", get("shared")), read("private", get("personal")),
      list("append", { POS: "last" }, { VALUE: text("tail") }),
      list("append", { POS: "first" }, { VALUE: text("head") }),
      list("insert_value", {}, { INDEX: num(99), VALUE: text("inserted") }),
      list("replace", { TYPE: "nth" }, { INDEX: num(99), VALUE: text("replacement") }),
      list("delete", { TYPE: "nth" }, { INDEX: num(99) }),
      list("delete", { TYPE: "nth" }, { INDEX: num(0) }),
      read("length", list("length")), read("missing", list("get_value", { TYPE: "nth" }, { INDEX: num(0) }))],
    limits: [set("shared", text("x".repeat(1030))), set("personal", num(9)), set("personal", b("logic_boolean", { BOOL: "TRUE" })),
      list("append", { POS: "last" }, { VALUE: text("z".repeat(140)) }),
      read("public", get("shared")), read("private", get("personal")), read("length", list("length"))],
    change: [set("shared", text("12")), b("change_cloud_variable", { valname: "shared", method: "increase" }, { n: num(3) }),
      read("public", get("shared")), b("change_cloud_variable", { valname: "shared", method: "decrease" }, { n: num(3) }),
      read("private", get("shared"))],
    ranking: [b("show_ranking", { VAR: "personal" }), read("shown", b("is_ranking_show_hide", { VAL: "show" })),
      b("hide_ranking"), read("hidden", b("is_ranking_show_hide", { VAL: "hide" })),
      b("show_ranking", { VAR: "?" }), read("invalid", b("is_ranking_show_hide", { VAL: "show" }))],
  };
  const result = {};
  for (const [name, body] of Object.entries(specs)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC cloud ${name}`;
    project.cloud_variables = Object.fromEntries([["shared", "public"], ["personal", "private"], ["items", "public_list"]].map(([id, type]) =>
      [id, { id, cvid: `local-${id}`, name: id, type, value: type === "public_list" ? ["ignored"] : "ignored/saved", visible: false, position: { x: 0, y: 0 }, scale: 1, offset: { x: 0, y: 0 } }]));
    project.variables = Object.fromEntries(["public", "private", "length", "missing", "shown", "hidden", "invalid"].map(id =>
      [id, { id, name: id, value: "unexecuted", type: "any", is_global: true, visible: false, position: { x: 0, y: 0 } }]));
    project.variable_order = Object.keys(project.variables);
    const blocks = {}, connections = {};
    let serial = 0;
    function insert(node, parent = null) {
      const id = `cloud-${++serial}`;
      const defaults = structuredClone(schema[node.type].defaults);
      blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
      const edges = connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) edges[insert(child, id)] = { type: "input", input_type: "value", input_name: socket };
      return id;
    }
    const roots = [b("start_on_click"), ...body];
    let previous;
    for (const node of roots) {
      const id = insert(node, previous);
      if (previous) connections[previous][id] = { type: "next" };
      previous = id;
    }
    for (const entity of Object.values(project.theatre.scenes)) entity.block_data_json = { blocks: {}, connections: {}, comments: {} };
    const actor = Object.values(project.theatre.actors)[0];
    actor.block_data_json = { blocks, connections, comments: {} };
    result[name] = project;
  }
  return result;
}

async function main() {
  const evidence = { schema: "nekoc-k4-cloud-evidence-v1", cases: {} };
  for (const [name, project] of Object.entries(await cloudFixtures())) {
    await saveJson(`tests/fixtures/kitten4/cloud-${name}.bcm`, project);
    if (process.argv.includes("--record")) {
      const trace = await runOracle(project, { frames: 3, blocks: true });
      evidence.assets = trace.diagnostics.assets;
      evidence.cases[name] = { variables: trace.frames.map(f => f.variables), errors: trace.errors };
      console.log(name, JSON.stringify(evidence.cases[name]));
    }
  }
  if (process.argv.includes("--record")) await saveJson("docs/kitten4-cloud-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
