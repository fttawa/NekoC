import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { excluded, recommendation, adjudicateDifference, summarizeRuntimeValue } from '../tools/compat/kn-hateneko-official-probe.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const evidence = () => read('docs/compatibility/hncompat2-official.json');

test('official archive covers 41 inventory entries, 39 observed exact originals, no delegated projects', async () => {
  const report = await evidence();
  assert.equal(report.ok, true);
  assert.equal(report.entries.length, 41);
  assert.equal(Object.keys(report.observations).length, 39);
  assert.equal(report.entries.filter(e => e.status === 'delegated').length, 2);
  assert.match(report.method, /No registry\/domain\/timer\/random overrides/);
  assert.equal(hash(await readFile(new URL(`../${report.baseline.file}`, import.meta.url))), report.baseline.sha256);
  for (const result of Object.values(report.observations)) {
    assert.equal(excluded(result.fixture), false);
    assert.equal(result.exactOriginal, true);
    assert.equal(result.editorVersion, '0.27.4');
    assert.equal(hash(await readFile(new URL(`../${result.fixture}`, import.meta.url))), result.sha256);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.failure, undefined);
    assert.ok(result.samples.length >= 3);
    assert.ok(result.bundles.some(b => /\/main\./.test(b.url) && /^[a-f0-9]{64}$/.test(b.sha256)));
    assert.ok(result.bundles.some(b => /\/crc_libs\./.test(b.url) && /^[a-f0-9]{64}$/.test(b.sha256)));
    assert.equal(result.inspection.getterSource, undefined);
    assert.ok(Number.isFinite(Date.parse(result.observationBatchAt)));
  }
  for (const entry of report.entries) {
    assert.equal(entry.fullRunCorrectnessClaimed, false);
    assert.equal(entry.differenceRulings.length, entry.baselineDifferences.length);
  }
});

test('actor private slots remain out of globals; completed cloneChanged is 99 in both exact fixtures', async () => {
  const report = await evidence();
  const variable = '30000000-0000-4000-8000-000000000001';
  const owner = '20000000-0000-4000-8000-000000000001';
  for (const name of ['actor-variables', 'actor-variables-deleted']) {
    const result = report.observations[`tests/fixtures/${name}.bcmkn`];
    const last = result.samples.at(-1);
    assert.equal(result.definitions[variable].isGlobal, false);
    assert.equal(result.definitions[variable].owner, owner);
    assert.ok(result.samples.every(s => !Object.hasOwn(s, 'definitions')));
    assert.equal(Object.hasOwn(last.globals, variable), false);
    assert.equal(last.privateVariables[owner][variable], 41);
    assert.equal(last.unscopedPrivateReads[variable].details.error.unique_number, 15);
    assert.match(last.unscopedPrivateReads[variable].details.error.description, /entity_id must be provided/);
    assert.equal(last.globals.cloneChanged, 99);
    assert.equal(last.globals.inherited, 41);
    assert.equal(last.globals.original, 41);
    assert.equal(last.globals.cloneRead, 99);
    assert.equal(last.globals.otherRead, 'other-value');
    assert.equal(last.globals.done, 1);
    assert.match(result.previousAttemptFailure, /page.evaluate/);
  }
  assert.deepEqual(report.observations['tests/fixtures/actor-variables-deleted.bcmkn'].samples.at(-1).globals.afterDelete, { $number: 'NaN' });
});

