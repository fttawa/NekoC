// Run each original workspace through the offline .orig runtime, without invoking
// physics domain functions directly or substituting an official module.
import { createHash } from "node:crypto";
import { physicsPartialFixtures } from "./k4-physics-partial-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const report = { schema: "nekoc-k4-physics-partial-evidence-v1", recordedAt: new Date().toISOString(),
  initialAttempt: "Six incomplete handwritten published ASTs were rejected during project loading (project-assets timeout; no block execution). Switched to schema-backed original workspaces and native compilation; the failed attempt is not behavioral evidence.", cases: {} };
for (const [name, project] of Object.entries(physicsPartialFixtures())) {
  const file = `tests/fixtures/kitten4/partial-physics-${name}.bcm`;
  const bytes = JSON.stringify(project, null, 2) + "\n";
  await saveJson(file, project);
  try {
    const trace = await runOracle(project, { frames: 30, seed: 1, blocks: true, wallTimeoutMs: 90000 });
    await saveJson(`dist/k4-physics-partial/${name}.official.json`, trace);
    report.cases[name] = {
      fixture: file, sha256: createHash("sha256").update(bytes).digest("hex"),
      variables: trace.frames.at(-1)?.variables, frameCount: trace.frames.length,
      errors: trace.errors, diagnostics: trace.diagnostics,
    };
    console.log(name, JSON.stringify(report.cases[name].variables), JSON.stringify(trace.errors));
  } catch (error) {
    report.cases[name] = { fixture: file, error: String(error), diagnostics: error.diagnostics };
    process.exitCode = 1;
    console.error(name, String(error));
  }
  await saveJson("docs/kitten4-physics-partial-evidence.json", report);
}
