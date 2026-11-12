import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { lifecycle7Fixtures } from '../tools/compat/k4-partial-lifecycle-7-fixtures.mjs';

test('lifecycle 7 observations bind every original fixture and preserve the deletion frame', async () => {
  const evidence = JSON.parse(await readFile('docs/kitten4-partial-lifecycle-7-evidence.json', 'utf8'));
  const fixtures = await lifecycle7Fixtures();
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  assert.ok(evidence.assets.some(a => a.sha256 === '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  for (const [name, item] of Object.entries(fixtures)) {
    const bytes = await readFile(`tests/fixtures/kitten4/partial-lifecycle-7-${name}.bcm`);
    assert.equal(bytes.toString(), JSON.stringify(item.project, null, 2) + '\n');
    const recorded = evidence.cases[name];
    assert.equal(recorded.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(recorded.frames.length, item.frames);
    assert.deepEqual(recorded.errors, []);
    assert.deepEqual(recorded.pageErrors, []);
    assert.equal(recorded.externalAllowed, 0);
    assert.ok(recorded.frames.every(f => f.variables.after === 0));
  }
  for (const name of ['delete-clone', 'delete-caller-clone']) {
    assert.equal(evidence.cases[name].frames[7].actors.length, 3);
    assert.equal(evidence.cases[name].frames[8].actors.length, 2);
  }
});
