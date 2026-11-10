#!/usr/bin/env node
// Original input probes: no external works or runtime implementation embedded.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

export async function inputFixture() {
  const p = await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema = (await readJson('docs/kitten4-block-schema.json')).blocks;
  const actor = Object.keys(p.theatre.actors)[0], scene = p.theatre.scenes_order[0];
  delete p.compile_result;
  p.project_name = 'NekoC original input probe';
  const b = (id,type,fields={},inputs={},statements={}) => ({id,type,fields,inputs,statements});
  const roots = [], variables = {};
  roots.push({...b('start','start_on_click'),next:b('drag-enabled','self_set_draggable',{draggable:'1'})});
  function count(id, type, fields) {
    variables[id] = {id,name:id,value:0,type:'number',is_global:true,current_entity:actor,visible:false,position:{x:0,y:0}};
    roots.push(b(`hat-${id}`,type,fields,{}, {DO:b(`add-${id}`,'change_variable',{valname:id,method:'increase'},{n:b('','math_number',{NUM:'1'})})}));
  }
  for (const key of ['65','any','48']) for (const state of ['down','up']) count(`key-${key}-${state}`,'on_keydown',{key,key_event_type:state});
  for (const target of ['__self','__scene']) for (const state of ['mouse_down','mouse_up','mouse_click']) count(`${target}-${state}`,'sprite_on_tap',{actor:target,type:state});
  for (const direction of ['left','right','up','down']) count(`swipe-${direction}`,'on_swipe',{type:direction});
  for (const entity of Object.values(p.theatre.scenes)) entity.block_data_json = workspace([],schema);
  p.theatre.actors[actor].block_data_json = workspace(roots,schema);
  p.theatre.actors[actor].draggable = true;
  p.theatre.actors[actor].scale = 100;
  p.theatre.actors[actor].x = 0; p.theatre.actors[actor].y = 0;
  p.theatre.actors[actor].rotation = 0;
  p.variables = variables; p.variable_order = Object.keys(variables);
  // An asymmetric 80x40 alpha shape: right half entirely transparent.
  const style = p.theatre.actors[actor].current_style_id;
  p.theatre.styles[style].url = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><path fill="red" d="M0 0h40v40H0z"/></svg>').toString('base64');
  p.theatre.styles[style].cdn_url = p.theatre.styles[style].url;
  p.theatre.scenes[scene].actors = [actor];
  return p;
}

export function inputScript() {
  const events=[];
  const key=(frame,type,key_code)=>events.push({frame,time_ms:frame*20,type,key_code});
  const pointer=(frame,type,x,y,pointer_type='mouse',time_ms=frame*20)=>events.push({frame,time_ms,type,x,y,pointer_type});
  key(2,'keydown',65); key(5,'keyup',65);
  key(7,'keydown',96); key(8,'keyup',96);
  pointer(10,'pointerdown',-20,0); pointer(13,'pointerup',-20,0);
  pointer(15,'pointerdown',20,0); pointer(16,'pointerup',20,0);
  pointer(18,'pointerdown',-20,0,'touch'); pointer(19,'pointermove',-10,5,'touch'); pointer(20,'pointerup',-10,5,'touch');
  pointer(22,'pointerdown',200,100); pointer(23,'pointermove',240,100); pointer(24,'pointerup',260,100);
  pointer(26,'pointerdown',200,100); pointer(27,'pointerup',220,100,'mouse',1600);
  events.push({frame:30,time_ms:1700,type:'keydown',key_code:65},{frame:30,time_ms:1710,type:'keyup',key_code:65});
  events.push({frame:32,time_ms:1800,type:'keydown',key_code:65},{frame:33,time_ms:1820,type:'keydown',key_code:66},
    {frame:34,time_ms:1840,type:'keyup',key_code:65},{frame:36,time_ms:1880,type:'keyup',key_code:66});
  return {schema:'nekoc-input-v1',events};
}

export function transformedInputScript() {
  return {schema:'nekoc-input-v1',events:[
    {frame:2,time_ms:20,type:'pointerdown',x:0,y:-40},
    {frame:4,time_ms:60,type:'pointerup',x:0,y:-40},
    {frame:6,time_ms:100,type:'pointerdown',x:0,y:40},
    {frame:7,time_ms:120,type:'pointerup',x:0,y:40},
  ]};
}

export async function transformedInputFixture() {
  const p=await inputFixture(), a=Object.values(p.theatre.actors)[0];
  a.rotation=Math.PI/2; a.scale=200;
  p.project_name='NekoC original rotated scaled input probe';
  return p;
}

export async function ghostInputFixture() {
  const p=await inputFixture(),a=Object.values(p.theatre.actors)[0];
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const graph=a.block_data_json;
  const effect=workspace([{id:'ghost',type:'self_set_effect_2',fields:{scope:'1'},inputs:{val:{id:'ghost-value',type:'math_number',fields:{NUM:'100'},inputs:{},statements:{}}},statements:{}}],schema);
  effect.blocks.ghost.parent_id='drag-enabled';
  graph.connections['drag-enabled'].ghost={type:'next'};
  Object.assign(graph.blocks,effect.blocks);Object.assign(graph.connections,effect.connections);
  p.project_name='NekoC original ghost hit input probe';
  return p;
}

async function main() {
  for (const [name,project,script,frames] of [
    ['input',await inputFixture(),inputScript(),38],
    ['input-transform',await transformedInputFixture(),transformedInputScript(),8],
    ['input-ghost',await ghostInputFixture(),{schema:'nekoc-input-v1',events:[{frame:2,time_ms:20,type:'pointerdown',x:-20,y:0},{frame:3,time_ms:40,type:'pointerup',x:-20,y:0}]},4],
  ]) {
    await saveJson(`tests/fixtures/kitten4/${name}.bcm`,project);
    await saveJson(`tests/fixtures/kitten4/${name}-script.json`,script);
    if (!process.argv.includes('--record')) continue;
    const trace=await runOracle(project,{frames,inputScript:script});
    const bytes=JSON.stringify(project,null,2)+'\n';
    await saveJson(`docs/${name}-evidence.json`,{schema:'nekoc-input-evidence-v1',sha256:createHash('sha256').update(bytes).digest('hex'),inputSha256:createHash('sha256').update(JSON.stringify(script,null,2)+'\n').digest('hex'),assets:trace.diagnostics.assets,inputObservations:trace.inputObservations,
      frames:trace.frames.map(({frame,variables,actors})=>({frame,variables,actors}))});
    console.log(JSON.stringify(trace.frames.map(f=>({frame:f.frame,variables:f.variables,actor:Object.values(f.actors)[0]})),null,2));
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1;});
