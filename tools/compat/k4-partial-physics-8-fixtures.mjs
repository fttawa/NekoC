// Original contact workspaces. No corpus or third-party project is read.
import { physicsTrajectoryFixtures, actorId } from "./k4-physics-trajectory-3-fixtures.mjs";
import { physicsRemainingFixtures } from "./k4-partial-physics-7-fixtures.mjs";
export { actorId };
export function physicsContactFixtures() {
  const out = {};
  const prior = physicsTrajectoryFixtures();
  for (const name of ["bounce", "friction"]) out[`trajectory-3-${name}-replay`] = {
    project: prior[name], frames: 60, replay: `tests/fixtures/kitten4/trajectory-3-${name}.bcm`,
  };
  for (const [name, spec] of Object.entries(physicsRemainingFixtures())) {
    if (spec.contact) out[`physics-7-${name}-replay`] = { ...spec,
      replay: `tests/fixtures/kitten4/partial-physics-7-${name}.bcm` };
  }
  for (const side of ["bottom", "top", "left", "right"]) {
    for (const [variant, restitution, friction, speed, offset] of [
      ["bounce", 1, 0, 2, 25], ["inelastic", 0, 0, 2, 25],
      ["oblique", .4, .8, 2, 35], ["low-speed", 1, .2, .05, 11],
    ]) {
      const project = structuredClone(prior.friction);
      const actor = project.theatre.actors[actorId];
      const horizontal = side === "left" || side === "right";
      actor.x = horizontal ? (side === "left" ? -1 : 1) * (640 - offset) : 0;
      actor.y = horizontal ? 0 : (side === "bottom" ? -1 : 1) * (360 - offset);
      const direction = { bottom: -90, top: 90, left: 180, right: 0 }[side];
      const graph = actor.block_data_json;
      function inputNumber(blockId, socket, value) {
        const child = Object.keys(graph.connections[blockId]).find(id => graph.connections[blockId][id].input_name === socket);
        graph.blocks[child].fields.NUM = String(value);
      }
      for (const [id, block] of Object.entries(graph.blocks)) {
        if (block.type === "physics2_set_gravity") {
          inputNumber(id, "value", variant === "low-speed" ? 0 : 2);
          inputNumber(id, "dir", direction);
        }
        if (block.type === "physics2_set_speed") {
          inputNumber(id, "value", speed);
          inputNumber(id, "dir", direction + (variant === "oblique" ? 45 : 0));
        }
        if (block.type === "physics2_set_boundary") block.fields.physics_bound_type = "all_bounds";
        if (block.type === "physics2_set_roughness") inputNumber(id, "friction", friction);
      }
      // Insert restitution before the original gravity command.
      const start = Object.values(graph.blocks).find(b => b.type === "start_on_click").id;
      const next = Object.keys(graph.connections[start]).find(id => graph.connections[start][id].type === "next");
      const template = structuredClone(Object.values(prior.bounce.theatre.actors[actorId].block_data_json.blocks).find(b => b.type === "physics2_set_resilience"));
      const number = structuredClone(Object.values(graph.blocks).find(b => b.type === "math_number"));
      template.id = "contact-8-restitution"; template.parent_id = start;
      number.id = "contact-8-restitution-value"; number.parent_id = template.id; number.fields.NUM = String(restitution);
      graph.blocks[template.id] = template; graph.blocks[number.id] = number;
      graph.blocks[next].parent_id = template.id;
      graph.connections[start] = { [template.id]: { type: "next" } };
      graph.connections[template.id] = { [next]: { type: "next" }, [number.id]: { type: "input", input_type: "value", input_name: "restitution" } };
      graph.connections[number.id] = {};
      project.project_name = `NekoC original contact 8 ${side} ${variant}`;
      out[`${side}-${variant}`] = { project, frames: variant === "low-speed" ? 180 : 120 };
    }
  }
  return out;
}
