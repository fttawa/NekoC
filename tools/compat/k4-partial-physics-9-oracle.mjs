// Public observations plus read-only particle buffers; never invokes solver methods.
import { createHash } from "node:crypto";
import { physicsSoftFixtures, actorId } from "./k4-partial-physics-9-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";
const report = { schema: "nekoc-k4-soft-9-v1", cases: {} };
function deformation(points, rest) {
  if (!points.length || points.length !== rest?.length) return null;
  const center = p => p.reduce((s,v) => [s[0]+v[0]/p.length,s[1]+v[1]/p.length], [0,0]);
  const a = center(rest), b = center(points);
  let dot = 0, cross = 0, chord = 0;
  for (let i=0; i<points.length; i++) {
    const [x,y] = [rest[i][0]-a[0], rest[i][1]-a[1]], [u,v] = [points[i][0]-b[0], points[i][1]-b[1]];
    dot += x*u+y*v; cross += x*v-y*u;
    for (let j=0; j<i; j++) chord = Math.max(chord, Math.abs(Math.hypot(points[i][0]-points[j][0],points[i][1]-points[j][1])-Math.hypot(rest[i][0]-rest[j][0],rest[i][1]-rest[j][1])));
  }
  const angle = Math.atan2(cross,dot), c = Math.cos(angle), s = Math.sin(angle);
  const errors = points.map((p,i) => { const x=rest[i][0]-a[0], y=rest[i][1]-a[1]; return Math.hypot(p[0]-b[0]-(c*x-s*y),p[1]-b[1]-(s*x+c*y)); });
  return { bestRigidRmsPx: Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length), bestRigidMaxPx: Math.max(...errors), rigidMaxErrorLowerBoundPx: chord/2 };
}
for (const [name, spec] of Object.entries(physicsSoftFixtures())) {
  const fixture = `tests/fixtures/kitten4/partial-physics-9-${name}.bcm`;
  await saveJson(fixture, spec.project);
  const observations = [];
  let environment;
  const trace = await runOracle(spec.project, { frames: spec.frames, wallTimeoutMs: 45000, virtualTime: true, beforeStart: async page => {
    environment = await page.evaluate(() => {
      const stage = window.__k4OracleRequire("a1xw").a();
      const gl = document.createElement("canvas").getContext("webgl");
      return { core: Object.keys(stage.core), uniformVectors: gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) };
    });
  }, onFrame: async (page, frame) => {
    observations.push(await page.evaluate(({ actorId, frame }) => {
      const stage = window.__k4OracleRequire("a1xw").a();
      const world = stage.core.physics.world_list.values().next().value;
      const adapter = world?.body_list.get(actorId), physics = adapter?.physics_body;
      const group = physics?.particle_group, system = physics?.particle_system;
      window.__soft9ids ||= new WeakMap(); window.__soft9serial ||= 0;
      const identity = value => { if (!value) return null; if (!window.__soft9ids.has(value)) window.__soft9ids.set(value, ++window.__soft9serial); return window.__soft9ids.get(value); };
      const points = [], velocities = [];
      if (group) for (let i = group.m_firstIndex; i < group.m_lastIndex; i++) {
        const p = system.m_positionBuffer.data[i], v = system.m_velocityBuffer.data[i];
        points.push([p.x * 10, -p.y * 10]); velocities.push([v.x * 10, -v.y * 10]);
      }
      return { frame, elastic: adapter?.elastic, type: physics?.type, groupId: identity(group), strength: adapter?.group_strength,
        pendingRebuild: adapter?.should_recreate_body, radius: system?.GetRadius(), stride: system?.GetParticleStride(),
        groupStrength: group?.m_strength, relativePositions: group?.relativePositions?.map(p => [p.x * 10, -p.y * 10]), points, velocities };
    }, { actorId, frame }));
  } });
  await saveJson(`dist/k4partial9/physics/${name}.official.json`, trace);
  await saveJson(`dist/k4partial9/physics/${name}.particles.json`, observations);
  const groups = new Map();
  const frames = trace.frames.map((f,i) => {
    const o = observations[i];
    if (o.groupId && !groups.has(o.groupId)) groups.set(o.groupId, o.points);
    const { points, velocities, relativePositions, ...soft } = o;
    return { frame: f.frame, actor: f.actors[actorId], soft: { ...soft, count: points.length,
      sentinels: [0, Math.floor(points.length/2), points.length-1].filter(j=>j>=0).map(j=>points[j]),
      meanSpeedPx: velocities.length ? velocities.reduce((s,v)=>s+Math.hypot(...v),0)/velocities.length : 0,
      deformation: deformation(points, groups.get(o.groupId)) } };
  });
  const worst = frames.reduce((a,b) => (b.soft.deformation?.rigidMaxErrorLowerBoundPx||0) > (a.soft.deformation?.rigidMaxErrorLowerBoundPx||0) ? b : a);
  const witness = { frame: worst.frame, rest: groups.get(worst.soft.groupId), points: observations[worst.frame-1].points };
  report.cases[name] = { fixture, sha256: createHash("sha256").update(JSON.stringify(spec.project,null,2)+"\n").digest("hex"),
    particlesSha256: createHash("sha256").update(JSON.stringify(observations,null,2)+"\n").digest("hex"), deformationWitness: witness, environment,
    frames, errors: trace.errors, diagnostics: trace.diagnostics };
  await saveJson("docs/kitten4-partial-physics-9-evidence.json", report);
  console.log(name, trace.frames.length, JSON.stringify(trace.errors), JSON.stringify(trace.diagnostics.pageErrors), JSON.stringify(frames.filter((f,i) => i===0 || f.soft.groupId!==frames[i-1].soft.groupId || f.soft.strength!==frames[i-1].soft.strength).map(f => ({ frame:f.frame, group:f.soft.groupId, count:f.soft.count, strength:f.soft.strength }))), "maxRigidLowerBoundPx", Math.max(...frames.map(f=>f.soft.deformation?.rigidMaxErrorLowerBoundPx||0)));
}
