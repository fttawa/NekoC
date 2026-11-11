#!/usr/bin/env node
// Alternating order reduces thermal/time drift; never run while building/testing.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveJson } from "../compat/k4-oracle.mjs";
import { summarize } from "./run.mjs";
import { compare } from "./compare.mjs";
import { checkedRun } from "./paired-run.mjs";

const [before, after, fixtures, out] = process.argv.slice(2);
if (!before || !after || !fixtures || !out || !path.resolve(out).startsWith(path.resolve("dist") + path.sep)) throw new Error("Usage: paired.mjs before.exe|official after.exe fixtures-dir dist/.../paired");
const binaries = await Promise.all([before, after].map(async file => file === "official" ? { runtime: "official" } : ({ file: path.resolve(file), sha256: createHash("sha256").update(await readFile(file)).digest("hex") })));
const suites = binaries.map(binary => ({ binary, options: { frames: 120, warmup: 10, repeats: 7 }, date: new Date().toISOString(), works: [] }));
for (const name of (await readdir(fixtures)).filter(n => n.endsWith(".bcm")).sort()) {
  const file = path.resolve(fixtures, name);
  const sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
  suites.forEach(s => s.works.push({ name, file, sha256, runs: [] }));
  for (let repeat = 0; repeat < 7; repeat++) {
    for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
      const official = binaries[index].runtime === "official";
      const worker = fileURLToPath(new URL("./official.mjs", import.meta.url));
      const r = JSON.parse(execFileSync(official ? process.execPath : binaries[index].file,
        official ? [worker, file, "120", "10", "false", `${out}/${name}-${repeat}-failure.json`] : [file, "--warmup", "10", "--frames", "120"],
        { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }));
      checkedRun(r, official);
      r.status = "ok"; r.repeat = repeat; r.summary_ms = summarize(r.frame_ms);
      suites[index].works.at(-1).runs.push(r);
    }
  }
  console.log(name);
}
await saveJson(`${out}/before.json`, suites[0]);
await saveJson(`${out}/after.json`, suites[1]);
const comparison = compare(...suites);
await saveJson(`${out}/comparison.json`, comparison);
console.log(JSON.stringify(comparison, null, 2));
if (comparison.some(r => r.status !== "equal-final-state")) process.exitCode = 1;
