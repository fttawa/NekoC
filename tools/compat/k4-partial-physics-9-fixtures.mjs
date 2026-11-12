// Original soft-body workspaces. No third-party projects or solver code.
import { readFileSync } from "node:fs";
import { fixtures, actorId, floorId } from "../physics-fixtures.mjs";
export { actorId };
const schema = JSON.parse(readFileSync(new URL("../../docs/kitten4-block-schema.json", import.meta.url))).blocks;
export function physicsSoftFixtures() {
  const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const p = (type, values = {}, fields = {}) => b(`physics2_${type}`, fields, Object.fromEntries(Object.entries(values).map(([k,v]) => [k,n(v)])));
  const texture = soft => p("set_texture", {}, { texture_type: soft ? "soft" : "hard" });
  const wait = time => b("wait", {}, { time: n(time) });
  const flex = value => p("set_flexibility", { value });
  const base = [p("set_gravity", { value: 0, dir: -90 }), texture(true)];
  const specs = {
    coast: { commands: [...base, p("set_speed", { value: 2, dir: 0 })], frames: 90 },
    "impact-25": { commands: [p("set_gravity", { value: 2, dir: -90 }), texture(true), flex(25), p("set_boundary", {}, { physics_bound_type: "bottom_bound" })], frames: 120, y: -290 },
    "impact-90": { commands: [p("set_gravity", { value: 2, dir: -90 }), texture(true), flex(90), p("set_boundary", {}, { physics_bound_type: "bottom_bound" })], frames: 120, y: -290 },
    rebuild: { commands: [...base, p("set_speed", { value: 2, dir: 0 }), wait(.14), flex(90), wait(.14), texture(true), wait(.14), b("set_scale", {}, { scale: n(150) }), wait(.14), texture(false), wait(.14), texture(true)], frames: 90 },
  };
  return Object.fromEntries(Object.entries(specs).map(([name, spec]) => {
    const project = structuredClone(fixtures().soft);
    project.project_name = `NekoC original soft physics 9 ${name}`;
    project.toolbox.physics2 = true;
    project.variables = {}; project.variable_order = [];
    delete project.theatre.actors[floorId]; delete project.compile_result;
    const style = project.theatre.styles["probe-style"];
    style.width = 160; style.height = 120;
    const outline = [];
    for (let x=0; x<=160; x+=4) outline.push([x, x%8 ? 12 : 0]);
    for (let x=160; x>=0; x-=4) outline.push([x, x%8 ? 108 : 120]);
    style.url = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><polygon points="${outline.map(p=>p.join(",")).join(" ")}" fill="#3388aa"/></svg>`).toString("base64")}`;
    project.theatre.actors[actorId].y = spec.y || 0;
    const graph = { blocks: {}, connections: {}, comments: {} };
    let serial = 0;
    function insert(node, parent = null) {
      const id = `soft-9-${++serial}`, defaults = structuredClone(schema[node.type].defaults);
      graph.blocks[id] = { ...defaults, id, parent_id: parent, location: [0,0], fields: { ...defaults.fields, ...node.fields } };
      graph.connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) graph.connections[id][insert(child,id)] = { type: "input", input_type: "value", input_name: socket };
      return id;
    }
    let previous;
    for (const node of [b("start_on_click"), ...spec.commands]) {
      const id = insert(node, previous);
      if (previous) graph.connections[previous][id] = { type: "next" };
      previous = id;
    }
    project.theatre.actors[actorId].block_data_json = graph;
    return [name, { project, frames: spec.frames }];
  }));
}

export function physicsSoftBlockedFixture() {
  const project = physicsSoftFixtures().coast.project;
  project.project_name = "NekoC original soft physics 9 rectangle watchdog negative";
  const style = project.theatre.styles["probe-style"];
  style.width = 80; style.height = 60;
  style.url = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#3388aa"/></svg>').toString("base64")}`;
  return project;
}
