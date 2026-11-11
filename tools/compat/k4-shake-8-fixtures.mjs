#!/usr/bin/env node
// Original, non-physical shake probes. External player files remain read-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b('math_number', { NUM: String(n) });
const set = (VAR, VALUE) => b('variables_set', { VAR }, { VALUE });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const start = (...body) => chain(b('start_on_click'), ...body);
const shake = n => b('self_shake', {}, { time: num(n) });
const sample = () => b('repeat_n_times', {}, { times: num(40) }, { DO: chain(
  set('sampleX', b('get', { sprite: '__self', attribute: '0' })),
  set('sampleY', b('get', { sprite: '__self', attribute: '1' }))) });

export async function shake8Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const specs = Object.fromEntries([.14, .23, .4].map(n => [`single-${n}`, [start(
    set('phase', num(1)), shake(n), set('phase', num(2))), start(sample())]]));
  specs.sequential = [start(set('phase', num(1)), shake(.14), set('phase', num(2)), shake(.23), set('phase', num(3))), start(sample())];
  specs.competing = [start(set('phase', num(1)), shake(.23), set('phase', num(2))), start(
    b('repeat_n_times', {}, { times: num(30) }, { DO: b('self_change_coordinate',
      { coordinary: 'x', increase: 'increase' }, { value: num(1) }) })), start(sample())];
  specs.nonpositive = [start(set('phase', num(1)), shake(0), shake(-1),
    b('self_shake', {}, { time: b('text', { TEXT: '1' }) }), set('phase', num(2))), start(sample())];
  const fixtures = {};
  for (const [name, roots] of Object.entries(specs)) {
    const p = structuredClone(base);
    delete p.compile_result;
    p.project_name = `NekoC original shake 8 ${name}`;
    p.variables = Object.fromEntries(['phase', 'sampleX', 'sampleY'].map(id => [id,
      { id, name: id, value: 'unexecuted', type: 'any', is_global: true, visible: false }]));
    p.variable_order = Object.keys(p.variables);
    for (const scene of Object.values(p.theatre.scenes)) scene.block_data_json = workspace([], schema);
    Object.values(p.theatre.actors)[0].block_data_json = workspace(roots, schema);
    fixtures[name] = p;
  }
  return fixtures;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-shake-8-v1', fps: 60, seed: 1, frames: 40,
    originsMs: [0, 1024], cases: {} };
  for (const [name, project] of Object.entries(await shake8Fixtures())) {
    const file = `tests/fixtures/kitten4/shake-8-${name}.bcm`;
    await saveJson(file, project);
    if (!process.argv.includes('--record')) continue;
    const entry = evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), origins: {} };
    for (const origin of evidence.originsMs) {
      const trace = await runOracle(project, { frames: evidence.frames, seed: 1,
        beforeStart: page => page.evaluate(ms => {
          window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => ms;
        }, origin) });
      evidence.assets = trace.diagnostics.assets;
      entry.origins[origin] = { variables: trace.frames.map(f => f.variables),
        actors: trace.frames.map(f => Object.fromEntries(Object.entries(f.actors).map(([id, a]) => [id, { x: a.x, y: a.y }]))),
        errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
        externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
      await saveJson(`dist/shake-8/${name}-${origin}-official.json`, trace);
      console.log(`${name}/${origin}: phase ${trace.frames.map(f => f.variables.phase).join(',')}`);
    }
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-shake-8-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
