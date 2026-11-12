#!/usr/bin/env node
// Original probes, generated from repository-owned block descriptions.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}, statements = {}) => ({ type, fields, inputs, statements });
const num = value => b('math_number', { NUM: String(value) });
const set = (VAR, VALUE) => b('variables_set', { VAR }, { VALUE });
const chain = (...nodes) => { nodes.slice(1).forEach((node, i) => nodes[i].next = node); return nodes[0]; };
const start = (...body) => chain(b('start_on_click'), ...body);
const increment = id => set(id, b('math_arithmetic', { OP: 'ADD' }, { A: b('variables_get', { VAR: id }), B: num(1) }));
const hat = (type, fields, variable, busy = false) => b(type, fields, {}, { DO: busy ? chain(increment(variable),
  b('wait', {}, { time: num(.05) }), increment(`${variable}Done`)) : increment(variable) });

export async function deviceFixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const roots = [], variables = [];
  const add = (type, fields, name, busy = false) => {
    roots.push(hat(type, fields, name, busy)); variables.push(name); if (busy) variables.push(`${name}Done`);
  };
  add('on_shake', {}, 'shake');
  for (const type of ['up', 'down', 'left', 'right']) add('on_tilt', { type }, `tilt_${type}`);
  for (const mobile of ['mobile_1', 'mobile_2']) {
    add('on_mobile_shake', { mobile }, `${mobile}_shake`);
    for (const type of ['up', 'down', 'left', 'right']) {
      add('on_mobile_slide', { mobile, type }, `${mobile}_slide_${type}`);
      add('on_mobile_slope', { mobile, type }, `${mobile}_slope_${type}`);
    }
    for (const btn_event_type of ['click', 'keydown', 'keyup']) for (const type of ['A', 'B'])
      add('on_mobile_click_btn', { mobile, btn_event_type, type }, `${mobile}_${btn_event_type}_${type}`);
  }
  const specs = {
    events: { roots, variables },
    busy: { roots: [hat('on_shake', {}, 'shake', true), hat('on_mobile_shake', { mobile: 'mobile_1' }, 'mobile', true)],
      variables: ['shake', 'shakeDone', 'mobile', 'mobileDone'] },
    gravity: { roots: [start(b('self_enable_physics'), b('set_gravity_by_orientation', {}, { value: num(2) }), set('done', num(1)))], variables: ['done'] },
    vibration: { roots: [start(set('phase', num(1)), b('shock_duration', {}, { duration: num(.123) }),
      b('shock_for_n_times', {}, { times: num(2.5) }), b('shock_for_n_times', {}, { times: num(-1) }),
      b('shock_duration', {}, { duration: num(-.5) }), set('phase', num(2)))], variables: ['phase'] },
    'self-shake': { roots: [start(set('phase', num(1)), b('self_shake', {}, { time: num(.14) }), set('phase', num(2)))], variables: ['phase'] },
  };
  return Object.fromEntries(Object.entries(specs).map(([name, spec]) => {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC original device ${name}`;
    project.variables = Object.fromEntries(spec.variables.map(id => [id, { id, name: id, value: 0, type: 'any', is_global: true, visible: false }]));
    project.variable_order = spec.variables;
    for (const scene of Object.values(project.theatre.scenes)) scene.block_data_json = workspace([], schema);
    Object.values(project.theatre.actors)[0].block_data_json = workspace(spec.roots, schema);
    return [name, project];
  }));
}

export async function writeDeviceFixtures() {
  const fixtures = await deviceFixtures();
  for (const [name, project] of Object.entries(fixtures)) await saveJson(`tests/fixtures/kitten4/device-${name}.bcm`, project);
  return fixtures;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writeDeviceFixtures();
