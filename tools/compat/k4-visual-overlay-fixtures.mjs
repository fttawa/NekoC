#!/usr/bin/env node
// Original overlay probes. Vendor code and corpus projects are never fixture inputs.
import { visualFixtures } from './k4-visual-fixtures.mjs';
import { workspace } from './k4-scheduling-fixtures.mjs';
import { readJson, runOracle, saveJson } from './k4-oracle.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { pixelDifference } from './k4-visual.mjs';

const b=(id,type,fields={},inputs={})=>({id,type,fields,inputs,statements:{}});
const text=value=>b('','text',{TEXT:value});
const chain=(...nodes)=>{nodes.slice(1).forEach((node,i)=>nodes[i].next=node);return nodes[0];};
export const OVERLAY_FRAMES=[1,30,60];
export const OVERLAY_TEXT='NekoC 原创介绍。Hello overlay!';

export async function overlayFixtures(){
  const base=(await visualFixtures()).upright;
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const aid=Object.keys(base.theatre.actors)[0],sid=base.theatre.current_scene;
  const projects={};
  for(const name of ['actor','scene','portrait','say','think','say-edge']){
    const p=structuredClone(base),actor=p.theatre.actors[aid];
    p.project_name=`NekoC visual3 overlay ${name}`;
    actor.name='NekoC 演示';actor.scale=100;actor.rotation=0;
    p.theatre.scenes[sid].name='NekoC 舞台';
    if(name==='scene')p.size={width:1280,height:720};
    if(name==='portrait'){
      p.size={width:620,height:900};
      // Same original two-colour artwork, with a tall preview aspect ratio.
      p.theatre.styles['costume-a'].url='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="80"><rect width="40" height="80" fill="#e84030"/><rect width="20" height="15" fill="#20b060"/></svg>').toString('base64');
    }
    const bubble=name==='say'||name==='think'||name==='say-edge';
    if(name==='say-edge'){actor.x=410;actor.y=290;}
    actor.block_data_json=workspace([chain(b('start','start_on_click'),bubble
      ?b('bubble','self_dialog_wait',{type:name==='think'?'think':'say'},{text:text('NekoC 气泡')})
      :b('intro','create_stage_dialog',{actor:name==='scene'?sid:'__self'},{text:text(OVERLAY_TEXT)}))],schema);
    projects[name]=p;
  }
  const choice=structuredClone(base);
  choice.size={width:1280,height:720};choice.project_name='NekoC visual3 overlay choice';
  choice.theatre.actors[aid].visible=false;
  choice.theatre.actors[aid].block_data_json=workspace([chain(b('start','start_on_click'),
    b('choice','ask_and_choose',{}, {question:text('NekoC 原创问题'),CHOICE0:text('继续👌！')}))],schema);
  projects.choice=choice;
  return projects;
}

