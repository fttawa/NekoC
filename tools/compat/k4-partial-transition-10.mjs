// Original fixtures, native controlled ticker, complete full-canvas samples.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transition9Fixtures, recordTransition9 } from './k4-partial-transition-9.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}}),num=n=>b('','math_number',{NUM:String(n)});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>{nodes[i].next=n;});return nodes[0];};
export async function transition10Fixtures(){
  const old=await transition9Fixtures(),schema=(await readJson('docs/kitten4-block-schema.json')).blocks,cases={};
  for(const name of ['distrot-left','none-left','slide-left','fadeInOut-left','bounce-left'])cases[name]={project:old[name]};
  for(const kind of ['distrot','slide','fadeInOut']){
    const p=structuredClone(old[`${kind}-left`]),[a,c]=p.theatre.scenes_order;
    p.project_name=`NekoC transition 10 inherited filters ${kind}`;
    const aid=Object.keys(p.theatre.actors)[0];
    const effects=[65,0,25,9,0,17,60,8];
    // One original scene-owned thread installs effects BEFORE taking the
    // screenshots. No race against another entity's Start action.
    p.theatre.actors[aid].block_data_json=workspace([],schema);
    p.theatre.scenes[a].block_data_json=workspace([chain(b('fx-start','start_on_click'),
      ...[[0,65],[2,125],[3,9],[5,17],[6,60],[7,8]].map(([scope,v])=>b(`fx-${scope}`,'self_set_effect_2',{scope:String(scope)},{val:num(v)})),
      b('transition','set_scene_transition',{transition:kind,direction:'left'}),b('switch','switch_to_screen',{}, {screen:num(2)}))],schema);
    p.theatre.scenes[c].block_data_json=workspace([],schema);
    const initialFrame={sprites:[{id:a,style:'background',opacity:1,effects}],order:[]};
    const targetFrame={sprites:[{id:c,style:'background-b',opacity:1,effects:[0,0,0,0,0,0,0,0]}],order:[]};
    cases[`${kind}-filters`]={project:p,initialFrame,targetFrame};
  }
  return cases;
}
export async function recordTransition10(name,spec){
  const kind=name.split('-')[0],geometry=[];
  const result=await recordTransition9(`${kind}-left`,spec.project,{...spec,onInspect:async(page,frame)=>{
    if(frame===65)geometry.push(...await page.evaluate(()=>window.__transition10Passes||[]));
    if(frame!==1)return;
    geometry.push(...await page.evaluate(()=>{
      const t=window.__k4OracleRequire('a1xw').a().core.scenes.transition;
      return [t.out_sprite,t.in_sprite].filter(Boolean).map(s=>({bounds:s.getBounds(),radius:s.filters[0].radius,offset:{x:s.filters[0].offset.x,y:s.filters[0].offset.y},padding:s.filters[0].padding}));
    }));
    if(spec.initialFrame)await page.evaluate(ids=>{
      const stage=window.__k4OracleRequire('a1xw').a();
      for(const id of ids){
        const fx=stage.get_scene_by_id(id).get_effects().value;
        for(const [index,f]of fx.effect_filter_list.entries()){
          if(!f||f.__transition10Observed)continue;f.__transition10Observed=true;const apply=f.apply;
          f.apply=function(manager,input,output,...args){if((window.__transition10Passes??=[]).length<50)window.__transition10Passes.push({index,input:[input.width,input.height],frame:{...input.filterFrame},offset:this.offset&&{x:this.offset.x,y:this.offset.y}});return apply.call(this,manager,input,output,...args);};
        }
      }
    },spec.project.theatre.scenes_order);
  }});
  return {...result,geometry};
}
async function main(){
  const rendererLfSha256=createHash('sha256').update((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n')).digest('hex');
  for(const [name,spec]of Object.entries(await transition10Fixtures())){
    if(process.argv.length>2&&!process.argv.slice(2).includes(name))continue;
    await saveJson(`tests/fixtures/kitten4/partial-transition-10-${name}.bcm`,spec.project);
    const result=await recordTransition10(name,spec);
    // Split by case, rather than one megabyte-sized evidence document.
    await saveJson(`docs/kitten4-partial-transition-10-${name}.json`,{schema:'nekoc-k4-transition-10-v1',scope:'native official VM + independent NekoC renderer input; controlled 60Hz performance clock; 65 consecutive full canvas samples, no mask',rendererLfSha256,...result});
    console.log(name,JSON.stringify({maxChanged:Math.max(...result.pixels.map(p=>p.changedPixels)),maxMae:Math.max(...result.pixels.map(p=>p.mae))}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
