#!/usr/bin/env node
// Original probes and observations only; the external offline player stays read-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';
import { partialCostume4Fixtures, costume4Ids as styles } from './k4-partial-costume-4-fixtures.mjs';

export const A = '20000000-0000-4000-8000-000000000001';
export const B = '20000000-0000-4000-8000-000000000002';
export const LOCAL = '30000000-0000-4000-8000-000000000061';
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = n => b('math_number', { NUM: String(n) });
const text = s => b('text', { TEXT: s });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const wait = () => b('wait', {}, { time: num(0) });
const set = (VAR, VALUE) => b('variables_set', { VAR }, { VALUE });
const variable = VAR => b('variables_get', { VAR });
const append = value => b('lists_append', {}, { VAR: b('lists_get', { VAR: 'result' }), VALUE: value });
const prop = (type, target, attribute, index = num(0)) => b(type, { sprite: target, attribute },
  type === 'get_clone_index_property' ? { index } : {});
const costume = id => b('set_costume_by_id', {}, { style_id: typeof id === 'string' ? text(id) : id });
const vis = (type, sprite, time) => b('set_entity_show_hide', { type, sprite }, time === undefined ? {} : { time: num(time) });
const move = (x, y) => b('self_move_to', {}, { x: num(x), y: num(y) });
const sample = (type, target = '__self', index) => ['0', '1', '2', '3', '4', '5', '8', '9', '16', '17', LOCAL]
  .map(attribute => append(prop(type, target, attribute, index)));

