#!/usr/bin/env node
// Read-only observations of an original non-rectangular control. Never calls a
// solver, mutates particle state, or replaces shader/physics functions.
import { physicsSoftFixtures, actorId } from "./k4-partial-physics-9-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const evidence = { schema: "nekoc-k4-soft-blocked-model-v1", cases: {} };
for (const name of ["coast", "impact-25", "impact-90"]) {
  const frames = [];
  const trace = await runOracle(physicsSoftFixtures()[name].project, { frames: 3, virtualTime: true, wallTimeoutMs: 30000,
    onFrame: async (page, frame) => frames.push(await page.evaluate(({ actorId, frame }) => {
      const req = window.__k4OracleRequire, constants = req("49df");
      const world = req("a1xw").a().core.physics.world_list.values().next().value;
      const body = world.body_list.get(actorId), soft = body.physics_body;
      const system = soft.particle_system, group = soft.particle_group, filter = soft.soft_filter;
      const step = world.world.constructor.Step_s_step;
      const triads = system.m_triadBuffer.data.slice(0, system.m_triadBuffer.count);
      return { frame, constants: { physicsDt: constants.f, velocityIterations: constants.l, positionIterations: constants.j },
        gravity: { x: world.world.m_gravity.x, y: world.world.m_gravity.y },
        step: step && { dt: step.dt, velocityIterations: step.velocityIterations, positionIterations: step.positionIterations, particleIterations: step.particleIterations },
        particleIterationIndex: system.m_iterationIndex, particleTimestamp: system.m_timestamp,
        radius: system.m_particleDiameter / 2, elasticStrength: system.m_def.elasticStrength,
        groupStrength: group.m_strength, adapterStrength: body.group_strength, particleCount: group.m_lastIndex - group.m_firstIndex,
        groupFlags: group.m_groupFlags, firstParticleFlags: system.m_flagsBuffer.data[group.m_firstIndex],
        triadCount: triads.length, triadStrengthKinds: [...new Set(triads.map(triad => typeof triad.strength))],
        filter: { enabled: filter.enabled, maxNumAnchors: filter.max_num_anchors, triangles: filter.triangle_top_points.length,
          transformMatrixValues: filter.uniforms.transform_matrixes.length, triangleValues: filter.uniforms.triangles.length },
      };
    }, { actorId, frame })),
  });
  evidence.cases[name] = { frames, officialFrames: trace.frames.length, errors: trace.errors, assets: trace.diagnostics.assets };
}
await saveJson("docs/kitten4-soft-blocked-model-evidence.json", evidence);
console.log(Object.fromEntries(Object.entries(evidence.cases).map(([name, value]) => [name, {
  officialFrames: value.officialFrames, lastSample: value.frames.at(-1), errors: value.errors,
}])));
