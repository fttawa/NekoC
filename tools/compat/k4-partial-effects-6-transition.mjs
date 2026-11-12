#!/usr/bin/env node
// New textured backdrop probes. Native transition/ticker vs actual StageRenderer.
// This intentionally isolates scene compositing; it is NOT a VM scheduler proof.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { partialTransition3Fixtures, recordPartialTransition3 } from './k4-partial-transition-3-fixtures.mjs';
import { fixtureHash } from './k4-partial-effects-6-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

export async function effects6Transitions(){
  const previous=await partialTransition3Fixtures(),cases={};
  for(const name of ['slide-right','bounce-left','fadeInOut-left','distrot-left','none-left']){
    const p=structuredClone(previous[name]);p.project_name=`NekoC effects 6 textured transition ${name}`;
    Object.values(p.theatre.actors).forEach(a=>{a.visible=false;});
    for(const [i,id]of ['background','background-b'].entries()){
      const body=`<rect width="960" height="720" fill="${i?'#4065a0':'#bc9250'}"/><rect x="${i?130:320}" y="60" width="350" height="470" fill="${i?'#49ae81':'#d14c70'}" opacity="0.65"/><path d="M0 600L960 120" stroke="#ece3c7" stroke-width="43"/>`;
      p.theatre.styles[id].url='data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720">${body}</svg>`).toString('base64');
    }
    cases[name]=p;
  }return cases;
}
export async function recordEffects6Transition(name,project){
  const source=await readFile('web/renderer.js','utf8'),pen=await readFile('web/pen-k4.js','utf8'),pixels=[];
  const {observations,trace}=await recordPartialTransition3(project,{
    beforeStart:async page=>{
      await page.route('**/effects6-renderer.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
      await page.route('**/pen-k4.js',route=>route.fulfill({contentType:'application/javascript',body:pen}));
      await page.evaluate(async p=>{
        const {StageRenderer}=await import('/effects6-renderer.js');
        const r=new StageRenderer(document.createElement('canvas'));r.resolutionScale=1;r.transitionClock=()=>window.__transitionNow;
        const [a,b]=p.theatre.scenes_order;
        await r.load({_nekocKitten4:{},stageSize:p.size,
          scenes:{currentSceneId:a,scenesDict:{[a]:{currentStyleId:'background',actorIds:[]},[b]:{currentStyleId:'background-b',actorIds:[]}}},
          actors:{actorsDict:{}},styles:{stylesDict:Object.fromEntries(Object.entries(p.theatre.styles).map(([id,s])=>[id,{...s,centerPoint:s.rotate_center}]))}});
        window.__effects6Renderer=r;
      },project);
    },
    onSample:async(page,frame)=>{
      if(![1,2,8,16,24,31,32,46,61,62,65].includes(frame))return;
      pixels.push(await page.evaluate(({frame,name,scenes})=>{
        const [kind,direction]=name.split('-'),r=window.__effects6Renderer;
        if(frame===1)r.apply({scene:scenes[1],transition:{kind,direction},sprites:[],order:[]},new Float32Array());else{r.dirty=true;r.render();}
        const stage=window.__k4OracleRequire('a1xw').a();for(const id of scenes)stage.get_scene_by_id(id).on_tick();
        const app=stage.core.app.get_app();app.renderer.render(app.stage);
        const read=source=>{const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
        const a=read(app.view),b=read(r.canvas);if(a.length!==b.length)throw Error('canvas dimensions differ');
        let changedPixels=0,sum=0,max=0;for(let i=0;i<a.length;i+=4){let d=0;for(let k=0;k<3;k++){const x=Math.abs(a[i+k]-b[i+k]);sum+=x;d=Math.max(d,x);}max=Math.max(max,d);if(d>8)changedPixels++;}
        return {frame,ms:window.__transitionNow,pixels:a.length/4,maskedPixels:0,changedPixels,mae:sum/(a.length/4*3),maxChannelDifference:max,tolerance:8};
      },{frame,name,scenes:project.theatre.scenes_order}));
    },
  });
  return {sha256:fixtureHash(project),observations,pixels,assets:trace.diagnostics.assets,errors:trace.errors,
    externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action!=='blocked').length,pageErrors:trace.diagnostics.pageErrors};
}
async function main(){
  const filter=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
  const report=filter?await readJson('docs/kitten4-partial-effects-6-transitions.json'):{schema:'nekoc-k4-partial-effects-6-transitions-v1',scope:'original textured backgrounds; hidden actor; full frame pixels; controlled native performance/ticker; direct renderer input, NOT VM scheduling',cases:{}};
  for(const [name,project]of Object.entries(await effects6Transitions())){
    if(filter&&filter!==name)continue;
    await saveJson(`tests/fixtures/kitten4/partial-effects-6-transition-${name}.bcm`,project);
    if(!process.argv.includes('--record'))continue;
    const result=await recordEffects6Transition(name,project);report.assets=result.assets;delete result.assets;report.cases[name]=result;
    console.log(name,result.pixels.map(f=>`${f.frame}:${f.changedPixels}`).join(','));
    await saveJson('docs/kitten4-partial-effects-6-transitions.json',report);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
