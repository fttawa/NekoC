import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output='D:/AppData/Local/Temp/opencode/nekoc-pure-player';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
page.on('websocket',socket=>socket.on('framesent',event=>{try{requests.push(JSON.parse(event.payload));}catch{}}));
const report={tests:[],errors};
try{
  await page.goto('http://127.0.0.1:4173/play');await page.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false);
  assert.equal(await page.locator('#blocks').count(),0);
  const chooser=page.waitForEvent('filechooser');await page.locator('#import').click();await(await chooser).setFiles('samples/pencraft.bcmkn');
  await page.waitForFunction(()=>window.nekoPlayDiagnostics().frame?.variables[13]>=5);
  const before=await page.evaluate(()=>window.nekoPlayDiagnostics().frame.variables[29]);
  await page.locator('#stage').focus();await page.keyboard.down('w');
  await page.waitForFunction(before=>Math.abs(window.nekoPlayDiagnostics().frame.variables[29]-before)>.1,before);await page.keyboard.up('w');
  await page.keyboard.press('h');await page.waitForFunction(()=>window.nekoPlayDiagnostics().frame.variables[15]===0);
  if(!await page.locator('#frame-limit').isVisible())await page.locator('#settings-toggle').click();await page.locator('#frame-limit').selectOption('30');await page.locator('#budget').selectOption('8');
  await page.waitForFunction(()=>window.nekoPlayDiagnostics().totalUpdates>20);
  await page.waitForFunction(()=>Number(document.querySelector('#fps').textContent)>0);
  const rate=await page.evaluate(async()=>{
    const start=performance.now(),count=window.nekoPlayDiagnostics().totalUpdates;
    await new Promise(resolve=>{const sample=()=>performance.now()-start<1200?requestAnimationFrame(sample):resolve();requestAnimationFrame(sample);});
    return (window.nekoPlayDiagnostics().totalUpdates-count)*1000/(performance.now()-start);
  });
  assert.ok(rate>5&&rate<=33,`30/s limiter observed ${rate}`);
  await page.locator('#toggle').click();await page.waitForFunction(()=>!window.nekoPlayDiagnostics().pending);
  const paused=await page.evaluate(()=>window.nekoPlayDiagnostics());
  await page.locator('#resolution').selectOption('0.5');
  assert.deepEqual(await page.evaluate(()=>window.nekoPlayDiagnostics().framebuffer),[320,180]);
  await page.locator('#resolution').selectOption('2');
  assert.deepEqual(await page.evaluate(()=>window.nekoPlayDiagnostics().framebuffer),[1280,720]);
  const resized=await page.evaluate(()=>window.nekoPlayDiagnostics());assert.equal(resized.totalUpdates,paused.totalUpdates);assert.deepEqual(resized.frame.variables,paused.frame.variables);
  await page.locator('#resolution').selectOption('1');
  // Capture newly drawn native-resolution pixels after the intentional downscale test.
  await page.locator('#toggle').click();
  await page.waitForFunction(count=>window.nekoPlayDiagnostics().totalUpdates>count+40,paused.totalUpdates);
  await page.screenshot({path:path.join(output,'performance.png')});
  await page.locator('#settings-toggle').click();await page.screenshot({path:path.join(output,'player.png')});
  await page.locator('#toggle').click();await page.waitForFunction(()=>!window.nekoPlayDiagnostics().pending);
  assert.ok(requests.some(request=>request.budget_ms===8));
  report.tests.push('Pencraft chooser import/autoplay, held keyboard, live FPS, 30/s limiter, transmitted CPU budget, pause, non-destructive resolution changes');
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);
  await page.locator('#toggle').click();await page.waitForFunction(count=>window.nekoPlayDiagnostics().totalUpdates>count,resized.totalUpdates);
  await page.locator('#restart').click();await page.waitForFunction(()=>window.nekoPlayDiagnostics().frame?.variables[15]===1);
  await page.waitForFunction(()=>window.nekoPlayDiagnostics().frame?.variables[13]>=3);
  report.tests.push('fullscreen enter/exit, resume and clean restart');
  await page.locator('#toggle').click();await page.waitForFunction(()=>!window.nekoPlayDiagnostics().pending);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const fits=await page.evaluate(()=>{const s=document.querySelector('#stage').getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect();return s.width<=v.width+1&&s.height<=v.height+1;});assert.ok(fits);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#file').setInputFiles({name:'bad.bcmkn',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await page.waitForFunction(()=>!document.querySelector('#notice').hidden&&!window.nekoPlayDiagnostics().busy);
  assert.ok((await page.locator('#project-name').textContent()).startsWith('PENCRAFT'));
  await page.locator('#dismiss').click();
  const native=await readFile('samples/kitten4-demo.bcm','utf8');
  await page.evaluate(text=>{const dt=new DataTransfer();dt.items.add(new File([text],'demo.bcm',{type:'application/json'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt}));},native);
  await page.waitForFunction(()=>window.nekoPlayDiagnostics().running&&!window.nekoPlayDiagnostics().projectName.startsWith('PENCRAFT'));
  report.tests.push('responsive fit, invalid import preserves current game, native Kitten4 drag/drop playback');
  // A static pen surface must survive downscale/upscale with no VM replay.
  report.resize=await page.evaluate(async()=>{
    const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.createElement('canvas'));
    await r.load({stageSize:{width:100,height:100},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]}}},actors:{actorsDict:{}}});
    r.apply({clear:true,sprites:[]},new Float32Array([-30,0,30,0,20,1,0,0,1]));
    const results=[];
    for(const scale of [.5,2,1]){r.setResolution(scale);const gl=r.gl,pixel=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(r.canvas.width/2,r.canvas.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);results.push({scale,pixel:[...pixel],error:gl.getError()});}
    r.gl.getExtension('WEBGL_lose_context').loseContext();return results;
  });
  for(const result of report.resize){assert.deepEqual(result.pixel,[255,0,0,255]);assert.equal(result.error,0);}
  report.tests.push('persistent pen framebuffer pixel readback survives 0.5x/2x/1x');
  await page.reload();await page.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false);
  assert.deepEqual(await page.evaluate(()=>window.nekoPlayDiagnostics().settings),{limit:30,budget:8,resolution:1,coalesce:0});
  report.tests.push('performance preferences survive reload');
  assert.deepEqual(errors,[]);report.limitedUpdatesPerSecond=rate;
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
