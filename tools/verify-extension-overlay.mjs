import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output='D:/AppData/Local/Temp/opencode/neko-extension-overlay';await mkdir(output,{recursive:true});
const extension=path.resolve('dist/pickcat-rust'),origin='chrome-extension://aghbhbjmpgklpbgoeopacommcdjmeghj';
const fixture='https://pickcat.dao3.fun/works/overlay-fixture',official='https://kn.codemao.cn/player?type=2&workId=123';
const bcm='https://creation.bcmcdn.com/neko-overlay-fixture.bcmkn';
const encodedBcm='https://creation.bcmcdn.com/neko-encoded-fixture.bcmkn';
const project=JSON.parse(await readFile('samples/native-studio.bcmkn','utf8'));
project.actors.actorsDict.sprite.nekoBlockJsonList=[{type:'on_running_group_activated',next:{type:'repeat_forever',statements:{DO:{type:'self_rotate',inputs:{degrees:{type:'math_number',fields:{NUM:1}}}}}}}];
const iv=randomBytes(12),key=createHash('sha256').update(Buffer.from(Array.from({length:31},(_,i)=>i))).digest();
const cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(JSON.stringify(project),'utf8'),cipher.final()]);
const encoded=Buffer.concat([iv,ciphertext,cipher.getAuthTag()]).toString('base64').split('').reverse().join('');
const context=await chromium.launchPersistentContext(`${output}/profile-${Date.now()}`,{channel:'chromium',headless:true,viewport:{width:1280,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={browser:context.browser().version(),tests:[],errors:[]};
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',message=>{if(message.type()==='error'&&/postMessage|target origin|recipient window/i.test(message.text()))report.errors.push(message.text());});
let releaseNavigation;const navigationGate=new Promise(resolve=>{releaseNavigation=resolve;});
let officialLoads=0,detailRequests=0;
await context.route(fixture,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px system-ui;background:#e9eee9"><h2>PICKCAT extension UI verification</h2><main style="position:relative;width:1000px;height:640px"><h3>等待播放器</h3></main></body></html>'}));
await context.route('https://kn.codemao.cn/player?*',async route=>{
  if(++officialLoads===1)await navigationGate;
  const id=new URL(route.request().url()).searchParams.get('workId');
  const endpoint=`/neko/community/player/published-work-detail/${id}`;
  const request=id==='124'?`const xhr=new XMLHttpRequest();xhr.open('GET','${endpoint}');xhr.onload=()=>{window.detailLoaded=true;};xhr.send();`:`fetch('${endpoint}').then(r=>r.json()).then(()=>{window.detailLoaded=true;});`;
  await route.fulfill({contentType:'text/html',body:`<!doctype html><h2>Official player fixture</h2><script>${request}</script>`});
});
await context.route('https://kn.codemao.cn/neko/community/player/published-work-detail/*',route=>{
  detailRequests++;
  const id=new URL(route.request().url()).pathname.split('/').pop();
  const detail=id==='124'?{bcm_url:'',source_urls:['https://example.invalid/not-allowed.bcmkn',encodedBcm]}:id==='125'?{bcm_url:'',source_urls:[]}:{bcm_url:bcm};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(detail)});
});
await context.route(bcm,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(project)}));
await context.route(encodedBcm,route=>route.fulfill({contentType:'text/plain',body:encoded}));
async function rustFrame(){
  await page.locator('iframe').contentFrame().locator('#extension-fps').waitFor();
  const frame=page.frames().find(f=>f.url().startsWith(origin));
  await frame.waitForFunction(()=>window.nekoPlayDiagnostics?.().running);return frame;
}
async function officialFrame(){
  await page.waitForFunction(url=>document.querySelector('iframe')?.src===url,official);
  await page.locator('iframe').contentFrame().getByText('Official player fixture').waitFor();
  const frame=page.frames().find(f=>f.url()===official);
  await frame.waitForFunction(()=>window.detailLoaded);return frame;
}
async function overlayLayout(frame){
  return frame.evaluate(()=>{
    const fps=document.querySelector('#extension-fps'),viewport=document.querySelector('#viewport'),hint=document.querySelector('#takeover-hint');
    const a=fps.getBoundingClientRect(),b=viewport.getBoundingClientRect();
    const hit=document.elementFromPoint(a.x+a.width/2,a.y+a.height/2);
    return {right:b.right-a.right,bottom:b.bottom-a.bottom,pointerEvents:getComputedStyle(fps).pointerEvents,hintPointerEvents:getComputedStyle(hint).pointerEvents,clickThrough:!fps.contains(hit),value:fps.textContent,toolbarFPS:document.querySelector('.toolbar #fps')!==null};
  });
}
function checkLayout(layout){
  assert.ok(layout.right>=9&&layout.right<14&&layout.bottom>=9&&layout.bottom<14,JSON.stringify(layout));
  assert.equal(layout.pointerEvents,'none');assert.equal(layout.hintPointerEvents,'none');assert.ok(layout.clickThrough);assert.equal(layout.toolbarFPS,false);
}
try{
  await page.goto(fixture);
  const injection=page.locator('[data-neko-injection]');
  await injection.getByText('✓ Neko 扩展已植入').waitFor();
  assert.equal(await injection.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  await page.screenshot({path:`${output}/injected.png`});
  const injectionSeen=Date.now();await injection.waitFor({state:'detached',timeout:6000});
  assert.ok(Date.now()-injectionSeen>2500);
  report.tests.push('Injection notice appears once, ignores clicks, dismisses after about four seconds');
  await page.evaluate(url=>{
    const frame=document.createElement('iframe');frame.style.cssText='width:100%;height:100%;border:0';frame.allow='fullscreen';document.querySelector('main').replaceChildren(frame);
    window.initialDocument=frame.contentWindow.document.URL;window.initialProbes=0;
    frame.contentWindow.addEventListener('message',e=>{if(e.data?.type==='neko-request-resource')window.initialProbes++;});frame.src=url;
  },official);
  await page.locator('[data-neko-rust]').waitFor();
  await page.waitForFunction(()=>window.initialProbes>0);
  assert.equal(await page.evaluate(()=>window.initialDocument),'about:blank');
  assert.equal(await injection.count(),0);
  // A resource message from the same iframe before it has the official origin must be rejected.
  await page.evaluate(url=>document.querySelector('iframe').contentWindow.eval(`parent.postMessage(${JSON.stringify({type:'neko-project-resource',id:'123',url})},'*')`),bcm);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('iframe').getAttribute('src'),official);
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切换 Rust'}).click();
  releaseNavigation();let frame=await rustFrame();
  await frame.locator('#takeover-hint').waitFor({state:'visible'});
  await frame.waitForFunction(()=>Number(document.querySelector('#fps').textContent)>0);
  report.layout=await overlayLayout(frame);checkLayout(report.layout);
  await page.screenshot({path:`${output}/taken-over.png`});
  report.tests.push('Delayed official navigation from inherited-origin about:blank has no postMessage origin error; wrong-origin resource is rejected; fetch capture takes over');
  await frame.locator('#takeover-hint').waitFor({state:'hidden',timeout:6000});
  await frame.locator('#fullscreen').click();await frame.waitForFunction(()=>!!document.fullscreenElement);
  report.fullscreenLayout=await overlayLayout(frame);checkLayout(report.fullscreenLayout);
  assert.ok(await frame.locator('#extension-fps').isVisible());
  await page.screenshot({path:`${output}/fullscreen.png`});
  await frame.locator('#fullscreen').click();await frame.waitForFunction(()=>!document.fullscreenElement);
  await frame.locator('#toggle').click();await frame.waitForFunction(()=>document.querySelector('#fps').textContent==='—');
  await frame.locator('#toggle').click();await frame.waitForFunction(()=>Number(document.querySelector('#fps').textContent)>0);
  report.tests.push('Takeover confirmation dismisses; live drawing FPS is bottom-right and click-through, visible in fullscreen, dash when paused and resumes');
  await page.locator('[data-neko-rust]').getByRole('button',{name:'切回原版'}).click();await officialFrame();
  assert.equal(await page.locator('iframe').count(),1);
  assert.equal(await page.locator('[data-neko-rust]').getByRole('button',{name:'切换 Rust'}).count(),1);
  const popup=await context.newPage();await popup.goto(`${origin}/popup.html`);
  await popup.locator('#enabled').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-neko-rust]'));
  const requestsBefore=detailRequests,loadsBefore=officialLoads;
  await popup.locator('#enabled').check();frame=await rustFrame();
  assert.equal(detailRequests,requestsBefore);assert.equal(officialLoads,loadsBefore);
  await popup.close();await page.bringToFront();
  report.tests.push('Original player restores exact URL; enabling after official fetch has completed recovers cached resource without reload or duplicate detail request');
  await page.evaluate(()=>{
    history.pushState({},'', '/forum/post/overlay-next');
    const iframe=document.createElement('iframe');iframe.src='https://kn.codemao.cn/player?type=2&workId=124';iframe.style.cssText='width:100%;height:100%;border:0';iframe.allow='fullscreen';iframe.setAttribute('sandbox','allow-scripts allow-same-origin');document.querySelector('main').replaceChildren(iframe);
  });
  frame=await rustFrame();assert.equal(new URL(frame.url()).searchParams.get('workId'),'124');
  assert.equal(await page.locator('[data-neko-rust]').count(),1);
  assert.equal(new URL(frame.url()).searchParams.get('bcm'),encodedBcm);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-same-origin');
  await frame.evaluate(async encoded=>{
    const {decodeProject}=await import('./resource.js');
    if((await decodeProject('\uFEFF {"projectName":"中文😀"} ')).projectName!=='中文😀')throw Error('JSON changed');
    for(const bad of ['not a project',encoded.slice(0,-4),(encoded[0]==='A'?'B':'A')+encoded.slice(1)]){
      let failed=false;try{await decodeProject(bad);}catch{failed=true;}
      if(!failed)throw Error('Corrupted encoded source was accepted');
    }
  },encoded);
  report.tests.push('Forum sandbox iframe takes over encoded source_urls with empty bcm_url; disallowed CDN ignored, corrupt encoded data rejected; early manual takeover request stays active');
  await page.evaluate(()=>{document.querySelector('iframe').src='https://kn.codemao.cn/player?type=2&workId=125';});
  await page.locator('[data-neko-rust]').getByText('未找到可用作品资源').waitFor();
  assert.ok((await page.locator('iframe').getAttribute('src')).startsWith('https://kn.codemao.cn/'));
  await page.evaluate(()=>{history.pushState({},'', '/works/gated-next');document.querySelector('main').innerHTML='<h2>请先登录</h2>';});
  await page.waitForFunction(()=>!document.querySelector('[data-neko-rust]'));
  await injection.getByText('✓ Neko 扩展已植入').waitFor();
  assert.equal(await page.locator('iframe').count(),0);
  await page.evaluate(()=>{history.pushState({},'', '/');document.querySelector('main').textContent='首页';});
  await injection.waitFor({state:'detached'});
  report.tests.push('SPA replacement captures XHR, missing resource reports explicit status; gated work shows injection notice; leaving work removes it');
  assert.deepEqual(report.errors,[]);
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.log('Console errors',report.errors);await page.screenshot({path:`${output}/failure.png`});throw error;}
finally{releaseNavigation();await context.close();}
