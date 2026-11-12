#!/usr/bin/env node
// Original textured scene probes; only read/serve the external official kernel.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { effects6Transitions } from './k4-partial-effects-6-transition.mjs';
import { recordPartialTransition3 } from './k4-partial-transition-3-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { fixtureHash } from './k4-partial-effects-6-fixtures.mjs';
import { saveJson, readJson } from './k4-oracle.mjs';

const block=(id,type,fields={},inputs={},statements={})=>({id,type,fields,inputs,statements});
const num=n=>block('', 'math_number',{NUM:String(n)});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>{nodes[i].next=n;});return nodes[0];};
const set=(id,n)=>block(`set-${id}-${n}`,'variables_set',{VAR:id},{VALUE:num(n)});
export async function transition9Fixtures(){
  const old=await effects6Transitions(),schema=(await readJson('docs/kitten4-block-schema.json')).blocks,cases={};
  for(const name of [...['slide','bounce'].flatMap(k=>['up','down','left','right'].map(d=>`${k}-${d}`)),
    'fadeInOut-left','distrot-left','none-left','slide-invalid','fadeInOut-activation','distrot-activation']){
    const p=structuredClone(old[name]||old['none-left']);p.project_name=`NekoC transition 9 ${name}`;
    const [kind,direction]=name.split('-'),[a,b]=p.theatre.scenes_order;
    const actor=Object.keys(p.theatre.actors)[0];
    p.variables={};p.variable_order=['tail','activated','oldTicks','newTicks'];
    for(const id of p.variable_order)p.variables[id]={id,name:id,value:0,type:'any',is_global:true,current_entity:actor,visible:false,position:{x:0,y:0}};
    const inc=id=>block(`inc-${id}`,'change_variable',{valname:id,method:'increase'},{n:num(1)});
    p.theatre.actors[actor].block_data_json=workspace([chain(block('start','start_on_click'),
      block('transition','set_scene_transition',{transition:kind,direction}),
      block('switch','switch_to_screen',{}, {screen:num(2)}),set('tail',1))],schema);
    // Activation root uses the same next-chain convention as the official schema.
    p.theatre.scenes[a].block_data_json=workspace([chain(block('old-activate','on_running_group_activated'),
      block('old-repeat','repeat_forever',{}, {},{DO:inc('oldTicks')}))],schema);
    p.theatre.scenes[b].block_data_json=workspace([chain(block('new-activate','on_running_group_activated'),set('activated',1),
      block('new-repeat','repeat_forever',{}, {},{DO:inc('newTicks')}))],schema);
    if(direction==='activation'){
      p.theatre.actors[actor].block_data_json=workspace([],schema);
      p.theatre.scenes[a].block_data_json=workspace([chain(block('old-activate','on_running_group_activated'),
        block('transition','set_scene_transition',{transition:kind,direction:'left'}),
        block('switch','switch_to_screen',{}, {screen:num(2)}),set('tail',1),
        block('old-repeat','repeat_forever',{}, {},{DO:inc('oldTicks')}))],schema);
    }
    cases[name]=p;
  }return cases;
}

export async function recordTransition9(name,project,{rendererSource,onInspect,initialFrame,targetFrame}={}){
  const source=rendererSource??await readFile('web/renderer.js','utf8'),pen=await readFile('web/pen-k4.js','utf8'),pixels=[],events=[];
  const {observations,trace}=await recordPartialTransition3(project,{
    beforeStart:async page=>{
      await page.route('**/transition9-renderer.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
      await page.route('**/pen-k4.js',r=>r.fulfill({contentType:'application/javascript',body:pen}));
      await page.evaluate(async p=>{
        const {StageRenderer}=await import('/transition9-renderer.js');
        const r=new StageRenderer(document.createElement('canvas'));r.resolutionScale=1;r.transitionClock=()=>window.__transitionNow;
        const [a,b]=p.theatre.scenes_order;
        await r.load({_nekocKitten4:{},stageSize:p.size,
          scenes:{currentSceneId:a,scenesDict:{[a]:{currentStyleId:'background',actorIds:[]},[b]:{currentStyleId:'background-b',actorIds:[]}}},
          actors:{actorsDict:{}},styles:{stylesDict:Object.fromEntries(Object.entries(p.theatre.styles).map(([id,s])=>[id,{...s,centerPoint:s.rotate_center}]))}});
        window.__transition9Renderer=r;window.__transition9Events=[];
        // Runtime completion observed via stage's public scene-changed event below.
        const stage=window.__k4OracleRequire('a1xw').a();
        const scenes=stage.core.scenes,original=scenes.set_one_scene_visible;
        scenes.set_one_scene_visible=function(id){window.__transition9Events.push({phase:'ticker-completion',ms:window.__transitionNow,id});return original.call(this,id);};
      },project);
      if(initialFrame)await page.evaluate(frame=>window.__transition9Renderer.apply(frame,new Float32Array()),initialFrame);
    },
    onSample:async(page,frame)=>{
      await onInspect?.(page,frame);
      pixels.push(await page.evaluate(({frame,name,scenes,targetFrame})=>{
        const [kind,direction]=name.split('-'),r=window.__transition9Renderer;
        if(frame===1)r.apply({scene:scenes[1],transition:{kind,direction},sprites:[],order:[],...targetFrame},new Float32Array());else{r.dirty=true;r.render();}
        const stage=window.__k4OracleRequire('a1xw').a();for(const id of scenes)stage.get_scene_by_id(id).on_tick();
        const app=stage.core.app.get_app();app.renderer.render(app.stage);
        const read=source=>{const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
        const a=read(app.view),b=read(r.canvas);if(a.length!==b.length)throw Error('canvas dimensions differ');
        let changedPixels=0,sum=0,max=0;for(let i=0;i<a.length;i+=4){let d=0;for(let k=0;k<3;k++){const x=Math.abs(a[i+k]-b[i+k]);sum+=x;d=Math.max(d,x);}max=Math.max(max,d);if(d>8)changedPixels++;}
        return {frame,ms:window.__transitionNow,pixels:a.length/4,changedPixels,mae:sum/(a.length/4*3),maxChannelDifference:max,tolerance:8};
      },{frame,name,scenes:project.theatre.scenes_order,targetFrame}));
      if(frame===65)events.push(...await page.evaluate(()=>window.__transition9Events));
    },
  });
  return {sha256:fixtureHash(project),observations,pixels,events,frames:trace.frames,errors:trace.errors,pageErrors:trace.diagnostics.pageErrors,
    assets:trace.diagnostics.assets,externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action!=='blocked').length};
}
async function main(){
  const report={schema:'nekoc-k4-transition-9-v1',scope:'65 consecutive frames, native ticker, controlled performance clock; original textured scenes; full-frame RGB tolerance 8; independent renderer input and official VM variables',cases:{}};
  for(const [name,p]of Object.entries(await transition9Fixtures())){
    if(process.env.K4_TRANSITION_CASE&&process.env.K4_TRANSITION_CASE!==name)continue;
    await saveJson(`tests/fixtures/kitten4/partial-transition-9-${name}.bcm`,p);
    if(!process.argv.includes('--record'))continue;
    const result=await recordTransition9(name,p);report.assets=result.assets;delete result.assets;report.cases[name]=result;
    console.log(name,JSON.stringify({pixels:result.pixels.map(f=>f.changedPixels),events:result.events,first:result.frames[0],last:result.frames.at(-1)}));
  }
  if(process.argv.includes('--record'))await saveJson('docs/kitten4-partial-transition-9-evidence.json',report);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
