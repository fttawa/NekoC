import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { saveJson } from "./k4-oracle.mjs";
import { actorId } from "./k4-partial-physics-7-fixtures.mjs";

const executable = process.env.NEKOC_K4_TRACE || "target/debug/k4-trace.exe";
const label = process.argv[2] || "current";
const report = JSON.parse(readFileSync("docs/kitten4-partial-physics-7-evidence.json"));
const costumes = "dist/k4partial7/physics/costumes.json";
await saveJson(costumes, [{ id: "probe-style", width: 20, height: 20, mask_width: 20, mask_height: 20, mask_bytes: Array(50).fill(255) }]);
const result = { schema: "nekoc-k4-physics-comparison-7-v1", label,
  executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), cases: {} };
for (const [name, evidence] of Object.entries(report.cases)) {
  result.cases[name] = {};
  for (const interpreter of [false, true]) {
    const args = [evidence.fixture, "--frames", String(evidence.frames.length), "--costumes", costumes, ...(interpreter ? ["--interpreter"] : [])];
    const trace = JSON.parse(execFileSync(executable, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
    await saveJson(`dist/k4partial7/physics/${name}.${label}.${interpreter ? "interpreter" : "default"}.json`, trace);
    let maxPosition = 0, maxVariable = 0;
    const mismatches = [];
    for (let i = 0; i < evidence.frames.length; i++) {
      const expected = evidence.frames[i], actual = trace.frames[i];
      for (const key of ["x", "y", "rotation"]) {
        const error = Math.abs(actual.actors[actorId][key] - expected.actor[key]);
        maxPosition = Math.max(maxPosition, error);
        if (error > 1e-7 && mismatches.length < 12) mismatches.push({ frame: i + 1, key, expected: expected.actor[key], actual: actual.actors[actorId][key] });
      }
      for (const [key, value] of Object.entries(expected.variables)) {
        const got = actual.variables[key];
        const error = typeof got === "number" && typeof value === "number" ? Math.abs(got - value) : got === value ? 0 : Infinity;
        maxVariable = Math.max(maxVariable, error);
        if (error > 1e-9 && mismatches.length < 12) mismatches.push({ frame: i + 1, key, expected: value, actual: got });
      }
    }
    const summary = { frames: trace.frames.length, maxPosition, maxVariable, exact: maxPosition < 1e-7 && maxVariable < 1e-9, mismatches };
    result.cases[name][interpreter ? "interpreter" : "default"] = summary;
    console.log(name, interpreter ? "interpreter" : "default", JSON.stringify(summary));
  }
  await saveJson(`dist/k4partial7/physics/comparison-${label}.json`, result);
}
