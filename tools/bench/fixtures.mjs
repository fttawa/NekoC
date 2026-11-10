// Repository-owned synthetic K4 workspaces. No external corpus is embedded.
import { readJson, saveJson } from "../compat/k4-oracle.mjs";
import { workspace } from "../compat/k4-scheduling-fixtures.mjs";

const b = (type, fields = {}, inputs = {}, statements = {}) => ({ id: "", type, fields, inputs, statements });
const num = n => b("math_number", { NUM: String(n) });
const text = s => b("text", { TEXT: s });
const get = (id = "log") => b("variables_get", { VAR: id });
const set = (value, id = "log") => b("variables_set", { VAR: id }, { VALUE: value });
const list = () => b("lists_get", { VAR: "result" });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const repeat = (count, body) => b("repeat_n_times", {}, { times: num(count) }, { DO: body });
const warp = body => b("warp", {}, {}, { DO: body });
const add = (a, c, op = "ADD") => b("math_arithmetic", { OP: op }, { A: a, B: c });
const inc = () => set(add(get(), num(1)));
const call = () => ({ ...b("procedures_2_callnoreturn", { NAME: "recur" }), mutation: '<mutation def_id="recur" name="recur" type="NORMAL"></mutation>' });

export async function fixtures() {
  const base = await readJson("tests/fixtures/kitten4/scheduling-order.bcm");
  const schema = (await readJson("docs/kitten4-block-schema.json")).blocks;
  // Calls are context-dependent constructors; use statement defaults and explicit mutation.
  schema.procedures_2_callnoreturn = structuredClone(schema.variables_set);
  schema.procedures_2_callnoreturn.defaults.type = "procedures_2_callnoreturn";
  const specs = {
    numeric: [repeat(4000, set(add(add(get(), num(1)), num(0.999), "MULTIPLY")))],
    list: [b("lists_delete", { TYPE: "all" }, { VAR: list() }), repeat(1000, chain(
      b("lists_append", {}, { VAR: list(), VALUE: get() }),
      set(b("lists_index_of", {}, { VAR: list(), VALUE: num(-1) })), inc()))],
    string: [set(text("")), repeat(2000, set({ ...b("text_join", {}, { ADD0: get(), ADD1: text("abcdefgh") }), mutation: '<mutation items="2"></mutation>' }))],
    clones: [repeat(200, b("mirror", { sprite: "__self" }))],
    broadcast: [repeat(100, b("self_broadcast", {}, { message: text("bench") }))],
    recursion: [set(num(0), "depth"), repeat(40, call())],
    pen: [b("self_pen_down"), repeat(4000, chain(b("self_move_to", {}, { x: get(), y: num(0) }), inc()))],
  };
  const projects = {};
  for (const [name, body] of Object.entries(specs)) {
    const p = structuredClone(base);
    delete p.compile_result;
    const actor = Object.keys(p.theatre.actors)[0];
    p.project_name = `NekoC performance ${name}`;
    p.variables.log.value = 0;
    p.variables.result = { ...p.variables.log, id: "result", name: "result", type: "list", value: [] };
    p.variables.depth = { ...p.variables.log, id: "depth", name: "depth", value: 0 };
    p.variable_order = ["log", "result", "depth"];
    const roots = [chain(b("start_on_click"), b("repeat_forever", {}, {}, { DO: warp(chain(...body)) }))];
    if (name === "clones") roots.push(b("start_as_a_mirror", {}, {}, { DO: b("dispose_clone") }));
    if (name === "broadcast") for (let i = 0; i < 12; i++) roots.push(b("self_listen", {}, { message: text("bench") }, { DO: inc() }));
    if (name === "recursion") {
      const def = { ...b("procedures_2_defnoreturn", { NAME: "recur" }, {}, { STACK: chain(
        set(add(get("depth"), num(1)), "depth"), inc(),
        b("controls_if", {}, { IF0: b("logic_compare", { OP: "LT" }, { A: get("depth"), B: num(20) }) }, { DO0: call() }),
        set(add(get("depth"), num(1), "MINUS"), "depth")) }), id: "recur" };
      roots.push(def);
    }
    p.theatre.actors[actor].block_data_json = workspace(roots, schema);
    projects[name] = p;
  }
  return projects;
}

export async function writeFixtures(directory) {
  const paths = [];
  for (const [name, project] of Object.entries(await fixtures())) {
    const file = `${directory}/${name}.bcm`;
    await saveJson(file, project);
    paths.push(file);
  }
  return paths;
}
