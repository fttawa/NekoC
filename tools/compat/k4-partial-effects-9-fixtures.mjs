// Original editable ASCII-combination probes; no external artwork or source.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partialEffects8Fixtures } from './k4-partial-effects-8-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
export async function partialEffects9Fixtures(){
  const previous=await partialEffects8Fixtures(),schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const cases=Object.fromEntries(['all-no-ripple','ascii-offstage'].map(name=>[name,structuredClone(previous[name])]));
  for(const [name,settings]of Object.entries({
    'ascii-hue':[[0,65],[7,8]],'ascii-alpha':[[1,35],[7,8]],
    'ascii-brightness':[[2,130],[7,8]],'ascii-pixelate':[[3,9],[7,8]],
    'ascii-twist':[[5,40],[7,8]],'ascii-saturate':[[6,60],[7,8]],
    'ascii-twist-fractional':[[5,17],[7,7.5]],
  })){
    const spec=structuredClone(previous.ascii),p=spec.project;
    p.project_name=`NekoC effects 9 ${name}`;
    const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}}),num=n=>b('','math_number',{NUM:String(n)});
    const nodes=[b('start9','start_on_click')];
    for(const [i,[scope,value]]of settings.entries())nodes.push(b(`fx9-${i}`,'self_set_effect_2',{scope:String(scope),increase:'increase'},{val:num(value)}),b(`wait9-${i}`,'wait',{}, {time:num(0)}));
    nodes.push(b('clear9','self_clear_effects'),b('wait-clear9','wait',{}, {time:num(0)}));
    nodes.slice(1).forEach((node,i)=>{nodes[i].next=node;});
    p.theatre.actors[spec.aid].block_data_json=workspace([nodes[0]],schema);
    if(name.endsWith('fractional'))Object.assign(p.theatre.actors[spec.aid],{x:13.25,y:-7.75,scale:137,rotation:Math.PI/6});
    cases[name]={...spec,frames:settings.length*2+2,type:'self_set_effect_2'};
  }
  return cases;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  for(const [name,spec]of Object.entries(await partialEffects9Fixtures()))await saveJson(`tests/fixtures/kitten4/partial-effects-9-${name}.bcm`,spec.project);
}
