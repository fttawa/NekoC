#!/usr/bin/env node
// Performance ratios are only emitted with identical input hashes AND final states.
import { isDeepStrictEqual } from "node:util";
import { readJson, saveJson } from "../compat/k4-oracle.mjs";
import { summarize } from "./run.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function compare(before, after) {
  const crossRuntime = before.binary?.runtime === "official" || after.binary?.runtime === "official";
  const ambiguous = value => value == null || typeof value === "number" && !Number.isFinite(value)
    || typeof value === "object" && Object.values(value).some(ambiguous);
  const normalizedState = run => {
    const state = structuredClone(run.final_state);
    if (!state) return state;
    delete state.frame;
    if (crossRuntime) {
      // Official-only display labels and absent-vs-empty entity maps are
      // diagnostics. Keep every actual variable (including private cells).
      delete state.variable_names;
      if (state.entity_variables) for (const [id, values] of Object.entries(state.entity_variables)) {
        if (values && !Array.isArray(values) && typeof values === "object" && Object.keys(values).length === 0) delete state.entity_variables[id];
      }
    }
    return state;
  };
  if (before.options && after.options && ["frames", "warmup"].some(k => before.options[k] !== after.options[k])) throw new Error("Frame/warmup options differ");
  return before.works.map(a => {
    const b = after.works.find(b => b.name === a.name);
    if (!b || a.sha256 !== b.sha256) return { name: a.name, status: "input-mismatch" };
    const left = a.runs.filter(r => r.status === "ok"), right = b.runs.filter(r => r.status === "ok");
    if (left.length !== a.runs.length || right.length !== b.runs.length || !left.length || !right.length) return { name: a.name, status: "unverified" };
    for (const r of [...left, ...right]) {
      if (r.seed !== left[0].seed || r.frames !== left[0].frames || r.warmup !== left[0].warmup) return { name: a.name, status: "configuration-mismatch" };
      // The legacy performance JSON maps nonfinite values to null. Do not claim
      // cross-kernel value equality for ambiguous variable encodings.
      if (crossRuntime && (ambiguous(r.final_state?.variables) || ambiguous(r.final_state?.entity_variables))) return { name: a.name, status: "unverified" };
      const state = normalizedState(r);
      const expected = normalizedState(left[0]);
      if (!state || !isDeepStrictEqual(state, expected)) return { name: a.name, status: "state-mismatch" };
    }
    const l = summarize(left.map(r => r.summary_ms.mean)).median;
    const r = summarize(right.map(r => r.summary_ms.mean)).median;
    return { name: a.name, status: "equal-final-state", before_ms: l, after_ms: r, speedup: l / r };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after, out] = process.argv.slice(2);
  if (!before || !after || !out || !path.resolve(out).startsWith(path.resolve("dist") + path.sep)) throw new Error("Usage: compare.mjs before.json after.json dist/.../comparison.json");
  const result = compare(await readJson(before), await readJson(after));
  await saveJson(out, result);
  console.log(JSON.stringify(result, null, 2));
  if (result.some(r => r.status !== "equal-final-state")) process.exitCode = 1;
}
