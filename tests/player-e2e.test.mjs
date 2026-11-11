import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {loadPlaywright} from '../tools/probe-kitten4.mjs';

// Real Rust HTTP + WebSocket backend and WebGL renderer, with owned inline assets.
// Failure injection only replaces explicitly selected HTTP responses.
test('standalone player browser E2E', {skip:!process.env.NEKOC_PLAYER_E2E,timeout:120000}, async t=>{
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const child=spawn(process.env.NEKOC_WEB_BIN||'target/debug/web.exe',['tests/fixtures/kitten4/visual-stamp.bcm','--port',String(port)],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  let spawnError;child.on('error',error=>{spawnError=error;});
  let browser;
  const origin=`http://127.0.0.1:${port}`;
  try{
    for(let i=0;;i++){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null||i>=200)throw Error(`Backend failed: ${output}`);
      try{if((await fetch(`${origin}/api/project`)).ok)break;}catch{}
      await delay(50);
    }
    browser=await loadPlaywright().chromium.launch({headless:true,channel:process.env.NEKOC_BROWSER_CHANNEL||'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.sent=[];const send=WebSocket.prototype.send;
      WebSocket.prototype.send=function(data){if(typeof data==='string')window.sent.push(JSON.parse(data));return send.call(this,data);};
    });
    const ready=()=>page.waitForFunction(()=>window.nekoPlayDiagnostics&&!window.nekoPlayDiagnostics().busy);
    const running=()=>page.waitForFunction(()=>window.nekoPlayDiagnostics().running&&window.nekoPlayDiagnostics().totalUpdates>0);
    const fit=async()=>{
      await page.waitForFunction(()=>{
        const stage=document.querySelector('#stage').getBoundingClientRect(),area=document.querySelector('#viewport').getBoundingClientRect();
        return stage.width>0&&Math.abs(stage.width/stage.height-4/3)<.01&&stage.width<=area.width+1&&stage.height<=area.height+1&&Math.abs(stage.x+stage.width/2-area.x-area.width/2)<1;
      });
      assert.equal(await page.locator('#viewport').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
    };
    await t.test('start, pause, resume, restart, FPS and keyboard focus',async()=>{
      await page.goto(`${origin}/play`);await ready();await fit();
      assert.equal(await page.locator('#loading').isVisible(),false);
      await page.locator('#toggle').click();await running();
      assert.equal(await page.locator('#stage').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.down('ArrowRight');await page.locator('#settings-toggle').click();
      await page.waitForFunction(()=>window.sent.some(v=>v.events?.some(e=>e.kind==='key'&&e.key==='39'&&!e.down)));
      await page.keyboard.up('ArrowRight');
      await page.locator('#toggle').click();
      await page.waitForFunction(()=>!window.nekoPlayDiagnostics().running&&!window.nekoPlayDiagnostics().pending);
      const count=await page.evaluate(()=>window.nekoPlayDiagnostics().totalUpdates);await delay(100);
      assert.equal(await page.evaluate(()=>window.nekoPlayDiagnostics().totalUpdates),count);
      await page.locator('#toggle').click();await running();
      await page.locator('#restart').click();await running();
      await page.waitForFunction(()=>document.querySelector('#fps').textContent!=='—');
      await page.locator('#coverage').click();assert.equal(await page.locator('#coverage-dialog').isVisible(),true);
      const keysBefore=await page.evaluate(()=>window.sent.flatMap(v=>v.events||[]).filter(e=>e.kind==='key'&&e.down).length);
      await page.keyboard.press('a');
      assert.equal(await page.evaluate(()=>window.sent.flatMap(v=>v.events||[]).filter(e=>e.kind==='key'&&e.down).length),keysBefore);
      const report=JSON.parse(await page.locator('#report-content').textContent());
      assert.equal(report.kind,'nekoc-player-import-diagnostics-v1');assert.equal(report.project,undefined);
      const downloadPromise=page.waitForEvent('download');await page.locator('#report-download').click();
      assert.equal((await downloadPromise).suggestedFilename(),'neko-player-diagnostics.json');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#coverage').evaluate(el=>el===document.activeElement),true);
    });
    await t.test('fullscreen and blocked fullscreen have actionable UI',async()=>{
      await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);await fit();
      // fullscreenElement changes before the asynchronous fullscreenchange event.
      await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-label')==='退出全屏');
      assert.equal(await page.locator('#fullscreen').getAttribute('aria-label'),'退出全屏');
      await page.locator('#coverage').click();assert.equal(await page.locator('#coverage-dialog').isVisible(),true);await page.locator('#report-close').click();
      await page.locator('#fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);
      await page.evaluate(()=>{document.querySelector('#player-shell').requestFullscreen=()=>Promise.reject(Error('blocked'));});
      await page.locator('#fullscreen').click();assert.match(await page.locator('#notice-text').textContent(),/无法进入全屏/);
    });
    await t.test('background pause and disconnected runtime can be restarted',async()=>{
      await page.evaluate(()=>{
        Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;
      });
      assert.equal(await page.evaluate(()=>window.nekoPlayDiagnostics().running),false);
      assert.match(await page.locator('#status').textContent(),/后台/);
      await page.locator('#toggle').click();await running();
      await page.evaluate(()=>{
        const send=WebSocket.prototype.send;
        WebSocket.prototype.send=function(data){WebSocket.prototype.send=send;this.close();throw Error('测试断线');};
      });
      await page.waitForFunction(()=>!window.nekoPlayDiagnostics().running);
      assert.match(await page.locator('#status').textContent(),/中断/);
      await page.locator('#restart').click();await running();
    });
    await t.test('malformed file and backend rejection recover without replacing last report',async()=>{
      await page.locator('#file').setInputFiles({name:'broken.bcm',mimeType:'application/json',buffer:Buffer.from('{')});await ready();
      assert.match(await page.locator('#notice-text').textContent(),/无法读取作品「broken.bcm」/);
      await page.locator('#file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await ready();
      assert.match(await page.locator('#status').textContent(),/操作失败/);assert.equal(await page.locator('#import').isEnabled(),true);
    });
    await t.test('indeterminate fetch, resource progress, aggregate failures and unsupported coverage',async()=>{
      let release;const gate=new Promise(resolve=>{release=resolve;});
      await page.route('**/api/project',async route=>{await gate;await route.continue();});
      await page.goto(`${origin}/play`,{waitUntil:'domcontentloaded'});
      await page.locator('#loading').waitFor({state:'visible'});
      assert.equal(await page.locator('#load-progress').getAttribute('value'),null);release();await ready();await page.unroute('**/api/project');
      const response=await page.request.post(`${origin}/api/import-player`,{data:await(await page.request.get(`${origin}/api/project`)).json()});
      const report=await response.json();
      const project=report.project,scene=project.scenes.scenesDict[project.scenes.currentSceneId];
      scene.styles=['bad-a','bad-b'];scene.currentStyleId='bad-a';
      project.styles.stylesDict['bad-a']={name:'坏图 A',url:`${origin}/bad-a.png`};project.styles.stylesDict['bad-b']={name:'坏图 B',url:`${origin}/bad-b.png`};
      report.fast_runtime_ready=false;report.runtime_error='测试：不支持的积木';report.script_diagnostics=[];
      await page.route('**/api/import-player',route=>route.fulfill({json:report}));
      let releaseAsset;const assetGate=new Promise(resolve=>{releaseAsset=resolve;});
      await page.route('**/bad-*.png',async route=>{await assetGate;await route.fulfill({status:404,body:'missing'});});
      await page.goto(`${origin}/play`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#load-label').textContent.includes('加载图片'));
      assert.ok(Number(await page.locator('#load-progress').getAttribute('max'))>=2);releaseAsset();await ready();
      const notice=await page.locator('#notice-text').textContent();assert.match(notice,/坏图 A/);assert.match(notice,/坏图 B/);
      assert.equal(await page.locator('#toggle').isEnabled(),false);await page.locator('#coverage').click();
      assert.ok(JSON.parse(await page.locator('#report-content').textContent()).resource_errors.length>=2);
      await page.locator('#report-close').click();await page.unroute('**/api/import-player');await page.unroute('**/bad-*.png');
      await page.route('**/api/project',route=>route.fulfill({status:503,body:'unavailable'}));await page.reload();await ready();
      assert.match(await page.locator('#notice-text').textContent(),/HTTP 503/);assert.equal(await page.locator('#import').isEnabled(),true);
      await page.unroute('**/api/project');
    });
    await t.test('portrait and landscape touch maps to stage, without scrolling',async()=>{
      const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      await mobile.addInitScript(()=>{
        window.touchFrames=[];const send=WebSocket.prototype.send;
        WebSocket.prototype.send=function(data){if(typeof data==='string')window.touchFrames.push(JSON.parse(data));return send.call(this,data);};
      });
      const phone=await mobile.newPage();await phone.goto(`${origin}/play?app`);
      await phone.waitForFunction(()=>window.nekoPlayDiagnostics?.().running);
      for(const viewport of [{width:390,height:844},{width:844,height:390}]){
        await phone.setViewportSize(viewport);
        await phone.waitForFunction(()=>{
          const r=document.querySelector('#stage').getBoundingClientRect();return Math.abs(r.width/r.height-4/3)<.01&&r.width<=innerWidth&&r.height<=innerHeight;
        });
        const box=await phone.locator('#stage').boundingBox();await phone.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await phone.waitForFunction(()=>window.touchFrames.some(frame=>frame.events?.some(event=>event.kind==='pointer'&&event.state==='mouse_click'&&Math.abs(event.x)<2&&Math.abs(event.y)<2)));
        assert.equal(await phone.evaluate(()=>scrollY),0);
        assert.equal(await phone.locator('#stage').evaluate(el=>getComputedStyle(el).touchAction),'none');
        assert.equal(await phone.locator('#settings-toggle').isVisible(),true);
        await phone.evaluate(()=>{window.touchFrames=[];});
      }
      // Normal mobile shell must also keep controls inside the short viewport.
      await phone.goto(`${origin}/play`);await phone.waitForFunction(()=>window.nekoPlayDiagnostics&&!window.nekoPlayDiagnostics().busy);
      const controls=await phone.locator('#toggle').boundingBox();assert.ok(controls.y>=0&&controls.y+controls.height<=390);
      await phone.locator('#toggle').tap();await phone.waitForFunction(()=>window.nekoPlayDiagnostics().running);
      await phone.setViewportSize({width:390,height:844});
      await phone.waitForFunction(()=>{
        const stage=document.querySelector('#stage').getBoundingClientRect(),area=document.querySelector('#viewport').getBoundingClientRect();
        return Math.abs(stage.width/stage.height-4/3)<.01&&stage.width<=area.width+1&&stage.height<=area.height+1;
      });
      await mobile.close();
    });
    await t.test('overlay questions and dialogs own focus without stealing toolbar focus',async()=>{
      await page.goto(`${origin}/play`);await ready();await page.locator('#toggle').click();await running();
      await page.evaluate(async()=>{
        const {StageOverlay}=await import('/overlay.js');window.testOverlay=new StageOverlay(document.querySelector('#stage-box'),{canvas:document.querySelector('#stage'),sprites:[]},()=>{});
        window.testOverlay.showAsk({id:'q',question:'姓名？'});
      });
      await page.waitForFunction(()=>document.activeElement?.matches('.neko-ask input'));
      await page.keyboard.type('abc');await page.keyboard.press('Enter');
      await page.locator('#coverage').focus();await page.evaluate(()=>window.testOverlay.showAsk({id:'q2',question:'选择',choices:['甲','乙']}));
      assert.equal(await page.locator('#coverage').evaluate(el=>el===document.activeElement),true);
      await page.evaluate(()=>{window.testOverlay.reset();document.querySelector('#stage').focus();window.testOverlay.showStageDialog({id:'d',name:'对话',text:'继续'});});
      await page.waitForFunction(()=>document.activeElement?.matches('.neko-stage-dialog button'));
      await page.evaluate(()=>window.testOverlay.showStageDialog(null));
      assert.equal(await page.locator('#stage').evaluate(el=>el===document.activeElement),true);
    });
    assert.deepEqual(errors,[]);await context.close();
  }finally{
    await browser?.close();
    if(child.exitCode===null&&!spawnError){child.kill();await once(child,'exit');}
  }
});
