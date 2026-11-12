#!/usr/bin/env node
// Shader isolation: native official VM/getters drive both renderers. This is
// deliberately NOT evidence for NekoC VM dispatch (use the separate visual runner).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { partialEffects7Fixtures } from './k4-partial-effects-7-fixtures.mjs';
import { partialEffects8Fixtures } from './k4-partial-effects-8-fixtures.mjs';
import { partialEffects9Fixtures } from './k4-partial-effects-9-fixtures.mjs';
import { partialEffects10Fixtures } from './k4-partial-effects-10-fixtures.mjs';
import { runOracle, saveJson } from './k4-oracle.mjs';
import { pixelDifference } from './k4-visual.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceArg=process.argv.find(a=>a.startsWith('--source='));
const diagnose=process.argv.includes('--diagnose');
let source=await readFile(sourceArg?sourceArg.slice(9):'web/renderer.js','utf8');
const round10=process.argv.includes('--round10'),round9=process.argv.includes('--round9'),round8=process.argv.includes('--round8'),names=process.argv.slice(2).filter(n=>!n.startsWith('--')),round=round10?10:round9?9:round8?8:7;
const report={schema:`nekoc-k4-partial-effects-${round}-renderer-v1`,scope:'shader isolation only: native official getters feed NekoC renderer, NOT NekoC VM evidence; full canvas, no masks, tolerance 8',rendererLfSha256:hash(source.replace(/\r\n/g,'\n')),cases:{}};
for(const [name,spec]of Object.entries(await (round10?partialEffects10Fixtures():round9?partialEffects9Fixtures():round8?partialEffects8Fixtures():partialEffects7Fixtures()))){
  if(name.startsWith('scene-'))continue; // scene cases use the real-VM runner only
  if(names.length&&!names.includes(name))continue;
   const dir=`dist/partial-effects-${round}/${sourceArg?'baseline-renderer':'renderer'}/${name}`;await mkdir(dir,{recursive:true});
  let nekoPage;const frames=[],observations=[],filterSamples=[];
  const trace=await runOracle(spec.project,{virtualTime:true,blocks:true,frames:spec.frames,seed:1,
    beforeStart:async page=>{
      const actor=spec.project.theatre.actors[spec.aid];
      await page.evaluate(({aid,diagnose})=>{
        const actor=window.__k4OracleRequire('a1xw').a().get_actor_by_id(aid),fx=actor.get_effects().value;
        window.__effects7Filters=[];
        const proto=Object.getPrototypeOf(fx),original=proto.get_effect_filter;
        proto.get_effect_filter=function(index){const filter=original.call(this,index);if(!filter.__effects7Observed){
          filter.__effects7Observed=true;const apply=filter.apply;
           filter.apply=function(manager,input,output,...args){window.__effects7Filters.push({index,frame:window.__effects7Frame,inputFrame:input.filterFrame&&{x:input.filterFrame.x,y:input.filterFrame.y,width:input.filterFrame.width,height:input.filterFrame.height},size:this.size,angle:this.angle,radius:this.radius,offset:this.offset&&{x:this.offset.x,y:this.offset.y},padding:this.padding});
             if(diagnose){const r=manager.renderer,gl=r.gl,old=gl.getParameter(gl.FRAMEBUFFER_BINDING),fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,input.baseTexture._glTextures[r.CONTEXT_UID].texture,0);const bytes=new Uint8Array(input.width*input.height*4);gl.readPixels(0,0,input.width,input.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);gl.bindFramebuffer(gl.FRAMEBUFFER,old);gl.deleteFramebuffer(fb);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));(window.readbacks10??=[]).push({index,frame:window.__effects7Frame,width:input.width,height:input.height,rgba:btoa(raw)});}
             return apply.call(this,manager,input,output,...args);};
        }return filter;};
      },{aid:spec.aid,diagnose});
      nekoPage=await page.context().newPage();
      await nekoPage.route('**/effects7-renderer.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
      await nekoPage.route('**/pen-k4.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile('web/pen-k4.js','utf8')}));
      await nekoPage.route('**/effects7',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas></canvas>'}));
      await nekoPage.goto(new URL('/effects7',page.url()).href);
      await nekoPage.evaluate(async({aid,sid,actor,styles,diagnose})=>{
        const {StageRenderer}=await import('/effects7-renderer.js');const r=window.renderer=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
        await r.load({_nekocKitten4:true,stageSize:{width:960,height:720},scenes:{currentSceneId:sid,scenesDict:{[sid]:{actorIds:[aid],currentStyleId:'background'}}},actors:{actorsDict:{[aid]:{currentStyleId:'costume-a',styles:['costume-a']}}},styles:{stylesDict:Object.fromEntries(Object.entries(styles).map(([id,s])=>[id,{...s,centerPoint:s.rotate_center}]))}});
        window.actor={id:aid,style:'costume-a',x:actor.x,y:actor.y,direction:-90,scale:actor.scale,visible:true,rotation_type:0};
        // K4 is counterclockwise from right; wire draw angle is clockwise.
         window.actor.direction=-actor.rotation*180/Math.PI;
         if(diagnose){const gl=r.gl,draw=gl.drawArrays.bind(gl);gl.drawArrays=function(...args){draw(...args);if(gl.getParameter(gl.FRAMEBUFFER_BINDING)){const vp=gl.getParameter(gl.VIEWPORT),bytes=new Uint8Array(vp[2]*vp[3]*4);gl.readPixels(0,0,vp[2],vp[3],gl.RGBA,gl.UNSIGNED_BYTE,bytes);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));(window.readbacks10??=[]).push({width:vp[2],height:vp[3],rgba:btoa(raw)});}};}
      },{aid:spec.aid,sid:spec.sid,actor,styles:spec.project.theatre.styles,diagnose});
    },
    onFrame:async(page,frame)=>{
      const observed=await page.evaluate(({aid,frame})=>{
        window.__effects7Frame=frame;const stage=window.__k4OracleRequire('a1xw').a(),actor=stage.get_actor_by_id(aid),fx=actor.get_effects().value;
        return {frame,opacity:actor.get_alpha(),effects:['hue','brightness','pixelate','displacement','twist','saturate','ascii'].map(k=>fx[`get_${k}`]())};
      },{aid:spec.aid,frame});observations.push(observed);
      await nekoPage.evaluate(({opacity,effects:e})=>{const r=window.renderer;r.apply({sprites:[{...window.actor,opacity,effects:[e[0],0,e[1]-100,e[2],e[3],e[4],-e[5],e[6]]}]},new Float32Array());},observed);
      const capture=async(p,official)=>p.evaluate(official=>{
        let source;if(official){const stage=window.__k4OracleRequire('a1xw').a();stage.get_scene_by_id(stage.core.scenes.get_current_scene()).on_tick();const app=stage.core.app.get_app();app.renderer.render(app.stage);source=app.view;}else{window.renderer.dirty=true;window.renderer.render();source=window.renderer.canvas;}
        const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,0,0);const rgba=ctx.getImageData(0,0,c.width,c.height).data;
        let bytes='';for(let i=0;i<rgba.length;i+=8192)bytes+=String.fromCharCode(...rgba.subarray(i,i+8192));return {width:c.width,height:c.height,rgba:btoa(bytes),png:c.toDataURL().split(',')[1]};
      },official);
      const [a,b]=await Promise.all([capture(nekoPage,false),capture(page,true)]);
      if(diagnose)for(const [label,p]of [['nekoc',nekoPage],['official',page]])await saveJson(path.join(dir,`${frame}-${label}-readback.json`),await p.evaluate(()=>{const a=window.readbacks10||[];window.readbacks10=[];return a;}));
      filterSamples.push(...await page.evaluate(()=>window.__effects7Filters.splice(0)));
      if(a.width!==b.width||a.height!==b.height)throw Error('Canvas size mismatch');
      const aa=Buffer.from(a.rgba,'base64'),bb=Buffer.from(b.rgba,'base64');
      frames.push({frame,width:a.width,height:a.height,...pixelDifference(aa,bb,8),additionalTolerances:Object.fromEntries([0,1].map(t=>[t,pixelDifference(aa,bb,t)]))});
      for(const [label,img]of [['nekoc',a],['official',b]])await writeFile(path.join(dir,`${frame}-${label}.png`),Buffer.from(img.png,'base64'));
    }});
  await saveJson(path.join(dir,'diagnostics.json'),trace.diagnostics);
  report.cases[name]={sha256:hash(JSON.stringify(spec.project,null,2)+'\n'),observations,frames,filterSamples,errors:trace.errors,events:trace.events.filter(e=>e.event==='block'),assets:trace.diagnostics.assets,pageErrors:trace.diagnostics.pageErrors,externalRequests:trace.diagnostics.externalRequests};
  console.log(name,frames.map(f=>`${f.frame}:${f.changedPixels}`).join(','));
  await saveJson(`docs/kitten4-partial-effects-${round}-${sourceArg?'baseline':'renderer'}.json`,report);
}
