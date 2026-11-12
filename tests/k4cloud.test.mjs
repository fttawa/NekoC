import test from 'node:test';
import { cloudDataTypes, mappingStatus } from '../tools/compat/k4-block-catalog.mjs';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { k4cloudFixtures } from '../tools/compat/k4cloud-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';

const evidence = await readJson('docs/k4cloud-evidence.json');
const at = (name, step) => evidence.cases[name].frames.find(f => f.variables.step === step);

test('only twelve measured offline data types are promoted, never cloud UI or invented prefixes', () => {
  assert.equal(cloudDataTypes.size, 12);
  const ui = ['show_hide_cloud_variable', 'show_hide_cloud_list', 'show_ranking', 'hide_ranking', 'is_ranking_show_hide'];
  const rows = mappingStatus(process.cwd(), [...cloudDataTypes, ...ui, 'cloud_lists_unknown'].map(type => ({type,official:[]})));
  for (const row of rows) {
    if (cloudDataTypes.has(row.type)) {
      assert.equal(row.semantics, 'offline-oracle-verified', row.type);
      assert.ok(row.unverifiedBoundaries.some(s => s.includes('surrogate')), row.type);
    } else if (ui.includes(row.type)) {
      assert.equal(row.semantics, 'partial', row.type);
    } else assert.equal(row.status, '缺失');
  }
});

test('k4cloud original fixtures are reproducible and all cloud domain blocks actually executed', async () => {
  const cases = await k4cloudFixtures();
  const executed = new Set();
  let frames = 0;
  for (const [name, { project, frames: count }] of Object.entries(cases)) {
    const file = `tests/fixtures/kitten4/k4cloud-${name}.bcm`;
    assert.deepEqual(project, await readJson(file));
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), evidence.cases[name].sha256);
    assert.equal(project.compile_result, undefined);
    const record = evidence.cases[name];
    assert.equal(record.frames.length, count);
    assert.deepEqual(record.errors, []);
    assert.deepEqual(record.pageErrors, []);
    assert.ok(record.externalRequests.length > 0);
    assert.ok(record.externalRequests.every(r => r.action === 'blocked'));
    assert.deepEqual(record.frames.map(f => f.frame), Array.from({ length: count }, (_, i) => i + 1));
    const blocks = Object.values(project.theatre.actors)[0].block_data_json.blocks;
    for (const id of record.executedBlocks) executed.add(blocks[id]?.type);
    frames += count;
  }
  assert.equal(frames, 138);
  const types = Object.keys((await readJson('docs/kitten4-block-schema.json')).blocks).filter(k => /cloud_|ranking/.test(k));
  assert.equal(types.length, 17);
  for (const type of types) assert.ok(executed.has(type), `${type} must have an actual block event`);
  assert.ok((await stat('docs/k4cloud-evidence.json')).size < 300000);
  assert.equal(evidence.assets.find(a => a.source.endsWith('.orig')).sha256, '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160');
});

test('k4cloud public/private scalar operations survive every frame without importing saved defaults', () => {
  const expected = [0, 12, 15, 13, '123', 120, 120];
  for (const id of ['shared', 'personal']) {
    const name = `scalar-${id}`;
    for (const f of evidence.cases[name].frames) {
      assert.equal(f.variables[id], expected[f.variables.step]);
      assert.equal(f.variables[id === 'shared' ? 'personal' : 'shared'], 0);
      assert.deepEqual(f.variables.items, []);
    }
  }
});

test('k4cloud list mutations and live alias are detached into each official snapshot', () => {
  const expected = [[], ['tail'], ['head', 'tail'], ['head', 7, 'tail'], ['head', 7, 'tail'],
    ['head', 'middle', 'tail'], ['head', 'middle', 'end'], ['head', 'end'], ['head'],
    ['head', 'overflow'], ['head', 'overflow', 'appended'], []];
  for (const f of evidence.cases.list.frames) {
    assert.deepEqual(f.variables.items, expected[f.variables.step]);
    if (f.variables.step >= 4) assert.deepEqual(f.variables.all, expected[f.variables.step]);
  }
  const f = at('list', 4).variables;
  assert.equal(f.nth, 7); assert.equal(f.last, 'tail'); assert.equal(f.length, 3);
  assert.equal(f.exists, true); assert.equal(f.index, 2);
});

test('k4cloud monitor visibility is proven by rendered stage texts, not stale metadata', () => {
  const expected = [[], ['NekoC shared', 'PUBLIC'], ['NekoC shared', 'PUBLIC', 'NekoC personal', '42'],
    ['NekoC shared', 'PUBLIC', 'NekoC personal', '42', 'NekoC items', 'ROW-A'],
    ['NekoC shared', 'PUBLIC-NEXT', 'NekoC personal', '43', 'NekoC items', 'ROW-A', 'ROW-B'],
    ['NekoC personal', '43', 'NekoC items', 'ROW-A', 'ROW-B'], ['NekoC items', 'ROW-A', 'ROW-B'], []];
  for (const f of evidence.cases.monitors.frames) {
    const text = f.stageTexts.map(t => t.text).filter(t => !['1', '2'].includes(t));
    assert.deepEqual(text.sort(), [...expected[f.variables.step]].sort());
    assert.ok(Object.values(f.monitors).every(m => m.visible === false));
  }
});

test('k4cloud ranking valid show has anonymous/loading DOM but never fabricated ranked users', () => {
  for (const f of evidence.cases.ranking.frames) {
    const shown = [1, 3].includes(f.variables.step);
    assert.equal(f.ranking.show, shown);
    assert.deepEqual(f.ranking.user_list, []);
    assert.equal(f.rankingDomCount > 0, shown);
    if (shown) {
      assert.equal(f.ranking.loading_status, 0);
      assert.match(f.domText, /排行榜\n-\n未登录用户\n(?:42|0)\nloading/);
    } else assert.doesNotMatch(f.domText, /排行榜/);
  }
  assert.equal(at('ranking', 1).ranking.var_id, 'personal');
  assert.equal(at('ranking', 1).ranking.value, 42);
  assert.equal(at('ranking', 3).ranking.var_id, 'shared');
  assert.equal(at('ranking', 5).variables['invalid-shown'], false);
});
