#!/usr/bin/env node
// Orchestrates unmodified, reviewed external checkouts, never vendors their code.
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { summarize } from './run.mjs';
import { assertWritablePath, ignoredPath, assertIdle } from './hateneko.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const self = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const vendor = path.join(root, 'dist/peers');
const offline = path.join(root, 'tools/bench/peers-offline.cjs');
const names = ['numeric', 'list', 'string', 'clones', 'broadcast', 'recursion', 'pen'];
const literals = ['math_number', 'math_integer', 'math_whole_number', 'math_positive_number', 'math_angle', 'text', 'colour_picker'];
const revisions = { kitten2scratch: '3b2dc03044e958b8052e947eebae09f2ec24ed5c', 'scratch-vm': '0cb82afe62506f3d9f2ff849c95593f0473b5d2c' };
const invoke = (command, args, extra = {}) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...extra,
});

export async function assertOutputTree(directory) {
  await assertWritablePath(directory);
  // Reject existing child junctions/file symlinks before any truncating write,
  // including the vendor CLI's output and fixture preparers' subdirectories.
  try {
    for (const entry of await readdir(directory)) {
      const file = path.join(directory, entry);
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`Output symlink/junction: ${file}`);
      if ((await lstat(file)).isDirectory()) await assertOutputTree(file);
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function validateSuite(suite) {
  const o = suite.options;
  if (!o || !Number.isInteger(o.frames) || o.frames < 60 || o.frames > 120 || o.warmup !== 10 || o.repeats !== 3) throw new Error('Invalid formal configuration');
  const expected = new Set(['k4', 'kn'].flatMap(format => names.map(name => `${format}/${name}`)));
  if (!Array.isArray(suite.works) || suite.works.length !== expected.size) throw new Error('Incomplete suite');
  for (const work of suite.works) {
    if (!expected.delete(`${work.format}/${work.name}`)) throw new Error('Duplicate/unknown work');
    if (work.runs?.length !== 3) throw new Error('Incomplete runs');
    for (const [repeat, run] of work.runs.entries()) {
      if (run.repeat !== repeat || JSON.stringify(run.order) !== JSON.stringify(repeat % 2 ? ['turbowarp', 'nekoc'] : ['nekoc', 'turbowarp'])) throw new Error('Invalid repeat/order');
      for (const key of ['nekoc', 'turbowarp']) {
        const r = run.runtimes?.[key];
        if (typeof r?.status !== 'string') throw new Error('Missing runtime result');
        if (r.status === 'ok' && (!validSamples(r, o.frames) || key === 'turbowarp'
          && (r.current_step_time_ms !== 1000 / 60 || r.compiler_options?.enabled !== true || r.compiler_options?.warpTimer !== false))) throw new Error('Invalid successful runtime configuration/samples');
      }
    }
  }
}
function validSamples(r, frames) {
  return r?.status === 'ok' && r.frame_ms?.length === frames && r.warmup_ms?.length === 10
    && [...r.frame_ms, ...r.warmup_ms].every(v => Number.isFinite(v) && v >= 0);
}

export function assertInlineAssets(project) {
  // The reviewed converter can read local asset paths and swallow CDN errors.
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['url', 'cdn_url', 'sourceFile', 'src', '__sourceFile'].includes(key) && item
        && (typeof item !== 'string' || !item.startsWith('data:'))) throw new Error('Non-inline asset/source path');
      visit(item);
    }
  }
  visit(project);
}

export function parseArgs(args) {
  const o = { out: 'dist/bench/peers', frames: 60, warmup: 10, repeats: 3 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prepare') { o.prepare = true; continue; }
    if (args[i] === '--prepare-only') { o.prepare = true; o.prepareOnly = true; continue; }
    const key = args[i].replace(/^--/, '');
    if (!['out', 'frames', 'warmup', 'repeats'].includes(key) || !args[i + 1]) throw new Error(`Invalid option ${args[i]}`);
    o[key] = args[++i];
  }
  for (const k of ['frames', 'warmup', 'repeats']) o[k] = Number(o[k]);
  if (!Number.isInteger(o.frames) || o.frames < 60 || o.frames > 120 || o.warmup !== 10 || o.repeats !== 3) {
    throw new Error('Formal peer benchmark requires 10 warmup, 60–120 measured frames, 3 repetitions');
  }
  o.out = ignoredPath(o.out);
  if (!o.out.startsWith(path.join(root, 'dist/bench') + path.sep)) throw new Error('Peer outputs must be under dist/bench/');
  return o;
}

