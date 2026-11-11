import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { partialCamp4Fixtures } from '../tools/compat/k4-partial-camp-4-fixtures.mjs';

test('original arbitrary-camp fixtures reproduce and match isolated official evidence', async () => {
  const evidence = await readJson('docs/kitten4-partial-camp-4-evidence.json');
  const fixtures = await partialCamp4Fixtures();
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  for (const [name, fixture] of Object.entries(fixtures)) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/partial-camp-4-${name}.bcm`), fixture);
    const c = evidence.cases[name];
    assert.equal(c.sha256, createHash('sha256').update(JSON.stringify(fixture, null, 2) + '\n').digest('hex'));
    assert.equal(c.variables.length, 30);
    assert.equal(c.groups.length, 30);
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.pageErrors, []);
    assert.equal(c.externalAllowed, 0);
  }
  const actor = Object.keys(fixtures.cycle.theatre.actors)[0];
  assert.equal(evidence.cases.cycle.groups[0][actor], 'camp_green');
  assert.equal(evidence.cases.cycle.groups.at(-1)[actor], 'no_camp');
  const matrix = evidence.cases['custom-cycle'].variables.at(-1);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    assert.equal(matrix[`member-${i}-${j}`], +(i === j));
    assert.equal(matrix[`reverse-${i}-${j}`], +(i === j));
  }
  assert.equal(evidence.cases.clone.groups[1][`${actor}#1`], '阵营🐈');
  assert.equal(evidence.cases.clone.groups.at(-1)[`${actor}#1`], 'camp_green');
});
