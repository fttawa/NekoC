#!/usr/bin/env node
// Owned artwork and workspace probes. No corpus or vendor implementation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('', 'math_number', {NUM:String(n)});
const chain=nodes=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};
const wait=id=>b(id,'wait',{}, {time:num(0)});
const move=(id,x,y)=>b(id,'self_move_to',{}, {x:num(x),y:num(y)});
const effect=(id,type,scope,value)=>b(id,type,{scope:String(scope),increase:'increase'}, {[type.includes('set_effect')?'val':'steps']:num(value)});
const svg=body=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64">${body}</svg>`).toString('base64');
export const fixtureHash=p=>createHash('sha256').update(JSON.stringify(p,null,2)+'\n').digest('hex');

export async function partialEffects6Fixtures(){
  const base=(await visualFixtures()).upright;
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid=Object.keys(base.theatre.actors)[0],sid=base.theatre.scenes_order[0],cases={};
  // Fine and broad spatial frequencies, transparent rows and an asymmetric hole.
  const cells=Array.from({length:96},(_,x)=>`<rect x="${x}" y="${x%3}" width="1" height="58" fill="${['#cb3153','#2b9875','#345fc1','#aa7834'][Math.floor(x/12)%4]}" opacity="${x%7===0?.4:1}"/>`).join('');
  base.theatre.styles['costume-a'].url=svg(cells);
  Object.assign(base.theatre.actors[aid],{x:0,y:0,scale:200,rotation:0,rotation_type:0});
  const make=(name,nodes,properties={})=>{
    const project=structuredClone(base);project.project_name=`NekoC effects 6 ${name}`;
    Object.assign(project.theatre.actors[aid],properties);
    project.theatre.actors[aid].block_data_json=workspace([chain([b('start','start_on_click'),...nodes])],schema);
    cases[name]={project,aid,sid,frames:12};
  };
  for(const type of ['self_set_effect_2','self_change_effect_3','self_clear_effects','self_set_effect','self_change_effect','self_change_effect_2']){
    const nodes=[];
    if(type==='self_clear_effects'){
      for(let scope=0;scope<8;scope++)nodes.push(effect(`seed-${scope}`,'self_set_effect_2',scope,scope===2?130:scope===7?8:30));
      nodes.push(wait('hold-all'),b('clear',type),wait('hold-clear'));
    }else{
      for(const [scope,v] of [[0,65],[1,35],[2,type.includes('set_effect')?130:30],[6,60]])nodes.push(effect(`effect-${scope}`,type,scope,v),wait(`hold-${scope}`));
      nodes.push(b('clear','self_clear_effects'),wait('hold-clear'));
    }
    make(type,nodes);
  }
  for(const [scope,label,value] of [[3,'pixelate',9],[4,'ripple',65],[5,'twist',65],[7,'ascii',8]])make(`scope-${label}`,[effect('set','self_set_effect_2',scope,value),wait('hold'),effect('change','self_change_effect_3',scope,4),wait('hold-change'),b('clear','self_clear_effects')]);
  for(const [align,rotation] of [['left',0],['center',Math.PI/6],['right',-Math.PI/4]]){
    const nodes=[b('color','self_set_pen_color',{color:'#304c81'}),b('alpha','self_set_pen_color_property',{scope:'alpha'},{val:num(50)})];
    for(let i=0;i<3;i++)nodes.push(move(`move-${i}`,-130+i*110,70-i*50),b(`stamp-${i}`,'stamp',{align},{text:b('','text',{TEXT:'K4 Ag 6'}),size:num(23.5)}),wait(`hold-${i}`));
    make(`stamp-${align}`,nodes,{visible:false,rotation,scale:100});
  }
  for(const [label,rotation,scale,pivot] of [['alpha',0,100,{x:0,y:0}],['pivot-rotate',Math.PI/5,73,{x:11,y:-7}]]){
    const nodes=[effect('opacity','self_set_effect_2',1,100),effect('hue','self_set_effect_2',0,110)];
    for(let i=0;i<3;i++)nodes.push(move(`move-${i}`,-130+i*110,60-i*40),b(`image-${i}`,'image_stamp'),wait(`hold-${i}`));
    make(`image-${label}`,nodes,{visible:false,rotation,scale});cases[`image-${label}`].project.theatre.styles['costume-a'].rotate_center=pivot;
  }
  return cases;
}

export async function recordEffects6(spec){
  const observations=[];
  const trace=await runOracle(spec.project,{frames:spec.frames,virtualTime:true,blocks:true,seed:1,
    beforeStart:async page=>page.evaluate(aid=>{
      const stage=window.__k4OracleRequire('a1xw').a();
      const proto=Object.getPrototypeOf(stage.get_actor_by_id(aid).get_brush());
      window.__effects6Calls=[];
      for(const name of ['draw_text_stamp','draw_image_stamp']){
        const original=proto[name];
        proto[name]=function(...args){window.__effects6Calls.push({name,args:args.map(v=>typeof v==='object'?'object':v)});return original.apply(this,args);};
      }
    },spec.aid),
    onFrame:async(page,frame)=>observations.push(await page.evaluate(({aid,frame})=>{
      const stage=window.__k4OracleRequire('a1xw').a(),actor=stage.get_actor_by_id(aid);
      const result=actor.get_effects(),fx=result.value;if(result.is_error(fx))throw Error('effects unavailable');
      const brush=actor.get_brush(),rgba=brush.ctx.getImageData(0,0,960,720).data;
      let nonzero=0,alphaSum=0;for(let i=3;i<rgba.length;i+=4){if(rgba[i])nonzero++;alphaSum+=rgba[i];}
      return {frame,opacity:actor.get_alpha(),effects:['hue','brightness','pixelate','displacement','twist','saturate','ascii'].map(k=>fx[`get_${k}`]()),calls:[...window.__effects6Calls],brush:{nonzero,alphaSum}};
    },{aid:spec.aid,frame})),
  });
  return {sha256:fixtureHash(spec.project),observations,errors:trace.errors,assets:trace.diagnostics.assets,
    externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action!=='blocked').length,
    externalRequests:trace.diagnostics.externalRequests,pageErrors:trace.diagnostics.pageErrors,
    events:trace.events.filter(e=>e.event==='block')};
}
async function main(){
  const evidence={schema:'nekoc-k4-partial-effects-6-evidence-v1',cases:{}};
  for(const [name,spec]of Object.entries(await partialEffects6Fixtures())){
    await saveJson(`tests/fixtures/kitten4/partial-effects-6-${name}.bcm`,spec.project);
    if(!process.argv.includes('--record'))continue;
    const record=await recordEffects6(spec);evidence.assets=record.assets;delete record.assets;evidence.cases[name]=record;
    console.log(name,record.observations.length,'frames',JSON.stringify(record.errors));
    await saveJson('docs/kitten4-partial-effects-6-evidence.json',evidence);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
