#!/usr/bin/env node
// Reuses archived official observations; never starts a browser or builds Rust.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readJson, saveJson } from './k4-oracle.mjs';
import { devicePlans, validateDeviceScript } from './k4-device-evidence.mjs';

export const tolerance = 1e-6;
const sha256 = data => createHash('sha256').update(data).digest('hex');
export const normalizeVibration = pattern => Array.isArray(pattern) ? pattern : [pattern];

// No projection of actor fields, ID matching by name, angle wrapping, numeric
// coercion, relative tolerance, or final-frame-only comparisons.
export function differences(expected, actual, field = '', out = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > tolerance)
      out.push({ field, official: expected, nekoc: actual });
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push({ field: `${field}.length`, official: expected.length, nekoc: actual.length });
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) differences(expected[i], actual[i], `${field}[${i}]`, out);
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object' &&
    !Array.isArray(expected) && !Array.isArray(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) out.push({ field: `${field}.${key}`,
        officialPresent: Object.hasOwn(expected, key), nekocPresent: Object.hasOwn(actual, key),
        official: expected[key] ?? null, nekoc: actual[key] ?? null });
      else differences(expected[key], actual[key], `${field}.${key}`, out);
    }
  } else if (expected !== actual) out.push({ field, official: expected ?? null, nekoc: actual ?? null });
  return out;
}

export async function archiveDeviceEvidence(input = 'dist/k4device/evidence.json') {
  const evidence = await readJson(input), plans = devicePlans();
  if (evidence.schema !== 'nekoc-k4-device-evidence-v1') throw new Error('Unexpected official evidence schema');
  const sources = new Map();
  const archive = { schema: 'nekoc-k4-device-regression-v1', fps: 60, seed: 1, tolerance,
    identity: '指定离线 .orig；指定在线发布物核心一致范围见 docs/compatibility/k4-online-vs-offline.md；非当前编辑器或全部 K4',
    sourceHashes: [], cases: {} };
  for (const [name, entry] of Object.entries(evidence.cases)) {
    const plan = plans[name];
    if (!plan) throw new Error(`Unknown archived case: ${name}`);
    if (entry.errors.length || entry.pageErrors.length) throw new Error(`Official error in ${name}`);
    const hash = sha256(await readFile(entry.fixture));
    if (hash !== entry.fixtureSha256) throw new Error(`Fixture changed since official capture: ${entry.fixture}`);
    validateDeviceScript(entry.inputScript, plan.frames);
    const trace = await readJson(`dist/k4device/${name}-official.json`);
    if (trace.frames.length !== plan.frames) throw new Error(`Official frame count changed: ${name}`);
    if (!isDeepStrictEqual(entry.variables, trace.frames.map(f => f.variables)) ||
      !isDeepStrictEqual(entry.actors, trace.frames.map(f => f.actors)) ||
      !isDeepStrictEqual(entry.inputScript, trace.inputScript) ||
      !isDeepStrictEqual(entry.observations, trace.deviceObservations) ||
      !isDeepStrictEqual(entry.assets, trace.diagnostics.assets)) throw new Error(`Official summary/trace conflict: ${name}`);
    for (const asset of entry.assets) {
      const source = { path: `src/player/build/${asset.source}`, sha256: asset.sha256 };
      if (sources.has(source.path) && sources.get(source.path).sha256 !== source.sha256) throw new Error('Mixed official builds');
      sources.set(source.path, source);
    }
    archive.cases[name] = { fixture: entry.fixture, fixtureSha256: hash, inputScript: entry.inputScript,
      ...(plan.origin !== undefined ? { shakeClockOriginMs: plan.origin } : {}),
      ...(name.startsWith('gravity') ? { physicsNegativeCase: true } : {}),
      frames: trace.frames.map((frame, i) => ({ frame: i + 1, variables: frame.variables, actors: frame.actors,
        k4_media_output: entry.observations.filter(o => o.type === 'vibrate' && o.frame === i + 1)
          .map(o => ({ kind: 'vibrate', pattern_ms: normalizeVibration(o.pattern) })),
        ...(name.startsWith('gravity') ? { gravityCalls: entry.observations.filter(o => o.type === 'gravity' && o.frame === i + 1)
          .map(o => ({ scene: o.scene, x: o.x, y: o.y })) } : {}) })) };
  }
  if (Object.keys(archive.cases).length !== Object.keys(plans).length) throw new Error('Incomplete official archive');
  archive.sourceHashes = [...sources.values()].sort((a, b) => a.path.localeCompare(b.path));
  return archive;
}

