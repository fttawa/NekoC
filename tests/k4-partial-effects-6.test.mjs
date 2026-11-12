import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { partialEffects6Fixtures, fixtureHash } from '../tools/compat/k4-partial-effects-6-fixtures.mjs';
import { effects6Transitions } from '../tools/compat/k4-partial-effects-6-transition.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
import path from 'node:path';
import { StageRenderer } from '../web/renderer.js';

const read=async p=>JSON.parse(await readFile(p,'utf8'));
const fixtures=await partialEffects6Fixtures();
const evidence=await read('docs/kitten4-partial-effects-6-evidence.json');

test('round 6 evidence pins original editable fixtures, offline kernel and all real updates',async()=>{
  assert.equal(Object.keys(fixtures).length,15);
  assert.ok(evidence.assets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
  for(const [name,spec]of Object.entries(fixtures)){
    assert.deepEqual(await read(`tests/fixtures/kitten4/partial-effects-6-${name}.bcm`),spec.project,name);
    const record=evidence.cases[name];assert.equal(record.sha256,fixtureHash(spec.project));
    assert.equal(record.observations.length,spec.frames);assert.deepEqual(record.errors,[]);assert.equal(record.externalAllowed,0);
    for(const style of Object.values(spec.project.theatre.styles))assert.match(style.url,/^data:image\/svg\+xml;base64,/);
    assert.ok(record.events.some(e=>e.block==='start'),name+' real start');
  }
});

test('six effect spellings execute at real frame boundaries, and clear restores all native defaults',()=>{
  for(const name of ['self_set_effect_2','self_change_effect_3','self_clear_effects','self_set_effect','self_change_effect','self_change_effect_2']){
    const r=evidence.cases[name],last=r.observations.at(-1);
    assert.deepEqual(last.effects,[0,100,0,0,0,0,0],name);assert.equal(last.opacity,1,name);
    assert.ok(r.observations.some(o=>o.effects.some((v,i)=>v!==[0,100,0,0,0,0,0][i])||o.opacity!==1),name+' is not empty');
    assert.ok(r.events.some(e=>e.block==='clear'),name+' clear executes');
  }
  for(const [a,b]of [['self_set_effect_2','self_set_effect'],['self_change_effect_3','self_change_effect'],['self_change_effect_3','self_change_effect_2']]){
    assert.deepEqual(evidence.cases[a].observations.map(o=>[o.opacity,o.effects]),evidence.cases[b].observations.map(o=>[o.opacity,o.effects]),`${a}/${b}`);
  }
});

test('cross-frame text/image stamps produce three native calls and accumulating nonempty brush pixels',()=>{
  for(const name of ['stamp-left','stamp-center','stamp-right','image-alpha','image-pivot-rotate']){
    const obs=evidence.cases[name].observations,last=obs.at(-1);
    assert.equal(last.calls.length,3,name);assert.ok(last.brush.nonzero>0,name);
    const unique=[...new Set(obs.map(o=>o.brush.nonzero))];assert.equal(unique.length,3,name+' draws on three distinct updates');
    for(let i=1;i<obs.length;i++)assert.ok(obs[i].brush.alphaSum>=obs[i-1].brush.alphaSum,name);
    assert.ok(last.calls.every(c=>c.name===(name.startsWith('stamp')?'draw_text_stamp':'draw_image_stamp')));
  }
});

test('historical round 6 pixel records bind fixtures and the pre-round-7 renderer, including former failures',async()=>{
  const pixels=await read('docs/kitten4-partial-effects-6-pixels.json');
  // Round 7 deliberately fixes this renderer. Keep the old measurements as a
  // historical baseline; current source is bound by the round-7 pixel tests.
  const baseline7=await read('docs/kitten4-partial-effects-7-baseline.json');
  assert.equal(pixels.rendererLfSha256,baseline7.rendererLfSha256,'historical renderer identity');
  for(const [name,spec]of Object.entries(fixtures)){
    const r=pixels.cases[name];assert.equal(r.sha256,fixtureHash(spec.project),name);assert.equal(r.status,'captured',r.error);
    assert.equal(r.rendererSha256,pixels.rendererSha256,name+' must bind the same recorded renderer');
    assert.equal(r.frames.length,12,name);
    for(const f of r.frames){assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.tolerance,8);}
  }
  for(const name of ['self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2','stamp-left','stamp-center','stamp-right','image-alpha','image-pivot-rotate']){
    assert.ok(pixels.cases[name].frames.every(f=>f.changedPixels===0),name+' native main-path tolerance');
  }
  assert.ok(pixels.cases.self_clear_effects.frames.filter(f=>f.frame>=3).every(f=>f.changedPixels===0),'all eight scopes cleared visually');
  for(const name of ['scope-pixelate','scope-twist'])assert.ok(pixels.cases[name].frames.some(f=>f.changedPixels>10000),name+' historical algorithm failure is visible');
  // Known gaps are explicit, never inferred to pass from getter state.
  assert.ok(pixels.cases['scope-ascii'].frames.some(f=>f.changedPixels>0),'ASCII stays a measured known failure');
});

