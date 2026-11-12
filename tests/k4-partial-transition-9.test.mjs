import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sampleTransition, StageRenderer } from '../web/renderer.js';
import { fixtureHash } from '../tools/compat/k4-partial-effects-6-fixtures.mjs';
import { transition9Fixtures, recordTransition9 } from '../tools/compat/k4-partial-transition-9.mjs';

const evidence=JSON.parse(await readFile('docs/kitten4-partial-transition-9-evidence.json','utf8'));
test('transition 9 original fixtures and complete official frame evidence stay bound',async()=>{
  const fixtures=await transition9Fixtures();
  assert.equal(Object.keys(fixtures).length,14);
  for(const [name,p]of Object.entries(fixtures)){
    assert.deepEqual(JSON.parse(await readFile(`tests/fixtures/kitten4/partial-transition-9-${name}.bcm`,'utf8')),p);
    const c=evidence.cases[name];assert.equal(c.sha256,fixtureHash(p));
    assert.equal(c.frames.length,65);assert.equal(c.observations.length,65);assert.equal(c.pixels.length,65);
    assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);assert.equal(c.externalAllowed,0);
    for(const pixel of c.pixels){assert.equal(pixel.pixels,960*720);assert.ok(pixel.mae<1.6);assert.ok(pixel.changedPixels<=2000);}
  }
});
test('native completion is strict, and activation runs in the NEXT VM update',()=>{
  for(const [name,frame]of Object.entries({'slide-right':33,'fadeInOut-left':33,'bounce-left':63,'distrot-left':39,'none-left':2})){
    const c=evidence.cases[name],first=c.frames.find(f=>f.variables.activated===1);
    assert.equal(first.frame,frame,name);
    assert.equal(c.frames[0].variables.tail,1,`${name}: global switch tail stays same-update`);
    const completion=c.events.at(-1);
    assert.equal(c.observations[frame-2].ms,completion.ms);
    if(name!=='none-left')assert.equal(c.frames[frame-2].variables.oldTicks,frame-1);
  }
  assert.ok(evidence.cases['slide-invalid'].frames.every(f=>f.variables.activated===0));
});
test('distort alpha/angle follows both native screenshot tweens in all 37 active frames',()=>{
  const c=evidence.cases['distrot-left'];
  const transition={kind:'distort',outEnd:1000/60*31};
  for(const o of c.observations.filter(o=>o.out)){
    const s=sampleTransition(transition,o.ms,960,720);
    assert.equal(s.active,true);
    for(const [a,b]of [[s.outgoing.alpha,o.out.alpha],[s.incoming.alpha,o.incoming.alpha],[s.outgoing.angle,o.angles[0]],[s.incoming.angle,o.angles[1]]])assert.ok(Math.abs(a-b)<1e-12,`${o.frame}: ${a} != ${b}`);
  }
  assert.equal(sampleTransition(transition,600,960,720).active,true);
  assert.equal(sampleTransition(transition,600.001,960,720).active,false);
});
test('clearing screenshot transition releases both framebuffers and textures',()=>{
  const released=[];const r={sceneTransition:{screenshots:[{texture:'a',framebuffer:'b'},{texture:'c',framebuffer:'d'}]},gl:{deleteTexture:x=>released.push(x),deleteFramebuffer:x=>released.push(x)}};
  StageRenderer.prototype.clearSceneTransition.call(r);assert.deepEqual(released,['b','a','d','c']);assert.equal(r.sceneTransition,null);
});
test('transition 9 remeasures consecutive full frame pixels and VM completion against native core',{
  skip:!process.env.K4_TRANSITION_9_INTEGRATION,timeout:300000,
},async()=>{
  for(const[name,p]of Object.entries(await transition9Fixtures())){
    const c=await recordTransition9(name,p);assert.deepEqual(c.errors,[]);assert.deepEqual(c.pageErrors,[]);
    // Compare the persisted trace contract: JSON normalizes signed zero.
    assert.deepEqual(JSON.parse(JSON.stringify(c.frames)),evidence.cases[name].frames);assert.deepEqual(c.events,evidence.cases[name].events);
    for(const f of c.pixels){assert.ok(f.changedPixels<=2000,`${name}/${f.frame}: ${JSON.stringify(f)}`);assert.ok(f.mae<1.6);}
  }
});
