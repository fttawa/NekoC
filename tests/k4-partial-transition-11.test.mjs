import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transition10Fixtures } from '../tools/compat/k4-partial-transition-10.mjs';
import { recordTransition11 } from '../tools/compat/k4-partial-transition-11.mjs';
import { StageRenderer } from '../web/renderer.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('round 11 closes the original slide/distort inherited-filter negatives at tolerance 8',async()=>{
  const renderer=hash((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n'));
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    const file=`docs/kitten4-partial-transition-11-${name}.json`,c=JSON.parse(await readFile(file,'utf8'));
    assert.ok((await stat(file)).size<300000);assert.equal(c.rendererLfSha256,renderer);
    assert.equal(c.sha256,hash(JSON.stringify(spec.project,null,2)+'\n'));
    assert.equal(c.pixels.length,65);assert.equal(c.frames.length,65);assert.equal(c.observations.length,65);
    assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);assert.equal(c.externalAllowed,0);
    for(const f of c.pixels){assert.equal(f.pixels,960*720);assert.equal(f.tolerance,8);assert.equal(f.changedPixels,0,`${name}/${f.frame}`);}
    assert.ok(c.assets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    if(name.startsWith('distrot'))for(const s of c.readbacks.flat())assert.equal(s.changedChannels,0,'raw RGBA screenshots before transition twist');
  }
});
test('distort releases all screenshot/filter surfaces including ASCII destination projection',()=>{
  const released=[],surface=id=>({texture:`t${id}`,framebuffer:`f${id}`});
  const r={sceneTransition:{screenshots:[surface(0),surface(1)],filterInput:surface(2),asciiOutput:surface(3)},gl:{deleteTexture:t=>released.push(t),deleteFramebuffer:f=>released.push(f)}};
  StageRenderer.prototype.clearSceneTransition.call(r);
  assert.deepEqual(released,['f0','t0','f1','t1','f2','t2','f3','t3']);assert.equal(r.sceneTransition,null);
});
test('same-update outgoing VM snapshot overrides stale rendered filter state',()=>{
  const oldId='a',sprite={id:'actor',effects:[65,0,25,9,0,17,60,8]},background={id:oldId,style:'new-style',effects:sprite.effects};
  const r={kitten4:true,sceneId:oldId,scenes:{a:{},b:{}},sprites:[],spriteIndices:new Map(),actorOrder:[],transitionClock:()=>0,
    clearSceneTransition(){},usePenSurface(){},backgroundState:{id:oldId,style:'stale'},backdrop:'stale'};
  StageRenderer.prototype.switchScene.call(r,'b',{kind:'slide',direction:'left',outgoing:{scene:'a',sprites:[background,sprite],order:['actor'],pen_layer:1}});
  assert.equal(r.sceneTransition.old.backgroundState,background);assert.equal(r.sceneTransition.old.backdrop,'new-style');
  assert.deepEqual(r.sceneTransition.old.sprites,[sprite]);assert.equal(r.sceneTransition.old.spriteIndices.get('actor'),0);
  assert.equal(r.sceneTransition.old.penLayer,1);
});
test('live official slide/distort full chain has zero tolerance-8 outliers',{skip:!process.env.K4_TRANSITION_11_INTEGRATION,timeout:600000},async()=>{
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    const c=await recordTransition11(name,spec,{diagnose:true});
    assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);
    assert.ok(c.pixels.every(f=>f.changedPixels===0),name);
    if(name.startsWith('distrot'))assert.ok(c.readbacks.flat().every(s=>s.changedChannels===0),name);
  }
});
