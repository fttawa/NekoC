#!/usr/bin/env node
// Repository-owned probes only. No external project/kernel data is embedded.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";

const directory = "tests/fixtures/kitten4";
const scene = "10000000-0000-4000-8000-000000000001";
const otherScene = "10000000-0000-4000-8000-000000000002";
const actor = "20000000-0000-4000-8000-000000000001";
const otherActor = "20000000-0000-4000-8000-000000000002";
const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b("", "math_number", { NUM: String(n) });
const text = s => b("", "text", { TEXT: s });
const get = () => b("", "variables_get", { VAR: "log" });
const add = (id, s) => b(id, "variables_set", { VAR: "log" }, {
  VALUE: { ...b("", "text_join", {}, { ADD0: get(), ADD1: text(s) }), mutation: '<mutation items="2"></mutation>' },
});
const wait = id => b(id, "wait", {}, { time: num(0) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const start = (id, ...nodes) => chain(b(id, "start_on_click"), ...nodes);
const repeat = (id, n, body) => b(id, "repeat_n_times", {}, { times: num(n) }, { DO: body });
const broadcast = (id, waiting = false) => b(id, waiting ? "self_broadcast_and_wait" : "self_broadcast", {}, { message: text("m") });
const listener = body => b("listen", "self_listen", {}, { message: text("m") }, { DO: body });

function workspace(roots, schema) {
  let serial = 0;
  const blocks = {}, connections = {};
  function insert(node, parent = null) {
    const id = node.id || `generated-${++serial}`;
    const defaults = structuredClone(schema[node.type].defaults);
    blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields },
      ...(node.mutation ? { mutation: node.mutation } : {}) };
    const edges = connections[id] = {};
    for (const [kind, children] of [["value", node.inputs], ["statement", node.statements]]) {
      for (const [socket, child] of Object.entries(children)) edges[insert(child, id)] = { type: "input", input_type: kind, input_name: socket };
    }
    if (node.next) edges[insert(node.next, id)] = { type: "next" };
    return id;
  }
  roots.forEach(root => insert(root));
  return { blocks, connections, comments: {} };
}

export async function schedulingFixtures() {
  const base = await readJson(`${directory}/semantics-screen.bcm`);
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  const specs = {
    order: [start("z-first", add("first", "A")), start("a-second", add("second", "B"))],
    wait: [start("z-first", add("before", "A"), wait("zero"), add("after", "C")), start("a-second", add("other", "B"))],
    loop: [start("z-first", repeat("loop", 2, add("iteration", "A")), add("after-loop", "C")), start("a-second", add("other", "B"))],
    fractional: [start("z-first", repeat("loop", 1.5, add("iteration", "A")), add("after-loop", "C"))],
    defaults: [start("start", b("check", "controls_if", {}, {
      IF0: b("compare", "logic_compare", { OP: "EQ" }, {
        A: b("default", "default_value", { TEXT: "-1" }), B: num(-1),
      }),
    }, { DO0: add("matched", "A") }), add("finished", "B"))],
    broadcast: [start("sender", add("before", "A"), broadcast("send"), add("after", "B"), wait("zero"), add("resumed", "D")), listener(add("received", "C"))],
    "broadcast-wait": [start("sender", add("before", "A"), broadcast("send", true), add("after", "D")), listener(chain(add("received", "B"), wait("zero"), add("received-again", "C")))],
    clone: [start("sender", add("before", "A"), b("mirror", "mirror", { sprite: "__self" }), add("after", "B"), wait("zero"), add("resumed", "D")), b("cloned", "start_as_a_mirror", {}, {}, { DO: add("clone-body", "C") })],
    scene: [start("global", add("global-body", "A"), b("switch", "switch_to_screen", {}, { screen: b("", "get_sensing_current_scene", { scene: otherScene }) }), add("after-switch", "B"))],
    entities: [start("actor-one", add("one", "A"))],
    initial: [start("actor-one", add("one", "A"))],
  };
  const result = {};
  for (const [name, roots] of Object.entries(specs)) {
    const project = structuredClone(base);
    project.project_name = `NekoC scheduling ${name}`;
    delete project.compile_result;
    project.theatre.current_scene = scene;
    project.theatre.scenes_order = [scene, otherScene];
    for (const entity of Object.values(project.theatre.scenes)) entity.block_data_json = workspace([], schema);
    project.theatre.scenes[scene].actors = [actor];
    project.theatre.actors[actor].block_data_json = workspace(roots, schema);
    project.variables = { log: { id: "log", name: "log", value: "", type: "any", is_global: true, current_entity: actor, visible: false, position: { x: 0, y: 0 } } };
    project.variable_order = ["log"];
    if (name === "initial") {
      project.theatre.current_scene = otherScene;
      project.theatre.scenes[otherScene].block_data_json = workspace([
        chain(b("inactive", "on_running_group_activated"), add("inactive-body", "X")),
      ], schema);
    }
    if (name === "entities") {
      project.theatre.actors[otherActor] = { ...structuredClone(project.theatre.actors[actor]), id: otherActor,
        block_data_json: workspace([start("actor-two", add("two", "B"))], schema) };
      // Layer order intentionally disagrees with entity insertion order.
      project.theatre.scenes[scene].actors = [otherActor, actor];
      project.theatre.groups.group.actors = [otherActor, actor];
    }
    if (name === "scene") {
      project.theatre.scenes[otherScene].block_data_json = workspace([
        chain(b("activate", "on_running_group_activated"), add("activation-body", "C")),
      ], schema);
    }
    result[name] = project;
  }
  return result;
}

async function main() {
  const record = process.argv.includes("--record");
  const evidence = { schema: "nekoc-k4-scheduling-evidence-v1", cases: {} };
  for (const [name, project] of Object.entries(await schedulingFixtures())) {
    await saveJson(`${directory}/scheduling-${name}.bcm`, project);
    if (record) {
      const trace = await runOracle(project, { frames: 6, blocks: true });
      evidence.assets = trace.diagnostics.assets;
      evidence.cases[name] = { log: trace.frames.map(f => f.variables.log),
        execution: trace.events.filter(e => ["resume", "yield", "finish"].includes(e.event)) };
      console.log(name, evidence.cases[name].log);
    }
  }
  if (record) await saveJson("docs/kitten4-scheduling-evidence.json", evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e); process.exitCode = 1;
});
