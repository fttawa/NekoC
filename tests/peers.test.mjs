import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, inspectSb3, compareVariables, comparePair, validateSuite, assertOutputTree, assertInlineAssets } from '../tools/bench/peers.mjs';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('peerbench enforces formal counts and ignored output paths', () => {
  assert.equal(parseArgs([]).frames, 60);
  assert.equal(parseArgs(['--frames', '120']).frames, 120);
  for (const args of [['--frames', '59'], ['--frames', '121'], ['--frames', 'NaN'], ['--frames', '60.5'],
    ['--warmup', '0'], ['--repeats', '1'], ['--out', 'docs/data'], ['--out', 'dist/../docs'], ['--unknown', 'a'], ['--out']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('converted opcode audit catches warp placeholders and rejects external extensions', () => {
  const project = { targets: [{ blocks: { a: { opcode: 'control_forever' }, b: { opcode: 'motion_align_scene' }, c: { opcode: 'kitten2scratch_placeholder' } } }] };
  assert.deepEqual(inspectSb3(project), { blocks: 3, unsupported: ['kitten2scratch_placeholder', 'motion_align_scene'] });
  assert.throws(() => inspectSb3({ targets: [] }), /no blocks/);
  assert.throws(() => inspectSb3({ ...project, extensions: ['custom'] }), /extension/);
  assert.throws(() => inspectSb3({ ...project, extensionURLs: { custom: 'https://example.com/a.js' } }), /extension/);
});

test('peer variables preserve scalar/list types and reject missing/nonfinite state', () => {
  const value = { log: 999, result: [1, '2'], depth: 0 };
  assert.equal(compareVariables(value, structuredClone(value)), true);
  assert.equal(compareVariables({ log: 999 }, { log: 999 + 1e-10 }), true);
  for (const other of [{ ...value, log: '999' }, { ...value, result: ['1', '2'] }, { ...value, depth: null },
    { ...value, extra: 1 }, { log: 999, result: [1, '2'] }, undefined]) assert.equal(compareVariables(value, other), false);
  for (const log of [NaN, Infinity, null, undefined, {}]) assert.equal(compareVariables({ log }, { log }), false);
  assert.equal(compareVariables({}, []), false);
});

test('peer suite validation requires unique full coverage and exact successful samples', () => {
  const result = () => ({ status: 'ok', frame_ms: Array(60).fill(1), warmup_ms: Array(10).fill(1), current_step_time_ms: 1000 / 60, compiler_options: { enabled: true, warpTimer: false } });
  const suite = { options: { frames: 60, warmup: 10, repeats: 3 }, works: ['k4', 'kn'].flatMap(format =>
    ['numeric', 'list', 'string', 'clones', 'broadcast', 'recursion', 'pen'].map(name => ({ format, name, runs: [0, 1, 2].map(repeat =>
      ({ repeat, order: repeat % 2 ? ['turbowarp', 'nekoc'] : ['nekoc', 'turbowarp'], runtimes: { nekoc: result(), turbowarp: result() } })) }))) };
  validateSuite(suite);
  for (const change of [s => { s.works[1] = s.works[0]; }, s => { s.works[0].runs[1].repeat = 0; },
    s => { s.options.frames = 1; }, s => { s.works[0].runs[0].runtimes.nekoc.frame_ms = []; },
    s => { s.works[0].runs[0].runtimes.turbowarp.current_step_time_ms = 1000 / 30; }]) {
    const changed = structuredClone(suite); change(changed); assert.throws(() => validateSuite(changed));
  }
});

test('peer outputs reject nested junctions before writes', async () => {
  await mkdir('dist/bench', { recursive: true });
  const directory = await mkdtemp(path.resolve('dist/bench/peer-path-test-'));
  try {
    await mkdir(path.join(directory, 'real'));
    await symlink(path.join(directory, 'real'), path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertOutputTree(directory), /symlink|junction/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('peer inputs reject external and local asset paths before conversion', () => {
  assertInlineAssets({ styles: { url: 'data:image/svg+xml,abc', cdn_url: '' } });
  for (const url of ['https://example.com/a.svg', '../secret', 'C:/secret']) {
    assert.throws(() => assertInlineAssets({ styles: { url } }), /Non-inline/);
    assert.throws(() => assertInlineAssets({ sourceFile: url }), /Non-inline/);
  }
});

test('offline preload fails the conversion even if a network rejection is swallowed', () => {
  const result = spawnSync(process.execPath, ['--require', './tools/bench/peers-offline.cjs', '-e',
    'try { fetch("https://example.invalid/"); } catch {}'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /1 denied network attempts/);
});

test('published peer evidence never presents incompatible work as speedup', async () => {
  const evidence = JSON.parse(await readFile(new URL('../docs/performance-peers-evidence.json', import.meta.url), 'utf8'));
  validateSuite({ ...evidence, works: evidence.works.map(w => ({ ...w, runs: w.runs.map(r => ({ ...r,
    runtimes: Object.fromEntries(Object.entries(r.runtimes).map(([k, v]) => [k, { ...v,
      // Compact evidence intentionally omits raw arrays. Only use the validator
      // for manifest/order coverage here; do not invent successful samples.
      status: 'compact-evidence' }])) })) })) });
  assert.match(evidence.source_sha256, /^[a-f0-9]{64}$/);
  for (const work of evidence.works) {
    assert.match(work.input_sha256, /^[a-f0-9]{64}$/);
    assert.match(work.sb3_sha256, /^[a-f0-9]{64}$/);
    assert.equal(work.speedup, undefined);
    for (const run of work.runs) {
      assert.equal(run.comparison.status, '不可比');
      assert.equal(run.speedup, undefined);
      assert.equal(run.comparison.speedup, undefined);
    }
  }
});

test('matching saturated variables never certify batches or yield a speed ratio', () => {
  const result = () => ({ status: 'ok', compiled_threads: 1, errors: [], frame_ms: Array(60).fill(1), warmup_ms: Array(10).fill(1), final_state: { variables: { log: 999, result: [], depth: 0 } } });
  const inspect = { unsupported: [] };
  const n = result(), t = result();
  let pair = comparePair('numeric', inspect, n, t);
  assert.equal(pair.variables_equal, true);
  assert.equal(pair.status, '不可比');
  assert.match(pair.reason, /equal work unverified/);
  assert.equal(pair.speedup, undefined);
  t.final_state.variables.log = 0;
  assert.match(comparePair('numeric', inspect, n, t).reason, /mismatch/);
  t.final_state.variables.log = 999;
  assert.match(comparePair('numeric', { unsupported: ['motion_align_scene'] }, n, t).reason, /unsupported/);
  t.frame_ms = [];
  assert.match(comparePair('numeric', inspect, n, t).reason, /incomplete/);
  t.frame_ms = Array(60).fill(NaN);
  assert.match(comparePair('numeric', inspect, n, t).reason, /incomplete/);
  t.frame_ms = Array(60).fill(1); t.compiled_threads = 0;
  assert.match(comparePair('numeric', inspect, n, t).reason, /no compiled thread/);
  t.compiled_threads = 1; t.errors = ['bad'];
  assert.match(comparePair('numeric', inspect, n, t).reason, /compile failure/);
});
