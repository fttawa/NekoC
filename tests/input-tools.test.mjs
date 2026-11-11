import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateInputScript } from '../tools/compat/input-script.mjs';
import { inputFixture, inputScript, transformedInputFixture, transformedInputScript, ghostInputFixture } from '../tools/compat/k4-input-fixtures.mjs';
import { readJson, runOracle, parseArgs } from '../tools/compat/k4-oracle.mjs';
import { StageRenderer } from '../web/renderer.js';

test('input fixtures reproduce exactly; official evidence binds source and replay bytes',async()=>{
  for(const [name,project,script] of [
    ['input',await inputFixture(),inputScript()],
    ['input-transform',await transformedInputFixture(),transformedInputScript()],
    ['input-ghost',await ghostInputFixture(),{schema:'nekoc-input-v1',events:[{frame:2,time_ms:20,type:'pointerdown',x:-20,y:0},{frame:3,time_ms:40,type:'pointerup',x:-20,y:0}]}],
  ]) {
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/${name}.bcm`),project);
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/${name}-script.json`),script);
    const evidence=await readJson(`docs/${name}-evidence.json`);
    const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
    assert.equal(await hash(`tests/fixtures/kitten4/${name}.bcm`),evidence.sha256);
    assert.equal(await hash(`tests/fixtures/kitten4/${name}-script.json`),evidence.inputSha256);
    assert.ok(evidence.assets.some(a=>a.source.endsWith('.orig')));
  }
});

test('replay validation rejects bad coordinates, unsupported events, frames and clocks',()=>{
  assert.equal(parseArgs(['run','--input','x.bcm','--input-script','events.json']).inputScript,'events.json');
  for(const e of [
    {frame:0,time_ms:0,type:'keydown',key_code:65},
    {frame:3,time_ms:0,type:'keydown',key_code:65},
    {frame:1,time_ms:-1,type:'keydown',key_code:65},
    {frame:1,time_ms:0,type:'keydown',key_code:256},
    {frame:1,time_ms:0,type:'pointermove',x:Infinity,y:0},
    {frame:1,time_ms:0,type:'pointermove',x:0,y:0,pointer_type:'pen'},
    {frame:1,time_ms:0,type:'swipe'},
  ]) assert.throws(()=>validateInputScript({schema:'nekoc-input-v1',events:[e]},2));
  assert.throws(()=>validateInputScript({schema:'invalid',events:[]}));
  assert.throws(()=>validateInputScript({schema:'nekoc-input-v1',events:[{frame:2,time_ms:20,type:'keydown',key_code:65},{frame:1,time_ms:30,type:'keyup',key_code:65}]},2));
  assert.throws(()=>validateInputScript({schema:'nekoc-input-v1',events:[{frame:1,time_ms:20,type:'keydown',key_code:65},{frame:2,time_ms:10,type:'keyup',key_code:65}]},2));
});

test('KN official input archive binds an editor-checked original fixture',async()=>{
  const e=await readJson('docs/input-kn-evidence.json');
  assert.equal(createHash('sha256').update(await readFile(e.fixture)).digest('hex'),e.fixtureSha256);
  assert.ok(e.samples.find(s=>s.label==='held-180ms').variables['a-down']>1);
  assert.ok(e.editorCompat.ok);
});

test('web alpha picking follows layer order, rotation, scale, pivot and K4 ghost policy',()=>{
  const image={width:80,height:40,alpha:new Uint8Array(3200),centerPoint:{x:0,y:0}};
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)image.alpha[y*80+x]=255;
  const a={id:'a',x:0,y:0,scale:100,direction:0,rotation_type:0,visible:true,opacity:1};
  const r={kitten4:true,actorOrder:['a'],sprites:[a],spriteIndices:new Map([['a',0]]),spriteImage:()=>image};
  const hit=(x,y)=>StageRenderer.prototype.hitTest.call(r,x,y);
  assert.equal(hit(-20,0),'a');assert.equal(hit(20,0),null);
  a.scale=200;a.direction=-90;
  assert.equal(hit(0,-40),'a');assert.equal(hit(0,40),null);
  a.opacity=0;assert.equal(hit(0,-40),'a');r.kitten4=false;assert.equal(hit(0,-40),'a');r.kitten4=true;
  a.visible=false;assert.equal(hit(0,-40),null);a.visible=true;
  a.direction=0;a.scale=100;image.centerPoint.x=20;
  assert.equal(hit(-40,0),'a');assert.equal(hit(0,0),null);
  const b={...a,id:'b',x:0,opacity:1};r.actorOrder.push('b');r.sprites.push(b);r.spriteIndices.set('b',1);
  assert.equal(hit(-40,0),'b');b.visible=false;assert.equal(hit(-40,0),'a');
});

test('official offline DOM input replay reproduces archived variable and actor traces',{
  skip:!process.env.K4_INPUT_INTEGRATION,
},async()=>{
  for(const [name,frames] of [['input',38],['input-transform',8],['input-ghost',4]]) {
    const expected=await readJson(`docs/${name}-evidence.json`);
    const actual=await runOracle(await readJson(`tests/fixtures/kitten4/${name}.bcm`),{frames,inputScript:`tests/fixtures/kitten4/${name}-script.json`});
    assert.deepEqual(JSON.parse(JSON.stringify(actual.frames.map(({frame,variables,actors})=>({frame,variables,actors})))),expected.frames);
    assert.deepEqual(actual.inputObservations,expected.inputObservations);
  }
});