export function inspectSb3(project) {
  // A coarse output classification only, NOT a source support/correctness
  // certificate. Unknown source blocks may already be downgraded to valid
  // motion_setx by the converter; worker runtime lookup is a separate audit.
  const unsupported = new Set();
  let blocks = 0;
  for (const target of project.targets ?? []) for (const block of Object.values(target.blocks ?? {})) {
    blocks++;
    // motion_align_scene exists as a no-op in TW, but is emitted here in
    // place of Kitten warp. Flag semantic loss, not a missing TW primitive.
    if ((!literals.includes(block.opcode)
      && !/^(?:event|control|operator|data|motion|looks|sound|sensing|procedures|argument|pen)_/.test(block.opcode))
      || block.opcode === 'motion_align_scene') unsupported.add(block.opcode);
  }
  if (!blocks) throw new Error('Converted project contains no blocks');
  if ((project.extensions ?? []).some(id => id !== 'pen') || Object.keys(project.extensionURLs ?? {}).length) {
    throw new Error('Unreviewed external extension');
  }
  return { blocks, unsupported: [...unsupported].sort() };
}

// Conservative observation only: no alias, intermediate-state or pixel claim.
export function compareVariables(native, peer) {
  const dict = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!dict(native) || !dict(peer)) return false;
  function equal(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b)
      && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (typeof a === 'string' || typeof a === 'boolean') return a === b;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
    return false;
  }
  const keys = Object.keys(native).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(peer).sort()) && keys.every(k => equal(native[k], peer[k]));
}

export function comparePair(name, inspection, n, t, frames = 60) {
  const result = { variables_equal: false, status: '不可比' };
  if (!validSamples(n, frames) || !validSamples(t, frames)) return { ...result, reason: 'load/run/incomplete samples' };
  result.variables_equal = compareVariables(n.final_state?.variables, t.final_state?.variables);
  if (!result.variables_equal) return { ...result, reason: 'final variable/type/list mismatch' };
  if (inspection.unsupported.length || t.errors?.length || !t.compiled_threads) return { ...result, reason: 'lossy warp placeholder / unsupported opcode / compile failure / no compiled thread' };
  // The current converter does not preserve warp. Matching a saturated numeric
  // value or rebuilt string cannot certify equal batches. Never infer speed.
  return { ...result, reason: name === 'pen' ? 'drawing not executed; unequal/unverified batches' : 'warp/batch scheduling not preserved; equal work unverified' };
}

