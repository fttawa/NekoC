#!/usr/bin/env node
// Original fixtures; no third-party project or runtime source is copied.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { partialMiscFixtures } from './k4-partial-misc-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b = (id, type, fields = {}, inputs = {}, statements = {}) => ({ id, type, fields, inputs, statements });
const num = n => b('', 'math_number', { NUM: String(n) });
const chain = (...nodes) => { nodes.slice(1).forEach((node, i) => nodes[i].next = node); return nodes[0]; };
const camp = (id, role_camp) => b(id, 'self_set_role_camp', { role_camp });
const wait = id => b(id, 'wait', {}, { time: num(0) });
const standard = ['camp_red', 'camp_yellow', 'camp_blue', 'no_camp'];

export async function partialCamp4Fixtures() {
  const previous = await partialMiscFixtures();
  const base = previous['camp-cycle'];
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const [a, observer] = Object.keys(base.theatre.actors);
  const cases = {};
  const values = ['camp_green', 'camp_custom', '', '🐈camp', 'camp_red', 'camp_yellow', 'camp_blue', 'no_camp'];
  for (const [name, selectedValues, targets, reverseProbe] of [
    ['cycle', values, standard, false],
    ['custom-cycle', ['camp_green', 'camp_custom', '🐈camp'], ['camp_green', 'camp_custom', '🐈camp', 'camp_unknown'], true],
  ]) {
   const body = [];
   const ids = [];
   for (const [i, value] of selectedValues.entries()) {
    body.push(camp(`camp-${i}`, value));
    for (const [j, target] of targets.entries()) {
      const id = `member-${i}-${j}`;
      ids.push(id);
      body.push(b(`set-${id}`, 'variables_set', { VAR: id }, { VALUE:
        b('', 'math_arithmetic', { OP: 'MULTIPLY' }, {
          A: b('', 'bump', { sprite1: observer, sprite2: target }), B: num(1),
        }) }));
      if (!reverseProbe) continue;
      const reverse = `reverse-${i}-${j}`;
      ids.push(reverse);
      body.push(b(`set-${reverse}`, 'variables_set', { VAR: reverse }, { VALUE:
        b('', 'math_arithmetic', { OP: 'MULTIPLY' }, {
          A: b('', 'bump', { sprite1: target, sprite2: observer }), B: num(1),
        }) }));
    }
    body.push(wait(`wait-${i}`));
  }
  const cycle = structuredClone(base);
  cycle.project_name = 'NekoC partial camp 4 arbitrary strings';
  const declaration = Object.values(base.variables)[0];
  cycle.variables = Object.fromEntries(ids.map(id => [id, { ...declaration, id, name: id }]));
  cycle.variable_order = ids;
  cycle.theatre.actors[a].block_data_json = workspace([chain(b('start', 'start_on_click'), ...body)], schema);
   cases[name] = cycle;
  }
  const clone = structuredClone(previous['camp-clone']);
  clone.project_name = 'NekoC partial camp 4 custom clone';
  clone.theatre.actors[a].block_data_json = workspace([
    chain(b('start', 'start_on_click'), camp('custom', '阵营🐈'), b('clone', 'mirror', { sprite: '__self' }),
      camp('yellow', 'camp_yellow'), wait('wait-a'), wait('wait-b')),
    b('clone-start', 'start_as_a_mirror', {}, {}, { DO: chain(wait('clone-wait'), camp('green', 'camp_green')) }),
  ], schema);
  cases.clone = clone;
  for (const value of ['camp_green', 'camp_custom', '']) {
    const initial = structuredClone(previous.camp_custom);
    initial.project_name = `NekoC partial camp 4 initial ${value}`;
    initial.theatre.actors[a].group = value;
    initial.theatre.actors[a].block_data_json = workspace([chain(b('start', 'start_on_click'),
      ...standard.map((target, j) => b(`set-${j}`, 'variables_set', { VAR: `member-${j}` }, {
        VALUE: b('', 'math_arithmetic', { OP: 'MULTIPLY' }, {
          A: b('', 'bump', { sprite1: observer, sprite2: target }), B: num(1),
        }),
      })))], schema);
    cases[`initial-${value || 'empty'}`] = initial;
  }
  return cases;
}

async function main() {
  const evidence = { schema: 'nekoc-k4-partial-camp-4-v1', cases: {} };
  for (const [name, project] of Object.entries(await partialCamp4Fixtures())) {
    await saveJson(`tests/fixtures/kitten4/partial-camp-4-${name}.bcm`, project);
    if (!process.argv.includes('--record')) continue;
    const groups = [];
    const trace = await runOracle(project, { frames: 30, seed: 1, wallTimeoutMs: 60000,
      onFrame: async page => groups.push(await page.evaluate(() => {
        const req = window.__k4OracleRequire, stage = req('a1xw').a();
        const data = req('KmiX').b().get_runtime_data();
        return Object.fromEntries(Object.keys(req('ALsR').a.get_state().theatre_states.actors).flatMap(id =>
          [id, ...(data.get_sprite_clones(id) || [])].map((aid, i) =>
            [i ? `${id}#${i}` : id, stage.get_actor_by_id(aid).get_group() ?? null])));
      })) });
    evidence.assets = trace.diagnostics.assets;
    evidence.cases[name] = { sha256: createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      variables: trace.frames.map(f => f.variables), groups, errors: trace.errors,
      externalAllowed: trace.diagnostics.externalRequests.filter(r => r.action !== 'blocked').length,
      pageErrors: trace.diagnostics.pageErrors };
    console.log(name, `${trace.frames.length} frames`, JSON.stringify(groups.at(-1)));
  }
  if (process.argv.includes('--record')) await saveJson('docs/kitten4-partial-camp-4-evidence.json', evidence);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error); process.exitCode = 1;
});
