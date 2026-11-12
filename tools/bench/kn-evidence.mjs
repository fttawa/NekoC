#!/usr/bin/env node
// Compact first-party observations only: never embed bundles or project ASTs.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./run.mjs";
import { sameState, validateSample } from "./kn-ab.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function compactNativeWorks(report) {
  if (report.works.length !== 7 || report.works.some(work => work.runs.length !== 5)) throw new Error("Incomplete native AB suite");
  return report.works.map(work => {
    const runs = work.runs.map(pair => {
      const before = validateSample(pair.before), after = validateSample(pair.after);
      return { repeat: pair.repeat, before_ms: before.summary_ms, after_ms: after.summary_ms,
        final_state_equal: sameState(before.final_state, after.final_state),
        before_state_sha256: hash(JSON.stringify(before.final_state)), after_state_sha256: hash(JSON.stringify(after.final_state)) };
    });
    const before = median(runs.map(run => run.before_ms.mean)), after = median(runs.map(run => run.after_ms.mean));
    return { name: work.name, input_sha256: work.sha256, runs, before_ms: before, after_ms: after,
      change_percent: (after / before - 1) * 100, final_state_equal: runs.every(run => run.final_state_equal) };
  });
}

async function main() {
  const evidence = { schema: "nekoc-knperf-evidence-v1", date: new Date().toISOString(), native_ab: [], incomplete_native_ab: [], official: null };
  for (const name of ["history-head", "warp-introduction", "deadline-head", "head-final", "latest-final"]) {
    const file = `dist/bench/kn-ab/${name}/results.json`;
    let bytes;
    try { bytes = await readFile(path.join(root, file)); }
    catch (error) { if (error.code !== "ENOENT") throw error; continue; }
    const report = JSON.parse(bytes);
    if (report.works.length !== 7 || report.works.some(work => work.runs.length !== 5)) {
      evidence.incomplete_native_ab.push({ name, raw_file: file, raw_sha256: hash(bytes),
        binaries: report.binaries, completed_pairs: report.works.map(work => ({ name: work.name, pairs: work.runs.length })) });
      continue;
    }
    evidence.native_ab.push({ name, raw_file: file, raw_sha256: hash(bytes), host: report.host, options: report.options,
      binaries: report.binaries, works: compactNativeWorks(report) });
  }
  const officialFile = "dist/bench/official-kn-final-retry/results.json";
  try {
    const bytes = await readFile(path.join(root, officialFile)), report = JSON.parse(bytes);
    evidence.official = { raw_file: officialFile, raw_sha256: hash(bytes), complete: !!report.summary,
      expected_works: 7, completed_runs: report.works.reduce((sum, work) => sum + work.runs.length, 0), options: report.options,
      bundles: report.bundles, host: report.host, harness_sha256: report.harness_sha256,
      bundles_unchanged: report.bundles_unchanged, harness_unchanged: report.harness_unchanged, native_binary: report.native_binary,
      works: report.works.map(work => ({ name: work.name, input_sha256: work.sha256,
        runs: work.runs.map(run => ({ repeat: run.repeat, status: run.status, errors: run.errors, page_errors: run.page_errors,
          console_errors: run.console_errors, browser_version: run.browser_version,
          official_ms: run.frame_ms?.length ? summarize(run.frame_ms) : null,
          native_ms: run.native?.frame_ms?.length ? summarize(run.native.frame_ms) : null,
          projection_equal: run.projection_equal, comparison: run.comparison,
          official_workload: run.workload, native_workload: run.native?.workload,
          final_state_sha256: run.final_state ? hash(JSON.stringify(run.final_state)) : null })) })) };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  evidence.official_attempts = [];
  for (const file of ["dist/bench/official-kn-final/results.json"]) {
    try {
      const bytes = await readFile(path.join(root, file)), report = JSON.parse(bytes);
      evidence.official_attempts.push({ raw_file: file, raw_sha256: hash(bytes), complete: !!report.summary,
        works: report.works.map(work => ({ name: work.name, runs: work.runs.map(run => ({ repeat: run.repeat,
          status: run.status, errors: run.errors, projection_equal: run.projection_equal, comparison: run.comparison })) })) });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  evidence.diagnostics = [];
  for (const name of ["numeric", "list", "string"]) {
    const file = `dist/bench/official-kn-diagnostic/${name}.json`;
    let bytes;
    try { bytes = await readFile(path.join(root, file)); }
    catch (error) { if (error.code !== "ENOENT") throw error; continue; }
    const run = JSON.parse(bytes);
    evidence.diagnostics.push({ name, raw_file: file, raw_sha256: hash(bytes), status: run.status,
      input_sha256: run.input_sha256, errors: run.errors, page_errors: run.page_errors,
      bundles: run.bundles, browser_version: run.browser_version,
      workload: run.workload, deterministic: run.deterministic,
      updates: run.workload_diagnostic?.updates.map(update => ({ frame_before: update.frame_before,
        frame_after: update.frame_after, tail_calls: update.tail_calls,
        boundary_returns: update.boundary_returns, max_step_tail: update.max_step_tail,
        completed_batch: update.completed_batch })) });
  }
  await writeFile(path.join(root, "docs/knperf-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Archived ${evidence.native_ab.length} native AB suites; official=${!!evidence.official}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
