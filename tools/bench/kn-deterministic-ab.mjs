#!/usr/bin/env node
// Semantic diagnostic only, never a timing comparison. All seven inputs must
// be repository-owned; outputs are confined to this worktree's ignored dist/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWritablePath, ignoredPath } from "./hateneko.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Timing, RSS and process initialization are deliberately excluded. This is a
// legacy JSON projection comparison, NOT bit-preserving Cell equality: JSON
// cannot distinguish undefined/null or nonfinite values in oracle_snapshot.
export function semanticResult(sample, expected) {
  const { import_ms, start_ms, frame_ms, warmup_ms, peak_rss_bytes, ...semantic } = sample;
  if (semantic.schema !== "nekoc-performance-v1" || semantic.runtime !== "nekoc"
      || semantic.deterministic !== true || semantic.frames !== 60 || semantic.warmup !== 10
      || !semantic.final_state || typeof semantic.final_state !== "object"
      || ![semantic.instructions, semantic.pen_lines, semantic.active_frames].every(value => Number.isSafeInteger(value) && value >= 0)
      || semantic.active_frames > semantic.frames
      || expected && (semantic.input !== expected.input || semantic.seed !== expected.seed)
      || !Array.isArray(frame_ms) || !Array.isArray(warmup_ms)
      || frame_ms.length !== semantic.frames || warmup_ms.length !== semantic.warmup
      || [...frame_ms, ...warmup_ms].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Expected a complete deterministic perf-bench sample");
  }
  return semantic;
}

async function main() {
  const [beforeArg, afterArg, fixturesArg, outArg, ...extra] = process.argv.slice(2);
  if (!beforeArg || !afterArg || !fixturesArg || !outArg || extra.length) {
    throw new Error("Usage: kn-deterministic-ab.mjs before.exe after.exe fixtures-dir dist/.../out");
  }
  const binaries = await Promise.all([beforeArg, afterArg].map(async file => ({
    path: path.resolve(root, file), sha256: hash(await readFile(path.resolve(root, file))),
  })));
  const out = ignoredPath(outArg);
  await assertWritablePath(out);
  await mkdir(out, { recursive: true });
  const results = [];
  for (const name of ["broadcast", "clones", "list", "numeric", "pen", "recursion", "string"]) {
    const input = path.resolve(root, fixturesArg, `${name}.bcmkn`);
    const inputSha256 = hash(await readFile(input));
    for (const interpreter of [false, true]) for (const seed of [1, 6, 42]) {
      const args = [input, "--frames", "60", "--warmup", "10", "--seed", String(seed), "--deterministic",
        ...(interpreter ? ["--interpreter"] : [])];
      const samples = [];
      for (const binary of binaries) {
        if (hash(await readFile(input)) !== inputSha256) throw new Error("Input changed before run");
        samples.push(JSON.parse(execFileSync(binary.path, args, {
          cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024,
        })));
        if (hash(await readFile(input)) !== inputSha256) throw new Error("Input changed during run");
      }
      const semantics = samples.map(sample => semanticResult(sample, { input, seed })).map(result => JSON.stringify(result));
      const equal = semantics[0] === semantics[1];
      const result = { name, interpreter, seed, input, input_sha256: inputSha256, equal,
        semantic_sha256: semantics.map(hash) };
      results.push(result);
      await writeFile(path.join(out, `${name}-${interpreter ? "interpreter" : "jit"}-${seed}.json`),
        JSON.stringify({ ...result, samples }, null, 2) + "\n");
      console.log(`${name} ${interpreter ? "interpreter" : "jit"} seed=${seed}: ${equal ? "equal" : "DIFFERENT"}`);
    }
  }
  for (const binary of binaries) if (hash(await readFile(binary.path)) !== binary.sha256) throw new Error("Binary changed");
  await writeFile(path.join(out, "results.json"), JSON.stringify({ binaries, results }, null, 2) + "\n");
  if (results.some(result => !result.equal)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
