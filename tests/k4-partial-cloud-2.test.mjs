import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partialCloud2Fixtures } from '../tools/compat/k4-partial-cloud-2-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';

test('partial-cloud-2 fixtures are original, reproducible and nonempty', async () => {
  const cases = await partialCloud2Fixtures();
  const evidence = await readJson('docs/kitten4-partial-cloud-2-evidence.json');
  assert.equal(Object.keys(cases).length, 7);
  for (const [name, project] of Object.entries(cases)) {
    assert.deepEqual(project, await readJson(`tests/fixtures/kitten4/partial-cloud-2-${name}.bcm`));
    assert.equal(createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'),
      evidence.cases[name].sha256, name);
    assert.equal(project.compile_result, undefined);
    const actor = Object.values(project.theatre.actors)[0];
    assert.ok(Object.keys(actor.block_data_json.blocks).length > 5);
  }
});

test('recorded partial-cloud-2 oracle has eight frames and no allowed external requests', async () => {
  const evidence = await readJson('docs/kitten4-partial-cloud-2-evidence.json');
  assert.match(evidence.scope, /offline/);
  for (const [name, result] of Object.entries(evidence.cases)) {
    assert.equal(result.variables.length, 8, name);
    assert.deepEqual(result.errors, [], name);
    assert.deepEqual(result.pageErrors, [], name);
    assert.ok(result.externalRequests.every(r => r.action === 'blocked'), name);
  }
  const c = evidence.cases.change.variables[0];
  for (const id of ['shared', 'personal']) {
    assert.equal(c[`${id}-array-right`], '12a,b');
    assert.equal(c[`${id}-infinity-text`], 'Infinity');
    assert.equal(c[`${id}-nan-text`], 'NaN');
    assert.equal(c[`${id}-invalid-minus-text`], 'NaN');
  }
  assert.equal(evidence.cases.limits.variables[0]['scalar-utf16'].length, 1024);
  assert.equal(evidence.cases.limits.variables[0]['list-utf16'].length, 128);
  assert.equal(evidence.cases['typed-index'].variables[0]['index-string'], '');
  assert.equal(evidence.cases['list-get'].variables[0]['alias-length'], 2);
});
