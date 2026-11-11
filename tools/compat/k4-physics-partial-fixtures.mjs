// Repository-owned workspace probes; no third-party project or kernel code.
import { readFileSync } from "node:fs";
import { fixtures, actorId } from "../physics-fixtures.mjs";

const schema = JSON.parse(readFileSync(new URL("../../docs/kitten4-block-schema.json", import.meta.url))).blocks;

export function physicsPartialFixtures() {
  let serial = 0;
  const b = (type, params = {}) => ({ id: `partial-physics-${++serial}`, type, params });
  const n = value => b("math_number", { NUM: value });
  const text = value => b("text", { TEXT: value });
  const store = (name, value) => b("variables_set", { VAR: name, VALUE: value });
  const property = (name = "speed") => b("get_physics_property", { sprite: "__self", attribute: name });
  const sample = label => [store(`${label}Speed`, property())];
  const velocity = (value = 2, dir = 0) => b("set_velocity", { value: n(value), dir: n(dir) });
  const wait = () => b("wait", { time: n(.05) });
  const oldFlag = enabled => b("set_actor_as", { physics_body_type: enabled ? "attend_physics_world" : "exit_physics_world" });
  const forceable = enabled => b("physics2_enable_force", { is_enable: String(enabled) });
  const collidable = enabled => b("physics2_set_actor_as", { physics_body_type: enabled ? "attend_physics_world" : "exit_physics_world" });
  const gravity = () => b("set_gravity", { value: n(0), dir: n(0) });
  const enable = () => b("self_enable_physics");
  const base = () => [enable(), gravity()];
  const cases = {
    "legacy-flags": [
      ...base(), velocity(), ...sample("before"), oldFlag(false), ...sample("exit"),
      oldFlag(true), ...sample("reenter"), velocity(3), ...sample("staticWrite"),
      enable(), velocity(4), ...sample("enabled"), wait(), ...sample("afterTick"),
    ],
    "legacy-hidden": [
      ...base(), velocity(), b("self_disappear"), oldFlag(true), ...sample("hidden"),
      b("self_appear"), enable(), velocity(3), wait(), ...sample("shown"),
    ],
    "velocity-validation": [
      ...base(), velocity(2, 90), ...sample("initial"),
      b("set_velocity", { value: text("9"), dir: n(0) }), ...sample("stringValue"),
      b("set_velocity", { value: n(9), dir: text("0") }), ...sample("stringDir"),
      velocity(-3, 450), ...sample("negative"), velocity(20000), ...sample("clamped"),
      velocity(0), ...sample("zero"),
    ],
    "legacy-no-world": [
      oldFlag(false), velocity(4), ...sample("absent"), oldFlag(true), ...sample("stillAbsent"),
    ],
    "modern-flags": [
      forceable(true), gravity(), velocity(), ...sample("before"),
      forceable(false), ...sample("disabledImmediate"), velocity(3), ...sample("writeImmediate"),
      wait(), ...sample("staticTick"), velocity(4), ...sample("writeStatic"),
      forceable(true), velocity(5), ...sample("reenableImmediate"), wait(), ...sample("dynamicTick"),
      collidable(false), velocity(6), ...sample("sensor"), wait(), ...sample("sensorTick"),
    ],
    "modern-disable-both": [
      forceable(true), gravity(), velocity(), collidable(false), forceable(false),
      ...sample("bothImmediate"), wait(), ...sample("bothTick"),
      velocity(3), ...sample("bothWrite"), collidable(true), wait(), ...sample("staticTick"),
      forceable(true), wait(), ...sample("resumed"),
    ],
    "modern-speed": [
      forceable(true), gravity(),
      b("physics2_set_speed", { value: n(2), dir: n(0) }), ...sample("initial"),
      forceable(false), b("physics2_set_speed", { value: n(3), dir: n(0) }), ...sample("beforeTick"),
      wait(), ...sample("staticTick"),
      b("physics2_set_speed", { value: n(4), dir: n(0) }), ...sample("staticWrite"),
      forceable(true), b("physics2_set_speed", { value: n(5), dir: n(0) }), ...sample("reenableWrite"),
      wait(), b("physics2_set_speed", { value: n(6), dir: n(0) }), ...sample("dynamicWrite"),
    ],
  };
  return Object.fromEntries(Object.entries(cases).map(([name, commands]) => {
    const project = structuredClone(fixtures().speed);
    project.project_name = `NekoC original partial physics ${name}`;
    // The offline player's optional-library detector recognizes legacy PHYSICS
    // ASTs but not all physics2 block ids. Real editor projects carry this flag.
    if (name.startsWith("modern-")) project.toolbox.physics2 = true;
    project.variables = {};
    project.variable_order = [];
    commands.push(store("done", n(1)));
    for (const command of commands) if (command.type === "variables_set") {
      const name = command.params.VAR;
      project.variables[name] = { id: name, name, value: 0, type: "any", is_global: true, current_entity: actorId, visible: false };
      project.variable_order.push(name);
    }
    const graph = { blocks: {}, connections: {}, comments: {} };
    function insert(node, parent = null) {
      const defaults = structuredClone(schema[node.type].defaults);
      const fields = {}, inputs = {};
      for (const [key, value] of Object.entries(node.params)) {
        if (value && typeof value === "object" && value.type) inputs[key] = value;
        else fields[key] = String(value);
      }
      graph.blocks[node.id] = { ...defaults, id: node.id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...fields } };
      const edges = graph.connections[node.id] = {};
      for (const [socket, child] of Object.entries(inputs)) edges[insert(child, node.id)] = { type: "input", input_type: "value", input_name: socket };
      return node.id;
    }
    let previous;
    for (const command of [b("start_on_click"), ...commands]) {
      const id = insert(command, previous);
      if (previous) graph.connections[previous][id] = { type: "next" };
      previous = id;
    }
    project.theatre.actors[actorId].block_data_json = graph;
    delete project.compile_result;
    return [name, project];
  }));
}
