// Repository-owned command-path probes. No corpus or official implementation is copied.
import { readFileSync } from "node:fs";
import { fixtures, actorId, floorId } from "../physics-fixtures.mjs";

const schema = JSON.parse(readFileSync(new URL("../../docs/kitten4-block-schema.json", import.meta.url))).blocks;
export { actorId };
export function physicsMainPathFixtures() {
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const command = (type, values = {}, fields = {}) => b(type, fields,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, n(value)])));
  const modern = (type, values = {}, fields = {}) => command(`physics2_${type}`, values, fields);
  // Keep the control probe off an exact 60-Hz deadline; exact-boundary wait
  // rounding is tracked separately rather than weakening the physics tolerance.
  const wait = () => command("wait", { time: .04 });
  const store = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
  const sample = prefix => ["speed", "friction", "restitution", "mass"].map(property =>
    store(`${prefix}_${property}`, b("get_physics_property", { sprite: "__self", attribute: property })));
  const zero = () => command("set_gravity", { value: 0, dir: 0 });
  const velocity = (value = 2, dir = 0) => command("set_velocity", { value, dir });
  const oldFlag = enabled => b("set_actor_as", { physics_body_type: enabled ? "attend_physics_world" : "exit_physics_world" });
  const forceable = enabled => modern("enable_force", {}, { is_enable: String(enabled) });
  const collidable = enabled => modern("set_actor_as", {}, { physics_body_type: enabled ? "attend_physics_world" : "exit_physics_world" });
  const oldBase = () => [b("self_enable_physics"), zero()];
  const newBase = () => [modern("set_gravity", { value: 0, dir: 0 })];
  const cases = {
    "legacy-membership": { types: ["set_actor_as", "self_enable_physics", "self_disable_physics", "set_velocity"], commands: [
      ...oldBase(), velocity(), wait(), oldFlag(false), ...sample("exit"), wait(), oldFlag(true),
      velocity(3), wait(), b("self_enable_physics"), velocity(-2, 90), wait(),
      b("self_disable_physics"), ...sample("disabled"), wait(), b("self_enable_physics"), velocity(1),
    ] },
    "legacy-material": { types: ["self_set_friction", "self_set_restitution"], commands: [
      ...oldBase(), command("self_set_friction", { friction: .7 }), command("self_set_restitution", { restitution: .8 }),
      ...sample("finite"), wait(), command("self_set_friction", { friction: -2 }), command("self_set_restitution", { restitution: 3 }),
      ...sample("clamped"), velocity(1),
    ] },
    "modern-membership": { modern: true, types: ["physics2_enable_force", "physics2_set_actor_as", "physics2_set_speed"], commands: [
      ...newBase(), modern("set_speed", { value: 2, dir: 0 }), wait(), forceable(false), ...sample("immediate"),
      wait(), ...sample("static"), forceable(true), wait(), modern("set_speed", { value: 3, dir: 90 }),
      collidable(false), wait(), collidable(true), wait(),
    ] },
    "modern-material": { modern: true, types: ["physics2_set_roughness", "physics2_set_resilience"], commands: [
      ...newBase(), modern("set_roughness", { friction: .65 }), modern("set_resilience", { restitution: .35 }),
      ...sample("finite"), wait(), modern("set_roughness", { friction: 2 }), modern("set_resilience", { restitution: -1 }),
      ...sample("clamped"), modern("set_speed", { value: 1, dir: 0 }),
    ] },
    "modern-force": { modern: true, types: ["physics2_set_force", "physics2_set_mass"], commands: [
      ...newBase(), modern("set_mass", { mass: 2 }), modern("set_force", { value: 12, dir: 0 }), wait(),
      ...sample("pushed"), modern("set_force", { value: 6, dir: 90 }),
    ] },
    "modern-gravity": { modern: true, types: ["physics2_set_gravity"], commands: [
      modern("set_gravity", { value: 2, dir: -90 }), wait(), modern("set_gravity", { value: 1, dir: 0 }), wait(),
      modern("set_gravity", { value: 0, dir: 0 }), modern("set_speed", { value: 0, dir: 0 }),
    ] },
    "legacy-gravity": { types: ["set_gravity", "set_velocity_by_vector"], commands: [
      ...oldBase(), command("set_gravity", { value: 2, dir: -90 }), wait(), zero(),
      command("set_velocity_by_vector", { x_axis: 1, y_axis: -2 }), wait(), velocity(0),
    ] },
    "legacy-force": { types: ["set_force", "set_force_by_vector", "self_set_mass"], commands: [
      ...oldBase(), command("self_set_mass", { mass: 2 }), command("set_force", { value: 12, dir: 0 }), wait(),
      command("set_force_by_vector", { x_axis: 0, y_axis: 6 }), ...sample("pushed"),
    ] },
    "legacy-rotate": { types: ["allow_rotate"], commands: [
      ...oldBase(), b("allow_rotate", { allow: "1" }), velocity(1), wait(), b("allow_rotate", { allow: "0" }),
    ] },
    "modern-rotate": { modern: true, types: ["physics2_allow_rotate"], commands: [
      ...newBase(), modern("allow_rotate", {}, { is_allow: "true" }), modern("set_speed", { value: 1, dir: 0 }),
      wait(), modern("allow_rotate", {}, { is_allow: "false" }),
    ] },
  };
  return Object.fromEntries(Object.entries(cases).map(([name, spec]) => {
    const project = structuredClone(fixtures().speed);
    project.project_name = `NekoC original main path physics 6 ${name}`;
    if (spec.modern) project.toolbox.physics2 = true;
    project.variables = {};
    project.variable_order = [];
    const graph = { blocks: {}, connections: {}, comments: {} };
    const commands = [b("start_on_click"), ...spec.commands, ...sample("final"), store("done", n(1))];
    for (const node of commands.filter(node => node.type === "variables_set")) {
      const id = node.fields.VAR;
      project.variables[id] = { id, name: id, value: 0, type: "any", is_global: true, current_entity: actorId, visible: false };
      project.variable_order.push(id);
    }
    function insert(node, parent = null) {
      const id = `physics-main-6-${++serial}`;
      const defaults = structuredClone(schema[node.type].defaults);
      graph.blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
      graph.connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) graph.connections[id][insert(child, id)] = { type: "input", input_type: "value", input_name: socket };
      return id;
    }
    let previous;
    for (const node of commands) {
      const id = insert(node, previous);
      if (previous) graph.connections[previous][id] = { type: "next" };
      previous = id;
    }
    project.theatre.actors[actorId].block_data_json = graph;
    delete project.theatre.actors[floorId];
    delete project.compile_result;
    return [name, { project, types: spec.types }];
  }));
}
