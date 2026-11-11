#!/usr/bin/env node
// Compare the complete pre-fix pipeline with the current one. The baseline is
// a local git archive of 0036124 in ignored dist/, not another worktree.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { visualWork, distribution, markdown } from "./k4-visual.mjs";
import { saveJson } from "./k4-oracle.mjs";

const baselineRoot = path.resolve("dist/k4fix/baseline-src");
const baseline = await import(pathToFileURL(path.join(baselineRoot, "tools/compat/k4-visual.mjs")));
const corpus = process.argv[2] || "E:/nekoc/dist/kitten4-corpus";
const options = { captureFrames: [1, 30, 60], pixelTolerance: 8, seed: 1,
  allowAssets: true, assetCache: new Map(), wallTimeoutMs: 180000 };
const report = { schema: "nekoc-k4fix-before-after-v1", baseline: "0036124",
  note: "before uses the old wall-clock oracle and canvas-only capture; after uses matched virtual clocks and the DOM overlay",
  works: [] };
for (const id of ["335017543", "331465353", "319595457"]) {
  const file = path.resolve(corpus, `${id}.bcm`);
  const pair = { id };
  for (const [label, run, extra] of [
    ["before", baseline.visualWork, { nekoc: path.resolve("target/k4fix-baseline/debug/k4-trace.exe") }],
    ["after", visualWork, {}],
  ]) {
    console.error(`${id} ${label}`);
    const work = await run(file, { ...options, ...extra, artifactsDir: `dist/k4fix/final-${label}` });
    pair[label] = work;
    const single = { ...options, works: [work], distribution: distribution([work]) };
    await saveJson(`dist/k4fix/final-${id}-${label}.json`, single);
    await writeFile(`dist/k4fix/final-${id}-${label}.md`, markdown(single));
    if (work.status !== "captured") throw Error(`${id}/${label}: ${work.error || work.status}`);
    console.log(id, label, work.frames.map(f => `${f.frame}:${f.changedPercent.toFixed(4)}%`).join(" "));
  }
  report.works.push(pair);
  await saveJson("dist/k4fix/final-before-after.json", report);
}
// The first 34 animation frames of 335017543 are intentionally empty. Verify
// actual white geometry later as well; filter only oracle trace output, never
// alter the work's variables or execution.
const contour = await visualWork(path.resolve(corpus, "335017543.bcm"), {
  ...options, captureFrames: [100, 150], artifactsDir: "dist/k4fix/final-contour",
  variableFilter: "49a3b61d-644e-4887-8059-ce6c08309e31,4f2e70e2-eef4-44ac-b6e1-39381e885f6a",
});
await saveJson("dist/k4fix/final-contour.json", contour);
if (contour.status !== "captured") throw Error(`contour: ${contour.error || contour.status}`);
console.log("contour", contour.frames.map(f => `${f.frame}:${f.changedPercent.toFixed(4)}%`).join(" "));
