// Kitten 4 takeover: a PICKCAT-style page embeds the official K4 player
// (https://player.codemao.cn/new/<id>, the URL PICKCAT builds for KITTEN4 works).
// The extension must capture the player's own public load response, download the
// plain-JSON published source from creation.codemao.cn, run it in the local Rust
// backend, and restore the original iframe on demand.
// Needs: `node tools/build-extension.mjs`, a running backend on 127.0.0.1:4173,
// and Playwright (NEKOC_NODE_MODULES may point at a node_modules that has it).
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output=path.resolve(process.env.NEKOC_VERIFY_OUT||'dist/verify-extension-k4');await mkdir(output,{recursive:true});
const extension=path.resolve('dist/pickcat-rust'),origin='chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj';
const workId=process.env.NEKOC_K4_WORK||'186831447';
const context=await chromium.launchPersistentContext(`${output}/profile-${Date.now()}`,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={browser:context.browser().version(),workId,tests:[],errors:[]};
const page=await context.newPage();page.setDefaultTimeout(60000);
page.on('pageerror',e=>{if(e.stack?.includes(origin))report.errors.push(e.message);});
page.on('console',m=>{if(m.type()==='error'&&/postMessage|target origin|recipient window/i.test(m.text()))report.errors.push(m.text());});
const fixture='https://pickcat.dao3.fun/works/k4-fixture',playerURL=`https://player.codemao.cn/new/${workId}`;
await context.route(fixture,r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><body style="font:16px system-ui;background:#eee"><h2>Kitten 4 · ${workId}</h2><main style="position:relative;width:1100px;height:700px"><iframe style="width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin" allow="fullscreen" src="${playerURL}"></iframe></main></body></html>`}));
async function rustFrame(){
  await page.locator('iframe').contentFrame().locator('#extension-fps').waitFor({timeout:120000});
  const frame=page.frames().find(f=>f.url().startsWith(origin));
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics?.().busy===false,null,{timeout:120000});
  const state=await frame.evaluate(()=>window.nekoPlayDiagnostics());
  assert.ok(state.playable,await frame.locator('#notice-text').textContent());assert.ok(state.running);return frame;
}
try{
  await page.goto(fixture);let frame=await rustFrame();
  const params=new URL(frame.url()).searchParams;
  assert.equal(params.get('kind'),'k4');assert.equal(params.get('workId'),workId);
  assert.equal(new URL(params.get('bcm')).origin,'https://creation.codemao.cn');
  const before=await frame.evaluate(()=>window.nekoPlayDiagnostics().totalUpdates);
  await frame.waitForFunction(b=>window.nekoPlayDiagnostics().totalUpdates>b+30,before,{timeout:60000});
  report.run=await frame.evaluate(()=>{const d=window.nekoPlayDiagnostics();return {project:d.projectName,updates:d.totalUpdates,vmMs:d.frame?.execute_us/1000};});
  await page.screenshot({path:`${output}/k4-rust.png`});
  report.tests.push('Official K4 player iframe captured; published JSON source downloaded from creation.codemao.cn, imported as Kitten 4 and running in Rust');
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切回原版'}).click();
  assert.equal(await page.locator('iframe').getAttribute('src'),playerURL);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-same-origin');
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切换 Neko'}).click();frame=await rustFrame();
  report.tests.push('Original K4 player URL and sandbox restored; Rust retakes the same iframe');
  assert.deepEqual(report.errors,[]);
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.log('Frames',page.frames().map(f=>f.url()),'errors',report.errors);await page.screenshot({path:`${output}/failure.png`});throw error;}
finally{await context.close();}
