import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output='D:/AppData/Local/Temp/opencode/neko-starhold';await mkdir(output,{recursive:true});
const project=JSON.parse(await readFile('projects/starhold/starhold.bcmkn','utf8'));
const names=Object.keys(project.variables.variablesDict).filter(id=>project.variables.variablesDict[id].type!=='list').sort();
const slots=Object.fromEntries(names.map((name,i)=>[name.replace(/^kn-var-/,''),i]));
const report={tests:[],errors:[]};
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
async function waitVar(name,value){await page.waitForFunction(({i,value})=>window.nekoPlayDiagnostics().frame?.variables[i]===value,{i:slots[name],value});}
async function click(x,y){const box=await page.locator('#stage').boundingBox();await page.mouse.click(box.x+(x+450)/900*box.width,box.y+(281-y)/562*box.height);}
try{
  await page.goto('http://127.0.0.1:4173/play');await page.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false);
  await page.locator('#file').setInputFiles('projects/starhold/starhold.bcmkn');await waitVar('ready',1);
  assert.ok(await page.evaluate(()=>window.nekoPlayDiagnostics().playable));
  await page.screenshot({path:`${output}/title.png`});
  await page.locator('#stage').focus();await page.keyboard.down('Enter');
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame?.variables[i]>5,slots.frames);
  assert.equal(await page.evaluate(i=>window.nekoPlayDiagnostics().frame.variables[i],slots.mode),0);
  await page.keyboard.up('Enter');await waitVar('mode',1);
  report.tests.push('Exact STARHOLD imports; keydown does not fire key-up hat, Enter release selects levels');
  await page.keyboard.press('b');await waitVar('mode',0);await click(0,-62);await waitVar('mode',1);
  await click(-240,55);await waitVar('mode',2);await waitVar('level',1);
  await click(-160,-35);await waitVar('selectedPad',4);
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame.variables[i]<280,slots.gold);
  report.tests.push('Real menu and level-card clicks read stage coordinates; tower pad click builds tower');
  await page.keyboard.press('u');await page.keyboard.press('Space');await waitVar('wave',1);
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame.variables[i]>0,slots.alive);
  await page.keyboard.press('p');await waitVar('paused',1);await page.keyboard.press('p');await waitVar('paused',0);
  report.tests.push('U upgrades, Space starts wave, P pause/resume uses release events');
  report.performance=await page.evaluate(async i=>{
    const start=performance.now(),before=window.nekoPlayDiagnostics().frame.variables[i];
    await new Promise(resolve=>{const sample=()=>performance.now()-start>=5000?resolve():requestAnimationFrame(sample);requestAnimationFrame(sample);});
    const d=window.nekoPlayDiagnostics();return {controllerFPS:(d.frame.variables[i]-before)*1000/(performance.now()-start),drawFPS:d.drawFps,vmMs:d.frame.execute_us/1000,renderer:d.renderer};
  },slots.frames);
  await page.waitForFunction(i=>window.nekoPlayDiagnostics().frame.variables[i]>0,slots.kills);
  report.tests.push('Natural combat damages and kills an enemy');
  await page.screenshot({path:`${output}/game.png`});
  await page.locator('#toggle').click();
  report.renderer=await page.evaluate(async()=>{
    const {StageRenderer}=await import('/renderer.js');
    const renderer=new StageRenderer(document.createElement('canvas'));
    const svg=body=>'data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">${body}</svg>`);
    const p={stageSize:{width:100,height:100},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:['front','back']}}},actors:{actorsDict:{front:{currentStyleId:'red',styles:['red','green'],visible:true},back:{currentStyleId:'blue',styles:['blue'],visible:true}}},styles:{stylesDict:{red:{url:svg('<path fill="red" fill-rule="evenodd" d="M0 0H20V20H0Z M8 8V12H12V8Z"/>')},green:{url:svg('<rect width="20" height="20" fill="lime"/>')},blue:{url:svg('<rect width="20" height="20" fill="blue"/>')}}}};
    await renderer.load(p);
    const gl=renderer.gl,pixel=()=>{const v=new Uint8Array(4);gl.readPixels(55,50,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);return [...v];};
    renderer.apply({sprites:[],pen_layer:0},new Float32Array([-20,0,20,0,5,1,1,0,1]));const bottom=pixel();
    renderer.apply({sprites:[],pen_layer:1},new Float32Array());const middle=pixel();
    renderer.apply({sprites:[],pen_layer:2},new Float32Array());const top=pixel();
    const hitOpaque=renderer.hitTest(5,0),hitHole=renderer.hitTest(0,0);
    renderer.apply({sprites:[{...renderer.sprites[0],style:'green',opacity:.5}],pen_layer:0},new Float32Array());const costume=pixel();
    const result={bottom,middle,top,hitOpaque,hitHole,costume,loadedStyles:renderer.images.size,error:gl.getError()};
    gl.getExtension('WEBGL_lose_context').loseContext();return result;
  });
  assert.deepEqual(report.renderer.bottom,[255,0,0,255]);assert.deepEqual(report.renderer.middle,[255,0,0,255]);assert.deepEqual(report.renderer.top,[255,255,0,255]);
  assert.equal(report.renderer.hitOpaque,'front');assert.equal(report.renderer.hitHole,'back');assert.equal(report.renderer.loadedStyles,3);assert.equal(report.renderer.error,0);
  assert.ok(report.renderer.costume[1]>=127&&report.renderer.costume[2]>=127);
  report.tests.push('GPU readback: front-to-back actor order, pen below/between/above sprites, inactive costume loaded, opacity blend, alpha-aware hit testing');
  assert.deepEqual(report.errors,[]);await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.log('state',await page.evaluate(()=>({diagnostics:window.nekoPlayDiagnostics?.(),notice:document.querySelector('#notice-text')?.textContent})));await page.screenshot({path:`${output}/failure.png`});throw error;}
finally{await browser.close();}
