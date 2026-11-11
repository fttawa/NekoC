// Read-only diagnostics of the official loaded original texture.
import { physicsTrajectoryFixtures, actorId } from "./k4-physics-trajectory-3-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";
import { createHash } from "node:crypto";
const observations = [];
const project = physicsTrajectoryFixtures().coast;
const trace = await runOracle(project, { frames: 3, virtualTime: true, onFrame: async (page, frame) => {
  observations.push(await page.evaluate(({ frame, actorId }) => {
    const stage = window.__k4OracleRequire("a1xw").a();
    const actor = stage.get_actor_by_id(actorId);
    const style = actor.get_current_style();
    const data = stage.core.data;
    const texture = data.get_texture(style.texture_id);
    const points = data.get_texture_points_color_data(style.texture_id);
    const world = stage.core.physics.world_list.values().next().value;
    const adapter = world?.body_list.get(actorId);
    const body = adapter?.physics_body.body;
    const shapes = [];
    for (let fixture = body?.GetFixtureList(); fixture; fixture = fixture.GetNext()) {
      const shape = fixture.GetShape();
      shapes.push({ density: fixture.GetDensity(), vertices: shape.m_vertices?.slice(0, shape.m_count) });
    }
    return { frame, style, texture: {width:texture.width, height:texture.height}, pointCount:points.length,
      coreKeys: Object.keys(stage.core), shapes, bodyPosition:body?.GetPosition(), velocity:body?.GetLinearVelocity(),
      groups: data?.get_texture_convex_groups(style.texture_id),
      worldKeys: stage.core.physics && Object.keys(stage.core.physics),
    };
  }, { frame, actorId }));
} });
await saveJson("dist/k4-physics-trajectory-3/shapes.json", observations);
await saveJson("docs/kitten4-physics-trajectory-3-shape-evidence.json", {
  fixture: "tests/fixtures/kitten4/trajectory-3-coast.bcm",
  sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
  observations, errors: trace.errors, diagnostics: trace.diagnostics,
});
console.log(JSON.stringify(observations, null, 2));
