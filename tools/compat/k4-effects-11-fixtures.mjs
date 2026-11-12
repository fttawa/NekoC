#!/usr/bin/env node
// Owned round-7/8/9/10 asymmetric artwork, new editable programs; no vendor code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partialEffects7Fixtures } from './k4-partial-effects-7-fixtures.mjs';
import { partialEffects10Fixtures } from './k4-partial-effects-10-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

export const effectTypes = ['self_set_effect', 'self_set_effect_2', 'self_change_effect', 'self_change_effect_2', 'self_change_effect_3'];
export const effectScopes = [0, 1, 2, 3, 5, 6, 7];
const values = { 0: 65, 1: 35, 2: 25, 3: 9, 5: 40, 6: 60, 7: 8 };
const decreases = { 0: 20, 1: 10, 2: 10, 3: 4, 5: 15, 6: 20, 7: 4 };
const block = (id, type, fields = {}, inputs = {}) => ({ id, type, fields, inputs, statements: {} });
const num = n => block('', 'math_number', { NUM: String(n) });
const isSetter = type => type === 'self_set_effect' || type === 'self_set_effect_2';
const activeValue = (type, scope) => scope === 2 && isSetter(type) ? 125 : values[scope];
// These are explicit inputs, not an assertion that an enabled filter is identical
// to clear. In particular ASCII steps=0 is the official invalid-input/no-op probe.
const neutralValue = (type, scope) => !isSetter(type) ? 0 : scope === 2 ? 100 : [3, 7].includes(scope) ? 1 : 0;

export async function partialEffects11Fixtures() {
  const [round7, round10, { blocks: schema }] = await Promise.all([
    partialEffects7Fixtures(), partialEffects10Fixtures(), readJson('docs/kitten4-block-schema.json'),
  ]);
  const cases = {};
  function make(type, target, mode) {
    const name = `${type}-${target}-${mode}`;
    const base = target === 'scene' ? round7['scene-common'] : round10['all-no-ripple'];
    const { project, aid, sid } = structuredClone(base);
    project.project_name = `NekoC effects 11 ${name}`;
    delete project.compile_result;
    // Remove every inherited program, retaining the original artwork/properties.
    for (const entity of [...Object.values(project.theatre.actors), ...Object.values(project.theatre.scenes)]) {
      entity.block_data_json = workspace([], schema);
    }
    const nodes = [block('start11', 'start_on_click')], operations = [];
    let serial = 0, waits = 0;
    function hold() {
      nodes.push(block(`wait11-${++serial}`, 'wait', {}, { time: num(0) }));
      waits++;
    }
    function clear(phase) {
      const id = `clear11-${++serial}`;
      nodes.push(block(id, 'self_clear_effects'));
      operations.push({ id, phase, type: 'self_clear_effects' });
      hold();
    }
    function effect(scope, value, phase, method = 'increase') {
      const id = `effect11-${++serial}`, fields = { scope: String(scope) };
      // Legacy changers have no method dropdown. Do not inject unsupported fields
      // or use a made-up val socket in place of their steps input.
      if (type === 'self_change_effect_3') fields.increase = method;
      const input = isSetter(type) ? 'val' : 'steps';
      nodes.push(block(id, type, fields, { [input]: num(value) }));
      operations.push({ id, phase, type, scope, input, value, ...(type === 'self_change_effect_3' ? { method } : {}) });
      hold();
    }
    clear('baseline');
    for (const scope of effectScopes) {
      effect(scope, activeValue(type, scope), mode);
      if (mode === 'isolated') clear('isolate-next-scope');
    }
    if (type === 'self_change_effect_3') {
      // Valid positive steps plus the real dropdown exercise decrease for ASCII
      // too; negative ASCII inputs would instead test rejection, not decrease.
      if (mode === 'chain') {
        for (const scope of effectScopes) effect(scope, decreases[scope], 'decrease', 'decrease');
      } else {
        for (const scope of effectScopes) {
          effect(scope, activeValue(type, scope), 'decrease-seed');
          effect(scope, decreases[scope], 'decrease', 'decrease');
          clear('decrease-isolate-next-scope');
        }
      }
    }
    clear('before-neutral');
    for (const scope of effectScopes) {
      effect(scope, neutralValue(type, scope), 'neutral-input');
      if (mode === 'isolated') clear('neutral-isolate-next-scope');
    }
    clear('before-reset');
    for (const scope of effectScopes) {
      effect(scope, activeValue(type, scope), 'reset-after-clear');
      if (mode === 'isolated') clear('reset-isolate-next-scope');
    }
    clear('final');
    nodes.slice(1).forEach((node, i) => { nodes[i].next = node; });
    const entity = target === 'scene' ? project.theatre.scenes[sid] : project.theatre.actors[aid];
    entity.block_data_json = workspace([nodes[0]], schema);
    cases[name] = {
      project, aid, sid, type, target, mode, scopes: [...effectScopes], operations,
      // Follow the round-7/8 zero-wait sampling budget, including final idle frames.
      frames: waits * 2 + 2,
      artwork: target === 'scene' ? 'round-7 scene-common' : 'round-10 / round-9 / round-8 all-no-ripple',
      limitations: ['ripple (scope 4) excluded: official displacement asset unavailable',
        'Fixed inputs only; no whole-type coverage upgrade',
        'Neutral inputs are sampled, not assumed pixel-equivalent to clear; ASCII change steps=0 is a no-op probe'],
    };
  }
  for (const type of effectTypes) for (const mode of ['isolated', 'chain']) make(type, 'actor', mode);
  for (const type of ['self_set_effect_2', 'self_change_effect_3']) {
    for (const mode of ['isolated', 'chain']) make(type, 'scene', mode);
  }
  return cases;
}
export const effects11Fixtures = partialEffects11Fixtures;

// Shared exact-name CLI selection. Repeated --case and comma lists are supported;
// reject typos instead of silently producing an empty evidence run.
export function selectEffects11Cases(cases, argv = process.argv.slice(2)) {
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--case') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('--case requires a case name');
      arg = argv[++i];
    } else if (arg.startsWith('--case=')) arg = arg.slice(7);
    else if (arg.startsWith('--')) throw Error(`Unknown option: ${arg}`);
    if (!arg || arg.split(',').some(name => !name)) throw Error('Empty case name');
    names.push(...arg.split(','));
  }
  const unknown = names.filter(name => !Object.hasOwn(cases, name));
  if (unknown.length) throw Error(`Unknown case(s): ${unknown.join(', ')}. Available: ${Object.keys(cases).join(', ')}`);
  return Object.entries(cases).filter(([name]) => !names.length || names.includes(name));
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node tools/compat/k4-effects-11-fixtures.mjs [case ... | --case name[,name] | --case=name]');
    return;
  }
  for (const [name, spec] of selectEffects11Cases(await partialEffects11Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-effects-11-${name}.bcm`, spec.project);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
