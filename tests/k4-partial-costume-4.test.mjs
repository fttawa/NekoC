import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partialCostume4Fixtures, costume4Ids as id } from '../tools/compat/k4-partial-costume-4-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';

test('partial-costume-4 original workspaces reproduce recorded fixture hashes', async () => {
  const evidence = await readJson('docs/kitten4-partial-costume-4-evidence.json');
  const fixtures = await partialCostume4Fixtures();
  assert.equal(Object.keys(fixtures).length, 25);
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  for (const [name, project] of Object.entries(fixtures)) {
    assert.deepEqual(project, await readJson(`tests/fixtures/kitten4/partial-costume-4-${name}.bcm`));
    assert.equal(createHash('sha256').update(JSON.stringify(project, null, 2) + '\n').digest('hex'), evidence.cases[name].sha256);
  }
  assert.equal(evidence.assets.find(a => a.source.endsWith('.orig')).sha256,
    '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160');
});

test('partial-costume-4 official traces preserve dynamic selection and field precedence', async () => {
  const { cases } = await readJson('docs/kitten4-partial-costume-4-evidence.json');
  const actorStyle = name => cases[name].observations.map(o => o.actors[0].style.style_id);
  const sceneStyle = name => cases[name].observations.map(o => o.scenes[0].texture);
  for (const name of ['dynamic-text', 'field-literal', 'array-single']) assert.deepEqual(actorStyle(name), Array(8).fill(id.b));
  assert.deepEqual(actorStyle('input-over-field'), Array(8).fill(id.a));
  assert.deepEqual(actorStyle('dynamic-change'), [id.b, id.b, id.a, id.a, id.b, id.b, id.b, id.b]);
  assert.deepEqual(cases['dynamic-change'].variables.map(v => v.phase), [1, 1, 2, 2, 3, 3, 3, 3]);
  for (const name of ['number', 'boolean', 'object', 'empty', 'invalid-text', 'name-not-id', 'missing-parameter']) {
    assert.equal(cases[name].status, 'completed', name);
    assert.deepEqual(actorStyle(name), Array(8).fill(id.a));
  }
  for (const name of ['scene-dynamic', 'scene-literal']) assert.deepEqual(sceneStyle(name), Array(8).fill(id.bg2));
  assert.deepEqual(sceneStyle('scene-foreign-id'), Array(8).fill(id.b));
  assert.deepEqual(sceneStyle('scene-missing-parameter'), Array(8).fill(id.bg));
});

test('partial-costume-4 errors keep their category, block attribution and unexecuted tail', async () => {
  const { cases } = await readJson('docs/kitten4-partial-costume-4-evidence.json');
  for (const [name, result] of Object.entries(cases)) {
    assert.deepEqual(result.pageErrors, [], name);
    assert.ok(result.externalRequests.every(request => request.action === 'blocked'), name);
    if (result.status === 'runtime-error') {
      assert.equal(result.variables.length, 0, name);
      assert.ok(result.errors.length > 0, name);
      const error = JSON.parse(result.errors[0]);
      assert.equal(error.annotation.block_type, 'set_costume_by_id', name);
      assert.equal(error.category.unique_code, name.startsWith('scene-') ? 'HEART.SYSTEM' : 'HEART.CLIENT', name);
      if (!name.startsWith('scene-')) assert.equal(error.annotation.client_annotation.id, 'set_costume', name);
      assert.deepEqual(result.observations[0].errorVariables, [{ before: 1, after: -1 }], name);
    } else {
      assert.equal(result.status, 'completed', name);
      assert.deepEqual(result.errors, [], name);
      assert.equal(result.variables.length, 8, name);
      assert.equal(result.variables.at(-1).before, 1, name);
      assert.equal(result.variables.at(-1).after, 1, name);
    }
  }
  assert.equal(Object.values(cases).filter(c => c.status === 'runtime-error').length, 9);
  for (const name of ['array', 'padded-id', 'missing-id', 'foreign-id', 'scene-missing-id', 'scene-number',
    'scene-boolean', 'scene-empty', 'scene-invalid-text']) {
    assert.equal(cases[name].status, 'runtime-error', name);
  }
});
