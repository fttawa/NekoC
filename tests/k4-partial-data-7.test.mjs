import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { data7Fixtures } from '../tools/compat/k4-partial-data-7-fixtures.mjs';

test('data 7 binds original fixtures and records all timing frames without devices', async () => {
  const evidence = JSON.parse(await readFile('docs/kitten4-partial-data-7-evidence.json', 'utf8'));
  const fixtures = await data7Fixtures();
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  assert.ok(evidence.assets.some(a => a.sha256 === '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  for (const [name, project] of Object.entries(fixtures)) {
    const bytes = await readFile(`tests/fixtures/kitten4/partial-data-7-${name}.bcm`);
    assert.equal(bytes.toString(), JSON.stringify(project, null, 2) + '\n');
    const recorded = evidence.cases[name];
    assert.equal(recorded.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(recorded.variables.length, 24);
    assert.deepEqual(recorded.errors, []);
    assert.deepEqual(recorded.pageErrors, []);
    assert.equal(recorded.externalAllowed, 0);
  }
  assert.deepEqual(evidence.cases['midi-wait-short'].variables.slice(0, 9).map(v => v.phase), [1,1,1,2,2,2,2,2,3]);
});
