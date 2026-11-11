import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects7Fixtures, effectTypes } from '../tools/compat/k4-partial-effects-7-fixtures.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
import { StageRenderer } from '../web/renderer.js';
import { createServer } from 'node:http';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const fixtures=await partialEffects7Fixtures();

test('round 7 fixtures are original editable workspaces and pin all five effect spellings',async()=>{
  for(const [name,spec]of Object.entries(fixtures)){
    assert.deepEqual(await read(`tests/fixtures/kitten4/partial-effects-7-${name}.bcm`),spec.project,name);
    for(const style of Object.values(spec.project.theatre.styles))assert.match(style.url,/^data:image\/svg\+xml;base64,/);
    assert.equal(spec.project.compile_result,undefined);
  }
  for(const type of effectTypes){assert.ok(fixtures[type]);assert.ok(fixtures[`${type}-pixelate`]);}
});

test('historical round-7 VM evidence binds the round-8 baseline and retains full unmasked failure records',async()=>{
  const report=await read('docs/kitten4-partial-effects-7-pixels.json');
  assert.equal(report.rendererLfSha256,(await read('docs/kitten4-partial-effects-8-baseline.json')).rendererLfSha256);
  assert.match(report.executableSha256,/^[0-9a-f]{64}$/);
  for(const [name,spec]of Object.entries(fixtures)){
    const record=report.cases[name];assert.equal(record.status,'captured',record.error);
    assert.equal(record.sha256,hash(JSON.stringify(spec.project,null,2)+'\n'),name);
    assert.equal(record.rendererLfSha256,report.rendererLfSha256,name);
    assert.equal(record.frames.length,spec.frames,name);
    assert.ok(record.kernelAssets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    for(const f of record.frames){assert.equal(f.pixels,960*720);assert.equal(f.maskedPixels,0);assert.equal(f.tolerance,8);}
  }
  for(const type of effectTypes)for(const name of [type,`${type}-pixelate`])assert.ok(report.cases[name].frames.every(f=>f.changedPixels===0),name);
  for(const name of ['pixelate-fractional','pixelate-rotate','twist','twist-rotate','twist-fractional','twist-pivot','pixelate-twist','color-pixelate-twist','change-decrease','scene-common'])assert.ok(report.cases[name].frames.every(f=>f.changedPixels===0),name);
  for(const name of ['ascii','ripple','spatial-offstage','scene-spatial'])assert.ok(report.cases[name].frames.some(f=>f.changedPixels>0),name+' known gap must remain visible');
  assert.deepEqual(report.cases['spatial-offstage'].frames.map(f=>f.changedPixels),[0,0,3795,3795,0,0]);
  assert.deepEqual(report.cases['scene-spatial'].frames.map(f=>f.changedPixels),[0,0,86021,86021,0,0]);
});

test('shader isolation retains native observations, pass geometry and offline diagnostics, without substituting for VM evidence',async()=>{
  const report=await read('docs/kitten4-partial-effects-7-renderer.json');
  assert.match(report.scope,/NOT NekoC VM evidence/);
  assert.equal(report.rendererLfSha256,(await read('docs/kitten4-partial-effects-8-baseline.json')).rendererLfSha256);
  for(const [name,record]of Object.entries(report.cases)){
    assert.equal(record.observations.length,fixtures[name].frames);assert.deepEqual(record.errors,[],name);
    assert.ok(record.events.some(e=>e.block==='start'),name+' real VM execution');
    assert.ok(record.externalRequests.every(r=>r.action==='blocked'),name+' offline');
    assert.equal(record.sha256,hash(JSON.stringify(fixtures[name].project,null,2)+'\n'));
  }
  const pixel=report.cases['self_set_effect_2-pixelate'].filterSamples.find(f=>f.index===2&&f.frame===1);
  assert.deepEqual(pixel.inputFrame,{x:397,y:295,width:192,height:144});assert.deepEqual(pixel.size,[9,9]);
  const twist=report.cases.twist.filterSamples.find(f=>f.index===4&&f.frame===1);
  assert.equal(twist.padding,20);assert.equal(twist.radius,120);assert.deepEqual(twist.offset,{x:493,y:367});
  assert.ok(Math.abs(twist.angle-650*Math.PI/180)<1e-12);
});

test('baseline proves actual shader regressions rather than only post-fix screenshots',async()=>{
  const before=await read('docs/kitten4-partial-effects-7-baseline.json'),after=await read('docs/kitten4-partial-effects-7-pixels.json');
  assert.match(before.baselineCommit,/^[0-9a-f]{40}$/);
  for(const name of ['self_set_effect_2','self_set_effect_2-pixelate','twist']){
    assert.equal(before.cases[name].sha256,after.cases[name].sha256);
    assert.ok(before.cases[name].frames.some(f=>f.changedPixels>1000),name);
    assert.ok(after.cases[name].frames.every(f=>f.changedPixels===0),name);
  }
});

test('screen-space passes dispatch only for K4 spatial filters and guard recursion',()=>{
  const r={kitten4:true,k4Filtering:false,drawK4SpatialTexture:(...args)=>args};
  const fx=[0,0,0,9,0,0,0,0];
  assert.deepEqual(StageRenderer.prototype.drawTexture.call(r,'texture',1,2,3,4,0,[1,1,1,1],fx,[3,4]),['texture',1,2,3,4,0,[1,1,1,1],fx,[3,4],null,null]);
  // KN continues through the existing shader; a missing GL context proves it
  // did not incorrectly enter the K4-only dispatch above.
  assert.throws(()=>StageRenderer.prototype.drawTexture.call({...r,kitten4:false},'texture',1,2,3,4,0,[1,1,1,1],fx),TypeError);
  assert.throws(()=>StageRenderer.prototype.drawTexture.call({...r,k4Filtering:true},'texture',1,2,3,4,0,[1,1,1,1],fx),TypeError);
});

test('WebGL filter passes restore target/viewport, reuse bounded surfaces, and leave KN allocation-free',{
  skip:!process.env.K4_EFFECTS7_BROWSER,timeout:60000,
},async()=>{
  const sources={'/renderer.js':await readFile('web/renderer.js','utf8'),'/pen-k4.js':await readFile('web/pen-k4.js','utf8')};
  const server=createServer((req,res)=>{res.setHeader('Content-Type',sources[req.url]?'application/javascript':'text/html');res.end(sources[req.url]||'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
      const url='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#c34165"/><rect width="21" height="37" fill="#268954"/></svg>');
      const project={_nekocKitten4:true,stageSize:{width:160,height:120},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]}}},actors:{actorsDict:{}},styles:{stylesDict:{c:{url}}}};
      // load all styles through the scene's declared style list.
      project.scenes.scenesDict.s.styles=['c'];await r.load(project);
      const gl=r.gl,target=r.makeSurface(160,120),image=r.images.get('c');
      const draw=effects=>r.drawTexture(image.texture,0,0,64,48,0,[1,1,1,.65],effects,[64,48]);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);gl.viewport(2,3,151,111);
      gl.scissor(1,2,150,110);
      r.kitten4=false;draw([65,0,30,9,0,40,60]);const knBytes=r.stats.k4FilterBytes;
      r.kitten4=true;draw([65,0,30,9,0,40,60]);
      const restored=gl.getParameter(gl.FRAMEBUFFER_BINDING)===target.framebuffer,viewport=[...gl.getParameter(gl.VIEWPORT)],scissor=[...gl.getParameter(gl.SCISSOR_BOX)],scissorEnabled=gl.isEnabled(gl.SCISSOR_TEST);
      const first=[...r.k4FilterCache.values()][0].surfaces[0].texture;
      draw([65,0,30,9,0,40,60]);const reused=[...r.k4FilterCache.values()][0].surfaces[0].texture===first;
      for(let i=0;i<8;i++)r.drawTexture(image.texture,0,0,40+i,30+i,0,[1,1,1,1],[0,0,0,9,0,40,0],[64,48]);
      gl.enable(gl.SCISSOR_TEST);gl.scissor(5,6,140,100);
      draw([0,0,0,0,0,0,0,8]);
      const enabledScissorRestored=gl.isEnabled(gl.SCISSOR_TEST)&&[...gl.getParameter(gl.SCISSOR_BOX)].join(',')==='5,6,140,100';
      gl.disable(gl.SCISSOR_TEST);
      const entries=r.k4FilterCache.size,bytes=r.stats.k4FilterBytes,error=gl.getError();
      await r.load(project);return {restored,viewport,scissor,scissorEnabled,enabledScissorRestored,reused,entries,bytes,error,knBytes,resetBytes:r.stats.k4FilterBytes};
    });
    assert.equal(result.knBytes,0);assert.equal(result.restored,true);assert.deepEqual(result.viewport,[2,3,151,111]);assert.equal(result.reused,true);
    assert.deepEqual(result.scissor,[1,2,150,110]);assert.equal(result.scissorEnabled,false);assert.equal(result.enabledScissorRestored,true);
    assert.ok(result.entries<=4);assert.ok(result.bytes>0&&result.bytes<=32*1024*1024);assert.equal(result.error,0);assert.equal(result.resetBytes,0);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('live official/NekoC real-VM regression without Cargo',{
  skip:!process.env.K4_EFFECTS7_INTEGRATION,timeout:600000,
},async()=>{
  for(const name of ['self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2','pixelate-fractional','pixelate-rotate','twist','pixelate-twist']){
    const r=await visualWork(`tests/fixtures/kitten4/partial-effects-7-${name}.bcm`,{nekoc:path.resolve('target/debug/k4-trace.exe'),audioMetadata:true,captureFrames:[1,3,5],pixelTolerance:8,artifactsDir:'dist/partial-effects-7/regression'});
    assert.equal(r.status,'captured',r.error);assert.equal(r.frames.length,3);
    assert.ok(r.frames.every(f=>f.changedPixels===0),name);
  }
});