async function worker(file, frames, warmup) {
  require(offline);
  const VM = require(path.join(vendor, 'scratch-vm/src/virtual-machine.js'));
  const started = performance.now();
  const bytes = await readFile(file);
  const vm = new VM();
  const errors = [];
  vm.on('COMPILE_ERROR', (_target, e) => errors.push(String(e)));
  vm.setCompilerOptions({ enabled: true, warpTimer: false });
  vm.setTurboMode(false);
  vm.setFramerate(60);
  try {
    await vm.loadProject(bytes);
    const import_ms = performance.now() - started;
    vm.setFramerate(60);
    // FrameLoop.start normally sets this, but would also create a wall-clock
    // interval. Match its 60 Hz budget explicitly for manual _step calls.
    vm.runtime.currentStepTime = 1000 / 60;
    const unknown_opcodes = [...new Set(vm.runtime.targets.flatMap(t => Object.values(t.blocks._blocks)
      .map(b => b.opcode).filter(op => !literals.includes(op) && !vm.runtime.getOpcodeFunction(op) && !vm.runtime.getIsHat(op)
        && !['procedures_definition', 'procedures_prototype', 'procedures_call', 'argument_reporter_string_number', 'argument_reporter_boolean'].includes(op))))].sort();
    const start = performance.now();
    vm.greenFlag(); // lazy script compilation is part of start, not import
    const start_ms = performance.now() - start;
    const frame_ms = [], warmup_ms = [];
    // Observation counts, NOT unique threads, compiled script coverage or work.
    let compiled_threads = 0, interpreted_threads = 0;
    for (let i = 0; i < frames + warmup; i++) {
      const begin = performance.now();
      vm.runtime._step(); // no vm.start(): no real-time setInterval/rAF
      const ms = performance.now() - begin;
      (i < warmup ? warmup_ms : frame_ms).push(ms);
      for (const thread of [...vm.runtime.threads, ...vm.runtime._lastStepDoneThreads]) {
        if (thread.isCompiled) compiled_threads++; else interpreted_threads++;
      }
    }
    const memory = process.resourceUsage().maxRSS * 1024; // before final diagnostics
    const stage = vm.runtime.getTargetForStage();
    const variables = Object.fromEntries(Object.values(stage.variables).filter(v => v.type !== 'broadcast_msg').map(v => [v.name, v.value]));
    const actors = vm.runtime.targets.filter(t => !t.isStage).map(t => ({ name: t.getName(), original: t.isOriginal,
      x: t.x, y: t.y, direction: t.direction, size: t.size, visible: t.visible,
      variables: Object.fromEntries(Object.values(t.variables).map(v => [v.name, v.value])) }));
    return { status: errors.length ? 'compile-error' : 'ok', import_ms, start_ms, frame_ms, warmup_ms,
      peak_rss_bytes: memory, current_step_time_ms: vm.runtime.currentStepTime,
      compiler_options: vm.runtime.compilerOptions, compiled_threads, interpreted_threads,
      errors, unknown_opcodes, final_state: { variables, actors }, summary_ms: summarize(frame_ms) };
  } finally { vm.quit(); }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  await assertOutputTree(o.out);
  await mkdir(o.out, { recursive: true });
  if (o.prepare) {
    invoke(process.execPath, ['tools/bench/prepare.mjs', `${o.out}/k4`], { timeout: 600000 });
    const { writeKnFixtures } = await import('./kn-fixtures.mjs');
    const files = await writeKnFixtures(path.join(o.out, 'kn'));
    const output = invoke(process.execPath, ['tools/editor-compat.mjs', ...files, '--channel', 'msedge', '--out', `${o.out}/editor.json`], { timeout: 600000 });
    if (!JSON.parse(output).ok) throw new Error('Official KN editor check failed');
    const manifest = {};
    for (const format of ['k4', 'kn']) for (const name of names) {
      const file = `${format}/${name}.${format === 'kn' ? 'bcmkn' : 'bcm'}`;
      const bytes = await readFile(path.join(o.out, file));
      assertInlineAssets(JSON.parse(bytes));
      manifest[file] = digest(bytes);
    }
    await writeFile(path.join(o.out, 'input-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (o.prepareOnly) return;
  }
  const manifest = JSON.parse(await readFile(path.join(o.out, 'input-manifest.json'), 'utf8'));
  const binary = path.join(root, 'target/release/perf-bench.exe');
    const report = { schema: 'nekoc-peers-v1', date: new Date().toISOString(), options: o,
    revision: invoke('git', ['rev-parse', 'HEAD']).trim(),
    host: { cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, platform: process.platform, node: process.version },
    binary_sha256: digest(await readFile(binary)), harness_sha256: digest(await readFile(self)),
    offline_sha256: digest(await readFile(offline)),
    mode: 'Node/headless/manual-step/no-renderer/no-audio/no-storage; wall-clock budget; no async event-loop turn between steps',
    compiled_threads_definition: 'sum of per-frame thread observations including warmup; not unique threads or execution coverage',
    dependency_integrity: 'lockfile and vendor commits recorded; installed node_modules full-tree integrity not independently verified',
    vendors: {}, works: [] };
  for (const name of ['kitten2scratch', 'scratch-vm']) {
    const cwd = path.join(vendor, name);
    if (invoke('git', ['status', '--porcelain', '--untracked-files=no'], { cwd }).trim()) throw new Error(`Modified vendor: ${name}`);
    const commit = invoke('git', ['rev-parse', 'HEAD'], { cwd }).trim();
    if (commit !== revisions[name]) throw new Error(`Unreviewed vendor revision: ${name}`);
    report.vendors[name] = { commit,
      lock_sha256: digest(await readFile(path.join(cwd, 'package-lock.json'))) };
  }
  const save = () => writeFile(path.join(o.out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  for (const format of ['k4', 'kn']) for (const name of names) {
    const file = path.join(o.out, format, name + (format === 'kn' ? '.bcmkn' : '.bcm'));
    const work = { format, name, input_sha256: digest(await readFile(file)), runs: [] };
    if (manifest[`${format}/${path.basename(file)}`] !== work.input_sha256) throw new Error('Prepared input identity changed; rerun --prepare-only');
    assertInlineAssets(JSON.parse(await readFile(file, 'utf8')));
    report.works.push(work);
    const sb3 = path.join(o.out, `${format}-${name}.sb3`);
    try {
      const begin = performance.now();
      work.convert_log = invoke(process.execPath, ['--require', offline, path.join(vendor, 'kitten2scratch/cli.js'), file, sb3]);
      work.convert_wall_ms = performance.now() - begin;
      const bytes = await readFile(sb3);
      work.sb3_sha256 = digest(bytes);
      const JSZip = require(path.join(vendor, 'kitten2scratch/node_modules/jszip'));
      const zip = await JSZip.loadAsync(bytes);
      const project = JSON.parse(await zip.file('project.json').async('string'));
      work.inspection = inspectSb3(project);
      // Self-produced conversion diagnostic, not a copied third-party work.
      await writeFile(path.join(o.out, `${format}-${name}-project.json`), JSON.stringify(project, null, 2));
    } catch (e) { work.convert_error = e.message; }
    for (let repeat = 0; repeat < o.repeats; repeat++) {
      const run = { repeat, order: repeat % 2 ? ['turbowarp', 'nekoc'] : ['nekoc', 'turbowarp'], runtimes: {}, idle_checks: [] };
      work.runs.push(run);
      for (const runtime of run.order) {
        if (runtime === 'turbowarp' && work.convert_error) { run.runtimes[runtime] = { status: 'conversion-error', error: work.convert_error }; continue; }
        run.idle_checks.push(assertIdle());
        try {
          const args = runtime === 'nekoc' ? [file, '--frames', String(o.frames), '--warmup', String(o.warmup)]
            : [self, '--worker', sb3, String(o.frames), String(o.warmup)];
          const log = path.join(o.out, `${format}-${name}-${repeat}-${runtime}-stderr.txt`);
          // Save successful compiler warnings too, without flooding the console.
          const { openSync, closeSync } = require('node:fs');
          const fd = openSync(log, 'w');
          let output;
          try { output = invoke(runtime === 'nekoc' ? binary : process.execPath, args, { stdio: ['ignore', 'pipe', fd] }); }
          finally { closeSync(fd); }
          const r = JSON.parse(output);
          r.stderr = await readFile(log, 'utf8');
          r.status ??= 'ok';
          r.summary_ms = summarize(r.frame_ms);
          run.runtimes[runtime] = r;
        } catch (e) { run.runtimes[runtime] = { status: 'run-error', error: e.message, stderr: String(e.stderr ?? '') }; }
      }
      run.comparison = comparePair(name, work.inspection ?? { unsupported: [] }, run.runtimes.nekoc, run.runtimes.turbowarp, o.frames);
      await save();
      console.log(format, name, repeat, run.comparison.reason);
    }
  }
  validateSuite(report);
  await save();
  // Explicit incompatibility is evidence, not a successful benchmark gate.
  if (report.works.some(w => w.runs.some(r => r.comparison.status === '不可比'))) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const action = process.argv[2] === '--worker'
    ? worker(process.argv[3], Number(process.argv[4]), Number(process.argv[5])).then(r => console.log(JSON.stringify(r)))
    : main();
  action.catch(e => { console.error(e); process.exitCode = 1; });
}
