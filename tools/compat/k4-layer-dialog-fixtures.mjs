// Original inline-media probes. No corpus/vendor data is copied into fixtures.
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, saveJson } from './k4-oracle.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const num=n=>b('','math_number',{NUM:String(n)});
const text=s=>b('','text',{TEXT:s});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};
const body=(hat,...nodes)=>({...hat,statements:{DO:chain(...nodes)}});
export async function layerDialogFixtures(){
  const base=(await visualFixtures()).layers;
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const [aid,other]=Object.keys(base.theatre.actors),sid=base.theatre.current_scene;
  const result={};
  const mirror=id=>b(id,'mirror',{sprite:aid});
  for(const [name,version,layer] of [
    ['chain','4.11.20',null],['legacy','4.0.0',null],['front','4.11.20','peak'],
    ['forward','4.11.20','previous_level'],['backward','4.11.20','next_level'],['back','4.11.20','bottom'],
  ]){
    const p=structuredClone(base);p.application_version=version;
    p.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),mirror('c1'),mirror('c2'),
      ...(layer?[b('layer','set_theatre_layer',{layer})]:[]),mirror('c3'))],schema);
    result[name]=p;
  }
  // A moved clone leaves the insertion chain; moving another actor does not.
  for(const layer of ['peak','bottom','previous_level','next_level']){
    const p=structuredClone(base);
    p.theatre.actors[aid].block_data_json=workspace([
      chain(b('start','start_on_click'),mirror('c1'),mirror('c2')),
      body(b('key','on_keydown',{key:'65',key_event_type:'down'}),mirror('c3')),
      body(b('clone-start','start_as_a_mirror'),b('layer','set_theatre_layer',{layer})),
    ],schema);result[`clone-${layer}`]=p;
  }
  for(const layer of ['bottom','next_level']){
    const p=structuredClone(result[layer==='bottom'?'back':'backward']);
    p.theatre.scenes[sid].actors=[other,aid];
    result[`middle-${layer}`]=p;
  }
  const split=structuredClone(base);
  split.theatre.scenes[sid].block_data_json=workspace([chain(b('start','start_on_click'),
    b('split1','clone',{sprite:aid},{x:num(30),y:num(0)}),
    b('split2','clone',{sprite:aid},{x:num(60),y:num(0)}))],schema);
  result.split=split;
  for(const [name,positions]of [['pen-below',['below']],['pen-roundtrip',['below','above']]]){
    const p=structuredClone(base);
    p.theatre.actors[other].block_data_json=workspace([chain(b('start','start_on_click'),
      ...positions.map((position,i)=>b('pen-'+i,'set_layer_with_pen',{position})))],schema);
    result[name]=p;
  }
  const dialog=structuredClone(base);
  dialog.variables={after:{id:'after',name:'after',value:0,is_global:true},other:{id:'other',name:'other',value:0,is_global:true}};
  dialog.variable_order=['after','other'];
  dialog.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),
    b('intro','create_stage_dialog',{actor:'__self'},{text:text('Hello NekoC')}),
    b('after','variables_set',{VAR:'after'},{VALUE:num(1)}))],schema);
  dialog.theatre.actors[other].block_data_json=workspace([chain(b('other-start','start_on_click'),
    b('other','variables_set',{VAR:'other'},{VALUE:num(1)}))],schema);
  result.dialog=dialog;
  const pages=structuredClone(dialog);
  pages.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),
    b('intro','create_stage_dialog',{actor:sid},{text:text('分页文字'.repeat(45))}),
    b('after','variables_set',{VAR:'after'},{VALUE:num(1)}))],schema);result.pages=pages;
  const queue=structuredClone(dialog);
  queue.theatre.actors[other].block_data_json=workspace([chain(b('other-start','start_on_click'),
    b('second','create_stage_dialog',{actor:'__self'},{text:text('Second')}),
    b('other','variables_set',{VAR:'other'},{VALUE:num(1)}))],schema);result.queue=queue;
  const askFirst=structuredClone(queue);
  askFirst.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),
    b('ask','self_ask',{}, {text:text('Question')}),
    b('after','variables_set',{VAR:'after'},{VALUE:num(1)}))],schema);result['ask-first']=askFirst;
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  for(const [name,project]of Object.entries(await layerDialogFixtures()))await saveJson(`tests/fixtures/kitten4/layer-dialog-${name}.bcm`,project);
}
