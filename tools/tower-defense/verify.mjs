#!/usr/bin/env node
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startOfflinePlayer} from './offline-player.mjs';

const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):'D:/AppData/Local/Temp/opencode/nekoc-kitenn/package.json');
const {chromium}=require('playwright');
const project=path.resolve(process.argv[2]||'samples/pen_display_fast.bcmkn');
const out=path.resolve(process.argv[3]||'D:/AppData/Local/Temp/opencode/kn-tower-offline');
await mkdir(out,{recursive:true});
const host=await startOfflinePlayer({project});
const scenarioConfig=process.env.KN_SCENARIO?JSON.parse(await readFile(process.env.KN_SCENARIO,'utf8')):{};
const scenario=Array.isArray(scenarioConfig)?{after:scenarioConfig}:scenarioConfig;
const report={project,projectSha256:createHash('sha256').update(await readFile(project)).digest('hex'),assetResolution:host.assetResolution,runtimeKind:'Official published KN editor native playback runtime in a local test shell; not a standalone published-work player',release:host.audit,blocked:[],pageErrors:[],console:[],snapshots:[],scenario:[],network:{localRouted:0,externalHttpAborted:0,webSocketsAborted:0,externalResponses:[],externalCompleted:[]}};
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',async route=>{
  const url=route.request().url();
  if(new URL(url).origin===host.origin){report.network.localRouted++;return route.continue();}
  report.network.externalHttpAborted++;
  report.blocked.push({transport:'http',url,method:route.request().method()});
  return route.abort('blockedbyclient');
});
await context.routeWebSocket('**/*',socket=>{report.network.webSocketsAborted++;report.blocked.push({transport:'websocket',url:socket.url()});socket.close({code:1008,reason:'Offline verification'});});
const isExternal=url=>/^https?:/.test(url)&&new URL(url).origin!==host.origin;
context.on('response',response=>{if(isExternal(response.url()))report.network.externalResponses.push({url:response.url(),status:response.status()});});
context.on('requestfinished',request=>{if(isExternal(request.url()))report.network.externalCompleted.push(request.url());});
await context.addInitScript(()=>{
  window.__offlineCsp=[];
  window.__offlineRejections=[];
  document.addEventListener('securitypolicyviolation',e=>window.__offlineCsp.push({url:e.blockedURI,directive:e.effectiveDirective}));
  window.addEventListener('unhandledrejection',e=>window.__offlineRejections.push({type:e.reason?.constructor?.name,message:e.reason?.message||String(e.reason),target:e.reason?.target?.src||e.reason?.target?.href}));
  window.__offlineRaf={count:0,times:[]};
  const observe=t=>{const s=window.__offlineRaf;s.count++;if(s.times.length<1200)s.times.push(t);requestAnimationFrame(observe);};
  requestAnimationFrame(observe);
});
const page=await context.newPage();
const consoleDetails=[];
page.on('pageerror',e=>report.pageErrors.push(e.stack||e.message));
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning'){
  const item={type:m.type(),text:m.text()};report.console.push(item);
  if(m.type()==='error'&&!/(Content Security Policy|Refused to|Failed to load|sentry|Sentry)/.test(m.text()))consoleDetails.push(Promise.all(m.args().map(a=>a.evaluate(v=>{const seen=new WeakSet();try{return JSON.parse(JSON.stringify(v,(k,x)=>{if(typeof x==='bigint')return String(x);if(x&&typeof x==='object'){if(seen.has(x))return '[circular]';seen.add(x);if(x instanceof Error)return {...x,message:x.message,stack:x.stack};}return x;}));}catch{return String(v);}}).catch(()=>null))).then(args=>item.arguments=args));
}});
try{
  await page.goto(host.origin+'/editor?previewUrl='+encodeURIComponent(host.origin+'/project.bcmkn'),{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__nekocRequire?.(26921)?.cG?.get_instance()&&Object.keys(window.__nekocRequire(91107).BcmInstance.variablesDict).length>0,null,{timeout:45000,polling:500});
  if(host.assetResolution.substitutions.length){
    report.assetResolution.playbackLoad='Official 68602.UO playback loader with exact original JSON and embedded data URLs; URL-resolved copy is editor-bootstrap-only';
    report.assetResolution.playbackOriginalProjectSha256=report.projectSha256;
    report.playbackLoad=await page.evaluate(async()=>{
      const req=window.__nekocRequire,original=await(await fetch('/original-project.bcmkn')).json();
      const bcm=req(91107).BcmInstance;
      bcm.errorStyleUrls.clear();bcm.successStyleUrls.clear();bcm.uploadingStyleImage.clear();bcm.cacheResource.clear();
      await req(68602).UO(original);
      const data=bcm.getBcm();
      return {styleUrlsPreserved:Object.entries(original.styles.stylesDict).every(([id,s])=>data.styles.stylesDict[id]?.url===s.url),styles:Object.keys(data.styles.stylesDict).length};
    });
    assert.equal(report.playbackLoad.styleUrlsPreserved,true,'Native playback must preserve embedded style URLs');
  }
  report.boot=await page.evaluate(()=>({loader:!!window.__nekocRequire,canvas:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.width,height:c.height})),runtime:!!window.__nekocRequire(26921).cG.get_instance(),version:window.__nekocRequire(91107).BcmInstance.getBcm().version}));
  report.assetLoad=await page.evaluate(()=>{
    const bcm=window.__nekocRequire(91107).BcmInstance;
    return {errorStyleUrls:[...bcm.errorStyleUrls],successStyleUrls:[...bcm.successStyleUrls],uploadingStyles:bcm.uploadingStyleImage.size};
  });
  assert.deepEqual(report.assetLoad.errorStyleUrls,[],'Every project style must load through the official renderer');
  assert.equal(report.assetLoad.uploadingStyles,0,'Offline playback must not upload styles');
  report.nativeFactoryHashes=await page.evaluate(async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>{
    const bytes=new TextEncoder().encode(window.__nekocRequire.m[id].toString());
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return [id,[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')];
  }))),Object.keys(host.audit.nativeFactoryHashes));
  assert.deepEqual(report.nativeFactoryHashes,host.audit.nativeFactoryHashes,'Executing native module factories must exactly match the recorded release cache');
  await page.evaluate(()=>{
    const req=window.__nekocRequire,core=req(26921).cG.get_instance().getHeart().core;
    window.__nativeEvents={updates:0,errors:[],warnings:[],starts:0};
    const events=core.get_event_bus(),safe=e=>{const seen=new WeakSet();try{return JSON.parse(JSON.stringify(e,(k,x)=>{if(typeof x==='bigint')return String(x);if(k==='block'&&x?.id)return {id:x.id,type:x.type};if(x&&typeof x==='object'){if(seen.has(x))return '[circular]';seen.add(x);if(x instanceof Error)return {...x,message:x.message,stack:x.stack};}return x;}));}catch{return String(e);}};
    events.runtime_manager.after_update.immediate.sub(()=>window.__nativeEvents.updates++);
    events.runtime_manager.start.immediate.sub(()=>window.__nativeEvents.starts++);
    events.error.all.immediate.sub(e=>window.__nativeEvents.errors.push(safe(e)));
    events.warning.all.immediate.sub(e=>window.__nativeEvents.warnings.push(safe(e)));
  });
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await page.waitForFunction(()=>window.__nativeEvents.errors.length||window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_runtime_data().is_running(),null,{timeout:45000,polling:500});
  assert.equal(await page.evaluate(()=>window.__nativeEvents.errors.length),0,'Official native VM rejected project during start; see nativeEvents in report.json');
  const snapshot=()=>page.evaluate(()=>{
    const req=window.__nekocRequire,core=req(26921).cG.get_instance().getHeart().core;
    const manager=core.get_runtime_manager(),defs=Object.values(req(91107).BcmInstance.variablesDict);
    const variables={},lists={};
    for(const v of defs){
      let value;try{value=manager.get_variable(v.id,undefined,v.currentEntityId);}catch{value=v.value;}
      (v.type==='list'?lists:variables)[v.name]=value;
    }
    const stage=req(26921).cG.get_instance().stage.core;
    const actors=Object.values(req(91107).BcmInstance.actorsDict).map(def=>{
      const result=stage.actors.get_actor(def.id);if(result.is_error(result.value))return {id:def.id,name:def.name,error:true};
      const actor=result.value;
      return {id:def.id,name:def.name,visible:actor.get_visible(),position:actor.get_position(),style:actor.get_current_style()?.style_id,z:actor.get_z_index?.()};
    });
    return {at:performance.now(),running:core.get_runtime_data().is_running(),variables,lists,actors,raf:window.__offlineRaf.count,events:structuredClone(window.__nativeEvents)};
  });
  const first=await snapshot();
  report.frameVariable=process.env.KN_FRAME_VARIABLE||['frames','frame','__pd_frames','td_frames'].find(n=>n in first.variables);
  assert.ok(report.frameVariable,'Project must expose a game frame counter (KN_FRAME_VARIABLE can select it)');
  await page.waitForFunction(name=>{
    const req=window.__nekocRequire,v=Object.values(req(91107).BcmInstance.variablesDict).find(v=>v.name===name);
    return req(26921).cG.get_instance().getHeart().core.get_runtime_manager().get_variable(v.id,undefined,v.currentEntityId)>2;
  },report.frameVariable,{timeout:60000,polling:500});
  const dimensions=await page.evaluate(()=>window.__nekocRequire(91107).BcmInstance.stageSize);
  await page.addStyleTag({content:`#root{visibility:hidden}#STAGE_CANVAS{visibility:visible!important;position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:${dimensions.width}px!important;height:${dimensions.height}px!important;max-width:none!important;z-index:100000!important}#DialogContainer{display:none!important}`});
  report.titleSnapshot=await snapshot();
  await page.screenshot({path:path.join(out,'initial.png')});
  await page.locator('#STAGE_CANVAS').screenshot({path:path.join(out,'initial-stage.png')});
  async function runSteps(steps=[]){
    for(let i=0;i<steps.length;i++){
      const step=steps[i],before=await snapshot();
      if(step.set){
        // Explicitly labeled fixture injection; all game logic remains native.
        await page.evaluate(values=>{
          const req=window.__nekocRequire,defs=Object.values(req(91107).BcmInstance.variablesDict);
          const manager=req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
          for(const [name,value]of Object.entries(values)){
            const v=defs.find(v=>v.name===name);if(!v)throw new Error('Fixture variable absent: '+name);
            manager.set_variable(v.id,value,undefined,v.currentEntityId);
          }
        },step.set);
      }
      if(step.key){
        if(step.domKey){
          // Missing editor overlay cannot receive focus. Body events still go
          // through the official document.body keyboard listeners unchanged.
          const code={Enter:13,Space:32,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[step.key]||step.key.toUpperCase().charCodeAt(0);
          const dispatch=type=>page.evaluate(({type,key,code})=>document.body.dispatchEvent(new KeyboardEvent(type,{key:key==='Space'?' ':key,code:key==='Space'?'Space':key.length===1?'Key'+key.toUpperCase():key,keyCode:code,which:code,bubbles:true,cancelable:true})),{type,key:step.key,code});
          await dispatch('keydown');await page.waitForTimeout(step.holdMs||120);await dispatch('keyup');
        }else{await page.keyboard.down(step.key);await page.waitForTimeout(step.holdMs||120);await page.keyboard.up(step.key);}
      }
      if(step.click){
        const box=await page.locator('#STAGE_CANVAS').boundingBox();
        await page.mouse.click(box.x+box.width/2+step.click.x*box.width/dimensions.width,box.y+box.height/2-step.click.y*box.height/dimensions.height);
      }
      if(step.waitMs)await page.waitForTimeout(step.waitMs);
      if(step.until)await page.waitForFunction(({name,op,value,index,nonzero})=>{
        const req=window.__nekocRequire,v=Object.values(req(91107).BcmInstance.variablesDict).find(v=>v.name===name);
        if(!v)return false;
        let actual=req(26921).cG.get_instance().getHeart().core.get_runtime_manager().get_variable(v.id,undefined,v.currentEntityId);
        if(index!==undefined)actual=actual[index];
        if(nonzero)actual=actual.filter(value=>value!==0).length;
        return op==='gt'?actual>value:op==='lt'?actual<value:op==='ne'?actual!==value:actual===value;
      },step.until,{timeout:step.timeout||30000,polling:500});
      const after=await snapshot();
      const name=(step.name||`step-${i+1}`).replace(/[^a-zA-Z0-9_-]/g,'-');
      report.scenario.push({name,fixture:step.set||null,input:{key:step.key,domKey:!!step.domKey,click:step.click},before,after});
      for(const [variable,expected]of Object.entries(step.assert||{}))assert.deepEqual(after.variables[variable],expected,`${name}: ${variable}`);
      for(const [list,entries]of Object.entries(step.assertLists||{}))for(const [index,expected]of Object.entries(entries))assert.deepEqual(after.lists[list]?.[Number(index)],expected,`${name}: ${list}[${index}]`);
      assert.deepEqual(after.events.errors,[],`${name}: native VM errors`);
      await page.locator('#STAGE_CANVAS').screenshot({path:path.join(out,name+'-stage.png')});
    }
  }
  await runSteps(scenario.before);
  const benchmark=scenario.benchmark||{};
  report.benchmark={label:benchmark.label||'native playback',windows:benchmark.windows||3,windowMs:benchmark.windowMs||2000};
  const checkBenchmarkState=state=>{
    for(const [variable,expected]of Object.entries(benchmark.assert||{}))assert.deepEqual(state.variables[variable],expected,`Benchmark requires ${variable}=${expected}`);
    if(benchmark.activeEnemies)assert.ok(state.lists.eAlive.some(v=>v===1),'Benchmark requires active enemies');
    if(benchmark.validateActorLayers){
      const backdrop=state.actors.find(a=>a.name==='Backdrop');
      for(const actor of state.actors.filter(a=>a.visible&&/^(Tower|Enemy) /.test(a.name)))assert.ok(actor.z>backdrop.z,`${actor.name} must render above Backdrop`);
    }
  };
  report.snapshots.push(await snapshot());checkBenchmarkState(report.snapshots[0]);
  await page.locator('#STAGE_CANVAS').screenshot({path:path.join(out,'battle-start-stage.png')});
  // Reset after the readback so screenshots are outside every timing window.
  report.snapshots[0]=await snapshot();
  report.windows=[];
  for(let i=0;i<report.benchmark.windows;i++){
    await page.waitForTimeout(report.benchmark.windowMs);
    const before=report.snapshots.at(-1),after=await snapshot(),seconds=(after.at-before.at)/1000;
    report.snapshots.push(after);checkBenchmarkState(after);
    report.windows.push({seconds,gameFrames:after.variables[report.frameVariable]-before.variables[report.frameVariable],gameFps:(after.variables[report.frameVariable]-before.variables[report.frameVariable])/seconds,rafHz:(after.raf-before.raf)/seconds,nativeUpdates:after.events.updates-before.events.updates,mode:after.variables.mode,wave:after.variables.wave,activeEnemies:after.lists.eAlive?.filter(v=>v===1).length,score:after.variables.score,lives:after.variables.lives});
  }
  const start=report.snapshots[0],end=report.snapshots.at(-1),duration=(end.at-start.at)/1000;
  report.frameMetrics={durationSeconds:duration,gameFrames:end.variables[report.frameVariable]-start.variables[report.frameVariable],gameFps:(end.variables[report.frameVariable]-start.variables[report.frameVariable])/duration,rafHz:(end.raf-start.raf)/duration,nativeUpdates:end.events.updates-start.events.updates};
  await page.screenshot({path:path.join(out,'running.png')});
  await page.locator('#STAGE_CANVAS').screenshot({path:path.join(out,'running-stage.png')});
  assert.ok(report.windows.every(w=>w.gameFrames>0&&w.nativeUpdates>0),'Native VM and game counter must advance in every sample');
  assert.deepEqual(end.events.errors,[],'Native VM errors');
  await runSteps(scenario.after);
  assert.deepEqual(report.network.externalResponses,[],'No external HTTP responses may escape the network barrier');
  assert.deepEqual(report.network.externalCompleted,[],'No external requests may complete');
  report.runtimeVerified=true;
  report.provenanceVerified=host.audit.publishedDigestVerified;
  report.ok=true;
  console.log(JSON.stringify({boot:report.boot,frameVariable:report.frameVariable,windows:report.windows},null,2));
}catch(error){report.failure=error.stack||String(error);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{
  report.blocked.push(...await page.evaluate(()=>window.__offlineCsp.map(e=>({transport:'csp',...e}))).catch(()=>[]));
  report.network.cspBlocked=report.blocked.filter(e=>e.transport==='csp').length;
  report.network.observedExternalEscapes=report.network.externalResponses.length+report.network.externalCompleted.length;
  report.network.barrierVerified=report.network.observedExternalEscapes===0;
  report.missingAssets=host.missingAssets;report.localRequests=host.requests;
  report.raf=await page.evaluate(()=>window.__offlineRaf).catch(()=>null);
  report.unhandledRejections=await page.evaluate(()=>window.__offlineRejections).catch(()=>[]);
  report.nativeEvents=await page.evaluate(()=>window.__nativeEvents).catch(()=>null);
  await Promise.allSettled(consoleDetails);
  report.knownChromeRejections=report.unhandledRejections.filter(e=>e.target?.includes('/static/media/coordinate_portrait.'));
  report.browserShellDegraded=report.pageErrors.length>0||report.missingAssets.length>0;
  report.screenshots=[];
  for(const name of ['initial.png','initial-stage.png','battle-start-stage.png','running.png','running-stage.png',...report.scenario.map(s=>s.name+'-stage.png')]){
    try{const bytes=await readFile(path.join(out,name));report.screenshots.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}catch{}
  }
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(out,'release-audit.json'),JSON.stringify(report.release,null,2));
  await writeFile(path.join(out,'asset-resolution.json'),JSON.stringify(report.assetResolution,null,2));
  await writeFile(path.join(out,'blocked-requests.json'),JSON.stringify(report.blocked,null,2));
  await writeFile(path.join(out,'frame-metrics.json'),JSON.stringify({benchmark:report.benchmark,frameVariable:report.frameVariable,summary:report.frameMetrics,windows:report.windows,network:report.network,runtimeKind:report.runtimeKind,browserShellDegraded:report.browserShellDegraded},null,2));
  console.log(JSON.stringify({out,failure:report.failure,errors:report.pageErrors,missing:report.missingAssets},null,2));
  await browser.close();await host.close();
}
