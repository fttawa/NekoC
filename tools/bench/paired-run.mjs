// Shared paired-worker contract: never admit partial update sequences as samples.
export function checkedRun(run, official) {
  if (run.frame_ms?.length !== 120 || run.warmup_ms?.length !== 10) throw new Error("Update count mismatch");
  if ([...run.frame_ms, ...run.warmup_ms].some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid samples");
  if (official) Object.assign(run, { runtime: "official", seed: 1, frames: 120, warmup: 10 });
  return run;
}
