#!/usr/bin/env node
// Original probes only. Never import or copy corpus projects or kernel code.
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs });
const text = value => b('text', { TEXT: value });
const num = value => b('math_number', { NUM: String(value) });
const bool = value => b('logic_boolean', { BOOL: value ? 'TRUE' : 'FALSE' });
const get = id => b('cloud_variables_get', { VAR: id });
const set = (id, value) => b('cloud_variables_set', { VAR: id }, { VALUE: value });
const change = (id, value, method = 'increase') => b('change_cloud_variable', { valname: id, method }, { n: value });
const list = (type, fields = {}, inputs = {}) => b(`cloud_lists_${type}`, { VAR: 'items', ...fields }, inputs);
const read = (id, value) => b('variables_set', { VAR: id }, { VALUE: value });
const div = (a, c) => b('math_arithmetic', { OP: 'DIVIDE' }, { A: num(a), B: num(c) });
const item = index => list('get_value', { TYPE: 'nth' }, { INDEX: index });
const array = () => b('text_split', {}, { TEXT_TO_SPLIT: text('a/b'), SPLIT_TEXT: text('/') });

export async function partialCloud2Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const cases = {};
  const changes = [];
  // Record after every mutation, rather than letting later writes hide a mismatch.
  for (const id of ['shared', 'personal']) {
    for (const [name, initial, amount, method] of [
      ['numeric', num(12), num(3), 'increase'],
      ['string-left', text('12'), num(3), 'increase'],
      ['string-right', num(12), text('3'), 'increase'],
      ['boolean-right', num(12), bool(true), 'increase'],
      ['string-bool', text('x'), bool(false), 'increase'],
      ['numeric-text-minus', text('12'), text('3'), 'decrease'],
      ['invalid-minus', text('x'), num(3), 'decrease'],
      ['boolean-minus', num(12), bool(true), 'decrease'],
      ['array-right', num(12), array(), 'increase'],
      ['array-minus', num(12), array(), 'decrease'],
      ['infinity', div(1, 0), num(3), 'increase'],
      ['nan', div(0, 0), num(3), 'increase'],
      ['zero-minus', text('0'), text('0'), 'decrease'],
    ]) {
      changes.push(set(id, initial), change(id, amount, method), read(`${id}-${name}`, get(id)));
      if (['infinity', 'nan', 'invalid-minus', 'array-minus'].includes(name)) {
        changes.push(read(`${id}-${name}-text`, b('convert_type', { type: 'string' }, { original_value: get(id) })));
      }
    }
  }
  cases.change = changes;
  cases.limits = [
    set('shared', text('a'.repeat(1023))), change('shared', text('b'.repeat(20))), read('public-cap', get('shared')),
    set('personal', text('a'.repeat(1023))), change('personal', text('b'.repeat(20))), read('private-cap', get('personal')),
    set('shared', text('😀'.repeat(520))), read('scalar-utf16', get('shared')),
    set('personal', num(7)), set('personal', bool(true)), read('reject-bool', get('personal')),
    set('personal', array()), read('reject-array', get('personal')),
    list('append', { POS: 'last' }, { VALUE: text('😀'.repeat(70)) }), read('list-utf16', item(num(1))),
  ];
  cases.list = [
    read('empty', item(num(1))), read('empty-last', list('get_value', { TYPE: 'last' })),
    list('append', { POS: 'last' }, { VALUE: num(7) }),
    list('append', { POS: 'last' }, { VALUE: text('7') }),
    list('append', { POS: 'first' }, { VALUE: text('head') }),
    read('number-index', list('index_of', {}, { VALUE: num(7) })),
    read('string-index', list('index_of', {}, { VALUE: text('7') })),
    read('exists', list('is_exist', {}, { VALUE: num(7) })),
    read('absent-value', list('is_exist', {}, { VALUE: bool(true) })),
    read('fraction-low', item(num(0.25))), read('fraction', item(num(2.9))),
    read('invalid-zero', item(num(0))), read('invalid-negative', item(num(-1))),
    read('index-infinity', item(div(1, 0))),
    list('insert_value', {}, { INDEX: num(0.5), VALUE: text('front') }),
    list('replace', { TYPE: 'nth' }, { INDEX: num(2.8), VALUE: text('replaced') }),
    list('insert_value', {}, { INDEX: num(999), VALUE: text('tail') }),
    list('replace', { TYPE: 'nth' }, { INDEX: num(999), VALUE: text('overflow') }),
    list('delete', { TYPE: 'nth' }, { INDEX: num(999) }),
    list('delete', { TYPE: 'nth' }, { INDEX: div(0, 0) }),
    read('after-splice', list('length')),
    list('delete', { TYPE: 'last' }),
    list('replace', { TYPE: 'last' }, { VALUE: text('new-last') }),
    read('last', list('get_value', { TYPE: 'last' })),
  ];
  cases['list-get'] = [list('append', { POS: 'last' }, { VALUE: text('first') }),
    read('alias', list('get')), list('append', { POS: 'last' }, { VALUE: text('second') }),
    read('alias-length', b('lists_length', {}, { VAR: b('variables_get', { VAR: 'alias' }) })),
    set('shared', num(12)), change('shared', list('get')), read('array-add', get('shared'))];
  // Regression for the former shared-lowering gap: preserve this string's tag
  // until the cloud-only evaluator rejects it, instead of coercing it to 2.
  cases['typed-index'] = [list('append', { POS: 'last' }, { VALUE: text('first') }),
    list('append', { POS: 'last' }, { VALUE: text('second') }),
    read('index-string', item(text('2'))),
    list('insert_value', {}, { INDEX: text('1'), VALUE: text('must-not-insert') }),
    read('length', list('length'))];
  cases['invalid-list-value'] = [list('append', { POS: 'last' }, { VALUE: bool(true) }),
    read('read-invalid', item(num(1))), read('invalid-length', list('length')),
    read('invalid-as-text', b('convert_type', { type: 'string' }, { original_value: list('get') })),
    list('replace', { TYPE: 'last' }, { VALUE: bool(false) }),
    read('replace-invalid', list('get_value', { TYPE: 'last' }))];
  // Yielding execution checks that cloud state survives real frame boundaries.
  cases.frames = [set('shared', num(1)), set('personal', text('x')),
    list('append', { POS: 'last' }, { VALUE: text('a') }),
    b('wait', {}, { time: num(0.025) }), change('shared', num(2)), change('personal', num(2)),
    list('append', { POS: 'last' }, { VALUE: text('b') }),
    b('wait', {}, { time: num(0.025) }), change('shared', num(1), 'decrease'),
    list('delete', { TYPE: 'all' }), read('final', get('shared'))];
  const result = {};
  for (const [name, body] of Object.entries(cases)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC partial-cloud-2 ${name}`;
    project.cloud_variables = Object.fromEntries([['shared', 'public'], ['personal', 'private'], ['items', 'public_list']].map(([id, type]) =>
      [id, { id, cvid: `partial-cloud-2-${id}`, name: id, type, value: type === 'public_list' ? ['not-a-default'] : 'not-a-default', visible: false, position: { x: 0, y: 0 }, scale: 1, offset: { x: 0, y: 0 } }]));
    const names = body.filter(n => n.type === 'variables_set').map(n => n.fields.VAR);
    project.variables = Object.fromEntries(names.map(id => [id, { id, name: id, value: 'unexecuted', type: 'any', is_global: true, visible: false, position: { x: 0, y: 0 } }]));
    project.variable_order = names;
    const blocks = {}, connections = {};
    let serial = 0;
    function insert(node, parent = null) {
      const id = `partial-cloud-2-${++serial}`;
      if (!schema[node.type]) throw new Error(`unknown probe block ${node.type}`);
      const defaults = structuredClone(schema[node.type].defaults);
      blocks[id] = { ...defaults, id, parent_id: parent, location: [0, 0], fields: { ...defaults.fields, ...node.fields } };
      const edges = connections[id] = {};
      for (const [socket, child] of Object.entries(node.inputs)) edges[insert(child, id)] = { type: 'input', input_type: 'value', input_name: socket };
      return id;
    }
    let previous;
    for (const node of [b('start_on_click'), ...body]) {
      const id = insert(node, previous);
      if (previous) connections[previous][id] = { type: 'next' };
      previous = id;
    }
    for (const scene of Object.values(project.theatre.scenes)) scene.block_data_json = { blocks: {}, connections: {}, comments: {} };
    Object.values(project.theatre.actors)[0].block_data_json = { blocks, connections, comments: {} };
    result[name] = project;
  }
  return result;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-cloud-2-evidence-v1', scope: 'anonymous offline; no credentials; not online parity', cases: {} };
  for (const [name, project] of Object.entries(await partialCloud2Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-cloud-2-${name}.bcm`, project);
    if (process.argv.includes('--record')) {
      const trace = await runOracle(project, { frames: 8, blocks: true, wallTimeoutMs: 90000 });
      evidence.assets = trace.diagnostics.assets;
      evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
        variables: trace.frames.map(f => f.variables), errors: trace.errors,
        externalRequests: trace.diagnostics.externalRequests, pageErrors: trace.diagnostics.pageErrors };
      console.log(`${name}: ${trace.frames.length} frames, ${trace.errors.length} runtime errors, ${trace.diagnostics.externalRequests.length} blocked external requests`);
    }
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-cloud-2-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
