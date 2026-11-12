#!/usr/bin/env node
// Repository-owned probes only; no corpus or third-party runtime is copied.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { propertyFixtures } from './k4-partial-properties-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';
import { visualWork } from './k4-visual.mjs';

const actor = '20000000-0000-4000-8000-000000000001';
const scene = '10000000-0000-4000-8000-000000000001';
const list = '30000000-0000-4000-8000-000000000010';
const nullable = '30000000-0000-4000-8000-000000000011';
const unknown = '40000000-0000-4000-8000-000000000099';
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ id: '', type, fields, inputs, statements });
const num = n => b('math_number', { NUM: String(n) });
const text = s => b('text', { TEXT: s });
const chain = (...nodes) => { nodes.slice(1).forEach((node, i) => nodes[i].next = node); return nodes[0]; };
const append = value => b('lists_append', {}, { VAR: b('lists_get', { VAR: 'result' }), VALUE: value });
const prop = (type, target, attribute) => b(type, { sprite: target, attribute }, type === 'get_clone_index_property' ? { index: num(0) } : {});
const wait = () => b('wait', {}, { time: num(0) });
const moveByLength = value => b('self_move_to', {}, { x: b('math_arithmetic', { OP: 'MULTIPLY' }, {
  A: b('lists_length', {}, { VAR: value }), B: num(40),
}), y: num(0) });

export async function property5Fixtures() {
  const base = (await propertyFixtures())['get_3-actor'];
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const cases = {};
  for (const type of ['get', 'get_2', 'get_3', 'get_clone_index_property']) {
    const p = structuredClone(base);
    p.project_name = `NekoC partial properties 5 ${type} list identity`;
    p.variables[list] = { id: list, name: 'shared list', value: [7, 'cat'], type: 'list', is_global: true, current_entity: actor, visible: false };
    p.variable_order.push(list);
    p.theatre.actors[actor].block_data_json = workspace([chain(b('start_on_click'),
      append(prop(type, '__self', list)), moveByLength(prop(type, '__self', list)), wait(),
      b('lists_append', {}, { VAR: prop(type, '__self', list), VALUE: text('tail') }), moveByLength(prop(type, '__self', list)), wait(),
      append(prop(type, '__self', list)), wait(),
      b('lists_append', {}, { VAR: b('lists_get', { VAR: list }), VALUE: num(9) }), wait(),
      append(prop(type, '__self', list)), moveByLength(prop(type, '__self', list)))], schema);
    cases[`${type}-list`] = p;
  }
  for (const type of ['get_3', 'get_clone_index_property']) {
    const p = structuredClone(base);
    p.theatre.actors[actor].block_data_json = workspace([chain(b('start_on_click'),
      wait(), wait(), append(prop(type, '__self', unknown)),
      b('controls_if', {}, { IF0: b('logic_boolean', { BOOL: 'FALSE' }) }, {
        DO0: append(prop(type, '__self', nullable)),
      }), wait(), append(prop(type, '__self', unknown)))], schema);
    cases[`${type}-lazy`] = p;
  }
  for (const target of [actor, scene]) {
    const p = structuredClone(base);
    p.project_name = 'NekoC partial properties 5 no costume';
    p.theatre[target === actor ? 'actors' : 'scenes'][target].styles = [];
    p.theatre[target === actor ? 'actors' : 'scenes'][target].current_style_id = '';
    p.theatre.actors[actor].block_data_json = workspace([chain(b('start_on_click'),
      ...['0', '1', '2', '3', '4', '5', '7', '8', '9', '14', '16', '17'].map(a => append(prop('get_3', target, a))))], schema);
    cases[target === actor ? 'no-costume-actor' : 'no-costume-scene'] = p;
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-properties-5-v1', frames: 12, cases: {} };
  const visual = { schema: 'nekoc-k4-partial-properties-5-pixels-v1', cases: {} };
  for (const [name, project] of Object.entries(await property5Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-properties-5-${name}.bcm`, project);
    if (process.argv.includes('--visual')) {
      const work = await visualWork(`tests/fixtures/kitten4/partial-properties-5-${name}.bcm`, {
        captureFrames: [1, 3, 5, 9, 12], artifactsDir: 'dist/partial-properties-5-pixels',
      });
      visual.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
        status: work.status, error: work.error, frames: work.frames, kernelAssets: work.kernelAssets };
      console.log(name, work.status, work.frames?.map(f => `${f.frame}:${f.changedPercent}%`).join(' '));
      if (work.status !== 'captured') throw new Error(work.error || `${name}: not captured`);
      if (work.frames.some(frame => frame.changedPixels !== 0)) process.exitCode = 1;
    }
    if (!process.argv.includes('--record')) continue;
    const raw = [], resultTypes = [];
    const trace = await runOracle(project, { frames: evidence.frames, seed: 1,
      onFrame: async page => {
        raw.push(await page.evaluate(ids => {
          const manager = window.__k4OracleRequire('KmiX').b().get_runtime_manager();
          return Object.fromEntries(ids.map(id => {
            const value = manager.get_global_variable(id);
            return [id, { present: value !== undefined, value: value ?? null }];
          }));
        }, [unknown, nullable, list]));
        resultTypes.push(await page.evaluate(() => {
          const result = window.__k4OracleRequire('KmiX').b().get_runtime_manager().get_global_variable('result');
          return result.map(value => Number.isNaN(value) ? 'NaN' : Array.isArray(value) ? 'array' : typeof value);
        }));
      } });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = {
      sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      variables: trace.frames.map(f => f.variables), actors: trace.frames.map(f => f.actors), raw, resultTypes,
      errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length,
    };
    console.log(name, JSON.stringify(evidence.cases[name].variables[0]), JSON.stringify(raw[0]));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-properties-5-evidence.json', evidence);
  if (process.argv.includes('--visual')) await saveJson('docs/kitten4-partial-properties-5-pixels.json', visual);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
