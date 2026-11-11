#!/usr/bin/env node
// Re-evaluate the observation projection without changing any raw samples.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compareRun, ignoredPath, assertWritablePath, assertCompleteSuite, normalizationScope } from "./hateneko.mjs";

const [input = "dist/bench/hateneko/results.json", output = "dist/bench/hateneko/evidence.json", ...flags] = process.argv.slice(2);
const normalization = { excludeVariables: [] };
for (let i = 0; i < flags.length; i++) {
  if (flags[i] === "--normalize-private") normalization.normalizePrivate = true;
  else if (flags[i] === "--exclude-variables" && flags[i + 1] && !flags[i + 1].startsWith("--")) {
    normalization.excludeVariables = flags[++i].split(",");
    if (normalization.excludeVariables.some(id => !id.trim())) throw new Error("Empty excluded variable id");
  } else throw new Error(`Invalid option ${flags[i]}`);
}
const bytes = await readFile(input);
const suite = JSON.parse(bytes);
// Optional replay of the SAME raw observations, not a new runtime experiment.
// Verify declarations against the recorded input identity before using them.
if (flags.length) for (const work of suite.works) {
  let project = {};
  if (normalization.normalizePrivate) {
    const source = await readFile(fileURLToPath(new URL(`../../${work.file.replaceAll("\\", "/")}`, import.meta.url)));
    if (createHash("sha256").update(source).digest("hex") !== work.sha256) throw new Error("Stale normalization declarations");
    project = JSON.parse(source);
  }
  work.normalization = normalizationScope(project, normalization);
}
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
    for (const projection of [comparison, run.normalized_comparison].filter(Boolean)) {
      if (projection.differences) projection.differences = projection.differences.map(diff => ({ key: diff.key,
        ...variables({ nekoc: diff.nekoc, hateneko: diff.hateneko }) }));
    }
    // Recompute aggregates from raw samples; never trust stale summaries.
    for (const result of [n, h]) if (result?.frame_ms?.length && result.frame_ms.every(v => Number.isFinite(v) && v >= 0)) {
      const sorted = [...result.frame_ms].sort((a, b) => a - b);
      result.summary_ms = { mean: result.frame_ms.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.ceil(sorted.length * .95) - 1] };
    }
    const runtime = r => ({ status: r?.status, import_ms: r?.import_ms, frame_mean_ms: r?.summary_ms?.mean, frame_p95_ms: r?.summary_ms?.p95,
      peak_rss_bytes: r?.peak_rss_bytes, error: r?.error?.slice(0, 1800), errors: r?.errors, missing_primitives: r?.missing_primitives,
      variables: variables(r?.final_state?.variables), actor_count: Object.keys(r?.final_state?.actors ?? {}).length });
    return { repeat: run.repeat, nekoc: runtime(n), hateneko: runtime(h), comparison,
      ...(run.normalized_comparison ? { normalized_comparison: run.normalized_comparison } : {}) };
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
    scope: work.scope, normalization: work.normalization,
    ...(work.normalization ? { equal_normalized_state: runs.length === expectedRuns && runs.length > 0 && runs.every(r => r.normalized_comparison?.equal) } : {}),
    compile_wall_ms: work.compile_wall_ms, compile_error: work.compile_error?.slice(0, 1800), equal_observed_state: equal, metrics,
    ...(equal && work.synthetic && path.basename(work.file) !== "pen.bcmkn"
      && metrics.nekoc.frame_mean_ms > 0 && metrics.hateneko.frame_mean_ms > 0
      && Number.isFinite(metrics.nekoc.frame_mean_ms) && Number.isFinite(metrics.hateneko.frame_mean_ms)
      ? { speedup_h_over_n: metrics.hateneko.frame_mean_ms / metrics.nekoc.frame_mean_ms } : {}), runs };
});
const evidence = { schema: "nekoc-hateneko-evidence-v1", source_sha256: createHash("sha256").update(bytes).digest("hex"),
  date: suite.date, revision: suite.revision, host: suite.host, options: suite.options,
  ...(flags.length ? { replay_normalization: normalization } : {}),
  reference: { version: suite.reference.version, unchanged: suite.reference.unchanged,
    tree_sha256: createHash("sha256").update(JSON.stringify(suite.reference.files)).digest("hex"),
    files: Object.fromEntries(["VERSION", "player/main.lua", "player/conf.lua", "player/tools/kn.py", "player/rt/core/entity.lua", "player/rt/core/sched.lua"].map(key => [key, suite.reference.files[key]])) },
  probe_sha256: suite.probe_sha256, binary_sha256: suite.binary_sha256, binary_unchanged: suite.binary_unchanged, love_version: suite.love_version,
  executed_tree_sha256: suite.executed_files ? createHash("sha256").update(JSON.stringify(suite.executed_files)).digest("hex") : null,
  observation: "globals/typed lists, scene, actor multiset and local variables; N heading=90-oracle rotation, H heading=dir; no pixels/tasks/intermediate proof",
  works };
const published = ["performance-hateneko-evidence.json", "kncompat-hateneko-evidence.json", "compatibility/hncompat2-hateneko-evidence.json"]
  .map(name => fileURLToPath(new URL(`../../docs/${name}`, import.meta.url)));
const destination = published.includes(path.resolve(output)) ? path.resolve(output) : ignoredPath(output);
// Debug exports may retain partial samples, but a new published compatibility
// report must cover the entire exact manifest, including explicit failures.
if (published.slice(1).includes(destination)) assertCompleteSuite(suite);
if (destination === published[2]) {
  const historical = JSON.parse(await readFile(fileURLToPath(new URL("../../docs/kncompat-hateneko-evidence.json", import.meta.url)), "utf8"));
  const identity = works => works.map(work => ({ file: work.file.replaceAll("\\", "/"), sha256: work.sha256 }));
  if (JSON.stringify(identity(suite.works)) !== JSON.stringify(identity(historical.works))) throw new Error("Published hncompat2 evidence must cover the exact historical 41 inputs");
  if (suite.binary_unchanged !== true) throw new Error("Missing binary integrity verification");
}
await assertWritablePath(destination);
if (path.resolve(input) === destination) throw new Error("Evidence must not overwrite raw input");
await writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
for (const work of works) console.log(path.basename(work.file), work.equal_observed_state, JSON.stringify(work.metrics), work.speedup_h_over_n ?? "no-ratio");
