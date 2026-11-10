#!/usr/bin/env node
// Compact, non-source evidence: hashes, scalar timings and state fingerprints only.
// Never serialize corpus objects/assets into tracked files.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readJson, saveJson } from "../compat/k4-oracle.mjs";
import { summarize } from "./run.mjs";

const root = process.argv[2] || "dist/bench";
const pairedBefore = await readJson(`${root}/paired/before.json`);
const pairedAfter = await readJson(`${root}/paired/after.json`);
const official = await readJson(`${root}/official-memory/results.json`);
const native = await readJson(`${root}/native-final/results.json`);
const median = a => summarize(a).median;
const compact = w => w.runs.some(r => r.status !== "ok") ? { name: w.name, sha256: w.sha256, status: "unverified", errors: w.runs.map(r => r.error) } : ({ name: w.name, sha256: w.sha256, status: w.runs.map(r => r.status),
  import_ms: median(w.runs.map(r => r.import_ms)), frame_mean_ms: median(w.runs.map(r => r.summary_ms.mean)),
  frame_p95_ms: median(w.runs.map(r => r.summary_ms.p95)),
  peak_rss_bytes: w.runs[0].runtime === "nekoc" ? median(w.runs.map(r => r.peak_rss_bytes)) : null,
  renderer_peak_rss_bytes: w.runs[0].renderer_memory?.renderers ? median(w.runs.map(r => Math.max(...r.renderer_memory.renderers.map(p => p.peak_rss_bytes)))) : null,
  sampled_js_heap_peak_bytes: w.runs[0].sampled_js_heap_peak_bytes ? median(w.runs.map(r => r.sampled_js_heap_peak_bytes)) : null,
  final_state_sha256: w.runs.map(r => createHash("sha256").update(JSON.stringify(r.final_state)).digest("hex")),
  instructions: w.runs[0].instructions, active_frames: w.runs[0].active_frames });
const files = ["paired/before.json", "paired/after.json", "paired/comparison.json", "official-memory/results.json", "native-final/results.json", "hateneko.json",
  "corpus-compute-final/results.json", "corpus-pen-final/results.json", "corpus-assets/results.json"];
const evidence = { schema: "nekoc-performance-evidence-v1", baseline_revision: "146fd4f",
  host: official.host, date: official.date, browser: official.works[0].runs[0].browser_version,
  options: { paired: pairedAfter.options, official: official.options }, binaries: [pairedBefore.binary, pairedAfter.binary],
  raw_sha256: Object.fromEntries(await Promise.all(files.map(async f => [f, createHash("sha256").update(await readFile(`${root}/${f}`)).digest("hex")]))),
  assets: official.works[0].runs[0].assets, hateneko: await readJson(`${root}/hateneko.json`),
  comparison: await readJson(`${root}/paired/comparison.json`),
  before: pairedBefore.works.map(compact), after: pairedAfter.works.map(compact), official: official.works.map(compact),
  native: native.works.map(compact), corpus_official: (await Promise.all(["corpus-compute-final", "corpus-pen-final", "corpus-assets"].map(p => readJson(`${root}/${p}/results.json`)))).flatMap(s => s.works.map(compact)) };
// This file contains only our measurements, not third-party works/kernel code.
await saveJson("docs/performance-evidence.json", evidence);
console.log("docs/performance-evidence.json");
