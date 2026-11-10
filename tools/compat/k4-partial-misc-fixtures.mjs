#!/usr/bin/env node
// Repository-owned probes. Official code/media is read only from K4_PLAYER_DIR.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b('', 'math_number', { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((node, i) => nodes[i].next = node); return nodes[0]; };
const start = (...nodes) => chain(b('start', 'start_on_click'), ...nodes);
const wait = id => b(id, 'wait', {}, { time: num(0) });
const set = (id, value) => b(`set-${id}`, 'variables_set', { VAR: id }, { VALUE: value });
const camp = (id, role_camp) => b(id, 'self_set_role_camp', { role_camp });
const draggable = (id, value) => b(id, 'self_set_draggable', { draggable: value });
const camps = ['camp_red', 'camp_yellow', 'camp_blue', 'no_camp'];

export async function partialMiscFixtures() {
  const base = (await visualFixtures()).layers;
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const [a, observer] = Object.keys(base.theatre.actors), scene = base.theatre.current_scene;
  Object.assign(base.theatre.actors[a], { x: 0, y: 0, scale: 100, draggable: false });
  Object.assign(base.theatre.actors[observer], { x: 0, y: 0, scale: 100, draggable: false });
  const cases = {};
  function make(name, roots, variables = [], sceneRoots = []) {
    const project = structuredClone(base);
    project.project_name = `NekoC partial misc ${name}`;
    project.variables = Object.fromEntries(variables.map(id => [id, {
      id, name: id, value: -1, type: 'any', is_global: true, current_entity: a,
      visible: false, position: { x: 0, y: 0 },
    }]));
    project.variable_order = variables;
    project.theatre.actors[a].block_data_json = workspace(roots, schema);
    project.theatre.actors[observer].block_data_json = workspace([], schema);
    project.theatre.scenes[scene].block_data_json = workspace(sceneRoots, schema);
    cases[name] = project;
    return project;
  }
  // Numeric observation avoids conflating this setter probe with typed boolean
  // storage in variables (a separate compatibility surface).
  const touching = c => b('', 'math_arithmetic', { OP: 'MULTIPLY' }, {
    A: b('', 'bump', { sprite1: observer, sprite2: c }), B: num(1),
  });
  const values = [];
  make('camp-cycle', [start(...camps.flatMap((c, i) => [camp(`camp-${i}`, c),
    ...camps.map((target, j) => { const id = `c${i}-${j}`; values.push(id); return set(id, touching(target)); }),
    wait(`wait-${i}`)]))], values);
  for (const value of ['camp_green', 'camp_custom']) {
    const ids = camps.map((_, i) => `member-${i}`);
    make(value, [start(camp('custom-camp', value),
      ...ids.map((id, i) => set(id, touching(camps[i]))))], ids);
  }
  // Observer only touches the clone, not its original. Original changes must not
  // mutate the clone's inherited group. The clone handler then changes its own.
  const cloneVars = ['inherited-red', 'inherited-yellow', 'clone-red', 'clone-yellow', 'clone-blue'];
  const clone = make('camp-clone', [start(camp('red', 'camp_red'),
    b('clone', 'mirror', { sprite: '__self' }), camp('yellow', 'camp_yellow'), wait('wait-a'),
    set('inherited-red', touching('camp_red')), set('inherited-yellow', touching('camp_yellow')), wait('wait-b'),
    ...cloneVars.slice(2).map((id, i) => set(id, touching(camps[i])))),
    b('clone-start', 'start_as_a_mirror', {}, {}, { DO: chain(
      b('move-clone', 'self_move_to', {}, { x: num(150), y: num(0) }), wait('clone-wait'),
      camp('blue', 'camp_blue')) })], cloneVars);
  clone.theatre.actors[observer].x = 150;

  const dragValues = ['1', '0', 'true', 'draggable', '', '1'];
  make('draggable-cycle', [start(...dragValues.flatMap((v, i) => [draggable(`drag-${i}`, v), wait(`wait-${i}`)]))]);
  make('draggable-clone', [start(draggable('on', '1'), b('clone', 'mirror', { sprite: '__self' }),
    draggable('off', '0'), wait('wait'))]);
  make('draggable-initial', [start(wait('wait'))]).theatre.actors[a].draggable = true;

  for (const [name, width, height] of [['landscape', 1280, 720], ['portrait', 620, 900], ['classic', 960, 720]]) {
    const ids = ['width', 'height', 'unknown', 'empty', 'missing', 'scene-width', 'scene-height'];
    const p = make(`stage-${name}`, [start(...['width', 'height', 'unknown', 'empty', 'missing'].map(id =>
      set(id, b(`info-${id}`, 'get_stage_info', { info: ({ unknown: 'depth', empty: '' })[id] ?? id }))))], ids,
      [chain(b('scene-start', 'start_on_click'), b('scale-stage', 'set_scale', {}, { scale: num(175) }),
        set('scene-width', b('info-scene-width', 'get_stage_info', { info: 'width' })),
        set('scene-height', b('info-scene-height', 'get_stage_info', { info: 'height' })))]);
    p.size = { width, height };
    delete p.theatre.actors[a].block_data_json.blocks['info-missing'].fields.info;
  }
  for (const type of ['self_set_role_camp', 'self_set_draggable']) {
    make(`scene-${type}`, [], ['before', 'after'], [start(set('before', num(1)),
      b('scene-setter', type, type === 'self_set_role_camp' ? { role_camp: 'camp_red' } : { draggable: '1' }),
      set('after', num(1)))]);
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-misc-evidence-v1', cases: {} };
  for (const [name, project] of Object.entries(await partialMiscFixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-misc-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const observations = [];
    const options = { frames: 18, seed: 1, blocks: true, wallTimeoutMs: 60000,
      beforeStart: async page => {
        if (!name.startsWith('scene-')) return;
        await page.evaluate(() => {
          const runtime = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
          const report = runtime.report_error_and_stop;
          window.__miscErrorVariables = [];
          runtime.report_error_and_stop = function (...args) {
            window.__miscErrorVariables.push({ before: this.get_variable('before'), after: this.get_variable('after') });
            return report.apply(this, args);
          };
        });
      },
      onFrame: async (page, frame) => observations.push(await page.evaluate(frame => {
        const req = window.__k4OracleRequire, stage = req('a1xw').a();
        const data = req('KmiX').b().get_runtime_data();
        const actors = Object.keys(req('ALsR').a.get_state().theatre_states.actors);
        return { frame, ...(window.__miscErrorVariables ? { errorVariables: window.__miscErrorVariables } : {}),
          actors: actors.flatMap(id => [id, ...(data.get_sprite_clones(id) || [])].map((aid, index) => {
          const actor = stage.get_actor_by_id(aid);
          return { id: index ? `${id}#${index}` : id, group: actor.get_group() ?? null,
            draggable: actor.get_draggable(), ...actor.get_position() };
        })) };
      }, frame)) };
    const record = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex') };
    try {
      const trace = await runOracle(project, options);
      evidence.assets = trace.diagnostics.assets;
      Object.assign(record, { variables: trace.frames.map(f => f.variables), observations, errors: trace.errors,
        externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length,
        pageErrors: trace.diagnostics.pageErrors });
    } catch (error) {
      if (!name.startsWith('scene-')) throw error;
      const trace = error.diagnostics?.partialTrace;
      if (!trace?.errors?.some(e => e.includes('use_actor_blocks_in_scene'))) throw error;
      evidence.assets = error.diagnostics.assets;
      Object.assign(record, { variables: trace.frames.map(f => f.variables), observations, errors: trace.errors,
        externalAllowed: error.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length });
    }
    evidence.cases[name] = record;
    console.log(name, JSON.stringify({ variables: record.variables.at(-1), errors: record.errors, observations: observations.length }));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-misc-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
