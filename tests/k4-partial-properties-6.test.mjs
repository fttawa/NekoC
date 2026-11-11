import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { property6Fixtures, A, B, LOCAL } from '../tools/compat/k4-partial-properties-6-fixtures.mjs';
import { command } from '../tools/compat/k4-diff.mjs';

test('property-6 original fixtures bind all 192 isolated official observations', async () => {
  const fixtures = await property6Fixtures();
  const evidence = await readJson('docs/kitten4-partial-properties-6-evidence.json');
  assert.deepEqual(Object.keys(evidence.cases), Object.keys(fixtures));
  assert.equal(Object.keys(fixtures).length, 8);
  for (const [name, p] of Object.entries(fixtures)) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/partial-properties-6-${name}.bcm`), p);
    const c = evidence.cases[name];
    assert.equal(c.sha256, createHash('sha256').update(JSON.stringify(p, null, 2) + '\n').digest('hex'));
    assert.equal(c.frames.length, 24);
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.pageErrors, []);
    assert.equal(c.externalAllowed, 0);
    assert.deepEqual(c.frames.map(f => f.frame), Array.from({ length: 24 }, (_, i) => i + 1));
  }
  const state = evidence.cases['get-state'].frames;
  for (const type of ['get_2', 'get_3', 'get_clone_index_property']) {
    assert.deepEqual(evidence.cases[`${type}-state`].frames, state);
  }
  assert.deepEqual(state.map(f => f.variables.phase).slice(0, 6), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(state.at(-1).variables.result, [
    -37.12, 28.88, 2, 137.25, 'Second', 225, 35, 100, 225, 225, 'local-live',
    -37.12, 28.88, 2, 137.25, 'Second', 225, 100, 100, 225, 225, 'local-live',
    -37.12, 28.88, 1, 137.25, 'First', 225, 35, 100, 225, 225, 'local-live',
  ]);
  assert.deepEqual(evidence.cases['clone-index-local-costume'].frames.at(-1).variables.result,
    [24, 23, 24, 23, 24, 23, 49, 47, 49, 47, 49, 47, 0, 0, 1, 'First', 47,
      60, -20, 2, 'Second', 24, 120, -20, 2, 'Second', 49]);
  assert.deepEqual(evidence.cases['scene-costume-id'].frames.at(-1).variables.result,
    [2, 'Background two', 2, 'Background two', 2, 'Background two',
      1, 'Background one', 1, 'Background one', 1, 'Background one']);
  for (const name of ['group-instant', 'group-fade-cycle']) {
    assert.deepEqual(evidence.cases[name].frames.at(-1).variables.result, [100, 100, 0, 0]);
    for (const f of evidence.cases[name].frames) {
      assert.equal(f.actors[A].visible, f.actors[B].visible);
      assert.equal(f.actors[A].opacity, f.actors[B].opacity);
    }
  }
});

// Opt-in: no implicit builds; the parent session owns Cargo and provides the binary.
test('existing k4-trace matches official state in default and interpreted modes',
  { skip: !process.env.K4_PROPERTIES_EXE }, async () => {
    const evidence = await readJson('docs/kitten4-partial-properties-6-evidence.json');
    for (const [name, c] of Object.entries(evidence.cases)) {
      for (const interpreter of [false, true]) {
        const trace = JSON.parse(await command(process.env.K4_PROPERTIES_EXE,
          [`tests/fixtures/kitten4/partial-properties-6-${name}.bcm`, '--frames', '24',
            ...(interpreter ? ['--interpreter'] : [])]));
        assert.equal(trace.frames.length, 24);
        for (let i = 0; i < 24; i++) {
          const actual = trace.frames[i], expected = c.frames[i];
          const context = `${name}/${i + 1}/interpreter=${interpreter}`;
          // The official diagnostic repeats the owner's local in variables;
          // NekoC correctly keeps locals solely in entity_variables.
          const { [LOCAL]: ownerLocal, ...globals } = expected.variables;
          assert.deepEqual(actual.variables, globals, context);
          assert.equal(actual.entity_variables[A][LOCAL], ownerLocal, `${context}/owner-local`);
          assert.deepEqual(Object.keys(actual.actors).sort(), Object.keys(expected.actors).sort(), context);
          for (const [id, actor] of Object.entries(expected.actors)) {
            for (const key of ['x', 'y', 'visible']) assert.equal(actual.actors[id][key], actor[key], `${context}/${id}/${key}`);
            assert.equal(actual.actors[id].current_style_id, actor.style, `${context}/${id}/style`);
          }
        }
      }
    }
  });

test('property-6 pixel evidence binds 192 complete unmasked frames', async () => {
  const pixels = await readJson('docs/kitten4-partial-properties-6-pixels.json');
  const states = await readJson('docs/kitten4-partial-properties-6-evidence.json');
  assert.equal(pixels.works.length, 8);
  for (const work of pixels.works) {
    assert.equal(work.fixtureSha256, states.cases[work.name].sha256);
    assert.equal(work.status, 'compared');
    assert.equal(work.frames.length, 24);
    assert.deepEqual(work.errors, []);
    assert.deepEqual(work.pageErrors, []);
    assert.equal(work.externalAllowed, 0);
    assert.deepEqual([...work.assets].sort((a, b) => a.source.localeCompare(b.source)),
      [...states.assets].sort((a, b) => a.source.localeCompare(b.source)));
    for (const f of work.frames) {
      assert.equal(f.pixels, 1280 * 720);
      assert.equal(f.maskedPixels, 0);
      assert.equal(f.changedPixels, 0, `${work.name}/${f.frame}`);
    }
  }
});