test('Canvas stamp dispatch remains K4-only and reuses decoded source, not actor filters',()=>{
  const image={source:'decoded-canvas',texture:'gl-texture',width:80,height:40};
  const stamp={style:'a',x:0,y:0,direction:0,scale:100,opacity:.3,effects:[65,0,0,0,0,0,0,0]};
  const calls=[];
  const r={kitten4:true,images:new Map([['a',image]]),drawK4ImageStamp:(...args)=>calls.push(['canvas',...args]),drawTexture:(...args)=>calls.push(['gl',...args])};
  StageRenderer.prototype.drawImageStamp.call(r,stamp);assert.deepEqual(calls,[['canvas',stamp,image]]);
  calls.length=0;r.kitten4=false;StageRenderer.prototype.drawImageStamp.call(r,stamp);
  assert.equal(calls[0][0],'gl');assert.equal(calls[0][1],'gl-texture');
});

test('independent starting-commit renderer reproduces the rotated image-stamp regression',async()=>{
  const baseline=await read('docs/kitten4-partial-effects-6-image-baseline.json');
  const record=baseline.cases['image-pivot-rotate'];
  assert.equal(record.sha256,fixtureHash(fixtures['image-pivot-rotate'].project));
  assert.equal(record.status,'captured');assert.deepEqual(record.frames.map(f=>f.changedPixels),[144,288,432,432]);
  assert.ok(baseline.cases['image-alpha'].frames.every(f=>f.changedPixels===0));
});

test('textured transitions retain full-frame measurements including unsupported distort',async()=>{
  const record=await read('docs/kitten4-partial-effects-6-transitions.json');
  for(const [name,p]of Object.entries(await effects6Transitions())){
    assert.deepEqual(await read(`tests/fixtures/kitten4/partial-effects-6-transition-${name}.bcm`),p);
    const r=record.cases[name];assert.equal(r.sha256,fixtureHash(p));assert.equal(r.observations.length,65);assert.equal(r.pixels.length,11);
    assert.deepEqual(r.errors,[]);assert.equal(r.externalAllowed,0);
    for(const sample of r.pixels){assert.equal(sample.pixels,960*720);assert.equal(sample.maskedPixels,0);}
  }
  assert.ok(record.cases['distrot-left'].pixels.some(f=>f.changedPixels>0),'do not upgrade unsupported distort');
  assert.ok(record.cases['none-left'].pixels.every(f=>f.changedPixels===1937),'static textured backdrop residual remains explicit');
  for(const name of ['slide-right','bounce-left','fadeInOut-left']){
    assert.equal(record.cases[name].pixels.at(-1).changedPixels,1937,name+' shares static endpoint residual');
  }
});

test('live real-VM pixel regression (no Cargo; reruns offline official renderer)',{
  skip:!process.env.K4_EFFECTS6_INTEGRATION,timeout:600000,
},async()=>{
  const baseline=await read('docs/kitten4-partial-effects-6-pixels.json');
  for(const name of ['self_set_effect_2','self_change_effect_3','self_clear_effects','stamp-left','stamp-center','stamp-right','image-alpha','image-pivot-rotate']){
    const r=await visualWork(`tests/fixtures/kitten4/partial-effects-6-${name}.bcm`,{
      nekoc:path.resolve('target/debug/k4-trace.exe'),audioMetadata:true,
      captureFrames:[1,3,5,7,9,12],pixelTolerance:8,artifactsDir:'dist/partial-effects-6/regression',
    });
    assert.equal(r.status,'captured',r.error);assert.equal(r.frames.length,6);
    for(const f of r.frames){
      if(name==='self_clear_effects'&&f.frame<3){
        // Before clear, this probe deliberately combines unsupported ripple
        // and ASCII with spatial filters. It is not a certified pixel path;
        // keep its failure observable, not an old error-count ceiling.
        assert.ok(f.changedPixels>0,'unsupported pre-clear combination remains explicit');
        continue;
      }
      const expected=baseline.cases[name].frames.find(e=>e.frame===f.frame);
      assert.ok(f.changedPixels<=expected.changedPixels+2,`${name}/${f.frame}: ${f.changedPixels} > ${expected.changedPixels}`);
      assert.ok(f.mae<=expected.mae+.005,`${name}/${f.frame} MAE`);
    }
  }
});
