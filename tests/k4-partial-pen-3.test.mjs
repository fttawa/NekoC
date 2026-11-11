import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { paintK4PenLines, drawK4PenLines } from '../web/pen-k4.js';
import { partialPen3Fixtures } from '../tools/compat/k4-partial-pen-3-fixtures.mjs';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

const evidence = JSON.parse(fs.readFileSync('docs/kitten4-partial-pen-3-evidence.json', 'utf8'));
function officialLines(calls) {
  const lines = [];
  for (let i = 0; i < calls.length; i++) {
    const arc = calls[i];
    if (arc.brush !== 'draw_line' || arc.method !== 'arc') continue;
    const line = calls.slice(i + 1).find(c => c.method === 'lineTo');
    assert.ok(line);
    const rgb = arc.color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
    lines.push(arc.args[0] - 480, 360 - arc.args[1], line.args[0] - 480, 360 - line.args[1],
      arc.width, ...rgb, arc.alpha);
  }
  return new Float32Array(lines);
}

test('original pen fixtures and nonempty official observations are frozen by hash', async () => {
  const fixtures = await partialPen3Fixtures();
  assert.equal(Object.keys(fixtures).length, 11);
  for (const [name, p] of Object.entries(fixtures)) {
    const bytes = JSON.stringify(p, null, 2) + '\n';
    assert.equal(fs.readFileSync(`tests/fixtures/kitten4/partial-pen-3-${name}.bcm`, 'utf8'), bytes);
    const c = evidence.cases[name];
    assert.equal(c.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(c.externalAllowed, 0);
    assert.deepEqual(c.errors, []);
    assert.equal(c.observations.length, 3);
    assert.ok(c.observations[0].calls.length > 0, name);
  }
});

test('official alpha, repeated-down, fill and stamp probes exercise their intended branches', () => {
  const first = name => evidence.cases[name].observations[0];
  const sample = (name, x, y) => first(name).samples.find(p => p.x === x && p.y === y).rgba;
  assert.deepEqual(sample('alpha-endpoints', -120, 30), [32, 64, 96, 223]);
  assert.deepEqual(sample('alpha-endpoints', -70, 30), [32, 64, 96, 127]);
  assert.deepEqual(sample('alpha-endpoints', -11, 30), [32, 64, 96, 127]);
  assert.equal(sample('repeated-down-zero', 0, 0)[3], 192);
  assert.equal(sample('repeated-down-nonzero', -120, 30)[3], 128);
  for (const name of ['fill-pen-up', 'fill-restart', 'fill-self-intersection']) {
    const calls = first(name).calls;
    assert.equal(calls.filter(c => c.method === 'fill').length, 1);
    assert.ok(calls.every(c => c.brush === 'draw_fill_pattern' && c.alpha === 1));
  }
  assert.deepEqual(sample('fill-pen-up', -70, 60), [32, 64, 96, 255]);
  assert.deepEqual(sample('fill-self-intersection', -70, 60), [96, 160, 32, 255]);
  for (const method of ['fill', 'stroke', 'fillText', 'drawImage']) {
    assert.ok(first('mixed-stamps').calls.some(c => c.method === method), method);
  }
});

test('K4 paint issues disk then closed stroke for each packed segment', () => {
  const calls = [];
  const ctx = Object.fromEntries(['beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'closePath', 'stroke']
    .map(method => [method, (...args) => calls.push([method, ...args])]));
  paintK4PenLines(ctx, new Float32Array([-120, 30, -20, 30, 20, 0, 0, 0, 0.5]), 0, 1, 960, 720);
  assert.deepEqual(calls, [['beginPath'], ['arc', 360, 330, 10, 0, Math.PI * 2], ['fill'],
    ['beginPath'], ['moveTo', 360, 330], ['lineTo', 460, 330], ['closePath'], ['stroke']]);
  assert.equal(ctx.lineWidth, 20);
  assert.equal(ctx.globalAlpha, 0.5);
  assert.equal(ctx.lineJoin, 'round');
});

test('clipped batch renderer is a no-op for an empty batch', () => {
  drawK4PenLines({}, new Float32Array(), 0, 0);
});

test('Canvas pen reconstruction matches recorded official operations and actual pixel probes',
  { skip: process.env.K4_PEN3_BROWSER !== '1' }, async () => {
    const browser = await loadPlaywright().chromium.launch({ headless: true, channel: 'msedge' });
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: fs.readFileSync('web/pen-k4.js', 'utf8').replaceAll('export function', 'function') });
      for (const name of ['opaque-endpoints', 'alpha-endpoints', 'alpha-corner', 'same-position',
        'repeated-down-zero', 'repeated-down-nonzero', 'fractional-width']) {
        const c = evidence.cases[name].observations[0];
        const actual = await page.evaluate(({ calls, lines, samples }) => {
          const make = () => { const c = document.createElement('canvas'); c.width = 960; c.height = 720; return c; };
          const official = make(), result = make();
          const a = official.getContext('2d'), b = result.getContext('2d');
          for (const c of calls) {
            a.setTransform(...c.matrix); a.lineWidth = c.width; a.globalAlpha = c.alpha;
            a.fillStyle = a.strokeStyle = c.color; a.lineCap = c.cap; a.lineJoin = c.join;
            a[c.method](...c.args);
          }
          paintK4PenLines(b, new Float32Array(lines), 0, lines.length / 9, 960, 720);
          const expected = a.getImageData(0, 0, 960, 720).data, actual = b.getImageData(0, 0, 960, 720).data;
          let different = 0;
          for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) different++;
          return { different, samples: samples.map(({ x, y }) => [...b.getImageData(480 + x, 360 - y, 1, 1).data]) };
        }, { calls: c.calls, lines: [...officialLines(c.calls)], samples: c.samples });
        assert.equal(actual.different, 0, name);
        assert.deepEqual(actual.samples, c.samples.map(s => s.rgba), name);
      }
    } finally { await browser.close(); }
  });
