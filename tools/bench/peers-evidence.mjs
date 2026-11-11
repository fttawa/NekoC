#!/usr/bin/env node
// Compact, reproducible export of our measurements only; no vendor source/work.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { comparePair, validateSuite } from './peers.mjs';
import { summarize } from './run.mjs';
import { assertWritablePath } from './hateneko.mjs';
import path from 'node:path';

const [input = 'dist/bench/peers/results.json', output = 'docs/performance-peers-evidence.json'] = process.argv.slice(2);
if (path.resolve(input) === path.resolve(output)) throw new Error('Cannot overwrite raw results');
await assertWritablePath(output);
const bytes = await readFile(input);
const suite = JSON.parse(bytes);
validateSuite(suite);
const hash = value => createHash('sha256').update(value).digest('hex');
const compact = values => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key,
  typeof value === 'string' && value.length > 128 || Array.isArray(value)
    ? { type: typeof value === 'string' ? 'string' : 'list', length: value.length, sha256: hash(JSON.stringify(value)) } : value]));
const works = suite.works.map(work => {
  const runs = work.runs.map(run => {
    const runtimes = Object.fromEntries(['nekoc', 'turbowarp'].map(key => {
      const r = run.runtimes[key];
      const summary = r.status === 'ok' && r.frame_ms?.length ? summarize(r.frame_ms) : {};
      return [key, { status: r.status, import_ms: r.import_ms, start_ms: r.start_ms, mean_ms: summary.mean,
        p95_ms: summary.p95, peak_rss_bytes: r.peak_rss_bytes, variables: compact(r.final_state?.variables),
        actor_count: Object.keys(r.final_state?.actors ?? {}).length, errors: r.errors, error: r.error?.slice(0, 1800),
        compiled_threads: r.compiled_threads, interpreted_threads: r.interpreted_threads, current_step_time_ms: r.current_step_time_ms,
        unknown_opcodes: r.unknown_opcodes, stderr_sha256: r.stderr ? hash(r.stderr) : undefined }];
    }));
    return { repeat: run.repeat, order: run.order, runtimes,
      comparison: comparePair(work.name, work.inspection ?? { unsupported: [] }, run.runtimes.nekoc, run.runtimes.turbowarp, suite.options.frames) };
  });
  const metrics = {};
  for (const key of ['nekoc', 'turbowarp']) {
    metrics[key] = {};
    for (const metric of ['import_ms', 'start_ms', 'mean_ms', 'p95_ms', 'peak_rss_bytes']) {
      const values = runs.map(r => r.runtimes[key][metric]);
      if (runs.every(r => r.runtimes[key].status === 'ok') && values.every(v => Number.isFinite(v) && v >= 0)) metrics[key][metric] = summarize(values).median;
    }
  }
  return { format: work.format, name: work.name, input_sha256: work.input_sha256, sb3_sha256: work.sb3_sha256,
    inspection: work.inspection, convert_wall_ms: work.convert_wall_ms, convert_error: work.convert_error?.slice(0, 1800), metrics, runs };
});
const { works: _works, ...header } = suite;
await writeFile(output, JSON.stringify({ ...header, source_sha256: hash(bytes),
  exporter_sha256: hash(await readFile(new URL(import.meta.url))),
  comparison_sha256: hash(await readFile(new URL('./peers.mjs', import.meta.url))),
  coverage: '14 distinct inputs × 3 paired records; failures retained; not equal-work certification', works }, null, 2) + '\n');
for (const work of works) console.log(`${work.format}/${work.name}`, JSON.stringify(work.metrics), work.runs.map(r => r.comparison.reason));
