import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { baseline, serviceTypes, physicsMainPaths, propertyMainPaths, drawingMainPaths } from '../tools/compat/k4-partial-6-scope.mjs';
import { remainingRound7, round7MainPaths, scope7Markdown } from '../tools/compat/k4-partial-7-scope.mjs';

test('round 7 accounts for all 28 remaining A types and only promotes measured main paths', () => {
  const report = JSON.parse(fs.readFileSync('docs/kitten4-block-coverage.json', 'utf8'));
  const rows = new Map(report.rows.map(row => [row.type, row]));
  assert.equal(remainingRound7.length, 28);
  assert.ok(round7MainPaths.size >= 12);
  const previous = new Set([...physicsMainPaths, ...propertyMainPaths, ...drawingMainPaths]);
  assert.equal(previous.size, 27);
  for (const [type, count] of Object.entries(baseline)) {
    assert.equal(rows.get(type).occurrences, count);
    if (serviceTypes.has(type)) {
      assert.equal(rows.get(type).status, '设备降级');
      assert.equal(rows.get(type).semantics, 'partial');
    }
  }
  for (const type of remainingRound7) {
    const row = rows.get(type);
    assert.equal(row.semantics, round7MainPaths.has(type) ? 'main-path-verified' : 'partial', type);
    if (round7MainPaths.has(type)) {
      assert.ok(!previous.has(type));
      assert.ok(!serviceTypes.has(type));
      assert.ok(row.unverifiedBoundaries.length > 0);
      assert.ok(fs.existsSync(`docs/${round7MainPaths.get(type).evidence}`));
    }
  }
  for (const type of ['physics2_set_texture', 'physics2_set_flexibility', 'self_set_boundary', 'physics2_set_boundary', 'self_shake', 'set_scene_transition']) {
    assert.equal(rows.get(type).semantics, 'partial', type);
  }
  assert.equal(fs.readFileSync('docs/kitten4-partial-7.md', 'utf8').replaceAll('\r\n', '\n'), scope7Markdown(report));
});
