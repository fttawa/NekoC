import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { physicsRemainingFixtures, actorId } from "./k4-partial-physics-7-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const report = process.argv[2] ? JSON.parse(readFileSync("docs/kitten4-partial-physics-7-evidence.json")) :
  { schema: "nekoc-k4-physics-main-path-7-v1", recordedAt: new Date().toISOString(), cases: {} };
for (const [name, { project, types, frames, contact }] of Object.entries(physicsRemainingFixtures())) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue;
  const fixture = `tests/fixtures/kitten4/partial-physics-7-${name}.bcm`;
  await saveJson(fixture, project);
  try {
    const trace = await runOracle(project, { frames, seed: 1, virtualTime: true, blocks: true, wallTimeoutMs: 90000 });
    await saveJson(`dist/k4partial7/physics/${name}.official.json`, trace);
    report.cases[name] = { fixture, types, contact: !!contact,
      sha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
      errors: trace.errors, diagnostics: trace.diagnostics,
      frames: trace.frames.map(frame => ({ frame: frame.frame, actor: frame.actors[actorId], variables: frame.variables })) };
    await saveJson("docs/kitten4-partial-physics-7-evidence.json", report);
    console.log(name, trace.frames.length, JSON.stringify(trace.errors), JSON.stringify(trace.frames.at(-1).variables));
  } catch (error) {
    await saveJson(`dist/k4partial7/physics/${name}.failure.json`, { message: error.message, diagnostics: error.diagnostics });
    throw error;
  }
}
