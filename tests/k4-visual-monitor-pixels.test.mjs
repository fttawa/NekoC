import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorPixelFixture } from '../tools/compat/k4-visual-monitor-fixtures.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';

test('monitor pixel fixture uses original names/values and inline media',async()=>{
  assert.deepEqual(await readJson('tests/fixtures/kitten4/visual3-monitors.bcm'),await monitorPixelFixture());
});
test('initial common scalar widgets match official positions, scale, prefix and live values',{
  skip:!process.env.K4_VISUAL_INTEGRATION,
},async()=>{
  const work=await visualWork('tests/fixtures/kitten4/visual3-monitors.bcm',{
    captureFrames:[1,30,60],artifactsDir:'dist/visual3-monitors/regression',
  });
  assert.equal(work.status,'captured',work.error);assert.equal(work.frames.length,3);
  for(const frame of work.frames){assert.ok(frame.overlay);assert.ok(frame.changedPercent<.2,`${frame.frame}: ${frame.changedPercent}%`);}
});
