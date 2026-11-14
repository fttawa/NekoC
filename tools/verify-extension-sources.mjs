import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodeProject} from '../extension/resource.js';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output='D:/AppData/Local/Temp/opencode/neko-extension-sources';await mkdir(output,{recursive:true});
const extension=path.resolve('dist/pickcat-rust'),origin='chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj';
const context=await chromium.launchPersistentContext(`${output}/profile-${Date.now()}`,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={browser:context.browser().version(),tests:[],errors:[]};
const page=await context.newPage();page.setDefaultTimeout(60000);
page.on('pageerror',e=>{if(e.stack?.includes(origin))report.errors.push(e.message);});
page.on('console',m=>{if(m.type()==='error'&&/postMessage|target origin|recipient window/i.test(m.text()))report.errors.push(m.text());});
const fixture='https://pickcat.dao3.fun/works/source-fixture',cubeURL='https://kn.codemao.cn/player?type=2&workId=335008960';
await context.route(fixture,r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><body style="font:16px system-ui;background:#eee"><h2>Published source_urls · 335008960</h2><main style="position:relative;width:1100px;height:700px"><iframe style="width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin" allow="fullscreen" src="${cubeURL}"></iframe></main></body></html>`}));
async function rustFrame(){
  await page.locator('iframe').contentFrame().locator('#extension-fps').waitFor();
  const frame=page.frames().find(f=>f.url().startsWith(origin));
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false,null,{timeout:120000});
  const state=await frame.evaluate(()=>window.nekoPlayDiagnostics());
  assert.ok(state.playable,await frame.locator('#notice-text').textContent());assert.ok(state.running);return frame;
}
try{
  await page.goto(fixture);let frame=await rustFrame();
  const resource=new URL(frame.url()).searchParams.get('bcm');
  const text=await(await fetch(resource)).text();assert.ok(!text.trim().startsWith('{'));
  const project=await decodeProject(text);assert.equal(project.projectName,'基于画笔像素显示器的正多边体');
  const ids=Object.keys(project.variables.variablesDict).filter(id=>project.variables.variablesDict[id].type!=='list').sort();
  const slots=Object.fromEntries(ids.map((id,i)=>[id.replace(/^kn-var-/,''),i]));
  const value=name=>frame.evaluate(i=>window.nekoPlayDiagnostics().frame.variables[i],slots[name]);
  const wait=(name,n)=>frame.waitForFunction(({i,n})=>window.nekoPlayDiagnostics().frame?.variables[i]===n,{i:slots[name],n});
  await wait('poly_faces',6);const before=await value('poly_yaw');
  await frame.waitForFunction(({i,before})=>window.nekoPlayDiagnostics().frame.variables[i]!==before,{i:slots.poly_yaw,before});
  await frame.locator('#stage').press('e');await wait('poly_faces',8);
  await frame.locator('#stage').press('Space');await wait('poly_auto',0);
  await frame.locator('#stage').press('Space');await wait('poly_auto',1);
  report.cube=await frame.evaluate(async i=>{
    const start=performance.now(),before=window.nekoPlayDiagnostics().totalUpdates,frames=window.nekoPlayDiagnostics().frame.variables[i];
    await new Promise(resolve=>{function sample(){performance.now()-start>=5000?resolve():requestAnimationFrame(sample);}requestAnimationFrame(sample);});
    const d=window.nekoPlayDiagnostics(),seconds=(performance.now()-start)/1000;
    return {seconds,updatesPerSecond:(d.totalUpdates-before)/seconds,completeFramesPerSecond:(d.frame.variables[i]-frames)/seconds,drawFPS:d.drawFps,project:d.projectName,vmMs:d.frame.execute_us/1000};
  },slots.__pd_frames);
  await page.screenshot({path:`${output}/polyhedron.png`});
  report.tests.push('Real published 335008960: empty bcm_url/source_urls encoded download, decoding, private compilation, moving polyhedron, E changes faces, Space toggles rotation');
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切回原版'}).click();
  assert.equal(await page.locator('iframe').getAttribute('src'),cubeURL);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-same-origin');
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切换 Neko'}).click();frame=await rustFrame();
  report.tests.push('Encoded work restores original URL and sandbox; Rust can retake the same iframe');
  await page.goto('https://pickcat.dao3.fun/forum/post/01a19bdd-b240-7985-a80e-2a753101aaca');
  await page.locator('iframe').waitFor();await page.locator('iframe').scrollIntoViewIfNeeded();frame=await rustFrame();
  assert.equal(new URL(frame.url()).searchParams.get('workId'),'335054503');
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics().frame?.variables[18]===1);
  await frame.locator('#stage').press('Enter');
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics().audio.some(a=>a.time>1&&!a.paused));
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics().frame?.variables[2]>5);
  await frame.waitForFunction(()=>Number(document.querySelector('#fps').textContent)>0);
  report.forum=await frame.evaluate(()=>({project:window.nekoPlayDiagnostics().projectName,audio:window.nekoPlayDiagnostics().audio,fps:document.querySelector('#extension-fps').textContent}));
  await page.screenshot({path:`${output}/forum.png`});
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切回原版'}).click();
  assert.equal(await page.locator('iframe').getAttribute('src'),'https://kn.codemao.cn/player?type=2&workId=335054503');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-same-origin');
  report.tests.push('Actual public forum article: lazy sandboxed embed auto-takes over, initializes, Enter plays animation/audio, bottom-right FPS updates, original URL/sandbox restored');
  assert.deepEqual(report.errors,[]);
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.log('Frames',page.frames().map(f=>f.url()),'errors',report.errors);await page.screenshot({path:`${output}/failure.png`});throw error;}
finally{await context.close();}
