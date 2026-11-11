import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { saveJson } from "./k4-oracle.mjs";
import { actorId } from "./k4-partial-physics-8-fixtures.mjs";
const executable = process.env.NEKOC_K4_TRACE || "target/debug/k4-trace.exe";
const label = process.argv[2] || "current";
const report = JSON.parse(readFileSync("docs/kitten4-partial-physics-8-evidence.json"));
const costumes = "dist/k4partial8/physics/costumes.json";
await saveJson(costumes, [{ id: "probe-style", width: 20, height: 20, mask_width: 20, mask_height: 20, mask_bytes: Array(50).fill(255) }]);
const result = { schema: "nekoc-k4-contact-comparison-8-v1", label,
  executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), cases: {} };
for (const [name, evidence] of Object.entries(report.cases)) {
  result.cases[name] = {};
  for (const interpreted of [false, true]) {
    const trace = JSON.parse(execFileSync(executable, [evidence.fixture, "--frames", String(evidence.frames.length), "--costumes", costumes, ...(interpreted ? ["--interpreter"] : [])], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
    await saveJson(`dist/k4partial8/physics/${name}.${label}.${interpreted ? "interpreter" : "default"}.json`, trace);
    let maxPosition = 0, maxVariable = 0, maxRotation = 0;
    const worst = {};
    for (let i = 0; i < evidence.frames.length; i++) {
      const expected = evidence.frames[i], actual = trace.frames[i];
      for (const key of ["x", "y", "rotation"]) {
        const error = Math.abs(actual.actors[actorId][key] - expected.actor[key]);
        if (key === "rotation") maxRotation = Math.max(maxRotation, error);
        else if (error > maxPosition) { maxPosition = error; Object.assign(worst, { frame: i + 1, key, expected: expected.actor[key], actual: actual.actors[actorId][key] }); }
      }
      for (const [key, value] of Object.entries(expected.variables)) {
        const got = actual.variables[key];
        maxVariable = Math.max(maxVariable, typeof got === "number" && typeof value === "number" ? Math.abs(got - value) : got === value ? 0 : Infinity);
      }
    }
    const summary = { frames: trace.frames.length, maxPosition, maxRotation, maxVariable, subpixel: maxPosition < 1,
      withinRegressionBound: maxPosition < .15 && maxRotation < 1e-7 && maxVariable < 1e-9, worst };
    if (!summary.withinRegressionBound) process.exitCode = 1;
    result.cases[name][interpreted ? "interpreter" : "default"] = summary;
    console.log(name, interpreted ? "interpreter" : "default", JSON.stringify(summary));
  }
  await saveJson(`dist/k4partial8/physics/comparison-${label}.json`, result);
}
