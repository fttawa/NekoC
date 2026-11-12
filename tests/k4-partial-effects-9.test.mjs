import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { partialEffects9Fixtures } from '../tools/compat/k4-partial-effects-9-fixtures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),read=async p=>JSON.parse(await readFile(p,'utf8'));
test('round 9 real VM pixel evidence binds all original fixtures and current renderer',async()=>{
 const report=await read('docs/kitten4-partial-effects-9-pixels.json'),isolated=await read('docs/kitten4-partial-effects-9-renderer.json');
 assert.equal(report.rendererLfSha256,hash((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n')));
 assert.equal(isolated.rendererLfSha256,report.rendererLfSha256);assert.match(isolated.scope,/NOT NekoC VM evidence/);
 const fixtures=await partialEffects9Fixtures();assert.equal(Object.keys(report.cases).length,9);
 for(const [name,spec]of Object.entries(fixtures)){
  const bytes=await readFile(`tests/fixtures/kitten4/partial-effects-9-${name}.bcm`),c=report.cases[name];
  assert.equal(bytes.toString(),JSON.stringify(spec.project,null,2)+'\n');assert.equal(c.sha256,hash(bytes));assert.equal(spec.project.compile_result,undefined);
  assert.equal(c.rendererLfSha256,report.rendererLfSha256);assert.equal(c.status,'captured',c.error);assert.equal(c.frames.length,spec.frames);
  assert.ok(c.kernelAssets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  assert.deepEqual(isolated.cases[name].errors,[]);assert.deepEqual(isolated.cases[name].pageErrors,[]);
  for(const f of c.frames){assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.tolerance,0);assert.equal(f.additionalTolerances[1].tolerance,1);assert.equal(f.additionalTolerances[8].tolerance,8);}
  if(!['all-no-ripple','ascii-hue'].includes(name))assert.ok(c.frames.every(f=>f.additionalTolerances[8].changedPixels===0),name);
 }
 assert.equal(report.cases['all-no-ripple'].frames[12].additionalTolerances[8].changedPixels,65);
 assert.equal(report.cases['ascii-hue'].frames[2].additionalTolerances[8].changedPixels,1);
});
test('round 9 same-input shader baseline retains the negative pixels instead of relaxing tolerance',async()=>{
 const before=await read('docs/kitten4-partial-effects-9-baseline.json'),after=await read('docs/kitten4-partial-effects-9-renderer.json');
 for(const [name,frame,oldCount,newCount]of [['ascii-twist',3,557,0],['ascii-offstage',3,72,0],['all-no-ripple',13,703,65]]){
  assert.equal(before.cases[name].sha256,after.cases[name].sha256);assert.equal(before.cases[name].frames[frame-1].changedPixels,oldCount);assert.equal(after.cases[name].frames[frame-1].changedPixels,newCount);
 }
});
test('native final ASCII uses destination projection and active rectangle UVs',async()=>{
 const report=await read('docs/kitten4-partial-effects-9-geometry.json'),fixtures=await partialEffects9Fixtures();
 for(const [name,c]of Object.entries(report)){
  assert.equal(c.fixtureSha256,hash(JSON.stringify(fixtures[name].project,null,2)+'\n'));assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);assert.ok(c.externalRequests.every(r=>r.action==='blocked'));
 }
 const sample=report['ascii-twist'].samples.find(s=>s.frame===3&&s.index===6);
 assert.equal(sample.outputSize,null);assert.deepEqual(sample.inputSize,[256,256]);assert.deepEqual(sample.inputFrame,{x:377,y:275,width:232,height:184});assert.deepEqual(sample.uv,[0,0,.90625,0,.90625,.71875,0,.71875]);assert.equal(sample.fragmentPrecision,'mediump');
 assert.ok(Math.abs(sample.projection[0]-2/960)<1e-9);assert.ok(Math.abs(sample.projection[4]+2/720)<1e-9);
});
