// Original, small inline SVGs and editable workspaces; no corpus media.
import { readJson, saveJson } from './k4-oracle.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('','math_number',{NUM:String(n)});
const text=s=>b('','text',{TEXT:s});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};
const svg=(width,height,body)=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`).toString('base64');
export async function visualFixtures(){
  const base=await readJson('tests/fixtures/kitten4/semantics-screen.bcm');
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const sid=Object.keys(base.theatre.scenes)[0],aid=Object.keys(base.theatre.actors)[0];
  base.size={width:960,height:720};base.variables={};base.variable_order=[];delete base.compile_result;
  base.theatre.scenes_order=[sid];base.theatre.scenes={[sid]:base.theatre.scenes[sid]};base.theatre.scenes[sid].block_data_json=workspace([],schema);
  base.theatre.styles={background:{id:'background',name:'background',url:svg(960,720,'<rect width="960" height="720" fill="#d8e7f0"/>'),rotate_center:{x:0,y:0}},
    'costume-a':{id:'costume-a',name:'asymmetric',url:svg(80,40,'<rect width="80" height="40" fill="#e84030"/><rect width="20" height="15" fill="#20b060"/>'),rotate_center:{x:0,y:0}}};
  const actor=base.theatre.actors[aid];actor.styles=['costume-a'];actor.block_data_json=workspace([],schema);
  const result={};
  for(const [name,rotation,rotation_type,pivot]of [
    ['upright',0,0,{x:0,y:0}],['rotate',Math.PI/3,0,{x:0,y:0}],['pivot',Math.PI/3,0,{x:13,y:-7}],
    ['left-right',Math.PI,1,{x:13,y:0}],['left-right-up',Math.PI/3,1,{x:0,y:0}],['none',Math.PI/3,2,{x:0,y:0}],
  ]){const p=structuredClone(base);Object.assign(p.theatre.actors[aid],{rotation,rotation_type,scale:125});p.theatre.styles['costume-a'].rotate_center=pivot;result[name]=p;}
  const pen=structuredClone(base);pen.theatre.actors[aid].visible=false;
  const cover=structuredClone(base);cover.theatre.actors[aid].visible=false;
  cover.theatre.styles.background.url=svg(480,240,'<rect width="480" height="240" fill="#d8e7f0"/><rect width="80" height="240" fill="#e84030"/><rect x="400" width="80" height="240" fill="#20b060"/>');
  result.cover=cover;
  const zoom=structuredClone(base);zoom.theatre.actors[aid].visible=false;
  zoom.theatre.styles.background.url=svg(960,720,'<rect width="960" height="720" fill="#d8e7f0"/><rect x="440" y="320" width="80" height="80" fill="#e84030"/>');
  zoom.theatre.scenes[sid].block_data_json=workspace([chain(b('start','start_on_click'),b('zoom','set_scale',{}, {scale:num(300)}))],schema);result['background-scale']=zoom;
  const noAdaptive=structuredClone(cover);noAdaptive.theatre.styles.background.adaptive=false;result['no-adaptive']=noAdaptive;
  const layers=structuredClone(base),other='20000000-0000-4000-8000-000000000003';
  layers.theatre.actors[other]={...structuredClone(actor),id:other,x:25,y:10,scale:70};
  layers.theatre.scenes[sid].actors=[aid,other];layers.theatre.groups.group.actors=[aid,other];result.layers=layers;
  pen.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),b('color','self_set_pen_color',{color:'#2060d0'}),b('size','self_set_pen_size',{}, {size:num(9)}),b('down','self_pen_down'),b('move','self_move_to',{}, {x:num(90),y:num(55)}),b('up','self_pen_up'))],schema);result.pen=pen;
  const stamp=structuredClone(base);stamp.theatre.actors[aid].visible=false;
  stamp.theatre.actors[aid].rotation=Math.PI/6;
  stamp.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),b('color','self_set_pen_color',{color:'#204060'}),b('stamp','stamp',{align:'center'},{text:text('NekoC 像素'),size:num(24)}))],schema);result.stamp=stamp;
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  for(const [name,project]of Object.entries(await visualFixtures()))await saveJson(`tests/fixtures/kitten4/visual-${name}.bcm`,project);
}
