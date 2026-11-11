import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { overlayFixtures, recordOverlay, OVERLAY_FRAMES } from '../tools/compat/k4-visual-overlay-fixtures.mjs';
import { readJson, saveJson } from '../tools/compat/k4-oracle.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

test('original overlay fixtures are reproducible and use only inline media',async()=>{
  for(const [name,project]of Object.entries(await overlayFixtures())){
    assert.deepEqual(await readJson(`tests/fixtures/kitten4/visual3-overlay-${name}.bcm`),project,name);
    assert.ok(!project.compile_result,'editable native workspace, not copied corpus AST');
    for(const style of Object.values(project.theatre.styles))assert.ok(style.url.startsWith('data:image/svg+xml;base64,'));
    assert.equal(Object.keys(project.variables).length,0);
  }
});

const browser={skip:!process.env.K4_ORACLE_INTEGRATION,timeout:600000};
test('real DOM keeps safe text, stale-click gating and stage input isolation',browser,async()=>{
  const source=await readFile('web/overlay.js','utf8');
  const browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage();
    await page.setContent('<style>#box{position:relative;width:960px;height:720px}</style><div id="box"></div>');
    const result=await page.evaluate(async source=>{
      const {StageOverlay}=await import('data:text/javascript;base64,'+btoa(unescape(encodeURIComponent(source))));
      const answers=[],leaks=[],box=document.getElementById('box');
      for(const type of ['pointerdown','pointerup','keydown','keyup','click'])box.addEventListener(type,e=>leaks.push(e.type));
      const renderer={kitten4:true,width:960,height:720,sprites:[],spriteImage:()=>null};
      const overlay=new StageOverlay(box,renderer,event=>answers.push(event));
      const d={id:8,target:'scene',name:'Scene',text:'<img src=x onerror=alert(1)>',visible_text:'<img',printing:true,more:true};
      overlay.apply({stage_dialog:d});
      const panel=overlay.stageDialog;
      for(const type of ['pointerdown','pointerup','keydown','keyup'])panel.dispatchEvent(new Event(type,{bubbles:true}));
      panel.click();panel.click();
      const label=panel.querySelector('button').textContent;
      overlay.apply({stage_dialog:{...d,visible_text:d.text,printing:false}});
      const safe=panel.querySelector('p').textContent===d.text&&!panel.querySelector('p img');
      panel.click();
      overlay.apply({stage_dialog:null});overlay.reset();
      return{answers,leaks,label,safe,dialogs:box.querySelectorAll('[role=dialog]').length};
    },source);
    assert.deepEqual(result.answers,[{kind:'stage_dialog_click',id:8},{kind:'stage_dialog_click',id:8}]);
    assert.deepEqual(result.leaks,[]);
    assert.equal(result.label,'点击继续');assert.equal(result.safe,true);assert.equal(result.dialogs,0);
  }finally{await browser.close();}
});

test('official overlay geometry, text and DOM pixel regression',browser,async()=>{
  const source=await readFile('web/overlay.js','utf8');
  const overlaySource=source;
  for(const [name,project]of Object.entries(await overlayFixtures())){
    if(name==='choice')continue;
    const evidence=await recordOverlay(project,`${name}-regression`,{compare:true,overlaySource});
    assert.deepEqual(evidence.errors,[],name);
    assert.deepEqual(evidence.samples.map(s=>s.frame),OVERLAY_FRAMES);
    assert.ok(evidence.assets.some(a=>a.sha256==='0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160'));
    for(const sample of evidence.samples){
      if(sample.dialog){
        assert.equal(sample.dialog.next.text,'点击继续');
        assert.equal(sample.dialog.name.x,name==='scene'?42:132);
        assert.equal(sample.dialog.content.y,52);
        assert.equal(sample.dialog.y,sample.height/2-192);
        assert.ok(sample.metrics.changedPercent<.05,`${name}/${sample.frame}: ${sample.metrics.changedPercent}%`);
      }else{
        assert.equal(sample.bubble.text.style.fontSize,'26px');
        assert.equal(sample.bubble.text.style.lineHeight,36);
        assert.ok(sample.metrics.changedPercent<.16,`${name}/${sample.frame}: ${sample.metrics.changedPercent}%`);
      }
    }
  }
});

test('real VM overlay deltas match official fixed-frame pixels',{
  skip:!(process.env.K4_ORACLE_INTEGRATION&&process.env.K4_VISUAL_INTEGRATION),timeout:600000,
},async()=>{
  // No cargo build and no polling: an absent parent-built binary is an explicit failure.
  await access('target/debug/k4-trace.exe');
  const results=[];
  for(const name of Object.keys(await overlayFixtures())){
    const result=await visualWork(`tests/fixtures/kitten4/visual3-overlay-${name}.bcm`,{
      captureFrames:OVERLAY_FRAMES,artifactsDir:'dist/visual3-overlay/real-vm',seed:1,pixelTolerance:8,
    });results.push(result);
    assert.equal(result.status,'captured',result.error);
    for(const frame of result.frames){
      assert.equal(frame.overlay,true);
      assert.ok(frame.changedPercent<(name==='choice'?.8:.2),`${name}/${frame.frame}: ${frame.changedPercent}%`);
    }
  }
  await saveJson('dist/visual3-overlay/real-vm.json',results);
});
