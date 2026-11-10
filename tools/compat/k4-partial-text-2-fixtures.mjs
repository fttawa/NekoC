#!/usr/bin/env node
// Original probes, no corpus or external runtime code copied.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (type, fields = {}, inputs = {}) => ({ type, fields, inputs, statements: {} });
const text = TEXT => b('text', { TEXT });
const num = NUM => b('math_number', { NUM: String(NUM) });
const bool = value => b('logic_boolean', { BOOL: value ? 'TRUE' : 'FALSE' });
const index = (END, VALUE, FIND) => b('text_indexOf', { END }, { VALUE, FIND });
const set = (VAR, VALUE) => ({ ...b('variables_set', { VAR }, { VALUE }), id: `set-${VAR}` });
const asText = original_value => b('convert_type', { type: 'string' }, { original_value });
const array = () => b('text_split', {}, { TEXT_TO_SPLIT: text('a/b'), SPLIT_TEXT: text('/') });

export async function partialText2Fixtures() {
  const base = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  // Legacy text_indexOf is absent from the current editor catalog. This is an
  // original workspace descriptor, not an extracted official block definition.
  schema.text_indexOf = { defaults: { ...structuredClone(schema.text.defaults), type: 'text_indexOf',
    fields: { END: 'FIRST' }, shadows: { VALUE: '', FIND: '' } } };
  const cases = {};
  const success = [];
  for (const END of ['FIRST', 'LAST']) {
    for (const [name, value, needle] of [
      ['repeat', 'ababa', text('aba')], ['missing', 'ababa', text('z')],
      ['utf16-a', '猫😀abc😀', text('a')], ['utf16-emoji', '猫😀abc😀', text('😀')],
      ['utf16-empty', '😀', text('')], ['empty', '', text('')],
      ['empty-missing', '', text('abc')], ['longer', 'a', text('abcd')],
      ['case', 'AbA', text('a')], ['combining', 'e\u0301é', text('é')],
      ['number-find', 'x12x12', num(12)], ['boolean-find', 'truefalse', bool(false)],
      ['array-find', 'za,bza,b', array()],
    ]) success.push(set(`${END}-${name}`, index(END, text(value), needle)));
  }
  cases.search = success;
  cases['array-value'] = ['FIRST', 'LAST'].flatMap(END => [
    set(`${END}-array-hit`, index(END, array(), text('b'))),
    set(`${END}-array-missing`, index(END, array(), text('z'))),
    set(`${END}-array-empty`, index(END, array(), text(''))),
    set(`${END}-array-number`, index(END,
      b('text_split', {}, { TEXT_TO_SPLIT: text('1/2/1'), SPLIT_TEXT: text('/') }), num(1))),
    set(`${END}-array-string`, index(END,
      b('text_split', {}, { TEXT_TO_SPLIT: text('1/2/1'), SPLIT_TEXT: text('/') }), text('1'))),
  ]);
  for (const [name, value] of [['number', num(123)], ['boolean', bool(true)], ['object', b('midi_get', { midi: '60' })]]) {
    for (const END of ['FIRST', 'LAST']) cases[`error-${name}-${END}`] = [set('before', num(1)),
      set('result', index(END, value, text('2'))), set('after', num(1))];
  }
  cases['media-defaults'] = [set('voice', b('get_voice_answer')), set('scan', b('get_recognition_result')),
    set('midi-string', b('midi_get', { midi: '60' })),
    set('midi-text', asText(b('midi_get', { midi: '60' }))),
    set('midi-identity', b('logic_compare', { OP: 'EQ' }, { A: b('midi_get', { midi: '60' }), B: b('midi_get', { midi: '60' }) })),
    set('translate-empty', b('translate_result', { language: 'english' }, { text: text('') })),
    set('translate-zero', b('translate_result', { language: 'japanese' }, { text: num(0) })),
    set('translate-false', b('translate_result', { language: 'english' }, { text: bool(false) })),
    set('done', num(1))];
  const result = {};
  for (const [name, body] of Object.entries(cases)) {
    const project = structuredClone(base);
    delete project.compile_result;
    project.project_name = `NekoC partial-text-2 ${name}`;
    const names = body.map(node => node.fields.VAR);
    project.variables = Object.fromEntries(names.map(id => [id, { id, name: id, value: 'unexecuted', type: 'any',
      is_global: true, visible: false, position: { x: 0, y: 0 } }]));
    project.variable_order = names;
    project.cloud_variables = {};
    const nodes = [{ ...b('start_on_click'), id: 'text-start' }, ...body];
    nodes.slice(1).forEach((node, i) => nodes[i].next = node);
    for (const scene of Object.values(project.theatre.scenes)) scene.block_data_json = workspace([], schema);
    Object.values(project.theatre.actors)[0].block_data_json = workspace([nodes[0]], schema);
    result[name] = project;
  }
  return result;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-text-2-evidence-v1', scope: 'offline original fixtures; no credentials, hardware or allowed external requests', cases: {} };
  for (const [name, project] of Object.entries(await partialText2Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-text-2-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const observations = [];
    const options = { frames: name === 'media-defaults' ? 12 : 3, blocks: true, wallTimeoutMs: 60000,
      beforeStart: async page => {
        await page.evaluate(() => {
          const runtime = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
          const original = runtime.report_error_and_stop;
          window.__partialText2Errors = [];
          runtime.report_error_and_stop = function (...args) {
            window.__partialText2Errors.push({ before: this.get_variable('before'), result: this.get_variable('result'), after: this.get_variable('after') });
            return original.apply(this, args);
          };
        });
      }, onFrame: async page => observations.push(await page.evaluate(() => window.__partialText2Errors)) };
    let trace, diagnostics, status;
    try {
      trace = await runOracle(project, options); diagnostics = trace.diagnostics; status = 'completed';
      if (name.startsWith('error-')) throw new Error(`expected official type error: ${name}`);
    } catch (error) {
      if (!name.startsWith('error-') || !error.diagnostics?.partialTrace?.errors?.length) throw error;
      diagnostics = error.diagnostics; trace = diagnostics.partialTrace; status = 'runtime-error';
    }
    evidence.assets = diagnostics.assets;
    evidence.cases[name] = { status, sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      variables: trace.frames.map(f => f.variables), errors: trace.errors, observations,
      externalRequests: diagnostics.externalRequests, pageErrors: diagnostics.pageErrors };
    console.log(name, status, `${trace.frames.length} frames`, `${trace.errors.length} errors`);
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-text-2-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
