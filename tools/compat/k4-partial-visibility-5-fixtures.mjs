#!/usr/bin/env node
// Repository-original visibility probes. Only the external oracle executes vendor code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

export const A = '20000000-0000-4000-8000-000000000001';
export const B = '20000000-0000-4000-8000-000000000002';
const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b('', 'math_number', { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((n, i) => nodes[i].next = n); return nodes[0]; };
const start = (id, ...nodes) => chain(b(id, 'start_on_click'), ...nodes);
const wait = (id, time = 0) => b(id, 'wait', {}, { time: num(time) });
const set = (id, value = 1) => b(`set-${id}`, 'variables_set', { VAR: id }, { VALUE: num(value) });
const vis = (id, type, sprite = A, time) => b(id, 'set_entity_show_hide', { sprite, type },
  time === undefined ? {} : { time: typeof time === 'object' ? time : num(time) });
const repeatWait = n => Array.from({ length: n }, (_, i) => wait(`delay-${i}`));

export async function visibility5Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  // The generic schema dumper cannot instantiate this mutating block without fields.
  // Supply our own ordinary statement metadata; no external implementation is used.
  schema.set_entity_show_hide = { defaults: { ...schema.self_disappear.defaults,
    type: 'set_entity_show_hide', fields: { sprite: A, type: 'hide' }, shadows: {} } };
  const cases = {};
  function make(name, roots, otherRoots = [], hidden = false) {
    const p = structuredClone(base), scene = p.theatre.scenes_order[0];
    p.project_name = `NekoC original partial visibility 5 ${name}`;
    p.size = { width: 1280, height: 720 };
    p.theatre.scenes_order = [scene];
    p.theatre.scenes = { [scene]: p.theatre.scenes[scene] };
    p.theatre.scenes[scene].block_data_json = workspace([], schema);
    p.theatre.scenes[scene].actors = [A, B];
    p.theatre.groups.group = { id: 'group', name: 'Original group', is_group: true,
      actors: [A, B], scene, visible: true };
    p.theatre.actors[A].block_data_json = workspace(roots, schema);
    Object.assign(p.theatre.actors[A], { visible: !hidden, styles: ['costume-a'], current_style_id: 'costume-a' });
    p.theatre.actors[B] = { ...structuredClone(p.theatre.actors[A]), id: B, name: 'Observer', x: 100,
      visible: true, block_data_json: workspace(otherRoots, schema) };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path fill="#e04020" d="M0 0h40v40H0z"/></svg>';
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    p.theatre.styles['costume-a'] = { ...p.theatre.styles['costume-a'], url, cdn_url: url };
    p.variables = Object.fromEntries(['after', 'other', 'down', 'up', 'click'].map(id => [id,
      { id, name: id, value: 0, type: 'number', is_global: true, current_entity: A, visible: false, position: { x: 0, y: 0 } }]));
    p.variable_order = Object.keys(p.variables);
    cases[name] = { project: p, frames: 24 };
    return cases[name];
  }
  make('hide', [start('start', vis('fade', 'grad_hide', A, .2), set('after'))]);
  make('show', [start('start', vis('fade', 'grad_show', A, .2), set('after'))], [], true);
  for (const [name, time] of [
    ['negative', -.1], ['zero', 0],
    ['infinity', b('', 'math_arithmetic', { OP: 'DIVIDE' }, { A: num(1), B: num(0) })],
    ['negative-infinity', b('', 'math_arithmetic', { OP: 'DIVIDE' }, { A: num(-1), B: num(0) })],
    ['nan', b('', 'math_arithmetic', { OP: 'DIVIDE' }, { A: num(0), B: num(0) })],
  ]) make(`duration-${name}`, [start('start', vis('fade', 'grad_hide', A, time), set('after'))]);
  make('group-hide', [start('start', vis('fade', 'grad_hide', 'group', .2), set('after'))]);
  make('race-hide-hide', [start('start', vis('fade', 'grad_hide', A, .2), set('after'))],
    [start('other-start', ...repeatWait(3), vis('other-fade', 'grad_hide', A, .2), set('other'))]);
  make('race-hide-show', [start('start', vis('fade', 'grad_hide', A, .2), set('after'))],
    [start('other-start', ...repeatWait(3), vis('other-fade', 'grad_show', A, .2), set('other'))]);
  make('race-show-hide', [start('start', vis('fade', 'grad_show', A, .2), set('after'))],
    [start('other-start', ...repeatWait(3), vis('other-fade', 'grad_hide', A, .2), set('other'))], true);
  make('instant-during-fade', [start('start', vis('fade', 'grad_hide', A, .2), set('after'))],
    [start('other-start', ...repeatWait(3), vis('instant', 'hide'), vis('reshow', 'show'), set('other'))]);
  make('cancel-caller', [start('start', vis('fade', 'grad_hide', A, .2), set('after')),
    start('stopper', ...repeatWait(3), b('stop', 'stop', { scope: '2' }), set('other'))]);
  make('delete-clone', [start('start', b('clone', 'mirror', { sprite: '__self' })),
    b('clone-fade', 'start_as_a_mirror', {}, {}, { DO: chain(b('self-fade', 'self_gradually_show_hide', { is_show: 'hide' }, { time: num(.2) }), set('after')) }),
    b('clone-delete', 'start_as_a_mirror', {}, {}, { DO: chain(...repeatWait(3), b('delete', 'dispose_clone')) })]);
  make('delete-caller-clone', [start('start', b('clone', 'mirror', { sprite: '__self' })),
    b('clone-fade', 'start_as_a_mirror', {}, {}, { DO: chain(vis('fade', 'grad_hide', A, .2), set('after')) }),
    b('clone-delete', 'start_as_a_mirror', {}, {}, { DO: chain(...repeatWait(3), b('delete', 'dispose_clone')) })]);
  for (const gradual of [false, true]) {
    const item = make(gradual ? 'input-gradual-hide' : 'input-hide',
      [start('start', ...repeatWait(3), vis('hide', gradual ? 'grad_hide' : 'hide', A, gradual ? .1 : undefined), set('after')),
        ...['down', 'up', 'click'].map(state => b(`hat-${state}`, 'sprite_on_tap', { actor: '__self', type: `mouse_${state}` }, {},
          { DO: b(`inc-${state}`, 'change_variable', { valname: state, method: 'increase' }, { n: num(1) }) }))]);
    item.inputScript = { schema: 'nekoc-input-v1', events: [
      { frame: 2, time_ms: 20, type: 'pointerdown', x: 0, y: 0 },
      { frame: 17, time_ms: 320, type: 'pointerup', x: 0, y: 0 },
    ] };
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-visibility-5-v1',
    clock: 'Native deterministic Clock origin pinned to 1024 ms before Start; no task algorithm replacement. Avoids wall-origin floating-point boundary drift.', cases: {} };
  const selected = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const fixtures = await visibility5Fixtures();
  for (const [name, item] of Object.entries(fixtures)) {
    if (selected.length && !selected.includes(name)) continue;
    const fixture = `tests/fixtures/kitten4/partial-visibility-5-${name}.bcm`;
    await saveJson(fixture, item.project);
    if (item.inputScript) await saveJson(fixture.replace('.bcm', '-input.json'), item.inputScript);
    if (!process.argv.includes('--record')) continue;
    const alpha = [];
    const trace = await runOracle(item.project, { frames: item.frames, seed: 1, inputScript: item.inputScript,
      beforeStart: async page => page.evaluate(() => {
        window.__k4OracleContainer.get(window.__k4OracleBinding.Clock)._wall_clock_now = () => 1024;
      }),
      wallTimeoutMs: 60000, onFrame: async page => alpha.push(await page.evaluate(() => {
        const p = window.__k4Oracle, stage = window.__k4OracleRequire('a1xw').a();
        if (!p.frames.length) throw Error(JSON.stringify(p.errors));
        return Object.fromEntries(Object.entries(p.frames.at(-1).actors).map(([id, info]) => {
          const actor = stage.get_actor_by_id(id);
          const key = id === info.prototype_id ? id : `${info.prototype_id}#clone`;
          return [key, { visible: actor.get_visible(), opacity: actor.get_alpha() }];
        }));
      })) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(item.project, null, 2) + '\n').digest('hex'),
      frames: trace.frames.map((f, i) => ({ frame: f.frame, variables: f.variables, sprites: alpha[i] })),
      errors: trace.errors, pageErrors: trace.diagnostics.pageErrors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length };
    console.log(name, alpha.map(f => f[A]?.opacity).join(','), JSON.stringify(trace.frames.at(-1).variables));
    await saveJson('dist/partial-visibility-5/evidence-progress.json', evidence);
  }
  if (process.argv.includes('--record') && !selected.length &&
      Object.keys(evidence.cases).length === Object.keys(fixtures).length) {
    const staged = 'dist/partial-visibility-5/evidence-complete.json';
    await saveJson(staged, evidence);
    await rename(staged, 'docs/kitten4-partial-visibility-5-evidence.json');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e, e.diagnostics?.partialTrace || ''); process.exitCode = 1;
});
