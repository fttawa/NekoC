import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects8Fixtures } from '../tools/compat/k4-partial-effects-8-fixtures.mjs';
import { effectTypes } from '../tools/compat/k4-partial-effects-7-fixtures.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const fixtures=await partialEffects8Fixtures();
const gaps=['ripple','all-no-ripple','ascii-offstage'];
test('round 8 original editable fixtures retain their historical renderer binding',async()=>{
  const report=await read('docs/kitten4-partial-effects-8-pixels.json');
  assert.match(report.rendererLfSha256,/^[a-f0-9]{64}$/);
  assert.equal(Object.keys(report.cases).length,Object.keys(fixtures).length);
  for(const [name,spec]of Object.entries(fixtures)){
    assert.deepEqual(await read(`tests/fixtures/kitten4/partial-effects-8-${name}.bcm`),spec.project,name);
    assert.equal(spec.project.compile_result,undefined);
    for(const style of Object.values(spec.project.theatre.styles))assert.match(style.url,/^data:image\/svg\+xml;base64,/);
    const c=report.cases[name];assert.equal(c.sha256,hash(JSON.stringify(spec.project,null,2)+'\n'));
    assert.equal(c.rendererLfSha256,report.rendererLfSha256,name);assert.equal(c.status,'captured',c.error);
    assert.equal(c.frames.length,spec.frames);assert.ok(c.kernelAssets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    for(const f of c.frames){assert.equal(f.maskedPixels,0);assert.equal(f.pixels,960*720);assert.equal(f.tolerance,0);assert.equal(f.additionalTolerances[1].tolerance,1);assert.equal(f.additionalTolerances[8].tolerance,8);}
    if(gaps.includes(name))assert.ok(c.frames.some(f=>f.additionalTolerances[8].changedPixels>0),name+' unresolved gap');
    else assert.ok(c.frames.every(f=>f.additionalTolerances[8].changedPixels===0),name);
  }
  // Isolated geometry paths are within a single byte, not merely tolerance 8.
  for(const name of [...effectTypes.map(t=>`${t}-ascii`),'ascii-fractional','ascii-rotate','scene-ascii','scene-spatial','spatial-offstage'])assert.ok(report.cases[name].frames.every(f=>f.additionalTolerances[1].changedPixels===0),name);
});
test('the same old negative frames improve without rewriting round-7 historical evidence',async()=>{
  const before=await read('docs/kitten4-partial-effects-8-baseline.json'),after=await read('docs/kitten4-partial-effects-8-pixels.json');
  assert.equal(before.baselineCommit,'6aaa205310752503b1850f640703608302195489');
  for(const name of ['self_set_effect_2-ascii','spatial-offstage','scene-spatial']){
    assert.equal(before.cases[name].sha256,after.cases[name].sha256);
    assert.ok(before.cases[name].frames.some(f=>f.additionalTolerances[8].changedPixels>1000));
    assert.ok(after.cases[name].frames.every(f=>f.additionalTolerances[1].changedPixels===0));
  }
});
test('native geometry and isolated shader observations retain provenance, not substituted VM state',async()=>{
  const geometry=await read('docs/kitten4-partial-effects-8-geometry.json'),isolated=await read('docs/kitten4-partial-effects-8-renderer.json');
  assert.equal(isolated.rendererLfSha256,(await read('docs/kitten4-partial-effects-8-pixels.json')).rendererLfSha256);
  assert.match(isolated.scope,/NOT NekoC VM evidence/);
  for(const [name,c]of Object.entries(geometry)){
    assert.equal(c.fixtureSha256,hash(JSON.stringify(fixtures[name].project,null,2)+'\n'));
    assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);assert.ok(c.externalRequests.every(r=>r.action==='blocked'));
    assert.ok(c.assets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  }
  const twist=geometry['scene-spatial'].samples.find(s=>s.index===4&&s.frame===3);
  assert.deepEqual(twist.filterArea,[1024,1024,-20,-20]);assert.equal(twist.padding,20);assert.equal(twist.radius,600);
  const edge=geometry['spatial-offstage'].samples.find(s=>s.index===4&&s.frame===3);
  assert.deepEqual(edge.filterArea,[256,256,814,588]);
});
test('live real-VM official pixel regression: ASCII, rotation, stage-outside and scene',{
  skip:!process.env.K4_EFFECTS8_INTEGRATION,timeout:600000,
},async()=>{
  for(const name of ['self_set_effect_2-ascii','self_change_effect_3-ascii','ascii-rotate','spatial-offstage','scene-spatial','scene-ascii']){
    const r=await visualWork(`tests/fixtures/kitten4/partial-effects-8-${name}.bcm`,{nekoc:path.resolve('target/debug/k4-trace.exe'),audioMetadata:true,captureFrames:[1,3,5],pixelTolerance:1,artifactsDir:'dist/partial-effects-8/regression'});
    assert.equal(r.status,'captured',r.error);assert.ok(r.frames.every(f=>f.changedPixels===0),name);
  }
});
