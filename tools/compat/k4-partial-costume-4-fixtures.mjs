#!/usr/bin/env node
// Repository-owned legacy probes; external player files are read only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs, statements: {} });
const text = TEXT => b('text', { TEXT });
const num = NUM => b('math_number', { NUM: String(NUM) });
const bool = value => b('logic_boolean', { BOOL: value ? 'TRUE' : 'FALSE' });
const set = (VAR, VALUE) => b('variables_set', { VAR }, { VALUE });
const get = VAR => b('variables_get', { VAR });
const costume = (value, fields = {}) => b('set_costume_by_id', fields, value ? { style_id: value } : {});
const wait = () => b('wait', {}, { time: num(0) });
const chain = nodes => { nodes.slice(1).forEach((node, i) => nodes[i].next = node); return nodes[0]; };
export const costume4Ids = {
  a: '40000000-0000-4000-8000-000000000001',
  b: '40000000-0000-4000-8000-000000000002',
  bg: '40000000-0000-4000-8000-000000000003',
  bg2: '40000000-0000-4000-8000-000000000004',
  missing: '40000000-0000-4000-8000-000000000099',
};

export async function partialCostume4Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  // The current editor schema reports a translation/argument error for this
  // legacy block. Declare only its original generic workspace shape and socket.
  schema.set_costume_by_id = { defaults: { ...structuredClone(schema.set_costume.defaults),
    type: 'set_costume_by_id', fields: {}, shadows: { style_id: '' } } };
  const actorId = Object.keys(base.theatre.actors)[0], sceneId = base.theatre.current_scene;
  const id = costume4Ids;
  const oldStyles = base.theatre.styles;
  base.theatre.styles = Object.fromEntries([
    [id.a, oldStyles['costume-a'], 'First'], [id.b, oldStyles['costume-b'], 'Second'],
    [id.bg, oldStyles.background, 'Background one'], [id.bg2, oldStyles['costume-b'], 'Background two'],
  ].map(([key, style, name]) => [key, { ...structuredClone(style), id: key, name }]));
  Object.assign(base.theatre.actors[actorId], { styles: [id.a, id.b], current_style_id: id.a });
  for (const scene of Object.values(base.theatre.scenes)) Object.assign(scene, { styles: [id.bg, id.bg2], current_style_id: id.bg });
  const specs = {
    'dynamic-text': { body: [costume(text(id.b))] },
    'field-literal': { body: [costume(null, { style_id: id.b })] },
    'input-over-field': { body: [costume(text(id.b), { style_id: id.a })] },
    'dynamic-change': { body: [set('choice', text(id.b)), costume(get('choice')), set('phase', num(1)), wait(),
      set('choice', text(id.a)), costume(get('choice')), set('phase', num(2)), wait(),
      set('choice', text(id.b)), costume(get('choice')), set('phase', num(3))] },
    'number': { body: [costume(num(2))] },
    'boolean': { body: [costume(bool(true))] },
    'object': { body: [costume(b('get_current_costume', { style_id: id.b }))] },
    'array': { body: [costume(b('text_split', {}, { TEXT_TO_SPLIT: text(`${id.b}/x`), SPLIT_TEXT: text('/') }))] },
    'array-single': { body: [costume(b('text_split', {}, { TEXT_TO_SPLIT: text(id.b), SPLIT_TEXT: text('/') }))] },
    'missing-parameter': { body: [costume(null)] },
    'padded-id': { body: [costume(text(` ${id.b} `))] },
    'empty': { body: [costume(text(''))] },
    'invalid-text': { body: [costume(text('not-an-id'))] },
    'name-not-id': { body: [costume(text('Second'))] },
    'missing-id': { body: [costume(text(id.missing))] },
    'foreign-id': { body: [costume(text(id.bg2))] },
    'scene-dynamic': { scene: true, body: [costume(text(id.bg2))] },
    'scene-literal': { scene: true, body: [costume(null, { style_id: id.bg2 })] },
    'scene-missing-id': { scene: true, body: [costume(text(id.missing))] },
    'scene-number': { scene: true, body: [costume(num(2))] },
    'scene-boolean': { scene: true, body: [costume(bool(true))] },
    'scene-empty': { scene: true, body: [costume(text(''))] },
    'scene-missing-parameter': { scene: true, body: [costume(null)] },
    'scene-foreign-id': { scene: true, body: [costume(text(id.b))] },
    'scene-invalid-text': { scene: true, body: [costume(text('not-an-id'))] },
  };
  const cases = {};
  for (const [name, spec] of Object.entries(specs)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC partial costume 4 ${name}`;
    project.cloud_variables = {};
    const variables = ['before', 'after', 'choice', 'phase'];
    project.variables = Object.fromEntries(variables.map(key => [key, { id: key, name: key, value: -1,
      type: 'any', is_global: true, visible: false, position: { x: 0, y: 0 } }]));
    project.variable_order = variables;
    for (const owner of [...Object.values(project.theatre.actors), ...Object.values(project.theatre.scenes)]) owner.block_data_json = workspace([], schema);
    const nodes = [b('start_on_click'), set('before', num(1)), ...spec.body, set('after', num(1))];
    nodes.forEach((node, i) => { node.id = `costume4-${i}`; });
    const owner = spec.scene ? project.theatre.scenes[sceneId] : project.theatre.actors[actorId];
    owner.block_data_json = workspace([chain(nodes)], schema);
    cases[name] = project;
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-costume-4-evidence-v1', fps: 60, seed: 1,
    scope: 'original workspace legacy descriptors; no corpus, credentials or allowed external requests', cases: {} };
  for (const [name, project] of Object.entries(await partialCostume4Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-costume-4-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const observations = [];
    const options = { frames: 8, seed: 1, blocks: true, wallTimeoutMs: 60000,
      beforeStart: async page => page.evaluate(() => {
        const runtime = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
        const original = runtime.report_error_and_stop;
        window.__costume4ErrorVariables = [];
        runtime.report_error_and_stop = function (...args) {
          window.__costume4ErrorVariables.push({ before: this.get_variable('before'), after: this.get_variable('after') });
          return original.apply(this, args);
        };
      }),
      onFrame: async (page, frame) => observations.push(await page.evaluate(frame => {
        const req = window.__k4OracleRequire, stage = req('a1xw').a();
        const state = req('ALsR').a.get_state().theatre_states;
        return { frame,
          actors: Object.keys(state.actors).map(id => ({ id, style: stage.get_actor_by_id(id).get_current_style() ?? null })),
          scenes: Object.keys(state.scenes).map(id => ({ id, texture: stage.get_scene_by_id(id).get_background().get_texture_id() ?? null })),
          errorVariables: window.__costume4ErrorVariables };
      }, frame)) };
    let trace, diagnostics, status = 'completed';
    try {
      trace = await runOracle(project, options); diagnostics = trace.diagnostics;
    } catch (error) {
      diagnostics = error.diagnostics; trace = diagnostics?.partialTrace;
      if (!trace?.errors?.length) throw error;
      status = 'runtime-error';
    }
    evidence.assets = diagnostics.assets;
    evidence.cases[name] = { status,
      sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      variables: trace.frames.map(frame => frame.variables), observations, errors: trace.errors,
      events: trace.events, pageErrors: diagnostics.pageErrors, externalRequests: diagnostics.externalRequests };
    console.log(name, status, JSON.stringify({ frames: trace.frames.length,
      style: observations.at(-1)?.actors[0]?.style, texture: observations.at(-1)?.scenes[0]?.texture, errors: trace.errors }));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-costume-4-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