export async function property6Fixtures() {
  const base = structuredClone((await partialCostume4Fixtures())['dynamic-text']);
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  schema.set_costume_by_id = { defaults: { ...schema.set_costume.defaults,
    type: 'set_costume_by_id', fields: {}, shadows: { style_id: '' } } };
  schema.set_entity_show_hide = { defaults: { ...schema.self_disappear.defaults,
    type: 'set_entity_show_hide', fields: { sprite: A, type: 'hide' }, shadows: {} } };
  const scene = base.theatre.current_scene;
  const cases = {};
  function make(name, roots, sceneRoots = []) {
    const p = structuredClone(base);
    p.project_name = `NekoC original partial properties 6 ${name}`;
    p.theatre.scenes_order = [scene];
    p.theatre.scenes = { [scene]: p.theatre.scenes[scene] };
    p.theatre.scenes[scene].actors = [A, B];
    p.theatre.scenes[scene].block_data_json = workspace(sceneRoots, schema);
    p.theatre.actors[A].block_data_json = workspace(roots, schema);
    p.theatre.actors[B] = { ...structuredClone(p.theatre.actors[A]), id: B, name: 'Original observer', x: 180,
      block_data_json: workspace([], schema) };
    p.theatre.groups.group = { id: 'group', name: 'Original pair', is_group: true, actors: [A, B], scene, visible: true };
    p.variables = {
      result: { id: 'result', name: 'result', value: [], type: 'list', is_global: true, visible: false },
      phase: { id: 'phase', name: 'phase', value: 0, type: 'any', is_global: true, visible: false },
      choice: { id: 'choice', name: 'choice', value: styles.a, type: 'any', is_global: true, visible: false },
      [LOCAL]: { id: LOCAL, name: 'original local', value: 17, type: 'any', is_global: false, current_entity: A, visible: false },
    };
    p.variable_order = Object.keys(p.variables);
    cases[name] = p;
  }
  for (const type of ['get', 'get_2', 'get_3', 'get_clone_index_property']) {
    make(`${type}-state`, [chain(b('start_on_click'),
      move(-37.125, 28.875), b('self_point_towards', {}, { degrees: num(137.25) }),
      b('self_change_scale', {}, { scale: num(125) }),
      b('self_set_effect', { scope: '1' }, { val: num(35) }),
      set(LOCAL, text('local-live')), set('choice', text(styles.b)), costume(variable('choice')),
      ...sample(type), set('phase', num(1)), wait(),
      vis('hide', A), ...sample(type), set('phase', num(2)), wait(),
      costume(styles.a), vis('show', A), ...sample(type), set('phase', num(3)))]);
  }
  const index = () => b('get_current_clone_index');
  const add = (left, right) => b('math_arithmetic', { OP: 'ADD' }, { A: left, B: right });
  make('clone-index-local-costume', [chain(b('start_on_click'),
    set(LOCAL, num(23)), b('mirror', { sprite: '__self' }), wait(),
    set(LOCAL, num(47)), b('mirror', { sprite: '__self' }), wait(), wait(),
    ...[0, 1, 2].flatMap(i => ['0', '1', '2', '4', LOCAL].map(a => append(prop('get_clone_index_property', A, a, num(i))))),
    set('phase', num(1))),
  b('start_as_a_mirror', {}, {}, { DO: chain(
    set(LOCAL, add(variable(LOCAL), index())),
    b('self_move_to', {}, { x: b('math_arithmetic', { OP: 'MULTIPLY' }, { A: index(), B: num(60) }), y: num(-20) }),
    costume(styles.b),
    ...['get', 'get_2', 'get_3'].flatMap(type => [append(prop(type, '__self', LOCAL)), append(prop(type, A, LOCAL))])) })]);
  make('scene-costume-id', [], [chain(b('start_on_click'), costume(styles.bg2),
    ...['get', 'get_2', 'get_3'].flatMap(type => ['2', '4'].map(a => append(prop(type, scene, a)))),
    set('phase', num(1)), wait(), costume(styles.bg),
    ...['get', 'get_2', 'get_3'].flatMap(type => ['2', '4'].map(a => append(prop(type, scene, a)))), set('phase', num(2)))]);
  make('group-instant', [chain(b('start_on_click'), vis('hide', 'group'),
    append(prop('get_3', A, '8')), append(prop('get_3', B, '8')), set('phase', num(1)), wait(),
    vis('show', 'group'), append(prop('get_3', A, '8')), append(prop('get_3', B, '8')), set('phase', num(2)))]);
  make('group-fade-cycle', [chain(b('start_on_click'), vis('grad_hide', 'group', .1),
    append(prop('get_3', A, '8')), append(prop('get_3', B, '8')), set('phase', num(1)),
    costume(styles.b), vis('grad_show', 'group', .1),
    append(prop('get_3', A, '8')), append(prop('get_3', B, '8')), set('phase', num(2)))]);
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-properties-6-v1', fps: 60, seed: 1, frames: 24,
    clockOriginMs: 1024, cases: {} };
  for (const [name, project] of Object.entries(await property6Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-properties-6-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const native = [];
    const trace = await runOracle(project, { frames: evidence.frames, seed: evidence.seed, wallTimeoutMs: 60000,
      beforeStart: async page => page.evaluate(() => {
        window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024;
      }),
      onFrame: async page => native.push(await page.evaluate(() => {
        const stage = window.__k4OracleRequire('a1xw').a(), f = window.__k4Oracle.frames.at(-1);
        const data = window.__k4OracleRequire('KmiX').b().get_runtime_data();
        return Object.fromEntries(Object.entries(f.actors).map(([id, info]) => {
          const a = stage.get_actor_by_id(id);
          const index = (data.get_sprite_clones(info.prototype_id) || []).indexOf(id) + 1;
          return [id === info.prototype_id ? id : `${info.prototype_id}#${index}`,
            { x: info.x, y: info.y, visible: a.get_visible(), opacity: a.get_alpha(), style: a.get_current_style()?.style_id ?? null }];
        }));
      })) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = {
      sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      frames: trace.frames.map((f, i) => ({ frame: f.frame, variables: f.variables, actors: native[i] })),
      errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length,
    };
    console.log(name, JSON.stringify(trace.frames.at(-1).variables));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-properties-6-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e, e.diagnostics?.partialTrace || ''); process.exitCode = 1;
});
