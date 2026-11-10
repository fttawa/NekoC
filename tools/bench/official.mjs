#!/usr/bin/env node
// Isolated worker: the parent enforces a hard wall timeout even if update hangs.
import { readJson, runOracle, saveJson } from "../compat/k4-oracle.mjs";
const [input, frames, warmup, assets, diagnostics] = process.argv.slice(2);
try {
  const result = await runOracle(await readJson(input), { frames: Number(frames) + Number(warmup),
    warmup: Number(warmup), measurePerformance: true, allowAssets: assets === "true", timeoutMs: 45000 });
  console.log(JSON.stringify({ ...result.performance, assets: result.diagnostics.assets,
    adaptations: result.diagnostics.adaptations }));
} catch (error) {
  if (error.diagnostics) await saveJson(diagnostics, error.diagnostics);
  console.error(error.message);
  process.exitCode = 1;
}
