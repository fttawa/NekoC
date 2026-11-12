#!/usr/bin/env node
// Paired native KN benchmark. Both sides execute the same repository-owned
// bcmkn bytes; this does not compare a third-party runtime.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./run.mjs";
import { assertIdle, assertWritablePath, ignoredPath } from "./hateneko.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frames = 60, warmup = 10, repeats = 5;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const binary = async file => ({ file: path.resolve(root, file), sha256: sha256(await readFile(path.resolve(root, file))) });

export function validateSample(result, input = "sample") {
  if (!result || result.runtime !== "nekoc" || !Array.isArray(result.frame_ms) || !Array.isArray(result.warmup_ms)
      || result.frame_ms.length !== frames || result.warmup_ms.length !== warmup
      || !result.final_state || typeof result.final_state !== "object" || result.deterministic === true) {
    throw new Error(`Incomplete native sample for ${path.basename(input)}`);
  }
  if ([...result.frame_ms, ...result.warmup_ms].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid native sample for ${path.basename(input)}`);
  }
  return { ...result, summary_ms: summarize(result.frame_ms) };
}

function run(binaryInfo, input) {
  return validateSample(JSON.parse(execFileSync(binaryInfo.file, [input, "--warmup", String(warmup), "--frames", String(frames)], {
    cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024,
  })), input);
}

export function sameState(a, b) {
  return a != null && b != null && JSON.stringify(a) === JSON.stringify(b);
}

export function validateResume(saved, identity, inputs) {
  if (saved.schema !== identity.schema || JSON.stringify(saved.binaries) !== JSON.stringify(identity.binaries)
      || JSON.stringify(saved.options) !== JSON.stringify(identity.options) || !Array.isArray(saved.works)) throw new Error("Resume identity mismatch");
  if (JSON.stringify(saved.host) !== JSON.stringify(identity.host)) throw new Error("Resume host mismatch");
  const seen = new Set();
  for (const work of saved.works) {
    const expected = inputs.find(input => input.name === work.name);
    if (!expected || seen.has(work.name) || expected.sha256 !== work.sha256 || expected.file !== work.file
        || !Array.isArray(work.runs) || work.runs.length > repeats) throw new Error("Resume input mismatch");
    seen.add(work.name);
    for (const [index, pair] of work.runs.entries()) {
      if (pair.repeat !== index) throw new Error("Resume pair order mismatch");
      pair.before = validateSample(pair.before);
      pair.after = validateSample(pair.after);
      pair.final_state_equal = sameState(pair.before.final_state, pair.after.final_state);
    }
  }
  return saved;
}

async function main() {
  const [beforeArg, afterArg, fixturesArg, outArg, ...extra] = process.argv.slice(2);
  if (!beforeArg || !afterArg || !fixturesArg || !outArg || extra.length) {
    throw new Error("Usage: kn-ab.mjs before.exe after.exe fixtures-dir dist/.../out");
  }
  const out = ignoredPath(outArg);
  await assertWritablePath(path.join(out, "results.json"));
  const before = await binary(beforeArg), after = await binary(afterArg);
  const fixturesDir = path.resolve(root, fixturesArg);
  const names = (await readdir(fixturesDir)).filter(name => name.endsWith(".bcmkn")).sort();
  const expectedNames = ["broadcast", "clones", "list", "numeric", "pen", "recursion", "string"].map(name => `${name}.bcmkn`);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new Error("Expected the seven named KN fixtures");
  const inputs = await Promise.all(names.map(async name => ({ name,
    file: path.relative(root, path.join(fixturesDir, name)).replaceAll("\\", "/"), sha256: sha256(await readFile(path.join(fixturesDir, name))) })));
  await mkdir(out, { recursive: true });
  let report = {
    schema: "nekoc-kn-native-ab-v1", date: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, node: process.version },
    options: { frames, warmup, repeats, order: "before-after / after-before alternating" },
    binaries: { before, after }, works: [],
  };
  try {
    const saved = JSON.parse(await readFile(path.join(out, "results.json"), "utf8"));
    report = validateResume(saved, report, inputs);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of names) {
    const input = path.join(fixturesDir, name), bytes = await readFile(input);
    let work = report.works.find(work => work.name === name);
    if (work && work.sha256 !== sha256(bytes)) throw new Error("Resume input mismatch");
    if (!work) {
      work = { name, file: path.relative(root, input).replaceAll("\\", "/"), sha256: sha256(bytes), runs: [] };
      report.works.push(work);
    }
    for (let repeat = work.runs.length; repeat < repeats; repeat++) {
      const order = repeat % 2 ? [["after", after], ["before", before]] : [["before", before], ["after", after]];
      const runBySide = {};
      const idleChecks = [];
      const rawFiles = {};
      for (const [side, binaryInfo] of order) {
        idleChecks.push(assertIdle());
        if (sha256(await readFile(binaryInfo.file)) !== binaryInfo.sha256) throw new Error("Benchmark binary changed");
        const sample = run(binaryInfo, input);
        // Preserve attempts rejected by the post-run guard; resume reruns the
        // entire unfinished pair, never erases a completed single-side sample.
        const rawPath = path.join(out, `${name}-${repeat}-${side}-${Date.now()}.json`);
        await assertWritablePath(rawPath);
        await writeFile(rawPath, JSON.stringify({ binary: binaryInfo, input_sha256: work.sha256, sample }, null, 2) + "\n");
        rawFiles[side] = path.relative(root, rawPath).replaceAll("\\", "/");
        idleChecks.push(assertIdle());
        if (sha256(await readFile(binaryInfo.file)) !== binaryInfo.sha256) throw new Error("Benchmark binary changed during run");
        runBySide[side] = sample;
        console.log(`${name} ${repeat} ${side} ${sample.summary_ms.mean.toFixed(6)} ms`);
      }
      if (sha256(await readFile(input)) !== work.sha256) throw new Error("Input changed during pair");
      work.runs.push({ repeat, idle_checks: idleChecks, raw_files: rawFiles, before: runBySide.before, after: runBySide.after,
        final_state_equal: sameState(runBySide.before.final_state, runBySide.after.final_state) });
      await writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.summary = report.works.map(work => {
    const beforeMeans = work.runs.map(run => run.before.summary_ms.mean);
    const afterMeans = work.runs.map(run => run.after.summary_ms.mean);
    const beforeMedian = median(beforeMeans), afterMedian = median(afterMeans);
    return { name: work.name, before_ms: beforeMedian, after_ms: afterMedian,
      change_percent: (afterMedian / beforeMedian - 1) * 100,
      final_state_equal: work.runs.every(run => run.final_state_equal),
      before_samples_ms: beforeMeans, after_samples_ms: afterMeans };
  });
  report.summary_sha256 = sha256(Buffer.from(JSON.stringify(report.summary)));
  for (const info of [before, after]) if (sha256(await readFile(info.file)) !== info.sha256) throw new Error("Benchmark binary changed during suite");
  await writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.some(work => !work.final_state_equal)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
