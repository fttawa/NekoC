import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { property5Fixtures } from '../tools/compat/k4-partial-properties-5-fixtures.mjs';

test('original property-5 fixtures reproduce recorded official frames and lazy observations', async () => {
  const fixtures = await property5Fixtures();
  const evidence = await readJson('docs/kitten4-partial-properties-5-evidence.json');
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  for (const [name, project] of Object.entries(fixtures)) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/partial-properties-5-${name}.bcm`), project);
    const c = evidence.cases[name];
    assert.equal(c.sha256, createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'));
    assert.equal(c.variables.length, 12);
    assert.equal(c.raw.length, 12);
    assert.equal(c.actors.length, 12);
    assert.equal(c.resultTypes.length, 12);
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.pageErrors, []);
    assert.equal(c.externalAllowed, 0);
    if (name.endsWith('-list')) {
      assert.deepEqual(c.variables.at(-1).result, Array(3).fill([7, 'cat', 'tail', 9]));
    }
    if (name.endsWith('-lazy')) {
      const unknown = '40000000-0000-4000-8000-000000000099';
      assert.equal(c.raw[0][unknown].present, false);
      assert.deepEqual(c.raw.at(-1)[unknown], { present: true, value: 0 });
      assert.equal(c.raw.at(-1)['30000000-0000-4000-8000-000000000011'].present, false);
    }
    if (name.startsWith('no-costume')) {
      assert.equal(c.resultTypes[0][4], 'NaN');
      assert.equal(c.resultTypes[0][2], name.endsWith('actor') ? 'NaN' : 'number');
    }
  }
});

test('property-5 fixed-frame pixel evidence contains forty unmasked, zero-error comparisons', async () => {
  const evidence = await readJson('docs/kitten4-partial-properties-5-pixels.json');
  const states = await readJson('docs/kitten4-partial-properties-5-evidence.json');
  assert.equal(Object.keys(evidence.cases).length, 8);
  for (const [name, c] of Object.entries(evidence.cases)) {
    assert.equal(c.sha256, states.cases[name].sha256);
    const bySource = assets => [...assets].sort((a, b) => a.source.localeCompare(b.source));
    assert.deepEqual(bySource(c.kernelAssets), bySource(states.assets));
    assert.equal(c.status, 'captured');
    assert.deepEqual(c.frames.map(f => f.frame), [1, 3, 5, 9, 12]);
    for (const f of c.frames) {
      assert.equal(f.pixels, 1280 * 720);
      assert.equal(f.maskedPixels, 0);
      assert.equal(f.changedPixels, 0);
      assert.equal(f.mae, 0);
      assert.equal(f.rmse, 0);
    }
  }
});
