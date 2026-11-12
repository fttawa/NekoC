#!/usr/bin/env node
// Original editable cloud probes; no vendor implementation or corpus works.
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
const num = n => b('math_number', { NUM: String(n) });
const text = s => b('text', { TEXT: s });
const get = id => b('cloud_variables_get', { VAR: id });
const set = (id, value) => b('cloud_variables_set', { VAR: id }, { VALUE: value });
const list = (type, fields = {}, inputs = {}) => b(`cloud_lists_${type}`, { VAR: 'items', ...fields }, inputs);
const read = (id, value) => b('variables_set', { VAR: id }, { VALUE: value });
const change = (id, value, method = 'increase') => b('change_cloud_variable', { valname: id, method }, { n: value });
const item = (type, index) => list('get_value', { TYPE: type }, index === undefined ? {} : { INDEX: num(index) });

export async function k4cloudFixtures() {
  const base = (await visualFixtures()).upright;
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const cases = {};
  for (const id of ['shared', 'personal']) cases[`scalar-${id}`] = [
    [read('initial', get(id))],
    [set(id, num(12)), read('numeric', get(id))],
    [change(id, num(3)), read('increased', get(id))],
    [change(id, num(2), 'decrease'), read('decreased', get(id))],
    [set(id, text('12')), change(id, num(3)), read('joined', get(id))],
    [change(id, text('3'), 'decrease'), read('coerced', get(id))],
    [set(id, b('logic_boolean', { BOOL: 'TRUE' })), read('rejected', get(id))],
  ];
  cases.list = [
    [read('initial-length', list('length')), read('empty', item('nth', 1))],
    [list('append', { POS: 'last' }, { VALUE: text('tail') })],
    [list('append', { POS: 'first' }, { VALUE: text('head') })],
    [list('insert_value', {}, { INDEX: num(2), VALUE: num(7) })],
    [read('all', list('get')), read('nth', item('nth', 2)), read('last', item('last')),
      read('length', list('length')), read('exists', list('is_exist', {}, { VALUE: num(7) })),
      read('index', list('index_of', {}, { VALUE: num(7) }))],
    [list('replace', { TYPE: 'nth' }, { INDEX: num(2), VALUE: text('middle') })],
    [list('replace', { TYPE: 'last' }, { VALUE: text('end') })],
    [list('delete', { TYPE: 'nth' }, { INDEX: num(2) })],
    [list('delete', { TYPE: 'last' })],
    [list('insert_value', {}, { INDEX: num(99), VALUE: text('overflow') })],
    [list('replace', { TYPE: 'nth' }, { INDEX: num(99), VALUE: text('appended') })],
    [list('delete', { TYPE: 'all' }), read('cleared', list('length'))],
  ];
  cases.monitors = [
    [],
    [set('shared', text('PUBLIC')), b('show_hide_cloud_variable', { VAR: 'shared', FUNC: 'show' })],
    [set('personal', num(42)), b('show_hide_cloud_variable', { VAR: 'personal', FUNC: 'show' })],
    [list('append', { POS: 'last' }, { VALUE: text('ROW-A') }), b('show_hide_cloud_list', { VAR: 'items', FUNC: 'show' })],
    [change('shared', text('-NEXT')), change('personal', num(1)), list('append', { POS: 'last' }, { VALUE: text('ROW-B') })],
    [b('show_hide_cloud_variable', { VAR: 'shared', FUNC: 'hide' })],
    [b('show_hide_cloud_variable', { VAR: 'personal', FUNC: 'hide' })],
    [b('show_hide_cloud_list', { VAR: 'items', FUNC: 'hide' })],
  ];
  cases.ranking = [
    [read('initial-hidden', b('is_ranking_show_hide', { VAL: 'hide' }))],
    [set('personal', num(42)), b('show_ranking', { VAR: 'personal' }), read('private-shown', b('is_ranking_show_hide', { VAL: 'show' }))],
    [b('hide_ranking'), read('private-hidden', b('is_ranking_show_hide', { VAL: 'hide' }))],
    [b('show_ranking', { VAR: 'shared' }), read('public-shown', b('is_ranking_show_hide', { VAL: 'show' }))],
    [b('hide_ranking')],
    [b('show_ranking', { VAR: '?' }), read('invalid-shown', b('is_ranking_show_hide', { VAL: 'show' }))],
    [b('hide_ranking')],
  ];
  const result = {};
  for (const [name, steps] of Object.entries(cases)) {
    const project = structuredClone(base);
    project.project_name = `NekoC k4cloud ${name}`;
    project.cloud_variables = Object.fromEntries([['shared', 'public', 18], ['personal', 'private', 82], ['items', 'public_list', 146]].map(([id, type, y]) =>
      [id, { id, cvid: `nekoc-k4cloud-${id}`, name: `NekoC ${id}`, type, value: type === 'public_list' ? ['IGNORED'] : 'IGNORED', visible: false,
        position: { x: 18, y }, offset: { x: 0, y: 0 }, scale: 1 }]));
    const body = [b('start_on_click')];
    const labels = [];
    for (let index = 0; index < steps.length; index++) {
      body.push(read('step', num(index)), ...steps[index], b('wait', {}, { time: num(0.025) }));
      labels.push(steps[index].map(n => n.type).join(',') || 'initial');
    }
    const names = [...new Set(body.filter(n => n.type === 'variables_set').map(n => n.fields.VAR))];
    project.variables = Object.fromEntries(names.map(id => [id, { id, name: id, value: 'unexecuted', type: 'any', is_global: true, visible: false, position: { x: 0, y: 0 } }]));
    project.variable_order = names;
    const blocks = {}, connections = {};
    let serial = 0;
    function insert(node, parent = null) {
      const id = `k4cloud-${++serial}`;
      if (!schema[node.type]) throw new Error(`Unknown block ${node.type}`);
      const defaults = structuredClone(schema[node.type].defaults);
      blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
      connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) connections[id][insert(child, id)] = { type: 'input', input_type: 'value', input_name: socket };
      return id;
    }
    let previous;
    for (const node of body) {
      const id = insert(node, previous);
      if (previous) connections[previous][id] = { type: 'next' };
      previous = id;
    }
    Object.values(project.theatre.actors)[0].block_data_json = { blocks, connections, comments: {} };
    result[name] = { project, labels, frames: steps.length * 3 + 3 };
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, { project }] of Object.entries(await k4cloudFixtures())) await saveJson(`tests/fixtures/kitten4/k4cloud-${name}.bcm`, project);
}
