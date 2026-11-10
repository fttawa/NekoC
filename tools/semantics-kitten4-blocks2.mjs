#!/usr/bin/env node
// Self-authored official-editor probes; never loads a corpus work.
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtures,workspace} from './semantics-kitten4.mjs';
import {loadPlaywright,openOfficial,loadOfficialProject,officialUrl} from './probe-kitten4.mjs';
const b=(type,fields={},inputs={},statements={})=>({type,fields,inputs,statements});
const n=v=>b('math_number',{NUM:String(v)});
const text=v=>b('text',{TEXT:v});
const set=(name,v)=>b('variables_set',{VAR:name},{VALUE:v});
const chain=(...bs)=>{for(let i=1;i<bs.length;i++)bs[i-1].next=bs[i];return bs[0];};
const costume=()=>b('get_3',{sprite:'__self',attribute:'2'});

export function blockCases(){
  const result={};
  for(const name of ['invalid-list','costume','negative-list','flip','backdrop']){
    const p=fixtures().costume,actor=Object.values(p.theatre.actors)[0];
    p.project_name='NekoC blocks2 '+name;
    const names=['before','after','value','number','other','fraction','wrap','name','width','activated'];
    p.variables=Object.fromEntries(names.map(id=>[id,{id,name:id,type:'any',value:0,is_global:true,current_entity:actor.id,visible:false,position:{x:0,y:0}}]));
    p.variable_order=names;
    let blocks=[];
    if(name==='invalid-list')blocks=[set('before',n(123)),b('lists_append',{}, {VAR:b('variables_get',{VAR:'before'}),VALUE:n(7)}),set('after',n(1))];
    if(name==='costume')blocks=[
      b('set_costume',{}, {index:n(0)}),set('wrap',costume()),
      b('set_costume',{}, {index:n(3)}),set('number',costume()),
      b('set_costume',{}, {index:n(1.5)}),set('fraction',costume()),
      b('set_costume',{}, {index:text('missing')}),set('after',costume()),
      b('set_costume',{}, {index:text(' 蓝色方块 ')}),set('name',costume()),
    ];
    if(name==='negative-list')blocks=[set('value',b('lists_get_value',{TYPE:'first'}, {
      VAR:b('text_split',{}, {TEXT_TO_SPLIT:text('10,20,30'),SPLIT_TEXT:text(',')}),INDEX:n(-1)})),set('after',n(1))];
    if(name==='flip')blocks=[b('self_flip',{options:'0'}),b('self_flip',{options:'1'}),
      b('set_scale',{}, {scale:n(80)}),set('width',b('get_3',{sprite:'__self',attribute:'16'})),set('after',n(1))];
    const roots=[chain(b('start_on_click'),...blocks),chain(b('start_on_click'),b('wait',{}, {time:n(0.1)}),set('other',n(1)))];
    actor.block_data_json=workspace(roots);
    if(name==='backdrop'){
      const scene=p.theatre.scenes_order[0];
      p.theatre.scenes[scene].block_data_json=workspace([b('backdrop_on_change',{sprite:scene},{},{DO:set('activated',n(7))})]);
    }
    result[name]=p;
  }
  return result;
}

async function main(){
  const index=process.argv.indexOf('--out');
  if(index<0)throw Error('Usage: node tools/semantics-kitten4-blocks2.mjs --out report.json');
  const browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
  const report={officialUrl,verifiedAt:new Date().toISOString(),browserVersion:browser.version(),cases:{}};
  try{
    for(const [name,input]of Object.entries(blockCases())){
      const page=await browser.newPage();
      try{
        await openOfficial(page);
        await loadOfficialProject(page,input);
        const issues=[];
        for(const owner of [...Object.values(input.theatre.scenes),...Object.values(input.theatre.actors)]){
          if(!Object.keys(owner.block_data_json.blocks).length)continue;
          const observed=await page.evaluate(id=>{const r=window.__nekocKitten4Require;r('Fye/').B.select_workspace_by_id(id);return Blockly.json.workspace_to_json(Blockly.mainWorkspace);},owner.id);
          for(const [id,block]of Object.entries(owner.block_data_json.blocks)){
            if(observed.blocks[id]?.type!==block.type)issues.push(id+': type');
            for(const [key,v]of Object.entries(block.fields))if(String(observed.blocks[id]?.fields[key])!==String(v))issues.push(id+': '+key);
            for(const [child,edge]of Object.entries(owner.block_data_json.connections[id]))if(Object.entries(edge).some(([k,v])=>observed.connections[id]?.[child]?.[k]!==v))issues.push(id+' -> '+child);
          }
        }
        if(issues.length)throw Error(issues.join('; '));
        await page.locator('#btn_trigger').dispatchEvent('click');
        await page.waitForTimeout(600);
        const state=await page.evaluate(()=>{
          const req=window.__nekocKitten4Require,heart=req('JnWR').b(),manager=heart.get_runtime_manager(),doc=req('TzHo').e.getDoc();
          const actor=req('HP1x').a().get_actor_by_id(Object.keys(doc.theatre.actors)[0]);
          return {variables:Object.fromEntries(Object.keys(doc.variables).map(id=>[id,manager.get_variable(id)])),
            error:req('ALsR').a.get_state().error_state,running:heart.get_runtime_data().is_running(),
            flip:actor?{x:actor.get_vertical_flipped(),y:actor.get_horizontal_flipped()}:null,
            scripts:[...document.scripts].map(s=>s.src).filter(Boolean)};
        });
        report.cases[name]={inputSha256:createHash('sha256').update(JSON.stringify(input)).digest('hex'),workspaceIssues:issues,state};
        console.log(name,JSON.stringify(state));
      }finally{await page.close();}
    }
  }finally{await browser.close();}
  await mkdir(path.dirname(path.resolve(process.argv[index+1])),{recursive:true});
  await writeFile(process.argv[index+1],JSON.stringify(report,null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
