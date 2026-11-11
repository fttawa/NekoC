#!/usr/bin/env node
// Compact observations only; never copy projects or official implementation.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCompleteSuite, assertWritablePath, compareRun } from "./hateneko.mjs";

export function milestone(file, state) {
  if (!state) return false;
  const v = state.variables;
  if (/actor-variables(?:-deleted)?\.bcmkn$/.test(file)) return v.done === 1;
  if (file.endsWith("fangjie.bcmkn")) return Array.isArray(v["kn-list-world"]) && v["kn-list-world"].length === 524288
    && v["kn-list-world"].every(x => x === 0)
    && ["kn-list-chunk_x", "kn-list-chunk_z"].every(id => Array.isArray(v[id]) && v[id].length === 64 && v[id].every(x => x === 99999))
    && v["kn-var-gui_dirty"] === 0 && Object.values(state.actors).some(a => a.y === -65);
  return v["kn-var-lm_status"] === "DONE / EOS" && v["kn-var-lm_running"] === 0
    && Array.isArray(v["kn-list-lm_generated_ids"]) && v["kn-var-lm_generated"] === v["kn-list-lm_generated_ids"].length;
}

export function validateLongSuite(suite) {
  assertCompleteSuite(suite);
  if (suite.binary_unchanged !== true) throw new Error("Missing long-run binary integrity verification");
  if (!Number.isSafeInteger(suite.options.projectFrames) || suite.options.projectFrames <= 12
      || suite.works.some(work => work.frames !== suite.options.projectFrames)) throw new Error("Not an explicit long-run frame budget");
  for (const work of suite.works) for (const run of work.runs) compareRun(run, work);
}

export function completeMilestone(work, runtime) {
  return runtime.status === "ok" && !runtime.errors?.length && !runtime.missing_primitives?.length
    && Array.isArray(runtime.frame_ms) && runtime.frame_ms.length === work.frames
    && Array.isArray(runtime.warmup_ms) && runtime.warmup_ms.length === work.warmup
    && [...runtime.frame_ms, ...runtime.warmup_ms].every(v => Number.isFinite(v) && v >= 0)
    && milestone(work.file, runtime.final_state);
}

export function compactState(state) {
  if (!state) return null;
  return {
    current_scene_id: state.current_scene_id,
    actors: state.actors,
    entity_variables: state.entity_variables,
    variables: Object.fromEntries(Object.entries(state.variables).map(([id, value]) => [id,
      Array.isArray(value) && value.length > 32 ? {
        kind: "list", length: value.length,
        sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
        first: value.slice(0, 3), last: value.slice(-3),
      } : value])),
  };
}

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) throw new Error("Usage: hateneko-long-evidence.mjs <results.json> ...");
  const runs = [];
  for (const input of inputs) {
    const bytes = await readFile(input), suite = JSON.parse(bytes);
    validateLongSuite(suite);
    for (const work of suite.works) {
      if (!/^(?:fangjie|tiny_lm|actor-variables(?:-deleted)?)\.bcmkn$/.test(path.basename(work.file.replaceAll("\\", "/")))) throw new Error("Not a long-run project");
      runs.push({ source: input, source_sha256: createHash("sha256").update(bytes).digest("hex"),
        revision: suite.revision, binary_sha256: suite.binary_sha256, interpreter: !!suite.options.interpreter,
        binary_unchanged: suite.binary_unchanged,
        reference: { version: suite.reference.version, unchanged: suite.reference.unchanged,
          tree_sha256: createHash("sha256").update(JSON.stringify(suite.reference.files)).digest("hex") },
        file: work.file.replaceAll("\\", "/"), sha256: work.sha256, frames: work.frames,
        runs: work.runs.map(run => ({ comparison: run.comparison,
          normalization: work.normalization, normalized_comparison: run.normalized_comparison,
          runtimes: Object.fromEntries(Object.entries(run.runtimes).map(([name, runtime]) => [name, {
            status: runtime.status, errors: runtime.errors, missing_primitives: runtime.missing_primitives,
            error: runtime.error, expected_frames: work.frames, measured_frames: runtime.frame_ms?.length,
            expected_warmup: work.warmup, measured_warmup: runtime.warmup_ms?.length,
            milestone_reached: completeMilestone(work, runtime),
            final_state: compactState(runtime.final_state),
          }])) })),
      });
    }
  }
  const destination = fileURLToPath(new URL("../../docs/compatibility/hncompat2-long-evidence.json", import.meta.url));
  await assertWritablePath(destination);
  await writeFile(destination, JSON.stringify({ schema: "hncompat2-long-v1", runs }, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
