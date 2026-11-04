#!/usr/bin/env node
// Official cached native VM, offline network barrier, real keyboard events.
// Explicit control fixtures set output limits/temperature and an invalid prompt.
// Generated text, logits and token IDs are never injected.
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startOfflinePlayer} from '../tower-defense/offline-player.mjs';
const require=createRequire('D:/AppData/Local/Temp/opencode/nekoc-kitenn/package.json');
const {chromium}=require('playwright');
const project=path.resolve(process.argv[2]||'projects/tiny-lm/tiny_lm.bcmkn');
const out=path.resolve(process.argv[3]||'projects/tiny-lm/tiny-lm-verification');
const startupOnly=process.argv.includes('--startup-only');
const controlsOnly=process.argv.includes('--controls-only');
await mkdir(out,{recursive:true});
const host=await startOfflinePlayer({project});
const report={project,projectSha256:createHash('sha256').update(await readFile(project)).digest('hex'),runtimeKind:'Official cached KN editor native playback in local test shell; not standalone published player',release:host.audit,cases:[],pageErrors:[],console:[],network:{externalCompleted:[],externalResponses:[],aborted:[]}};
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',async route=>{const url=route.request().url();if(new URL(url).origin===host.origin)return route.continue();report.network.aborted.push(url);return route.abort('blockedbyclient');});
await context.routeWebSocket('**/*',socket=>{report.network.aborted.push(socket.url());socket.close();});
context.on('requestfinished',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==host.origin)report.network.externalCompleted.push(r.url());});
context.on('response',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==host.origin)report.network.externalResponses.push(r.url());});
const page=await context.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push({type:m.type(),text:m.text()});});
const snapshot=()=>page.evaluate(()=>{
  const req=window.__nekocRequire,manager=req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
  const variables={},lists={};
  for(const def of Object.values(req(91107).BcmInstance.variablesDict)){
    if(['lm_weights','lm_vocabulary'].includes(def.name))continue;
    const value=manager.get_variable(def.id,undefined,def.currentEntityId);
    (def.type==='list'?lists:variables)[def.name]=value;
  }
  return {at:performance.now(),variables,lists,events:structuredClone(window.__lmEvents)};
});
const set=values=>page.evaluate(values=>{
  const req=window.__nekocRequire,manager=req(26921).cG.get_instance().getHeart().core.get_runtime_manager(),defs=Object.values(req(91107).BcmInstance.variablesDict);
  for(const [name,value]of Object.entries(values)){const def=defs.find(d=>d.name===name);if(!def)throw new Error(name);manager.set_variable(def.id,value,undefined,def.currentEntityId);}
},values);
const key=async key=>{
  const code={Space:32,Enter:13}[key]||key.toUpperCase().charCodeAt(0);
  for(const type of ['keydown','keyup'])await page.evaluate(({type,key,code})=>document.body.dispatchEvent(new KeyboardEvent(type,{key:key==='Space'?' ':key,code:key.length===1?'Key'+key.toUpperCase():key,keyCode:code,which:code,bubbles:true,cancelable:true})),{type,key,code});
};
const until=async(name,expected,timeout=180000)=>{
  await page.waitForFunction(({name,expected})=>{
  if(window.__lmEvents?.errors.length)return true;
  const req=window.__nekocRequire,def=Object.values(req(91107).BcmInstance.variablesDict).find(d=>d.name===name);
  return req(26921).cG.get_instance().getHeart().core.get_runtime_manager().get_variable(def.id,undefined,def.currentEntityId)===expected;
  },{name,expected},{timeout,polling:100});
  assert.deepEqual(await page.evaluate(()=>window.__lmEvents.errors),[],`${name}: native errors`);
};
const idleHud=async()=>{
  const frames=(await snapshot()).variables.lm_frames;
  await page.waitForFunction(frames=>{
    const req=window.__nekocRequire,manager=req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
    const d=Object.values(req(91107).BcmInstance.variablesDict).find(d=>d.name==='lm_frames');
    return manager.get_variable(d.id,undefined,d.currentEntityId)>frames;
  },frames,{timeout:30000,polling:100});
};
async function finish(name,{inputKey,fixture,inputAction}={}){
  const before=await snapshot();if(fixture)await set(fixture);if(inputKey)await key(inputKey);if(inputAction)await inputAction();
  // Wait for actual work, not a stale DONE left by a previous request.
  if(inputKey||inputAction||fixture?.lm_request)await until('lm_running',1);
  await until('lm_running',0,300000);
  await idleHud();
  const after=await snapshot();
  assert.deepEqual(after.events.errors,[],name+' native errors');assert.deepEqual(after.events.warnings,[],name+' native warnings');
  assert.ok(after.variables.lm_generated>0,name+' must generate');
  const item={name,inputKey,fixture,before,after,wallSeconds:(after.at-before.at)/1000};report.cases.push(item);
  await page.locator('#STAGE_CANVAS').screenshot({path:path.join(out,name+'.png')});
  console.log(JSON.stringify({name,output:after.variables.lm_output,prompt:after.variables.lm_prompt,generated:after.variables.lm_generated,seconds:item.wallSeconds,tokenSeconds:after.lists.lm_token_ms.map(n=>n/1000)}));
}
try{
  await page.goto(host.origin+'/editor?previewUrl='+encodeURIComponent(host.origin+'/project.bcmkn'),{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__nekocRequire?.(26921)?.cG?.get_instance()&&Object.keys(window.__nekocRequire(91107).BcmInstance.variablesDict).length>0,null,{timeout:45000});
  report.nativeFactoryHashes=await page.evaluate(async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>{
    const bytes=new TextEncoder().encode(window.__nekocRequire.m[id].toString());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [id,[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')];
  }))),Object.keys(host.audit.nativeFactoryHashes));
  assert.deepEqual(report.nativeFactoryHashes,host.audit.nativeFactoryHashes,'Native factories must match the cached official release');
  await page.evaluate(()=>{
    const core=window.__nekocRequire(26921).cG.get_instance().getHeart().core,events=core.get_event_bus();
    window.__lmEvents={updates:0,errors:[],warnings:[]};
    const safe=e=>{try{return JSON.parse(JSON.stringify(e,(k,v)=>k==='block'?{id:v?.id,type:v?.type}:v));}catch{return String(e);}};
    events.runtime_manager.after_update.immediate.sub(()=>window.__lmEvents.updates++);
    events.error.all.immediate.sub(e=>window.__lmEvents.errors.push(safe(e)));
    events.warning.all.immediate.sub(e=>window.__lmEvents.warnings.push(safe(e)));
  });
  if(startupOnly)await page.evaluate(()=>{
    // Observe the editor's compiler-error callback and still invoke its original handler.
    const runtime=window.__nekocRequire(26921).cG.get_instance(),original=runtime.onLintError;
    runtime.onLintError=function(e){
      try{window.__lmEvents.errors.push(JSON.parse(JSON.stringify(e)));}catch{window.__lmEvents.errors.push(String(e));}
      return original.call(this,e);
    };
  });
  await page.getByText(/^开始$/).last().dispatchEvent('click');
  await until('lm_ready',1,120000);
  if(startupOnly){report.ok=true;}else{
  await set({lm_max_new_tokens:6});
  const dimensions=await page.evaluate(()=>window.__nekocRequire(91107).BcmInstance.stageSize);
  await page.addStyleTag({content:`${controlsOnly?'':'#root{visibility:hidden}'}#STAGE_CANVAS{visibility:visible!important;position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:${dimensions.width}px!important;height:${dimensions.height}px!important;max-width:none!important;z-index:100000!important}`});
  await finish('default-cat');
  if(controlsOnly){
    await finish('regenerate',{inputKey:'r',fixture:{lm_max_new_tokens:2}});
    const before=await snapshot();await set({lm_max_new_tokens:32});await key('3');await until('lm_running',1);
    await key('Space');await until('lm_running',0);await idleHud();
    report.stopControl={before,after:await snapshot()};
    assert.match(report.stopControl.after.variables.lm_status,/^(STOPPED|已停止)$/);
    const inputsBefore=await page.locator('input,textarea').count();
    await set({lm_max_new_tokens:3});await key('Enter');
    await page.waitForFunction(count=>document.querySelectorAll('input,textarea').length>count,inputsBefore,{timeout:15000});
    report.customInputElements=await page.locator('input,textarea').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,placeholder:n.placeholder,cls:n.className,type:n.type})));
    await finish('custom-prompt',{inputAction:async()=>{
      const input=page.locator('input[class*="StageDialogInput_input"]');
      await input.fill('小熊在',{force:true});
      await page.locator('[class*="StageDialogInput_dialogConfirmButton"]').dispatchEvent('click');
    }});
    assert.equal(report.cases.at(-1).after.variables.lm_prompt,'小熊在');
  }else{
  await finish('weather',{inputKey:'2',fixture:{lm_max_new_tokens:6}});
  await finish('night',{inputKey:'3',fixture:{lm_max_new_tokens:6}});
  await finish('temperature-sampling',{inputKey:'t',fixture:{lm_max_new_tokens:4}});
  await finish('full-cat-eos',{inputKey:'1',fixture:{lm_max_new_tokens:32,lm_temperature:0}});
  assert.match(report.cases.at(-1).after.variables.lm_status,/^(DONE \/ EOS|完成 · 句子结束)$/);
  // An unsupported prompt must fail clearly instead of silently remapping text.
  await set({lm_prompt:'🚀',lm_request:1});await until('lm_request',0);
  await page.waitForFunction(()=>{
    const req=window.__nekocRequire,defs=Object.values(req(91107).BcmInstance.variablesDict),d=defs.find(d=>d.name==='lm_status');
    return /^(Unsupported character:|词表外的字：)/.test(String(req(26921).cG.get_instance().getHeart().core.get_runtime_manager().get_variable(d.id,undefined,d.currentEntityId)));
  },null,{timeout:30000});
  report.unsupportedPrompt=await snapshot();
  assert.equal(report.unsupportedPrompt.variables.lm_running,0);
  await idleHud();
  }
  }
  assert.deepEqual(report.network.externalCompleted,[]);assert.deepEqual(report.network.externalResponses,[]);
  report.ok=true;
}catch(e){report.failure=e.stack;process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
  report.nativeEvents=await page.evaluate(()=>window.__lmEvents).catch(()=>null);report.missingAssets=host.missingAssets;
  report.final=await snapshot().catch(()=>null);report.browserShellDegraded=report.pageErrors.length>0||host.missingAssets.length>0;
  report.inputElements=await page.locator('input,textarea').evaluateAll(nodes=>nodes.map(n=>n.outerHTML)).catch(()=>[]);
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(out,'release-audit.json'),JSON.stringify(report.release,null,2));
  console.log(JSON.stringify({ok:report.ok,failure:report.failure,nativeEvents:report.nativeEvents,out},null,2));
  await browser.close();await host.close();
}
