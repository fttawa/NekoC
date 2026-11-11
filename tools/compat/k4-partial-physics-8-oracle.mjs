import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { physicsContactFixtures, actorId } from "./k4-partial-physics-8-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";
const report = { schema: "nekoc-k4-contact-8-v1", recordedAt: new Date().toISOString(), cases: {} };
for (const [name, spec] of Object.entries(physicsContactFixtures())) {
  const fixture = spec.replay || `tests/fixtures/kitten4/partial-physics-8-${name}.bcm`;
  if (!spec.replay) await saveJson(fixture, spec.project);
  const bytes = readFileSync(fixture, "utf8").replace(/\r\n/g, "\n");
  if (bytes !== JSON.stringify(spec.project, null, 2) + "\n") throw new Error(`Replay changed: ${name}`);
  const trace = await runOracle(spec.project, { frames: spec.frames, seed: 1, virtualTime: true, wallTimeoutMs: 90000 });
  await saveJson(`dist/k4partial8/physics/${name}.official.json`, trace);
  report.cases[name] = { fixture, sha256: createHash("sha256").update(bytes).digest("hex"),
    frames: trace.frames.map(f => ({ frame: f.frame, actor: f.actors[actorId], variables: f.variables })),
    errors: trace.errors, diagnostics: trace.diagnostics };
  await saveJson("docs/kitten4-partial-physics-8-evidence.json", report);
  console.log(name, trace.frames.length, JSON.stringify(trace.errors), JSON.stringify(trace.diagnostics.pageErrors));
}
