// Original workspaces: no corpus inputs or vendor implementation are embedded.
import { readFileSync } from "node:fs";
import { fixtures, actorId, floorId } from "../physics-fixtures.mjs";
import { physicsMainPathFixtures } from "./k4-partial-physics-6-fixtures.mjs";
export { actorId };
const schema = JSON.parse(readFileSync(new URL("../../docs/kitten4-block-schema.json", import.meta.url))).blocks;
export function physicsRemainingFixtures() {
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const c = (type, values = {}, fields = {}) => b(type, fields,
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, n(v)])));
  const p = (type, values = {}, fields = {}) => c(`physics2_${type}`, values, fields);
  const wait = (time = .04) => c("wait", { time });
  const set = (name, value) => b("variables_set", { VAR: name }, { VALUE: value });
  const oldGet = (attribute, sprite = "__self") => b("get_physics_property", { sprite, attribute });
  const newGet = (property, sprite = "__self") => b("physics2_get_property", { sprite, property });
  const sample = prefix => ["speed", "density", "mass", "friction", "restitution"].map(key =>
    set(`${prefix}_${key}`, oldGet(key))).concat(["speed", "speed_dir", "mass", "friction", "restitution", "flexibility"].map(key =>
    set(`${prefix}_new_${key}`, newGet(key))));
  const oldBase = () => [b("self_enable_physics"), c("set_gravity", { value: 0, dir: 0 })];
  const newBase = () => [p("set_gravity", { value: 0, dir: 0 })];
  const speed = (value = 2, dir = 0) => p("set_speed", { value, dir });
  const forceable = enabled => p("enable_force", {}, { is_enable: String(enabled) });
  const collidable = enabled => p("set_actor_as", {}, { physics_body_type: enabled ? "attend_physics_world" : "exit_physics_world" });
  const specs = {
    "forceable": { types: ["physics2_enable_force", "physics2_set_actor_as"], commands: [
      ...newBase(), speed(), wait(), forceable(false), ...sample("immediate"), wait(), ...sample("fixed"),
      forceable(true), speed(4), ...sample("before_ticker"), wait(), speed(3, 90), wait(),
      collidable(false), forceable(false), ...sample("disabled"), wait(), ...sample("disabled_after"),
      forceable(true), wait(), ...sample("restored"),
    ] },
    "sensor": { types: ["physics2_set_actor_as"], commands: [
      ...newBase(), speed(2, -30), collidable(false), wait(), ...sample("sensor"), collidable(true),
      wait(), ...sample("solid"), collidable(false), wait(), ...sample("again"),
    ] },
    "hard-texture": { types: ["physics2_set_texture"], commands: [
      ...newBase(), p("set_mass", { mass: 2 }), p("set_roughness", { friction: .7 }), p("set_resilience", { restitution: .8 }),
      p("set_flexibility", { value: 36 }), speed(2), p("set_texture", {}, { texture_type: "hard" }),
      ...sample("hard"), wait(), p("set_texture", {}, { texture_type: "hard" }), ...sample("repeated"),
    ] },
    "legacy-textures": { legacy: true, types: ["self_texture", "get_physics_property"], commands: [
      ...oldBase(), c("set_velocity", { value: 2, dir: 0 }), ...["origin", "iron", "wood", "elastic"].flatMap(texture_type => [
        b("self_texture", { texture_type }), ...["speed", "density", "mass", "friction", "restitution"].map(key => set(`${texture_type}_${key}`, oldGet(key))), wait(),
      ]),
    ] },
    "density": { legacy: true, types: ["self_set_density", "get_physics_property"], commands: [
      ...oldBase(), c("set_velocity", { value: 1, dir: 0 }), ...[2.5, 0, .125, 1].flatMap((density, i) => [
        c("self_set_density", { density }), ...["speed", "density", "mass", "friction", "restitution"].map(key => set(`density${i}_${key}`, oldGet(key))), wait(),
      ]),
    ] },
    "flexibility": { types: ["physics2_set_flexibility", "physics2_get_property"], commands: [
      ...newBase(), speed(1), ...[27.4, -50, 100, 200, 49.5].flatMap((value, i) => [
        p("set_flexibility", { value }), ...sample(`flex${i}`), wait(),
      ]),
    ] },
    "properties": { types: ["physics2_get_property", "get_physics_property"], commands: [
      ...newBase(), speed(-3, -150), ...sample("negative"), wait(), speed(0), ...sample("zero"),
      forceable(false), wait(), ...sample("static"), forceable(true), wait(), speed(2, 135), ...sample("diagonal"),
    ] },
    "timed-one": { frames: 100, types: ["physics2_set_force_in_time"], commands: [
      ...newBase(), p("set_mass", { mass: 2 }), p("set_force_in_time", { value: 1.2, dir: 30, time: 1 }),
      ...sample("finished"), wait(), ...sample("coasting"),
    ] },
    "timed-zero-fraction": { types: ["physics2_set_force_in_time"], commands: [
      ...newBase(), p("set_mass", { mass: 2 }), p("set_force_in_time", { value: 12, dir: 0, time: 0 }),
      ...sample("zero"), p("set_force_in_time", { value: 12, dir: 0, time: .5 }), ...sample("fraction"),
      p("set_force_in_time", { value: 12, dir: 0, time: -1 }), ...sample("negative"),
    ] },
    "timed-late": { frames: 100, types: ["physics2_set_force_in_time"], commands: [
      ...newBase(), p("set_mass", { mass: 2 }), wait(), p("set_force_in_time", { value: 1.2, dir: -30, time: 1 }),
      ...sample("finished"), p("set_force_in_time", { value: 12, dir: 0, time: 0 }), ...sample("zero"),
    ] },
  };
  for (const legacy of [false, true]) for (const mode of ["not_bound", "all_bounds", "bottom_bound", "left_right_bottom_bounds"]) {
    const key = `${legacy ? "legacy" : "modern"}-boundary-${mode}`;
    specs[key] = { legacy, boundary: true, types: [legacy ? "self_set_boundary" : "physics2_set_boundary"],
      commands: [...(legacy ? oldBase() : newBase()), b(legacy ? "self_set_boundary" : "physics2_set_boundary", { physics_bound_type: mode }),
        c(legacy ? "set_velocity" : "physics2_set_speed", { value: 2, dir: 0 }), wait(.24),
        set("crossed", b("get_3", { sprite: "__self", attribute: "0" })),
        b(legacy ? "self_set_boundary" : "physics2_set_boundary", { physics_bound_type: "not_bound" }), wait(),
      ] };
  }
  specs["filter-edge"] = { types: ["physics2_forbid_bump_with", "physics2_set_boundary"], boundary: true, commands: [
    ...newBase(), p("set_boundary", {}, { physics_bound_type: "all_bounds" }),
    p("forbid_bump_with", {}, { sprite: "__edge_right", is_bump: "false" }), speed(2), wait(.24),
    ...sample("passed"), p("forbid_bump_with", {}, { sprite: "__edge_right", is_bump: "true" }),
    p("set_boundary", {}, { physics_bound_type: "not_bound" }),
  ] };
  specs["filter-actor"] = { other: true, types: ["physics2_forbid_bump_with"], commands: [
    ...newBase(), p("forbid_bump_with", {}, { sprite: floorId, is_bump: "false" }), speed(2), wait(.24),
    ...sample("passed"), p("forbid_bump_with", {}, { sprite: floorId, is_bump: "true" }), wait(),
  ] };
  const out = {};
  // Retain the exact previous-generation failure probe as well as fresh input.
  const prior = physicsMainPathFixtures()["modern-membership"];
  out["membership-6-replay"] = { ...prior, frames: 40 };
  for (const [name, spec] of Object.entries(specs)) {
    const project = structuredClone(fixtures().speed);
    project.project_name = `NekoC original remaining physics 7 ${name}`;
    if (!spec.legacy) project.toolbox.physics2 = true;
    if (spec.boundary) project.theatre.actors[actorId].x = 625;
    if (spec.other) {
      const other = structuredClone(project.theatre.actors[actorId]);
      other.id = floorId;
      other.name = "Original filter target";
      other.x = 30;
      other.block_data_json = { blocks: {}, connections: {}, comments: {} };
      for (const [index, node] of [b("start_on_click"), forceable(false)].entries()) {
        const id = `physics-other-7-${index}`;
        const defaults = structuredClone(schema[node.type].defaults);
        other.block_data_json.blocks[id] = { ...defaults, id, parent_id: index ? "physics-other-7-0" : null,
          location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
        other.block_data_json.connections[id] = index ? {} : { "physics-other-7-1": { type: "next" } };
      }
      project.theatre.actors[floorId] = other;
      project.theatre.scenes[other.scene].actors = [actorId, floorId];
    } else delete project.theatre.actors[floorId];
    delete project.compile_result;
    project.variables = {};
    project.variable_order = [];
    const graph = { blocks: {}, connections: {}, comments: {} };
    const commands = [b("start_on_click"), ...spec.commands, set("done", n(1))];
    for (const node of commands.filter(node => node.type === "variables_set")) {
      const id = node.fields.VAR;
      project.variables[id] = { id, name: id, value: 0, type: "any", is_global: true, current_entity: actorId, visible: false };
      project.variable_order.push(id);
    }
    function insert(node, parent = null) {
      const id = `physics-remaining-7-${++serial}`;
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
    out[name] = { project, types: spec.types, frames: spec.frames ?? 60, contact: !!spec.boundary && ["all_bounds", "left_right_bottom_bounds"].some(x => name.endsWith(x)) };
  }
  return out;
}