export function compareDeviceFrames(expected, actual) {
  const result = { frameCount: { official: expected.length, nekoc: actual.length }, differences: [] };
  if (expected.length !== actual.length) result.differences.push({ frame: Math.min(expected.length, actual.length) + 1,
    field: 'frame_count', official: expected.length, nekoc: actual.length });
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    const frame = expected[i], got = actual[i];
    for (const field of ['frame', 'variables', 'actors', 'k4_media_output']) {
      const right = field === 'k4_media_output' ? (got[field] ?? []).map(output => output.kind === 'vibrate' ?
        { ...output, pattern_ms: normalizeVibration(output.pattern_ms) } : output) : got[field];
      result.differences.push(...differences(frame[field], right, field).map(d => ({ frame: i + 1, ...d })));
    }
  }
  result.equal = result.differences.length === 0;
  result.firstDifference = result.differences[0] ?? null;
  result.differingFrames = [...new Set(result.differences.map(d => d.frame))];
  return result;
}

export async function compareDeviceEvidence(options = {}) {
  const archive = await archiveDeviceEvidence(options.input);
  await saveJson('docs/kitten4-device-evidence.json', archive);
  if (options.archiveOnly) return archive;
  const executable = options.executable || process.env.NEKOC_K4_TRACE || 'target/debug/k4-trace.exe';
  const report = { schema: 'nekoc-k4-device-comparison-v1', tolerance, executable,
    executableSha256: sha256(await readFile(executable)), cases: {}, summary: { equal: [], different: [], physicalNegative: [], unverified: [] } };
  for (const [name, entry] of Object.entries(archive.cases)) {
    const input = `dist/k4device/${name}-compare-input.json`;
    await saveJson(input, entry.inputScript);
    const args = [entry.fixture, '--frames', String(entry.frames.length), '--seed', '1', '--input-script', input,
      ...(entry.shakeClockOriginMs !== undefined ? ['--shake-clock-origin-ms', String(entry.shakeClockOriginMs)] : [])];
    try {
      const trace = JSON.parse(execFileSync(executable, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120000 }));
      if (trace.schema !== 'nekoc-k4-trace-v1') throw new Error('Unexpected native trace schema');
      await saveJson(`dist/k4device/${name}-nekoc.json`, trace);
      const result = compareDeviceFrames(entry.frames, trace.frames);
      if (entry.physicsNegativeCase) {
        result.physics = { expectedNegativeCase: true, actorsEqual: !result.differences.some(d => d.field.startsWith('actors')),
          variablesEqual: !result.differences.some(d => d.field.startsWith('variables')),
          officialGravityCalls: entry.frames.flatMap(f => f.gravityCalls.map(call => ({ frame: f.frame, ...call }))),
          internalGravityComparison: 'unverified: k4-trace does not export native gravity calls; actor trajectories are compared without tolerance relaxation' };
      }
      // Gravity's known actor-physics gap must not swallow a new variable,
      // output, frame-count, or input-timing regression.
      const onlyPhysics = entry.physicsNegativeCase && result.differences.every(d => d.field.startsWith('actors.'));
      const category = result.equal ? 'equal' : onlyPhysics ? 'physicalNegative' : 'different';
      result.status = category;
      report.cases[name] = { args, ...result };
      report.summary[category].push(name);
      console.log(`${name}: ${category}; differing frames=${result.differingFrames.join(',') || 'none'}; first=${JSON.stringify(result.firstDifference)}`);
    } catch (error) {
      report.cases[name] = { args, status: 'unverified', error: String(error.stderr || error.message) };
      report.summary.unverified.push(name);
      console.error(`${name}: unverified: ${report.cases[name].error}`);
    }
  }
  await saveJson('dist/k4device/comparison.json', report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--archive-only') options.archiveOnly = true;
    else if (args[i] === '--exe' && args[i + 1]) options.executable = args[++i];
    else if (args[i] === '--input' && args[i + 1]) options.input = args[++i];
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  const report = await compareDeviceEvidence(options);
  if (report.summary && (report.summary.different.length || report.summary.physicalNegative.length || report.summary.unverified.length)) process.exitCode = 1;
}
