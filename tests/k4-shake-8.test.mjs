import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { shake8Fixtures } from '../tools/compat/k4-shake-8-fixtures.mjs';

const load = async () => JSON.parse(await readFile('docs/kitten4-shake-8-evidence.json', 'utf8'));
test('shake 8 binds six original fixtures, both origins, every variable and position', async () => {
  const evidence = await load();
  const fixtures = await shake8Fixtures();
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  assert.equal(Object.keys(fixtures).length, 6);
  assert.ok(evidence.assets.some(a => a.sha256 === '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  for (const [name, project] of Object.entries(fixtures)) {
    const bytes = await readFile(`tests/fixtures/kitten4/shake-8-${name}.bcm`);
    assert.equal(bytes.toString(), JSON.stringify(project, null, 2) + '\n');
    const c = evidence.cases[name];
    assert.equal(c.sha256, createHash('sha256').update(bytes).digest('hex'));
    for (const origin of evidence.originsMs) {
      const sample = c.origins[origin];
      assert.equal(sample.variables.length, 40);
      assert.equal(sample.actors.length, 40);
      assert.deepEqual(sample.errors, []);
      assert.deepEqual(sample.pageErrors, []);
      assert.equal(sample.externalAllowed, 0);
    }
  }
});

test('official task is post-script and end resume is next update; origin gap stays explicit', async () => {
  const e = await load();
  const id = '20000000-0000-4000-8000-000000000001';
  for (const origin of [0, 1024]) {
    const c = e.cases['single-0.14'].origins[origin];
    assert.equal(c.variables[9].phase, 1);
    assert.equal(c.actors[9][id].y, 0);
    assert.equal(c.variables[10].phase, 2);
    // A second script reads the position BEFORE this update's shake callback.
    for (let f = 1; f < 40; f++) {
      assert.equal(c.variables[f].sampleX, c.actors[f - 1][id].x);
      assert.equal(c.variables[f].sampleY, c.actors[f - 1][id].y);
    }
  }
  assert.equal(e.cases['single-0.14'].origins[0].actors[3][id].x, 0);
  assert.equal(e.cases['single-0.14'].origins[1024].actors[3][id].x, 5);
  for (const origin of [0, 1024]) assert.equal(e.cases.nonpositive.origins[origin].variables[0].phase, 2);
});
