// Original editable extensions of the round-7 asymmetric SVG artwork.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partialEffects7Fixtures, effectTypes } from './k4-partial-effects-7-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
export async function partialEffects8Fixtures(){
  const previous=await partialEffects7Fixtures(),schema=(await readJson('docs/kitten4-block-schema.json')).blocks,cases={...previous};
  const make=(name,type,settings,properties={})=>{
    const spec=structuredClone(previous.ascii),p=spec.project,nodes=[];
    p.project_name=`NekoC effects 8 ${name}`;Object.assign(p.theatre.actors[spec.aid],properties);
    const block=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
    const num=value=>block('','math_number',{NUM:String(value)});
    const wait=id=>block(id,'wait',{}, {time:num(0)});
    for(const [i,[scope,value,method='increase']]of settings.entries())nodes.push(block(`fx8-${i}`,type,{scope:String(scope),increase:method},{[type.includes('set_effect')?'val':'steps']:num(value)}),wait(`hold8-${i}`));
    nodes.push(block('clear8','self_clear_effects'),wait('hold-clear8'));
    nodes.unshift(block('start8','start_on_click'));nodes.slice(1).forEach((node,i)=>{nodes[i].next=node;});
    p.theatre.actors[spec.aid].block_data_json=workspace([nodes[0]],schema);
    cases[name]={...spec,frames:settings.length*2+2,type};
  };
  for(const type of effectTypes)make(`${type}-ascii`,type,[[7,8],[7,type.includes('set_effect')?12:4]]);
  make('ascii-fractional','self_set_effect_2',[[7,7.5],[7,1],[7,23]],{x:13.25,y:-7.75,scale:137});
  make('ascii-rotate','self_set_effect_2',[[7,8],[7,12]],{rotation:Math.PI/6});
  make('ascii-offstage','self_set_effect_2',[[7,8],[5,40]],{x:450,y:-320});
  make('all-no-ripple','self_set_effect_2',[[0,65],[1,35],[2,130],[3,9],[5,40],[6,60],[7,8]]);
  for(const name of ['scene-spatial','spatial-offstage','twist','pixelate-fractional','scene-common','ripple'])cases[name]=previous[name];
  const scene=structuredClone(cases['scene-spatial']);
  // Reuse the original full-stage rectangle background with an ASCII chain.
  scene.project.theatre.scenes[scene.sid].block_data_json=cases['self_set_effect_2-ascii'].project.theatre.actors[scene.aid].block_data_json;
  scene.project.project_name='NekoC effects 8 scene ASCII';cases['scene-ascii']=scene;
  return cases;
}
async function main(){for(const [name,spec]of Object.entries(await partialEffects8Fixtures()))await saveJson(`tests/fixtures/kitten4/partial-effects-8-${name}.bcm`,spec.project);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
