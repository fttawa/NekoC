#!/usr/bin/env node
// Original boundary probes. Only the independent oracle reads external vendor code.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';

const b = (id, type, fields = {}, inputs = {}) => ({ id, type, fields, inputs, statements: {} });
const num = n => b('', 'math_number', { NUM: String(n) });
const chain = nodes => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const types = ['self_set_effect_2', 'self_set_effect', 'self_change_effect_3', 'self_change_effect_2', 'self_change_effect', 'self_clear_effects'];
export async function partialEffectsFixtures() {
  const base = await readJson('tests/fixtures/kitten4/runerr-addition.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid = Object.keys(base.theatre.actors)[0], sid = base.theatre.scenes_order[0];
  const result = {};
  for (const type of types) {
    const project = structuredClone(base), steps = [], nodes = [b('start', 'start_on_click')];
    project.project_name = `NekoC original partial effects ${type}`;
    delete project.compile_result;
    project.variables = {}; project.variable_order = [];
    for (const entity of [...Object.values(project.theatre.scenes), ...Object.values(project.theatre.actors)]) entity.block_data_json = workspace([], schema);
    const add = (kind, scope, value, increase = 'increase') => {
      const id = `effect-${steps.length}`;
      const input = typeof value === 'string' && value.startsWith('text:') ? b('', 'text', { TEXT: value.slice(5) }) : num(value);
      nodes.push(b(id, kind, { scope: String(scope), increase }, kind === 'self_clear_effects' ? {} : { [kind.includes('set_effect') ? 'val' : 'steps']: input }));
      nodes.push(b(`wait-${steps.length}`, 'wait', {}, { time: num(0) }));
      steps.push({ id, type: kind, scope: String(scope), value: String(value), increase });
    };
    for (let scope = 0; scope <= 7; scope++) {
      if (type === 'self_clear_effects') {
        add('self_set_effect_2', scope, scope === 2 ? 140 : 37);
        continue;
      }
      for (const value of [-721, -360, -101, -1, 0, 0.5, 1, 1.5, 19.5, 20, 20.5, 99, 100, 101, 360, 721, 'NaN', 'Infinity', '-Infinity', 'text:20', 'text:no']) {
        add(type, scope, value);
      }
      if (type.startsWith('self_change')) {
        for (const increase of ['decrease', 'invalid']) for (const value of [-101, -1, 0, 0.5, 1, 101]) add(type, scope, value, increase);
      }
    }
    if (type === 'self_clear_effects') add(type, 0, 0);
    else for (const scope of ['8', '-1', '00', 'color', '']) add(type, scope, 33);
    // Bound official AST transport depth without changing effect evaluation order.
    const root = [nodes.shift()];
    while (nodes.length) {
      const part = b(`chunk-${root.length}`, 'repeat_n_times', {}, { times: num(1) });
      part.statements.DO = chain(nodes.splice(0, 16));
      root.push(part);
    }
    project.theatre.actors[aid].block_data_json = workspace([chain(root)], schema);
    result[type] = { project, steps, aid, sid, frames: steps.length * 3 + 3 };
  }
  for (const type of ['self_set_effect_2', 'self_change_effect_3', 'self_clear_effects']) {
    const spec = structuredClone(result[type]);
    spec.project.project_name += ' scene';
    spec.project.theatre.scenes[spec.sid].block_data_json = spec.project.theatre.actors[spec.aid].block_data_json;
    spec.project.theatre.actors[spec.aid].block_data_json = workspace([], schema);
    spec.scene = true;
    result[`scene-${type}`] = spec;
  }
  const wide = structuredClone(result.self_set_effect_2);
  wide.project.project_name += ' wide';
  wide.project.theatre.styles['costume-a'].url = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#39a768"/></svg>').toString('base64');
  result['wide-self_set_effect_2'] = wide;
  const fractional = structuredClone(result['scene-self_set_effect_2']);
  fractional.project.project_name = 'NekoC original scene fractional effect reporters';
  fractional.project.variables = { result: { id: 'result', name: 'result', type: 'list', value: [], is_global: true,
    current_entity: fractional.sid, visible: false, position: { x: 0, y: 0 } } };
  fractional.project.variable_order = ['result'];
  const nodes = [b('start', 'start_on_click')];
  fractional.steps = [];
  for (let scope = 0; scope < 8; scope++) {
    const id = `effect-${scope}`;
    const value = scope === 2 ? 123.4567 : scope === 7 ? 7.4567 : 12.4567;
    nodes.push(b(id, 'self_set_effect_2', { scope: String(scope) }, { val: num(value) }));
    nodes.push(b(`read-${scope}`, 'lists_append', {}, { VAR: b('', 'lists_get', { VAR: 'result' }),
      VALUE: b('', 'get_3', { sprite: '__self', attribute: String(scope + 7) }) }));
    nodes.push(b(`wait-${scope}`, 'wait', {}, { time: num(0) }));
    fractional.steps.push({ id, type: 'self_set_effect_2', scope: String(scope), value: String(value), increase: 'increase' });
  }
  fractional.project.theatre.scenes[fractional.sid].block_data_json = workspace([chain(nodes)], schema);
  fractional.frames = 25;
  result['scene-fractional-reporters'] = fractional;
  return result;
}

async function main() {
  const record = process.argv.includes('--record');
  const filter = process.argv.find(a => a.startsWith('--case='))?.slice(7);
  const evidence = { schema: 'nekoc-k4-partial-effects-v1', cases: {} };
  for (const [name, spec] of Object.entries(await partialEffectsFixtures())) {
    if (filter && name !== filter) continue;
    const { project, steps, aid, sid, scene, frames } = spec;
    await saveJson(`tests/fixtures/kitten4/partial-effects-${name}.bcm`, project);
    if (!record) continue;
    const samples = [];
    const trace = await runOracle(project, { frames, seed: 1, virtualTime: true, blocks: true,
      onFrame: async page => samples.push(await page.evaluate(({ aid, sid, scene }) => {
        const stage = window.__k4OracleRequire('a1xw').a();
        const actor = scene ? stage.get_scene_by_id(sid) : stage.get_actor_by_id(aid);
        const result = actor.get_effects(), effect = result.value;
        if (result.is_error(effect)) throw new Error('effects unavailable');
        return { opacity: (scene ? actor.get_background() : actor).get_alpha(), effects: ['hue', 'brightness', 'pixelate', 'displacement', 'twist', 'saturate', 'ascii'].map(k => effect[`get_${k}`]()) };
      }, { aid, sid, scene })) });
    evidence.assets = trace.diagnostics.assets;
    const executed = trace.events.filter(e => e.event === 'block' && e.block.startsWith('effect-'));
    // before_expression fires for the command and input; retain the first hit.
    const observations = steps.map(step => {
      const event = executed.find(e => e.block === step.id);
      if (!event) throw new Error(`${name}: missing execution ${step.id}`);
      return { ...step, frame: event.frame, state: samples[event.frame - 1] };
    });
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      entity: scene ? sid : aid, frames, observations,
      variables: trace.frames.map(f => f.variables), errors: trace.errors, externalRequests: trace.diagnostics.externalRequests,
      diagnostics: { pageErrors: trace.diagnostics.pageErrors } };
    console.log(name, samples.length, 'frames', JSON.stringify(samples.slice(0, 8)), 'errors', JSON.stringify(trace.errors));
  }
  if (record) await saveJson(`docs/kitten4-partial-effects-evidence${filter ? '-' + filter : ''}.json`, evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
