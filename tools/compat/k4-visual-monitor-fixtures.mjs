import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';

export async function monitorPixelFixture(){
  const project=structuredClone((await visualFixtures()).upright),actor=Object.values(project.theatre.actors)[0];
  actor.visible=false;actor.name='Owner';
  project.variables={};
  for(const [i,[name,value,scale,owner]]of [['Score',17,1,''],['分辨率',.85,1,''],['fps',0,1.166,''],['Local',31,1,actor.id],['Empty','',.75,'']].entries()){
    const id=`monitor-${i}`;project.variables[id]={id,name,value,type:'any',is_global:!owner,current_entity:owner,theme:'common',scale,visible:true,position:{x:-460+(i%2)*350,y:330-Math.floor(i/2)*180}};
  }
  project.variable_order=Object.keys(project.variables);
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  actor.block_data_json=workspace([{id:'monitor-start',type:'start_on_click',fields:{},inputs:{},statements:{},next:{id:'monitor-wait',type:'wait',fields:{},inputs:{time:{id:'monitor-time',type:'math_number',fields:{NUM:'.2'},inputs:{},statements:{}}},statements:{},next:{id:'monitor-change',type:'variables_set',fields:{VAR:'monitor-0'},inputs:{VALUE:{id:'monitor-value',type:'math_number',fields:{NUM:'1234'},inputs:{},statements:{}}},statements:{}}}}],schema);
  return project;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await saveJson('tests/fixtures/kitten4/visual3-monitors.bcm',await monitorPixelFixture());
