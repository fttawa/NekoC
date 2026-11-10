import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { layerDialogFixtures } from '../tools/compat/k4-layer-dialog-fixtures.mjs';
import { probe, summarizeProbe } from '../tools/compat/k4-layer-dialog-probe.mjs';
import { readJson } from '../tools/compat/k4-oracle.mjs';
import { command } from '../tools/compat/k4-diff.mjs';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';

test('layer/dialog fixtures reproduce owned inline-media projects',async()=>{
  for(const [name,p]of Object.entries(await layerDialogFixtures()))assert.deepEqual(await readJson(`tests/fixtures/kitten4/layer-dialog-${name}.bcm`),p);
});

test('official clone order and click-to-continue semantics reproduce recorded evidence',{
  skip:!process.env.K4_ORACLE_INTEGRATION,
},async()=>{
  const evidence=await readJson('docs/kitten4-layer-dialog-evidence.json');
  for(const [name,p]of Object.entries(await layerDialogFixtures())){
    const result=await probe(name,p);
    assert.deepEqual(summarizeProbe(result),evidence.cases[name],name);
    assert.deepEqual(result.errors,[]);
    assert.ok(result.kernelAssets.some(a=>a.sha256===evidence.kernel.sha256));
  }
});

test('CLI with no input keeps introduction blocked for all sampled frames',async()=>{
  const exe='target/debug/k4-trace'+(process.platform==='win32'?'.exe':'');
  const trace=JSON.parse(await command(exe,['tests/fixtures/kitten4/layer-dialog-dialog.bcm','--frames','60','--render']));
  assert.equal(trace.frames.length,60);
  assert.ok(trace.frames.every(f=>f.frame.stage_dialog&&f.frame.active>0));
  assert.ok(trace.trace.frames.every(f=>f.variables.after===0&&f.variables.other===1));
});

test('owned clone probes compare real VM layer output with official canvas pixels',{
  skip:!process.env.K4_VISUAL_INTEGRATION,
},async()=>{
  for(const name of ['chain','legacy','front','forward','middle-bottom','split']){
    const work=await visualWork(`tests/fixtures/kitten4/layer-dialog-${name}.bcm`,{
      captureFrames:[1,30,60],artifactsDir:'dist/visual2/pixel-regression',
    });
    assert.equal(work.status,'captured',work.error);
    for(const frame of work.frames)assert.ok(frame.changedPercent<.02,`${name}/${frame.frame}: ${frame.changedPercent}`);
  }
});

test('web dialog is safe text, consumes project input and emits explicit acknowledgements',{
  skip:!process.env.K4_VISUAL_BROWSER,
},async()=>{
  const source=await readFile('web/overlay.js','utf8');
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/overlay.js'?'application/javascript':'text/html');
    res.end(req.url==='/overlay.js'?source:'<!doctype html><div id="box" style="position:relative;width:960px;height:720px"></div>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async()=>{
      const {StageOverlay}=await import('/overlay.js');window.sent=[];window.leaked=[];
      const box=document.querySelector('#box');
      window.overlay=new StageOverlay(box,{sprites:[],spriteImage:()=>null},e=>window.sent.push(e));
      for(const type of ['click','pointerdown','pointerup','mousedown','mouseup','keydown','keyup'])box.addEventListener(type,e=>window.leaked.push(e.type));
      window.frame={stage_dialog:{id:7,target:'s',name:'<img onerror=alert(1)>',text:'<b>Hello</b>',visible_text:'<b>',printing:true,more:false}};
      overlay.apply(frame);
    });
    assert.equal(await page.locator('[role=dialog] b').innerText(),'<img onerror=alert(1)>');
    assert.equal(await page.locator('[role=dialog] b img').count(),0);
    await page.locator('[role=dialog] button').click();
    await page.evaluate(()=>{overlay.apply({...frame,stage_dialog:{...frame.stage_dialog,printing:false,visible_text:frame.stage_dialog.text}});});
    assert.equal(await page.locator('[role=dialog] p').innerText(),'<b>Hello</b>');
    await page.locator('[role=dialog] button').press('Enter');
    const result=await page.evaluate(()=>({sent,leaked}));
    assert.deepEqual(result.sent,[{kind:'stage_dialog_click',id:7},{kind:'stage_dialog_click',id:7}]);
    assert.deepEqual(result.leaked,[]);
    await page.evaluate(()=>overlay.apply({}));assert.equal(await page.locator('[role=dialog]').count(),0);
    await page.evaluate(()=>{overlay.apply(frame);overlay.reset();});assert.equal(await page.locator('[role=dialog]').count(),0);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
