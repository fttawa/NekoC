// Original workspaces and SVGs only; never reads corpus projects.
import { readFileSync } from "node:fs";
import { fixtures, actorId, floorId } from "../physics-fixtures.mjs";

const schema = JSON.parse(readFileSync(new URL("../../docs/kitten4-block-schema.json", import.meta.url))).blocks;
export { actorId };
export function physicsTrajectoryFixtures() {
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const p = (type, values = {}, fields = {}) => b(`physics2_${type}`, fields,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, n(value)])));
  const gravity = (value, dir = -90) => p("set_gravity", { value, dir });
  const speed = (value, dir = 0) => p("set_speed", { value, dir });
  const store = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
  const property = name => p("get_property", {}, { property: name, sprite: "__self" });
  const cases = {
    coast: [gravity(0), speed(2)],
    fall: [gravity(2)],
    "default-gravity": [p("enable_force", {}, { is_enable: "true" })],
    diagonal: [gravity(0), speed(99, 45)],
    "legacy-limit": [gravity(0), b("set_velocity", {}, { value: n(10000), dir: n(0) })],
    "legacy-diagonal-limit": [gravity(0), b("set_velocity_by_vector", {}, { x_axis: n(10000), y_axis: n(10000) })],
    force: [gravity(0), p("set_mass", { mass: 2 }), p("set_force", { value: 12, dir: 0 })],
    bounce: [gravity(2), p("set_boundary", {}, { physics_bound_type: "bottom_bound" }),
      p("set_resilience", { restitution: 1 })],
    friction: [gravity(2), p("set_boundary", {}, { physics_bound_type: "bottom_bound" }),
      p("set_roughness", { friction: 1 }), speed(2)],
    material: [gravity(0), p("set_roughness", { friction: .7 }), p("set_resilience", { restitution: .8 })],
    stop: [gravity(2), b("wait", {}, { time: n(.25) }),
      store("beforeY", b("get_3", { sprite: "__self", attribute: "1" })),
      gravity(0), speed(0), b("wait", {}, { time: n(.25) }),
      store("afterY", b("get_3", { sprite: "__self", attribute: "1" }))],
  };
  function workspace(commands) {
    const graph = { blocks: {}, connections: {}, comments: {} };
    function insert(node, parent = null) {
      const id = `trajectory-3-${++serial}`;
      const defaults = structuredClone(schema[node.type].defaults);
      graph.blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
      graph.connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) graph.connections[id][insert(child, id)] = { type: "input", input_type: "value", input_name: socket };
      return id;
    }
    let previous;
    for (const command of [b("start_on_click"), ...commands]) {
      const id = insert(command, previous);
      if (previous) graph.connections[previous][id] = { type: "next" };
      previous = id;
    }
    return graph;
  }
  return Object.fromEntries(Object.entries(cases).map(([name, commands]) => {
    const project = structuredClone(fixtures().speed);
    project.project_name = `NekoC original physics trajectory 3 ${name}`;
    project.toolbox.physics2 = true;
    project.variables = {};
    project.variable_order = [];
    for (const propertyName of ["mass", "friction", "restitution", "speed"]) {
      commands.push(store(propertyName, property(propertyName)));
    }
    for (const command of commands.filter(command => command.type === "variables_set")) {
      const propertyName = command.fields.VAR;
      project.variables[propertyName] = { id: propertyName, name: propertyName, value: 0, type: "any", is_global: true, current_entity: actorId, visible: false };
      project.variable_order.push(propertyName);
    }
    project.theatre.actors[actorId].block_data_json = workspace(commands);
    if (["bounce", "friction"].includes(name)) project.theatre.actors[actorId].y = -340;
    delete project.theatre.actors[floorId];
    delete project.compile_result;
    return [name, project];
  }));
}
