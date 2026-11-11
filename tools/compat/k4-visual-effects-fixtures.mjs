// Original colour swatches, including alpha; never derived from corpus artwork.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';

export async function effectsFixture(){
  const project=structuredClone((await visualFixtures()).upright);
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const scene=Object.values(project.theatre.scenes)[0],template=Object.values(project.theatre.actors)[0];
  const body=['#d02850','#2fb080','#3058d0','#a08030'].map((color,i)=>`<rect x="${i*40}" width="40" height="96" fill="${color}"/><rect x="${i*40}" y="96" width="40" height="24" fill="${color}" opacity="0.5"/>`).join('');
  project.theatre.styles['costume-a'].url='data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">${body}</svg>`).toString('base64');
  project.theatre.actors={};scene.actors=[];
  const cases=[['hue-positive',0,65],['hue-negative',0,-110],['gray-full',6,100],['gray-half',6,50],['brightness',2,130],['hue-gray',0,125,6,70]];
  for(const [i,[name,scope,value,secondScope,secondValue]]of cases.entries()){
    const id=`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
    const effect=(suffix,s,v)=>({id:`${name}-${suffix}`,type:'self_set_effect_2',fields:{scope:String(s)},inputs:{val:{id:`${name}-${suffix}-value`,type:'math_number',fields:{NUM:String(v)},inputs:{},statements:{}}},statements:{}});
    const start={id:`${name}-start`,type:'start_on_click',fields:{},inputs:{},statements:{},next:effect('first',scope,value)};
    if(secondScope!==undefined)start.next.next=effect('second',secondScope,secondValue);
    project.theatre.actors[id]={...structuredClone(template),id,name,x:(i%3-1)*250,y:(i<3?1:-1)*130,rotation:0,rotation_type:0,scale:100,block_data_json:workspace([start],schema)};
    scene.actors.push(id);
  }
  for(const group of Object.values(project.theatre.groups))group.actors=[...scene.actors];
  return project;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await saveJson('tests/fixtures/kitten4/visual3-effects.bcm',await effectsFixture());
