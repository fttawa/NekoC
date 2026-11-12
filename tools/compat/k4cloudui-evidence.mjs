#!/usr/bin/env node
// Original fixtures -> actual official PIXI and NekoC VM/renderer. No vendor assets saved to tracked paths.
import { k4cloudFixtures } from './k4cloud-fixtures.mjs';
import { visualWork } from './k4-visual.mjs';
import { saveJson } from './k4-oracle.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const fixtures={...Object.fromEntries(Object.entries(await k4cloudFixtures()).filter(([name])=>['monitors','ranking'].includes(name))),...await k4cloudFixtures({ui:true})};
const evidence={schema:'nekoc-k4cloudui-v1',scope:'fixed offline kernel; PIXI stage RGB tolerance 8; ranking DOM structure/text (not artwork parity)',cases:{}};
for(const [name,{project,frames}] of Object.entries(fixtures)){
  const input=`tests/fixtures/kitten4/k4cloud-${name}.bcm`;
  if(name.startsWith('ui-'))await saveJson(input,project);
  const observations=[];
  await mkdir(`dist/k4cloudui/dom/${name}`,{recursive:true});
  let last;
  const result=await visualWork(input,{captureFrames:Array.from({length:frames},(_,i)=>i+1),artifactsDir:'dist/k4cloudui/pixels',pixelTolerance:8,channel:'msedge',
    onComparedFrame:async({page,nekoPage,frame,delta})=>{
      if(name==='ui-empty-rows'&&frame===17){
        // One real pointer drag, not direct mutation of PIXI internals. Same
        // canonical 45px (one row) displacement in both stage coordinate spaces.
        for(const [target,official]of [[page,true],[nekoPage,false]]){
          const origin=await target.evaluate(official=>{const e=official?window.__k4OracleRequire('a1xw').a().core.app.get_app().view:document.querySelector('#stage');const b=e.getBoundingClientRect();return{x:b.x,y:b.y};},official);
          await target.mouse.move(origin.x+570,origin.y+410);await target.mouse.down();await target.mouse.move(origin.x+570,origin.y+365,{steps:3});await target.mouse.up();
        }
        // Real browser mouse input can trigger a repaint and discard the
        // non-preserved WebGL buffer. Restore it explicitly before PNG capture.
        await nekoPage.evaluate(()=>{window.renderer.dirty=true;window.renderer.render();});
      }
      const official=await page.evaluate(()=>{
        const state=window.__k4OracleRequire('ALsR').a.get_state().ranking_state;
        const stage=window.__k4OracleRequire('a1xw').a().core.app.get_app().stage;
        const widgets=[];function visit(n,visible=true){visible=visible&&n.visible!==false&&n.renderable!==false&&n.alpha!==0;if(['items','shared','personal'].includes(n.id)){const b=n.getBounds();const texts=[];function text(c,v){v=v&&c.visible!==false;if(v&&typeof c.text==='string')texts.push(c.text);for(const child of c.children||[])text(child,v);}text(n,visible);widgets.push({id:n.id,visible,bounds:{x:b.x,y:b.y,width:b.width,height:b.height},texts});}for(const c of n.children||[])visit(c,visible);}visit(stage);
        const panel=document.querySelector('[class*="ranking-container"]');
        const roles=['scale-wrap','ranking-header','current-user','ranking-content','scroll-container','loading'];
        return {step:window.__k4Oracle.heart.get_runtime_manager().get_variable('step'),items:window.__k4Oracle.heart.get_runtime_manager().lists_get('items'),widgets,ranking:state,
          dom:panel?{text:panel.innerText.split(/\s+/).filter(Boolean),roles:roles.filter(role=>panel.querySelector(`[class*="${role}"]`)),rows:panel.querySelectorAll('tr').length}:null};
      });
      const local=await nekoPage.evaluate(()=>{const p=document.querySelector('.neko-ranking');return p?{text:p.innerText.split(/\s+/).filter(Boolean).filter(t=>t!=='×'),roles:['ranking-header','current-user','ranking-content','scroll-container','loading'].filter(role=>p.querySelector(`.${role}`)),rows:p.querySelectorAll('tr').length}:null;});
      observations.push({frame,variables:delta.frame.cloud_ui,official,local});
      if(official.step!==last){await page.screenshot({path:`dist/k4cloudui/dom/${name}/${frame}-official.png`});await nekoPage.screenshot({path:`dist/k4cloudui/dom/${name}/${frame}-nekoc.png`});last=official.step;}
    }});
  if(result.status!=='captured')throw Error(`${name}: ${result.error}`);
  evidence.kernelAssets=result.kernelAssets;
  const diagnostics=JSON.parse(await readFile(`${result.artifacts}/diagnostics.json`,'utf8'));
  evidence.cases[name]={sha256:createHash('sha256').update(await readFile(input)).digest('hex'),frames:observations,pixels:result.frames.map(({frame,changedPixels,mae,rmse,tolerance})=>({frame,changedPixels,mae,rmse,tolerance})),pageErrors:diagnostics.pageErrors,externalRequests:diagnostics.externalRequests,artifacts:result.artifacts};
  console.log(`${name}: ${frames} frames, max changed pixels=${Math.max(...result.frames.map(f=>f.changedPixels))}`);
}
await saveJson('docs/k4cloudui-evidence.json',evidence);
