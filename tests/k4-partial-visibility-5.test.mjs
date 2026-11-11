import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { visibility5Fixtures, A } from '../tools/compat/k4-partial-visibility-5-fixtures.mjs';

test('visibility evidence is bound to original reproducible fixtures', async () => {
  const evidence = JSON.parse(await readFile('docs/kitten4-partial-visibility-5-evidence.json', 'utf8'));
  const generated = await visibility5Fixtures();
  assert.equal(Object.keys(evidence.cases).length, Object.keys(generated).length);
  for (const [name, item] of Object.entries(generated)) {
    const bytes = await readFile(`tests/fixtures/kitten4/partial-visibility-5-${name}.bcm`);
    assert.equal(bytes.toString(), JSON.stringify(item.project, null, 2) + '\n');
    const result = evidence.cases[name];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), result.sha256);
    assert.equal(result.frames.length, item.frames);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.pageErrors, []);
    assert.equal(result.externalAllowed, 0);
  }
  assert.equal(evidence.cases.hide.frames[12].sprites[A].visible, false);
  assert.equal(evidence.cases.show.frames[0].sprites[A].opacity, 0);
  assert.ok(evidence.cases['race-hide-hide'].frames[10].sprites[A].opacity < 0);
  assert.ok(Math.abs(evidence.cases['cancel-caller'].frames[23].sprites[A].opacity - .5) < 1e-6);
  assert.equal(evidence.cases['duration-infinity'].frames[23].variables.after, 0);
  assert.equal(evidence.cases['duration-negative'].frames[0].sprites[A].visible, true);
  assert.equal(evidence.cases['duration-negative'].frames[1].sprites[A].visible, false);
  assert.equal(evidence.cases['duration-negative'].frames[2].variables.after, 1);
  assert.equal(evidence.cases['input-hide'].frames[23].variables.down, 6);
  assert.equal(evidence.cases['input-gradual-hide'].frames[23].variables.down, 12);
});

test('visibility pixel observations retain complete frames and bind source bytes', async () => {
  const pixels = JSON.parse(await readFile('docs/kitten4-partial-visibility-5-pixels.json', 'utf8'));
  const fixtures = await visibility5Fixtures();
  assert.equal(pixels.works.length, Object.keys(fixtures).length);
  for (const work of pixels.works) {
    const fixture = `tests/fixtures/kitten4/partial-visibility-5-${work.name}.bcm`;
    assert.equal(createHash('sha256').update(await readFile(fixture)).digest('hex'), work.fixtureSha256);
    const item = fixtures[work.name];
    const inputHash = item.inputScript ? createHash('sha256').update(await readFile(fixture.replace('.bcm', '-input.json'))).digest('hex') : null;
    assert.equal(work.inputSha256, inputHash);
    assert.equal(work.status, 'compared');
    assert.equal(work.frames.length, item.frames);
    assert.deepEqual(work.frames.map(f => f.frame), Array.from({ length: item.frames }, (_, i) => i + 1));
    for (const frame of work.frames) {
      assert.equal(frame.pixels, 1280 * 720);
      assert.equal(frame.maskedPixels, 0);
      assert.ok(Number.isFinite(frame.mae));
      assert.ok(Number.isFinite(frame.changedPixels));
    }
  }
  const differences = pixels.works.flatMap(work => work.frames.filter(f => f.changedPixels > 0)
    .map(frame => [work.name, frame.frame, frame.changedPixels]));
  assert.deepEqual(differences, [['delete-caller-clone', 8, 1600]], 'documented clone disposal gap must remain visible');
});
