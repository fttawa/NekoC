#!/usr/bin/env node
// Keep all third-party input read-only. Only traces/summaries go to ignored dist/.
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJson, saveJson, runOracle } from "./k4-oracle.mjs";

const corpus = process.argv[2];
if (!corpus) throw new Error("Usage: node tools/compat/k4-run-error-corpus.mjs <corpus> [--profile debug|release] [--out dist/path] [--official]");
const seeds = [1, 6, 42];
const option = (flag, fallback) => {
  if (!process.argv.includes(flag)) return fallback;
  const value = process.argv[process.argv.indexOf(flag) + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
};
const profile = option("--profile", "debug");
if (!["debug", "release"].includes(profile)) throw new Error("--profile must be debug or release");
const root = option("--out", `dist/runerr2/${profile}`);
const files = (await readdir(corpus)).filter(f => f.endsWith(".bcm")).sort();
const report = { profile, frames: 60, seeds, coverage: {}, official: {} };
for (const seed of seeds) {
  const result = spawnSync(`target/${profile}/nekoc.exe`, ["coverage", ...files.map(f => path.join(corpus, f)), "--frames", "60", "--seed", String(seed)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `coverage exit ${result.status}`);
  const works = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const stages = {};
  for (const work of works) stages[work.report.stage] = (stages[work.report.stage] || 0) + 1;
  report.coverage[seed] = { stages, works };
  await saveJson(`${root}/coverage-${seed}.json`, { stages, works });
  console.log(seed, stages);
}
if (process.argv.includes("--official")) for (const id of ["335327306", "305999424"]) {
  for (const seed of seeds) {
    const frames = id === "305999424" ? 3 : 8;
    const blockFilter = id === "305999424" ? "N9k3sQ5kpqHqqlImQIA6,o4hGuLFYmMpKxDa9Axds" : "dn3VUmIJT0EgTdvee77o,yVr7QICXhHTREBS66S53,PHQya6TAC4gOerdkNoxG";
    const result = spawnSync(`target/${profile}/k4-trace.exe`, [path.join(corpus, `${id}.bcm`), "--frames", String(frames), "--seed", String(seed), "--blocks", "--block-filter", blockFilter], { encoding: "utf8", maxBuffer: 384 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr);
    const native = JSON.parse(result.stdout);
    await saveJson(`${root}/${id}-nekoc-${seed}.json`, native);
    const official = await runOracle(await readJson(path.join(corpus, `${id}.bcm`)), {
      frames, seed, blocks: true, randomSource: "nekoc", allowAssets: true,
      blockFilter,
    });
    await saveJson(`${root}/${id}-official-${seed}.json`, official);
    report.official[`${id}/${seed}`] = { nativeFrames: native.frames.length, error: native.error ?? null,
      nativeTruncated: native.traceTruncated, officialFrames: official.frames.length, officialTruncated: official.traceTruncated,
      generatorYield: native.events.find(e => e.hat === "liunvhDthdi1RbN0iRJv" && e.event === "yield"),
      officialGeneratorYield: official.events.find(e => e.hat === "liunvhDthdi1RbN0iRJv" && e.event === "yield") };
    console.log(id, seed, report.official[`${id}/${seed}`]);
  }
}
await saveJson(`${root}/summary.json`, report);
