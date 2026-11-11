#!/usr/bin/env node
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, saveJson } from "../compat/k4-oracle.mjs";
import { writeFixtures } from "./fixtures.mjs";

export function parseArgs(argv) {
  const o = { out: "dist/bench/run", frames: 180, warmup: 30, repeats: 3, runtime: "nekoc", timeout: 120000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--allow-assets") { o.allowAssets = true; continue; }
    const key = argv[i].replace(/^--/, "");
    if (!["out", "frames", "warmup", "repeats", "runtime", "corpus", "binary", "input", "fixtures", "timeout"].includes(key) || !argv[i + 1]) throw new Error(`Invalid option ${argv[i]}`);
    o[key] = argv[++i];
  }
  for (const k of ["frames", "warmup", "repeats", "timeout"]) {
    o[k] = Number(o[k]);
    if (!Number.isSafeInteger(o[k]) || o[k] < (k === "warmup" ? 0 : 1) || o[k] > 1000000) throw new Error(`Invalid ${k}`);
  }
  if (!["nekoc", "official", "both"].includes(o.runtime)) throw new Error("Invalid runtime");
  if (o.frames + o.warmup > 100000) throw new Error("Too many total frames");
  if (!path.resolve(o.out).startsWith(path.resolve("dist") + path.sep)) throw new Error("Outputs must be under ignored dist/");
  return o;
}

export function summarize(values) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid samples");
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
}

// Static candidate selection, not a claim that those blocks execute. Keep all scores.
export function scoreProject(p) {
  const scores = { compute: 0, clones: 0, pen: 0 };
  function visit(v) {
    if (!v || typeof v !== "object") return;
    const t = v.type || "";
    if (/math_|calculate|repeat|procedures_2_call/.test(t)) scores.compute++;
    if (/mirror/.test(t) || t === "clone") scores.clones++;
    if (/pen|brush/.test(t)) scores.pen++;
    Object.values(v).forEach(visit);
  }
  visit(p.compile_result || p.theatre);
  return scores;
}

async function corpusCandidates(directory, out) {
  const scores = [];
  for (const name of (await readdir(directory)).filter(n => n.endsWith(".bcm")).sort()) {
    const file = path.resolve(directory, name);
    scores.push({ file, ...scoreProject(await readJson(file)) });
  }
  if (!scores.length) throw new Error("Empty corpus");
  await saveJson(`${out}/corpus-scores.json`, scores);
  const selected = [];
  for (const k of ["compute", "clones", "pen"]) {
    const candidate = [...scores].sort((a, b) => b[k] - a[k] || a.file.localeCompare(b.file)).find(s => !selected.includes(s.file));
    if (candidate) selected.push(candidate.file);
  }
  return selected;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  await mkdir(o.out, { recursive: true });
  const files = o.input ? [path.resolve(o.input)] : o.fixtures
    ? (await readdir(o.fixtures)).filter(f => f.endsWith(".bcm")).sort().map(f => path.resolve(o.fixtures, f))
    : await writeFixtures(`${o.out}/fixtures`);
  if (!files.length) throw new Error("Empty fixture directory");
  if (o.corpus) files.push(...await corpusCandidates(o.corpus, o.out));
  const binary = path.resolve(o.binary || `target/release/perf-bench${process.platform === "win32" ? ".exe" : ""}`);
  const report = { schema: "nekoc-bench-suite-v1", options: o, date: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, memory: os.totalmem(), node: process.version },
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), works: [],
    hateneko: { status: "separate-kn-suite", reason: "Not measured by this K4 runner. Run tools/bench/hateneko.mjs for same-input KN measurements; see docs/performance.md." } };
  if (o.runtime !== "official") report.binary = { file: binary, sha256: createHash("sha256").update(await readFile(binary)).digest("hex") };
  for (const file of files) {
    const work = { name: path.basename(file), file, sha256: createHash("sha256").update(await readFile(file)).digest("hex"), runs: [] };
    report.works.push(work);
    for (const runtime of (o.runtime === "both" ? ["nekoc", "official"] : [o.runtime])) for (let repeat = 0; repeat < o.repeats; repeat++) {
      const run = { runtime, repeat };
      try {
        if (runtime === "nekoc") Object.assign(run, JSON.parse(execFileSync(binary, [file, "--frames", String(o.frames), "--warmup", String(o.warmup)], { encoding: "utf8", timeout: o.timeout, maxBuffer: 64 * 1024 * 1024 })));
        else {
          const worker = fileURLToPath(new URL("./official.mjs", import.meta.url));
          Object.assign(run, JSON.parse(execFileSync(process.execPath, [worker, file, String(o.frames), String(o.warmup), String(!!o.allowAssets),
            `${o.out}/${work.name}-${runtime}-${repeat}-failure.json`], { encoding: "utf8", timeout: o.timeout, maxBuffer: 64 * 1024 * 1024 })));
          if (run.frame_ms.length !== o.frames) throw new Error(`Update count mismatch: ${run.frame_ms.length}`);
        }
        run.summary_ms = summarize(run.frame_ms);
        run.status = "ok";
        console.log(work.name, runtime, repeat, JSON.stringify(run.summary_ms));
      } catch (error) {
        run.status = "unverified"; run.error = error.message;
        if (error.diagnostics) await saveJson(`${o.out}/${work.name}-${runtime}-${repeat}-failure.json`, error.diagnostics);
        console.error(work.name, runtime, error.message.slice(0, 350));
      }
      work.runs.push(run);
      await saveJson(`${o.out}/results.json`, report);
    }
  }
  await writeFile(`${o.out}/summary.md`, ["|作品|运行时|次数|导入 ms|帧均值 ms|帧 p95 ms|内存 bytes|状态|", "|---|---|---:|---:|---:|---:|---:|---|",
    ...report.works.flatMap(w => w.runs.map(r => `|${w.name}|${r.runtime}|${r.repeat}|${r.import_ms?.toFixed(2) ?? "—"}|${r.summary_ms?.mean.toFixed(4) ?? "—"}|${r.summary_ms?.p95.toFixed(4) ?? "—"}|${r.peak_rss_bytes ?? r.sampled_js_heap_peak_bytes ?? "—"}|${r.status}|`))].join("\n") + "\n");
  if (report.works.some(w => w.runs.some(r => r.status !== "ok"))) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