// Record public component state and pixels without needing the Rust trace binary.
// Raw data and official screenshots stay in ignored dist/, never in tracked paths.
export async function recordOverlay(project,name,options={}){
  const dir=path.join('dist/visual3-overlay/oracle',name);await mkdir(dir,{recursive:true});
  const samples=[];let domPage;
  const trace=await runOracle(project,{frames:60,seed:1,virtualTime:true,...options,
    beforeStart:async page=>{
      if(!options.compare)return;
      domPage=await page.context().newPage();
      await domPage.route('**/overlay-probe.js',async route=>route.fulfill({contentType:'application/javascript',body:options.overlaySource||await readFile('web/overlay.js','utf8')}));
      await domPage.route('**/overlay-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0}#box{position:relative;overflow:hidden}#base{display:block;width:100%;height:100%}</style><div id="box"><img id="base"></div>'}));
      await domPage.goto(new URL('/overlay-probe',page.url()).href);
    },
    onFrame:async(page,frame)=>{
      if(!OVERLAY_FRAMES.includes(frame))return;
      const sample=await page.evaluate(()=>{
        const stage=window.__k4OracleRequire('a1xw').a(),app=stage.core.app.get_app();
        app.renderer.render(app.stage);
        const d=stage.core.components.get_stage_dialog();
        const node=n=>n?{x:n.x,y:n.y,width:n.width,height:n.height,text:n.text,
          style:n.style?{fontFamily:n.style.fontFamily,fontSize:n.style.fontSize,lineHeight:n.style.lineHeight,fill:n.style.fill}:undefined,
          texture:n.texture?{width:n.texture.width,height:n.texture.height}:undefined}:null;
        const find=(root,predicate)=>{if(predicate(root))return root;for(const child of root.children||[]){const found=find(child,predicate);if(found)return found;}return null;};
        const bubble=find(app.stage,n=>n.children?.some(c=>c.name==='bubbles'));
        const canvas=document.createElement('canvas');canvas.width=app.view.width;canvas.height=app.view.height;
        const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(app.view,0,0);
        const png=canvas.toDataURL().split(',')[1];
        const dialogVisible=d?.visible,bubbleVisible=bubble?.visible;if(d)d.visible=false;if(bubble)bubble.visible=false;
        app.renderer.render(app.stage);ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(app.view,0,0);
        const base=canvas.toDataURL().split(',')[1];if(d)d.visible=dialogVisible;if(bubble)bubble.visible=bubbleVisible;
        return {width:canvas.width,height:canvas.height,png,base,
          dialog:d?.visible?{...node(d),printing:d.is_printing,preview:node(d.preview),name:node(d.target_name),content:node(d.content),next:node(d.next_text),icon:node(d.next_icon)}:null,
          bubble:bubble?{...node(bubble),bounds:JSON.parse(JSON.stringify(bubble.getBounds())),text:node(bubble.children.find(c=>c.name==='text'))}:null};
      });
      await writeFile(path.join(dir,`${frame}-official.png`),Buffer.from(sample.png,'base64'));
      if(domPage){
        await domPage.setViewportSize({width:sample.width,height:sample.height});
        await domPage.evaluate(async({sample,project})=>{
          const {StageOverlay}=await import('/overlay-probe.js');
          const box=document.getElementById('box');box.style.width=sample.width+'px';box.style.height=sample.height+'px';
          const base=document.getElementById('base');base.src='data:image/png;base64,'+sample.base;await base.decode();
          const actor=Object.values(project.theatre.actors)[0],style=project.theatre.styles[actor.current_style_id];
          const image=new Image();image.src=style.url;await image.decode();
          const a={...actor,size_y:100,dialog:sample.bubble?{text:sample.bubble.text.text,think:project.project_name.endsWith('think')}:null};
          const renderer={kitten4:true,width:sample.width,height:sample.height,sprites:[a],spriteImage:()=>image};
          window.overlay?.root.remove();window.overlay=new StageOverlay(box,renderer,()=>{});
          const d=sample.dialog;window.overlay.apply({stage_dialog:d?{id:1,target:project.project_name.endsWith('scene')?project.theatre.current_scene:actor.id,name:d.name.text,text:d.content.text,visible_text:d.content.text,printing:d.printing,more:false}:null});
          window.overlay.update();await document.fonts.ready;
        },{sample,project});
        const png=await domPage.locator('#box').screenshot({animations:'disabled',caret:'hide',scale:'css'});
        await writeFile(path.join(dir,`${frame}-nekoc.png`),png);
        const rgba=await domPage.evaluate(async images=>Promise.all(images.map(async png=>{
          const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
          let bytes='';const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<data.length;i+=8192)bytes+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(bytes);
        })),[sample.png,png.toString('base64')]);
        sample.metrics=pixelDifference(...rgba.map(value=>Buffer.from(value,'base64')),8);
      }
      delete sample.png;delete sample.base;
      samples.push({frame,...sample});
    }});
  const evidence={samples,errors:trace.errors,assets:trace.diagnostics.assets};
  await saveJson(path.join(dir,'evidence.json'),evidence);return evidence;
}

async function main(){
  for(const [name,project]of Object.entries(await overlayFixtures())){
    if(process.argv.includes('--record')&&name!=='choice')console.log(name,JSON.stringify(await recordOverlay(project,name,{compare:process.argv.includes('--compare')})));
    else if(process.argv.includes('--write'))await saveJson(`tests/fixtures/kitten4/visual3-overlay-${name}.bcm`,project);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