test('compact archive summarizes long runtime strings, preserves small typed fixtures, and identifies full raw reports', async () => {
  const report = await evidence();
  const bytes = await readFile(new URL('../docs/compatibility/hncompat2-official.json', import.meta.url));
  assert.ok(bytes.length < 1200000, `archive too large: ${bytes.length}`);
  assert.equal(report.rawReports.length, 2);
  for (const raw of report.rawReports) {
    assert.match(raw.file, /^dist\//);
    assert.match(raw.sha256, /^[a-f0-9]{64}$/);
    assert.ok(raw.bytes > 0);
  }
  const long = '猫'.repeat(129);
  assert.deepEqual(summarizeRuntimeValue(long), { kind: 'string-summary', length: 129, sha256: hash(long), head: '猫'.repeat(40) });
  assert.equal(summarizeRuntimeValue('3333333333333333'), '3333333333333333');
  let summaries = 0;
  const walk = value => {
    if (typeof value === 'string') assert.ok(value.length <= 128, `unsummarized runtime string length ${value.length}`);
    else if (value && typeof value === 'object') {
      if (value.kind === 'string-summary') {
        summaries++;
        assert.ok(value.length > 128);
        assert.ok(value.head.length <= 40);
        assert.match(value.sha256, /^[a-f0-9]{64}$/);
      }
      Object.values(value).forEach(walk);
    }
  };
  for (const result of Object.values(report.observations)) {
    result.samples.forEach(walk);
    if (!/actor-variables/.test(result.fixture)) assert.ok(result.samples.every(s => !Object.hasOwn(s, 'monitorVariables')));
  }
  assert.ok(summaries > 30);
  const initial = report.observations['tests/fixtures/kn-value-types/initial-lists.bcmkn'].samples.at(-1).globals;
  assert.equal(initial.worldFirst, '3333333333333333');
  assert.deepEqual(initial.source, ['1', '01', '3333333333333333', '33333333333333333', '1e2', 'bad', '', '  ', ['2', '猫', ['3']]]);
});

test('clock/RNG differences and pencraft actor coordinates are not silently adjudicated or ignored', async () => {
  const report = await evidence();
  const star = report.entries.find(e => /starhold/.test(e.file));
  assert.equal(star.differenceRulings.filter(r => r.status === 'unmatched-clock-input').length, 3);
  assert.equal(star.differenceRulings.filter(r => r.status === 'unmatched-rng-input').length, 2);
  assert.ok(star.differenceRulings.every(r => r.direction === 'unresolved'));
  const samples = report.observations[star.file].samples;
  assert.ok(samples.at(-1).globals['kn-var-now'] > samples[0].globals['kn-var-now']);
  for (const s of samples) {
    for (const [id, min, max] of [['socialId', 100000, 999999], ['socialSession', 100000000, 999999999]]) {
      assert.ok(Number.isInteger(s.globals[`kn-var-${id}`]));
      assert.ok(s.globals[`kn-var-${id}`] >= min && s.globals[`kn-var-${id}`] <= max);
    }
  }
  assert.match(report.sourceFacts[0].fact, /wall-clock Date/);
  const pencraft = report.entries.find(e => /pencraft-before-present-fix/.test(e.file));
  assert.equal(pencraft.status, 'partially-adjudicated');
  assert.equal(pencraft.differenceRulings.filter(r => r.status === 'unmatched-frame').length, 2);
  assert.match(pencraft.unresolved, /整项不能判正确/);
});

test('audio empty state does not prove completion; input exercise is separate from passive opening', async () => {
  const { observations } = await evidence();
  const audio = observations['tests/fixtures/audio.bcmkn'];
  assert.ok(audio.samples.every(s => Object.keys(s.globals).length === 0));
  assert.match(recommendation(audio.fixture).unresolved, /不能据空表证明/);
  const input = observations['tests/fixtures/input-kn.bcmkn'].samples;
  assert.ok(input.slice(0, 3).every(s => s.globals['a-down'] === 0));
  assert.ok(input[3].globals['a-down'] > 0);
  assert.ok(input[4].globals['a-up'] > 0);
  assert.equal(observations['tests/fixtures/kn-async-services/timers.bcmkn'].samples.at(-1).globals.fired, 0);
});

test('typed final values distinguish NaN, Undefined and null; no full list extrapolation', async () => {
  const { observations, entries } = await evidence();
  const missing = observations['tests/fixtures/kn-value-types/missing-object.bcmkn'].samples.at(-1).globals;
  assert.equal(missing.missing, 0);
  assert.deepEqual(missing.runtime, [{ $undefined: true }]);
  assert.deepEqual(missing.listMissing, { $number: 'NaN' });
  const nullish = observations['tests/fixtures/kn-value-types/nullish-list-item.bcmkn'].samples.at(-1).globals;
  assert.deepEqual(nullish.nullSource, [null]);
  assert.deepEqual(nullish.undefinedAny, { $number: 'NaN' });
  assert.equal(nullish.nullAny, 0);
  assert.ok(entries.some(e => e.differenceRulings.some(r => r.status === 'list-index-not-sampled')));
  assert.equal(adjudicateDifference('x', { key: 'state.actors.0.x' }, null).direction, 'unresolved');
  for (const reference of (await evidence()).existingEvidence) {
    assert.equal(hash(await readFile(new URL(`../${reference.file}`, import.meta.url))), reference.sha256);
  }
});
