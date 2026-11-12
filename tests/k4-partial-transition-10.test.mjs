import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transition10Fixtures, recordTransition10 } from '../tools/compat/k4-partial-transition-10.mjs';
import { StageRenderer } from '../web/renderer.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
// These are retained counterexamples, NOT an increased RGB tolerance or a
// parity pass. Passing this archive test means the known gap stays visible.
const gaps={'slide-filters':{pixels:4293,mae:.342202},'distrot-filters':{pixels:150185,mae:11.431807}};
test('transition 10 original fixtures retain full 65-frame native evidence',async()=>{
  const renderer=hash((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n'));
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    const bytes=await readFile(`tests/fixtures/kitten4/partial-transition-10-${name}.bcm`);
    assert.equal(bytes.toString(),JSON.stringify(spec.project,null,2)+'\n');
    const c=JSON.parse(await readFile(`docs/kitten4-partial-transition-10-${name}.json`,'utf8'));
    assert.equal(c.sha256,hash(bytes));assert.equal(c.rendererLfSha256,renderer);
    assert.equal(c.frames.length,65);assert.equal(c.pixels.length,65);assert.equal(c.observations.length,65);
    assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);assert.equal(c.externalAllowed,0);
    for(const f of c.pixels){assert.equal(f.pixels,960*720);assert.equal(f.tolerance,8);if(!gaps[name])assert.equal(f.changedPixels,0,`${name}/${f.frame}`);}
    if(gaps[name]){
      assert.equal(Math.max(...c.pixels.map(f=>f.changedPixels)),gaps[name].pixels,`${name}: retain the measured negative`);
      assert.ok(Math.max(...c.pixels.map(f=>f.mae))<=gaps[name].mae);
      assert.equal(c.pixels.at(-1).changedPixels,0,'completion returns to the target scene');
    }
  }
});
test('distort cleanup releases its reusable padded alpha input',()=>{
  const released=[],surface={texture:'texture',framebuffer:'fbo'},r={sceneTransition:{filterInput:surface},gl:{deleteTexture:t=>released.push(t),deleteFramebuffer:f=>released.push(f)}};
  StageRenderer.prototype.clearSceneTransition.call(r);assert.deepEqual(released,['fbo','texture']);assert.equal(r.sceneTransition,null);
});
test('live native transitions: passing paths and explicit inherited-filter counterexamples',{skip:!process.env.K4_TRANSITION_10_INTEGRATION,timeout:600000},async()=>{
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    const c=await recordTransition10(name,spec);assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);
    if(gaps[name]){
      const max=Math.max(...c.pixels.map(f=>f.changedPixels));assert.ok(max>0&&max<=gaps[name].pixels,name);
      assert.ok(Math.max(...c.pixels.map(f=>f.mae))<=gaps[name].mae,name);
    }else assert.ok(c.pixels.every(f=>f.changedPixels===0),name);
  }
});
