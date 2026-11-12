import { createHash } from "node:crypto";
import { physicsMainPathFixtures, actorId } from "./k4-partial-physics-6-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const report = { schema: "nekoc-k4-physics-main-path-6-v1", recordedAt: new Date().toISOString(), cases: {} };
for (const [name, { project, types }] of Object.entries(physicsMainPathFixtures())) {
  const fixture = `tests/fixtures/kitten4/partial-physics-6-${name}.bcm`;
  await saveJson(fixture, project);
  const trace = await runOracle(project, { frames: 40, seed: 1, virtualTime: true, blocks: true, wallTimeoutMs: 90000 });
  await saveJson(`dist/k4partial6/physics/${name}.official.json`, trace);
  report.cases[name] = { fixture, types, sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
    errors: trace.errors, diagnostics: trace.diagnostics,
    frames: trace.frames.map(frame => ({ frame: frame.frame, actor: frame.actors[actorId], variables: frame.variables })) };
  await saveJson("docs/kitten4-partial-physics-6-evidence.json", report);
  console.log(name, trace.frames.length, JSON.stringify(trace.errors));
}
