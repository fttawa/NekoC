#!/usr/bin/env node
// Re-evaluate the observation projection without changing any raw samples.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compareRun, ignoredPath, assertWritablePath } from "./hateneko.mjs";

const [input = "dist/bench/hateneko/results.json", output = "dist/bench/hateneko/evidence.json"] = process.argv.slice(2);
const bytes = await readFile(input);
const suite = JSON.parse(bytes);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function variables(values) {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key,
    typeof value === "string" && value.length > 128 || value && typeof value === "object"
      ? { kind: Array.isArray(value) ? "list" : typeof value, length: value.length ?? Object.keys(value).length,
        sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") } : value]));
}
const works = suite.works.map(work => {
  const runs = work.runs.map(run => {
    const n = run.runtimes.nekoc, h = run.runtimes.hateneko;
    compareRun(run, work);
    const comparison = run.comparison;
    // Recompute aggregates from raw samples; never trust stale summaries.
    for (const result of [n, h]) if (result?.frame_ms?.length && result.frame_ms.every(v => Number.isFinite(v) && v >= 0)) {
      const sorted = [...result.frame_ms].sort((a, b) => a - b);
      result.summary_ms = { mean: result.frame_ms.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.ceil(sorted.length * .95) - 1] };
    }
    if (comparison.differences) comparison.differences = comparison.differences.map(diff => ({ key: diff.key,
      ...variables({ nekoc: diff.nekoc, hateneko: diff.hateneko }) }));
    const runtime = r => ({ status: r?.status, import_ms: r?.import_ms, frame_mean_ms: r?.summary_ms?.mean, frame_p95_ms: r?.summary_ms?.p95,
      peak_rss_bytes: r?.peak_rss_bytes, error: r?.error?.slice(0, 1800), errors: r?.errors, missing_primitives: r?.missing_primitives,
      variables: variables(r?.final_state?.variables), actor_count: Object.keys(r?.final_state?.actors ?? {}).length });
    return { repeat: run.repeat, nekoc: runtime(n), hateneko: runtime(h), comparison };
  });
  const expectedRuns = work.synthetic ? suite.options.repeats : 1;
  const equal = runs.length === expectedRuns && runs.length > 0 && runs.every(r => r.comparison.equal);
  const metrics = {};
  for (const runtime of ["nekoc", "hateneko"]) {
    metrics[runtime] = {};
    for (const metric of ["import_ms", "frame_mean_ms", "frame_p95_ms", "peak_rss_bytes"]) {
      const values = runs.map(r => r[runtime][metric]);
      if (values.every(v => Number.isFinite(v))) metrics[runtime][metric] = median(values);
    }
  }
  return { file: work.file, sha256: work.sha256, compiled_sha256: work.compiled_sha256, synthetic: work.synthetic, frames: work.frames, warmup: work.warmup,
    scope: work.scope, compile_wall_ms: work.compile_wall_ms, compile_error: work.compile_error?.slice(0, 1800), equal_observed_state: equal, metrics,
    ...(equal && work.synthetic && path.basename(work.file) !== "pen.bcmkn"
      && metrics.nekoc.frame_mean_ms > 0 && metrics.hateneko.frame_mean_ms > 0
      && Number.isFinite(metrics.nekoc.frame_mean_ms) && Number.isFinite(metrics.hateneko.frame_mean_ms)
      ? { speedup_h_over_n: metrics.hateneko.frame_mean_ms / metrics.nekoc.frame_mean_ms } : {}), runs };
});
const evidence = { schema: "nekoc-hateneko-evidence-v1", source_sha256: createHash("sha256").update(bytes).digest("hex"),
  date: suite.date, revision: suite.revision, host: suite.host, options: suite.options,
  reference: { version: suite.reference.version, unchanged: suite.reference.unchanged,
    tree_sha256: createHash("sha256").update(JSON.stringify(suite.reference.files)).digest("hex"),
    files: Object.fromEntries(["VERSION", "player/main.lua", "player/conf.lua", "player/tools/kn.py", "player/rt/core/entity.lua", "player/rt/core/sched.lua"].map(key => [key, suite.reference.files[key]])) },
  probe_sha256: suite.probe_sha256, binary_sha256: suite.binary_sha256, love_version: suite.love_version,
  executed_tree_sha256: suite.executed_files ? createHash("sha256").update(JSON.stringify(suite.executed_files)).digest("hex") : null,
  observation: "globals/typed lists, scene, actor multiset and local variables; N heading=90-oracle rotation, H heading=dir; no pixels/tasks/intermediate proof",
  works };
const published = fileURLToPath(new URL("../../docs/performance-hateneko-evidence.json", import.meta.url));
const destination = path.resolve(output) === published ? published : ignoredPath(output);
await assertWritablePath(destination);
if (path.resolve(input) === destination) throw new Error("Evidence must not overwrite raw input");
await writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
for (const work of works) console.log(path.basename(work.file), work.equal_observed_state, JSON.stringify(work.metrics), work.speedup_h_over_n ?? "no-ratio");
