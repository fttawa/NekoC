#!/usr/bin/env node
// Offline official editor import/render/serialization checks; no VM replacements.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startOfflinePlayer} from '../tower-defense/offline-player.mjs';
const require=createRequire('D:/AppData/Local/Temp/opencode/nekoc-kitenn/package.json');
const {chromium}=require('playwright');
const project=path.resolve(process.argv[2]);
const out=path.resolve(process.argv[3]||'D:/AppData/Local/Temp/opencode/tiny-lm-editor-check');
const importOnly=process.argv.includes('--import-only');
await mkdir(out,{recursive:true});
const host=await startOfflinePlayer({project});
const report={project,sha256:createHash('sha256').update(await readFile(project)).digest('hex'),pageErrors:[],console:[],externalCompleted:[]};
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',route=>new URL(route.request().url()).origin===host.origin?route.continue():route.abort('blockedbyclient'));
await context.routeWebSocket('**/*',socket=>socket.close());
context.on('requestfinished',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==host.origin)report.externalCompleted.push(r.url());});
const page=await context.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.console.push(m.text());});
try{
  await page.goto(host.origin+'/editor?previewUrl='+encodeURIComponent(host.origin+'/project.bcmkn'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__nekocRequire?.(40742).BlinkInstance.core?.mainWorkspace&&window.__nekocRequire(40742).BlinkInstance.workspaceManager.workspaces.size>0,null,{timeout:60000});
  report.compatibility=await page.evaluate(({original,importOnly})=>{
    const req=window.__nekocRequire,bcm=req(91107).BcmInstance,blink=req(40742).BlinkInstance;
    const summaries=[],issues=[];let blockCount=0,connections=0,sourceBlocks=0;
    const workspaces=[...blink.workspaceManager.workspaces.entries()];
    for(const [owner,workspace]of workspaces){
      const data=structuredClone(workspace.getWorkspaceDataJson());
      const entity=original.actors.actorsDict[owner]||original.scenes.scenesDict[owner]||original.procedures.proceduresDict[owner];
      const visit=b=>{
        sourceBlocks++;
        const imported=data.blocks[b.id];
        if(!imported||imported.type!==b.type)issues.push({owner,kind:'changed_import_block',id:b.id,type:b.type,actual:imported?.type});
        const edge=(child,input,kind)=>{
          const c=data.connections[b.id]?.[child.id];
          if(!c||(kind==='next'?c.type!=='next':c.input_name!==input))issues.push({owner,kind:'changed_import_connection',id:b.id,input,child:child.id});
          visit(child);
        };
        for(const [input,child]of Object.entries(b.inputs||{}))edge(child,input,'value');
        for(const [input,child]of Object.entries(b.statements||{}))edge(child,input,'statement');
        if(b.next)edge(b.next,undefined,'next');
      };
      for(const root of entity?.nekoBlockJsonList||[])visit(root);
      if(importOnly){summaries.push({owner,checked:Object.keys(data.blocks).length});continue;}
      blink.workspaceManager.selectWorkspace(owner,true);
      const rendered=blink.core.mainWorkspace;
      let checked=0;
      for(const b of Object.values(data.blocks)){
        checked++;blockCount++;
        const actual=rendered.get_block_by_id(b.id);
        if(!actual){issues.push({owner,kind:'missing_block',id:b.id,type:b.type});continue;}
        for(const [childId,c]of Object.entries(data.connections[b.id]??{})){
          connections++;
          const child=c.type==='next'?actual.get_next_block():actual.get_input_target_block(c.input_name);
          if(child?.id!==childId)issues.push({owner,kind:'changed_connection',id:b.id,type:b.type,input:c.input_name,expected:childId,actual:child?.id});
        }
        for(const [field,value]of Object.entries(b.fields??{})){
          const actualValue=actual.get_field_value(field);
          if(actualValue!==undefined&&String(actualValue)!==String(value))issues.push({owner,kind:'changed_field',id:b.id,type:b.type,field,expected:value,actual:actualValue});
        }
      }
      summaries.push({owner,checked});
    }
    return {version:bcm.getBcm().version,scope:importOnly?'source project blocks and connections checked against all imported workspaces; no repeated rendering':'source project connections checked against import, then all actor/procedure workspaces rendered with official block definitions',workspaces:summaries,sourceBlocks,blockCount,connections,issues};
  },{original:JSON.parse(await readFile(project,'utf8')),importOnly});
  assert.ok((importOnly?report.compatibility.sourceBlocks:report.compatibility.blockCount)>10000);
  assert.deepEqual(report.compatibility.issues,[]);
  assert.deepEqual(report.externalCompleted,[]);
  report.ok=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{
  report.missingAssets=host.missingAssets;
  report.release=host.audit;
  report.scope='Cached official 0.27.4 editor modules in local shell, missing official CSS/HTML; not current online editor acceptance';
  await writeFile(path.join(out,importOnly?'editor-import-integrity.json':'editor-compatibility.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,failure:report.failure,sourceBlocks:report.compatibility?.sourceBlocks,blocks:report.compatibility?.blockCount,connections:report.compatibility?.connections,issues:report.compatibility?.issues,externalCompleted:report.externalCompleted,out},null,2));
  await browser.close();await host.close();
}
