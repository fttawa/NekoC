import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partialText2Fixtures } from '../tools/compat/k4-partial-text-2-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';

test('partial-text-2 original fixtures reproduce recorded hashes', async () => {
  const evidence = await readJson('docs/kitten4-partial-text-2-evidence.json');
  const fixtures = await partialText2Fixtures();
  assert.equal(Object.keys(fixtures).length, 9);
  for (const [name, project] of Object.entries(fixtures)) {
    assert.deepEqual(project, await readJson(`tests/fixtures/kitten4/partial-text-2-${name}.bcm`));
    assert.equal(createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), evidence.cases[name].sha256);
  }
});

test('partial-text-2 official evidence preserves values, errors and network boundary', async () => {
  const evidence = await readJson('docs/kitten4-partial-text-2-evidence.json');
  for (const [name, result] of Object.entries(evidence.cases)) {
    assert.deepEqual(result.pageErrors, []);
    assert.ok(result.externalRequests.every(r => r.action === 'blocked'), name);
    if (name.startsWith('error-')) {
      assert.equal(result.status, 'runtime-error');
      assert.equal(result.variables.length, 0);
      const error = JSON.parse(result.errors[0]);
      assert.equal(error.category.unique_code, 'HEART.SYSTEM');
      assert.equal(error.annotation.block_type, 'text_indexOf');
      assert.deepEqual(result.observations.flat(), [{ before: 1, result: 'unexecuted', after: 'unexecuted' }]);
    } else {
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.errors, []);
      assert.equal(result.variables.length, name === 'media-defaults' ? 12 : 3);
    }
  }
  const search = evidence.cases.search.variables[0];
  assert.equal(search['FIRST-utf16-a'], 4);
  assert.equal(search['LAST-utf16-emoji'], 7);
  assert.equal(search['LAST-utf16-empty'], 3);
  assert.equal(search['FIRST-empty'], 1);
  assert.equal(search['LAST-repeat'], 3);
  assert.equal(search['FIRST-missing'], 0);
  const array = evidence.cases['array-value'].variables[0];
  assert.equal(array['FIRST-array-hit'], 2);
  assert.equal(array['LAST-array-number'], 3);
  assert.equal(array['LAST-array-string'], 0);
  const media = evidence.cases['media-defaults'].variables.at(-1);
  assert.equal(media.done, 1);
  for (const id of ['voice', 'scan', 'translate-empty', 'translate-zero', 'translate-false']) assert.equal(media[id], '');
  assert.deepEqual(media['midi-string'], { id: '60' });
  assert.equal(media['midi-text'], '[object Object]');
  assert.equal(media['midi-identity'], true); // K4 equality compares object content, not JS ===.
});
