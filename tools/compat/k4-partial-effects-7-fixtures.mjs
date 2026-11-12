#!/usr/bin/env node
// Original asymmetric artwork; no corpus media or vendor implementation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('','math_number',{NUM:String(n)});
const wait=id=>b(id,'wait',{}, {time:num(0)});
const chain=nodes=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};
export const effectTypes=['self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2'];
export async function partialEffects7Fixtures(){
  const base=(await visualFixtures()).upright,schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid=Object.keys(base.theatre.actors)[0],sid=base.theatre.scenes_order[0];
  const cells=Array.from({length:48},(_,i)=>`<rect x="${i%8*12}" y="${Math.floor(i/8)*12}" width="${i%5===0?8:12}" height="12" fill="${['#d93d54','#3976c8','#e7b32a','#238963'][i%4]}" opacity="${i%7===0?.45:1}"/>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72">${cells}<rect x="9" y="17" width="11" height="29" fill="#fff"/><rect x="71" y="4" width="7" height="57" fill="#142836"/></svg>`;
  base.theatre.styles['costume-a'].url='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  Object.assign(base.theatre.actors[aid],{x:13,y:-7,rotation:0,rotation_type:0,scale:200});
  const cases={};
  const make=(name,type,settings,properties={})=>{
    const project=structuredClone(base),nodes=[];
    Object.assign(project.theatre.actors[aid],properties);project.project_name=`NekoC effects 7 ${name}`;
    for(const [i,[scope,value,method='increase']]of settings.entries())nodes.push(b(`effect-${i}`,type,{scope:String(scope),increase:method},{[type.includes('set_effect')?'val':'steps']:num(value)}),wait(`hold-${i}`));
    nodes.push(b('clear','self_clear_effects'),wait('hold-clear'));
    project.theatre.actors[aid].block_data_json=workspace([chain([b('start','start_on_click'),...nodes])],schema);
    cases[name]={project,aid,sid,frames:settings.length*2+2,type};
  };
  for(const type of effectTypes){
    make(type,type,[[0,65],[1,35],[2,type.includes('set_effect')?130:30],[6,60]]);
    make(`${type}-pixelate`,type,[[3,9],[3,4]]);
  }
  make('pixelate-fractional','self_set_effect_2',[[3,1],[3,7.5],[3,72]],{scale:137,x:13.25,y:-7.75});
  make('pixelate-rotate','self_set_effect_2',[[3,9],[3,13]],{rotation:Math.PI/6});
  make('twist','self_set_effect_2',[[5,65],[5,20]]);
  make('twist-rotate','self_set_effect_2',[[5,65],[5,20]],{rotation:Math.PI/6});
  make('twist-fractional','self_set_effect_2',[[5,25],[5,100]],{scale:137,x:13.25,y:-7.75});
  make('twist-pivot','self_set_effect_2',[[5,65],[5,20]],{rotation:Math.PI/6});
  cases['twist-pivot'].project.theatre.styles['costume-a'].rotate_center={x:11,y:-7};
  make('spatial-offstage','self_set_effect_2',[[3,9],[5,40]],{x:450,y:-320});
  make('color-pixelate-twist','self_set_effect_2',[[0,65],[1,35],[2,130],[3,9],[5,40],[6,60]]);
  make('ascii','self_set_effect_2',[[7,8],[7,12]]);
  make('ripple','self_set_effect_2',[[4,65],[4,20]]);
  make('pixelate-twist','self_set_effect_2',[[3,9],[5,40]]);
  make('change-decrease','self_change_effect_3',[[0,65],[0,20,'decrease'],[1,35],[1,10,'decrease'],[2,30],[2,15,'decrease'],[6,60],[6,20,'decrease']]);
  for(const [name,settings]of [['scene-common',[[0,65],[1,35],[2,130],[6,60]]],['scene-spatial',[[3,9],[5,40]]]]){
    make(name,'self_set_effect_2',settings,{visible:false});
    const p=cases[name].project;p.theatre.scenes[sid].block_data_json=p.theatre.actors[aid].block_data_json;
    p.theatre.actors[aid].block_data_json=workspace([],schema);
    const background='<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="#287d96"/><rect x="13" y="37" width="391" height="283" fill="#da4867"/><rect x="513" y="219" width="217" height="353" fill="#dbb436"/><rect x="731" y="13" width="113" height="641" fill="#367142" opacity=".45"/></svg>';
    p.theatre.styles.background.url='data:image/svg+xml;base64,'+Buffer.from(background).toString('base64');
  }
  return cases;
}
async function main(){for(const [name,spec]of Object.entries(await partialEffects7Fixtures()))await saveJson(`tests/fixtures/kitten4/partial-effects-7-${name}.bcm`,spec.project);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
