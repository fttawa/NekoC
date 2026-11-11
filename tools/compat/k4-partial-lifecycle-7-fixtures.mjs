#!/usr/bin/env node
// Repository-original lifecycle probes, without copying either runtime's implementation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { visibility5Fixtures, A, B } from './k4-partial-visibility-5-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b('math_number', { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const wait = () => b('wait', {}, { time: num(0) });
const set = (VAR, n) => b('variables_set', { VAR }, { VALUE: num(n) });

export async function lifecycle7Fixtures() {
  const originals = await visibility5Fixtures();
  const cases = Object.fromEntries(['delete-clone', 'delete-caller-clone'].map(name => [name, originals[name]]));
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  for (const immediate of [true, false]) {
    const project = structuredClone(originals['delete-clone'].project);
    const name = immediate ? 'delete-following-code' : 'delete-recreate';
    project.project_name = `NekoC original lifecycle 7 ${name}`;
    project.theatre.actors[A].block_data_json = workspace([
      chain(b('start_on_click'), b('mirror', { sprite: '__self' }),
        ...(immediate ? [] : [wait(), wait(), b('mirror', { sprite: '__self' })])),
      b('start_as_a_mirror', {}, {}, { DO: chain(set('other', 1), b('dispose_clone'), set('after', 1)) }),
    ], schema);
    project.theatre.actors[B].block_data_json = workspace([], schema);
    cases[name] = { project, frames: 12 };
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-lifecycle-7-v1', fps: 60, seed: 1, clockOriginMs: 1024, cases: {} };
  for (const [name, item] of Object.entries(await lifecycle7Fixtures())) {
    const file = `tests/fixtures/kitten4/partial-lifecycle-7-${name}.bcm`;
    await saveJson(file, item.project);
    if (!process.argv.includes('--record')) continue;
    const trace = await runOracle(item.project, { frames: item.frames, seed: 1, blocks: true,
      beforeStart: page => page.evaluate(() => {
        window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024;
      }) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(item.project, null, 2) + '\n').digest('hex'),
      frames: trace.frames.map(f => ({ frame: f.frame, variables: f.variables,
        actors: Object.values(f.actors).map(a => ({ prototype: a.prototype_id, x: a.x, y: a.y, visible: a.visible })) })),
      errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
    await saveJson(`dist/partial-lifecycle-7/${name}-official.json`, trace);
    console.log(name, JSON.stringify(evidence.cases[name].frames.map(f => [f.actors.length, f.variables.after, f.variables.other])));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-lifecycle-7-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
