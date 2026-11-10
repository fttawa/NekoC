import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { k4ImageStampGeometry, StageRenderer } from '../web/renderer.js';

test('K4 image stamps floor their destination rectangle like official Canvas calls', () => {
  const evidence = JSON.parse(fs.readFileSync('docs/kitten4-partial-drawing-evidence.json', 'utf8'));
  const project = JSON.parse(fs.readFileSync('tests/fixtures/kitten4/partial-drawing-image-state.bcm', 'utf8'));
  const actor = Object.values(project.theatre.actors)[0];
  const image = { width: 80, height: 40, centerPoint: { x: 13, y: -7 }, texture: 'source' };
  const stamp = { ...actor, style: 'costume-a', direction: -30, size_x: 100, size_y: 100,
    opacity: 1, effects: Array(8).fill(0) };
  const g = k4ImageStampGeometry(stamp, image);
  const call = evidence.cases['image-state'].observations[0].calls[0];
  const [dx, dy, width, height] = call.args, m = call.matrix;
  assert.equal(g.width, width);
  assert.equal(g.height, height);
  assert.ok(Math.abs(g.x - (m[4] - 480 + dx + width / 2)) < 1e-5);
  assert.ok(Math.abs(g.y - (360 - m[5] - dy - height / 2)) < 1e-5);
  let args;
  StageRenderer.prototype.drawImageStamp.call({ kitten4: true, images: new Map([['costume-a', image]]),
    drawTexture: (...values) => { args = values; } }, stamp);
  assert.deepEqual(args.slice(1, 6), [g.x, g.y, g.width, g.height, g.angle]);
  assert.deepEqual(args[6], [1, 1, 1, 1]);
  assert.deepEqual(args[7], Array(8).fill(0));
});
