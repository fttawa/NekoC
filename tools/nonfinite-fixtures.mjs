// All artwork and blocks in these fixtures are self-authored, not corpus assets.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const actorId = "20000000-0000-4000-8000-000000000001";
const sceneId = "10000000-0000-4000-8000-000000000001";
const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
const num = n => b("math_number", { NUM: Object.is(n, -0) ? "-0" : String(n) });
const text = s => b("text", { TEXT: s });
const chain = nodes => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };

export async function fixture(product, list = false) {
  const kn = product === "kn";
  const schema = JSON.parse(await readFile(path.join(root, "docs/kitten4-block-schema.json"), "utf8")).blocks;
  const div = (a, c) => b("math_arithmetic", kn ? { type: "divide" } : { OP: "DIVIDE" }, { A: num(a), B: num(c) });
  const special = n => div(n === "NaN" ? 0 : n === "Infinity" ? 1 : -1, 0);
  const set = (name, value) => b("variables_set", kn ? { variable: name } : { VAR: name }, kn ? { value } : { VALUE: value });
  const variables = { phase: 0, done: 0, nan: 0, inf: 0, sqrt: 0, log: 0, modulo: 0, badNumber: 0, huge: 0, tiny: 0, negativeZero: 0 };
  const convert = value => b("convert_type", { type: "string" }, kn ? { text: value } : { original_value: value });
  const unary = (op, n) => b(kn ? "math_function" : "math_single", kn ? { type: op === "ROOT" ? "0" : "4" } : { OP: op }, kn ? { num: num(n) } : { NUM: num(n) });
  const nodes = [b(kn ? "on_running_group_activated" : "start_on_click"),
    set("nan", convert(div(0, 0))), set("inf", convert(div(1, 0))), set("sqrt", convert(unary("ROOT", -1))), set("log", convert(unary("LOG10", 0))),
    set("modulo", convert(b("math_modulo", {}, kn ? { A: num(1), B: num(0) } : { DIVIDEND: num(1), DIVISOR: num(0) }))),
    set("badNumber", b("convert_type", { type: "number" }, kn ? { text: text("not-a-number") } : { original_value: text("not-a-number") })),
    set("huge", convert(num(1e21))), set("tiny", convert(num(1e-7))), set("negativeZero", convert(num(-0))),
  ];
  let phase = 0;
  const phases = [];
  for (const property of ["x", "y", "rotation", "scale", "opacity"]) {
    for (const n of ["NaN", "Infinity", "-Infinity"]) {
      nodes.push(b("self_move_to", {}, { x: num(100), y: num(20) }), b("self_point_towards", {}, { degrees: num(35) }), b("set_scale", {}, { scale: num(80) }),
        b(kn ? "self_set_effect" : "self_set_effect_2", { scope: "1" }, kn ? { value: num(25) } : { val: num(25) }));
      nodes.push(property === "x" ? b(kn ? "self_set_position_x" : "self_set_position", kn ? {} : { coordinary: "x" }, { value: special(n) })
        : property === "y" ? b(kn ? "self_set_position_y" : "self_set_position", kn ? {} : { coordinary: "y" }, { value: special(n) })
        : property === "rotation" ? b("self_point_towards", {}, { degrees: special(n) })
          : property === "scale" ? b("set_scale", {}, { scale: special(n) })
            : b(kn ? "self_set_effect" : "self_set_effect_2", { scope: "1" }, kn ? { value: special(n) } : { val: special(n) }));
      nodes.push(set("phase", num(++phase)), b("wait", {}, { time: num(0.35) }));
      phases.push({ phase, property, input: n, bounce: false });
      nodes.push(b("self_bounce_off_edge"), set("phase", num(++phase)), b("wait", {}, { time: num(0.35) }));
      phases.push({ phase, property, input: n, bounce: true });
    }
  }
  if (list) {
    variables.items = [11, 22];
    nodes.push(set("listRead", b(kn ? "list_item" : "lists_get_value", kn ? { item: "any" } : { TYPE: "first" }, kn
      ? { list: b("pure_list_get", { list: "items" }), list_index: div(0, 0) }
      : { VAR: b("lists_get", { VAR: "items" }), INDEX: div(0, 0) })));
    variables.listRead = "unreached";
  }
  nodes.push(set("done", num(1)));
  let serial = 0;
  if (kn) {
    const p = JSON.parse(await readFile(path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "utf8"));
    function identify(node, parent = null) {
      node.id = `nonfinite-${++serial}`;
      node.parent_id = parent;
      for (const child of Object.values(node.inputs)) identify(child, node.id);
      for (const child of Object.values(node.statements ?? {})) identify(child, node.id);
      if (node.next) identify(node.next, node.id);
    }
    // Keep JSON nesting below serde's default limit without changing sequencing.
    const groups = [];
    for (let i = 1; i < nodes.length; i += 20) {
      groups.push({ ...b("warp"), statements: { DO: chain(nodes.slice(i, i + 20)) } });
    }
    const start = chain([nodes[0], ...groups]);
    identify(start);
    p.projectName = "NekoC nonfinite";
    p.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList = [start];
    p.variables.variablesDict = Object.fromEntries(Object.entries(variables).map(([id, value]) => [id, { id, name: id, value, type: Array.isArray(value) ? "list" : "any", visible: true, isGlobal: true, position: { x: 0, y: 0 } }]));
    return { project: p, phases };
  }
  const empty = () => ({ blocks: {}, connections: {}, comments: {} });
  const graph = empty();
  function add(node, parent = null) {
    const id = `nonfinite-${++serial}`;
    graph.blocks[id] = { ...structuredClone(schema[node.type].defaults), id, parent_id: parent, location: [0, 0], fields: { ...schema[node.type].defaults.fields, ...node.fields } };
    graph.connections[id] = {};
    for (const [name, child] of Object.entries(node.inputs)) graph.connections[id][add(child, id)] = { type: "input", input_type: "value", input_name: name };
    if (node.next) graph.connections[id][add(node.next, id)] = { type: "next" };
    return id;
  }
  add(chain(nodes));
  const style = (id, w, h) => ({ id, name: id, adaptive: false, pivot: { x: 0, y: 0 }, rotate_center: { x: 0, y: 0 }, cdn_url: "", url: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#336699"/></svg>`).toString("base64")}` });
  const entity = (id, styles) => ({ id, name: id, styles, current_style_id: styles[0], x: 0, y: 0, scale: 100, rotation: 0, rotation_type: 0, visible: true, draggable: false, workspace_offset: { x: 40, y: 40 }, block_data_json: empty() });
  return { phases, project: { hidden_toolbox: { toolbox: [], blocks: [] }, work_source_label: 1, version: 25, application_version: "4.11.20", work_type: "KITTEN", type: 1, size: { width: 1280, height: 720 }, project_name: "NekoC nonfinite",
    theatre: { current_entity: actorId, current_scene: sceneId, scenes_order: [sceneId], scenes: { [sceneId]: { ...entity(sceneId, ["background"]), actors: [actorId], screen_name: "Main", group_order: ["group"] } },
      actors: { [actorId]: { ...entity(actorId, ["costume"]), scene: sceneId, lock: false, editable_in_tuition_mode: true, user_change_r_c: false, block_data_json: graph } }, groups: { group: { id: "group", name: "", is_fold: false, is_group: false, actors: [actorId], scene: sceneId, visible: true } }, styles: { background: style("background", 1280, 720), costume: style("costume", 20, 20) }, videos: {}, timer: {} },
    variables: Object.fromEntries(Object.entries(variables).map(([id, value]) => [id, { id, name: id, value, type: Array.isArray(value) ? "list" : "any", is_global: true, current_entity: actorId, visible: false, position: { x: 0, y: 0 } }])), variable_order: Object.keys(variables), cloud_variables: {}, audio: {}, audio_order: [], midimusic: [], midi_order: [], matrix: {}, models: {}, toolbox: { current_type: "event", pen: false }, toolbox_order: [], last_toolbox_order: [], hardware_type: "", is_partial: false, ai_lab: {}, broadcasts: {}, painter: { color: [] } } };
}

if (process.argv.includes("--generate")) {
  await mkdir(path.join(root, "tests/fixtures/nonfinite"), { recursive: true });
  for (const p of ["kitten4", "kn"]) for (const list of [false, true]) {
    const { project } = await fixture(p, list);
    await writeFile(path.join(root, `tests/fixtures/nonfinite/${p}${list ? "-list" : ""}.${p === "kn" ? "bcmkn" : "bcm"}`), JSON.stringify(project) + "\n");
  }
}
