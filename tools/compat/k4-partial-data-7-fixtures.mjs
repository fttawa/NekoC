#!/usr/bin/env node
// Data/timing only: no MIDI playback, audio device, or service access.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs, statements: {} });
const num = n => b('math_number', { NUM: String(n) });
const text = TEXT => b('text', { TEXT });
const set = (VAR, VALUE) => b('variables_set', { VAR }, { VALUE });
const delay = () => b('wait', {}, { time: num(0) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };

export async function data7Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  schema.text_indexOf = { defaults: { ...schema.text.defaults, type: 'text_indexOf',
    fields: { END: 'FIRST' }, shadows: { VALUE: '', FIND: '' } } };
  const bodies = {};
  bodies['midi-data'] = ['0', '39', '60', '87'].flatMap((midi, i) => [
    set('phase', num(i + 1)), set('result', b('midi_get', { midi })), delay(),
    set('same', b('logic_compare', { OP: 'EQ' }, { A: b('variables_get', { VAR: 'result' }), B: b('midi_get', { midi }) })),
    set('string', b('convert_type', { type: 'string' }, { original_value: b('variables_get', { VAR: 'result' }) })), delay(),
  ]);
  for (const [name, beats] of [['short', num(.04)], ['zero', num(0)], ['negative', num(-1)], ['string', text('1')]]) {
    bodies[`midi-wait-${name}`] = [set('phase', num(1)), b('midi_wait', {}, { beats }), set('phase', num(2)),
      b('midi_wait', {}, { beats: num(.08) }), set('phase', num(3))];
  }
  for (const seconds of [.14, .23, .4]) {
    bodies[`shake-${seconds}`] = [set('phase', num(1)), b('self_shake', {}, { time: num(seconds) }), set('phase', num(2))];
  }
  bodies.search = ['FIRST', 'LAST'].flatMap((END, i) => [
    set('phase', num(i + 1)), set('result', b('text_indexOf', { END }, { VALUE: text('猫😀ababa😀'), FIND: text('aba') })), delay(),
    set('result', b('text_indexOf', { END }, { VALUE: text('😀'), FIND: text('') })), delay(),
    set('result', b('text_indexOf', { END }, { VALUE: b('text_split', {}, { TEXT_TO_SPLIT: text('1/2/1'), SPLIT_TEXT: text('/') }), FIND: num(1) })), delay(),
  ]);
  const result = {};
  for (const [name, body] of Object.entries(bodies)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC original partial data 7 ${name}`;
    project.variables = Object.fromEntries(['phase', 'result', 'same', 'string'].map(id => [id,
      { id, name: id, value: 'unexecuted', type: 'any', is_global: true, visible: false }]));
    project.variable_order = Object.keys(project.variables);
    for (const scene of Object.values(project.theatre.scenes)) scene.block_data_json = workspace([], schema);
    Object.values(project.theatre.actors)[0].block_data_json = workspace([chain(b('start_on_click'), ...body)], schema);
    result[name] = project;
  }
  return result;
}
async function main() {
  const evidence = { schema: 'nekoc-k4-partial-data-7-v1', fps: 60, seed: 1, clockOriginMs: 1024, cases: {} };
  for (const [name, project] of Object.entries(await data7Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-data-7-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const trace = await runOracle(project, { frames: 24, seed: 1,
      beforeStart: page => page.evaluate(() => {
        window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024;
      }) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      variables: trace.frames.map(f => f.variables),
      ...(name.startsWith('shake-') ? { actors: trace.frames.map(f => Object.fromEntries(Object.entries(f.actors).map(([id, a]) => [id, { x: a.x, y: a.y }]))) } : {}),
      errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
    await saveJson(`dist/partial-data-7/${name}-official.json`, trace);
    console.log(name, JSON.stringify(trace.frames.map(f => f.variables.phase)));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-data-7-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
