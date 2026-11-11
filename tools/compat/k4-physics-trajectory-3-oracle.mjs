import { createHash } from "node:crypto";
import { physicsTrajectoryFixtures, actorId } from "./k4-physics-trajectory-3-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const report = { schema: "nekoc-k4-physics-trajectory-3-v1", recordedAt: new Date().toISOString(), cases: {} };
for (const [name, project] of Object.entries(physicsTrajectoryFixtures())) {
  const fixture = `tests/fixtures/kitten4/trajectory-3-${name}.bcm`;
  await saveJson(fixture, project);
  const trace = await runOracle(project, { frames: 60, seed: 1, virtualTime: true, wallTimeoutMs: 90000 });
  await saveJson(`dist/k4-physics-trajectory-3/${name}.official.json`, trace);
  report.cases[name] = { fixture, sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
    frames: trace.frames.map(frame => ({ frame: frame.frame, actor: frame.actors[actorId], variables: frame.variables })),
    errors: trace.errors, diagnostics: trace.diagnostics };
  await saveJson("docs/kitten4-physics-trajectory-3-evidence.json", report);
  console.log(name, JSON.stringify(report.cases[name].frames.slice(0, 4).map(frame => [frame.actor.x, frame.actor.y])), JSON.stringify(trace.frames[0].variables));
}
