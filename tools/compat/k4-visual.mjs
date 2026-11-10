#!/usr/bin/env node
// Real VM deltas -> web/renderer.js, compared with the external player's canvas.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, compareWork, projectCapabilities } from './k4-diff.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function pixelDifference(a,b,tolerance=8){
  if(a.length!==b.length||!a.length||a.length%4)throw Error('RGBA size mismatch');
  if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255)throw Error('Invalid pixel tolerance');
  let changed=0,absolute=0,squared=0;
  for(let i=0;i<a.length;i+=4){let max=0;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);max=Math.max(max,d);absolute+=d;squared+=d*d;}if(max>tolerance)changed++;}
  const mse=squared/(a.length/4*3);
  return {pixels:a.length/4,changedPixels:changed,changedPercent:changed/(a.length/4)*100,mae:absolute/(a.length/4*3),rmse:Math.sqrt(mse),psnr:mse?10*Math.log10(255**2/mse):null,tolerance};
}
export function selectedWork(w){return ['equal','different'].includes(w.status)&&!w.randomness?.detected;}
export function distribution(works){
  const values=works.filter(w=>w.status==='captured').flatMap(w=>(w.frames||[]).map(f=>f.changedPercent)).sort((a,b)=>a-b);
  return {count:values.length,exact:values.filter(x=>x===0).length,under1:values.filter(x=>x<1).length,under5:values.filter(x=>x<5).length,
    median:values.length?values[Math.floor((values.length-1)*.5)]:null,p90:values.length?values[Math.floor((values.length-1)*.9)]:null,max:values.at(-1)??null};
}
// Both sides are sampled synchronously after explicit render, before the browser
// can discard a non-preserved WebGL drawing buffer. No CSS screenshots/rescaling.
async function capture(page,official){
  return page.evaluate(official=>{
    let source;
    if(official){const stage=window.__k4OracleRequire('a1xw').a();
      // Ct.on_tick uploads pending brush deltas; this does not advance the VM,
      // clocks or transitions. Start's first update occurs before the ticker.
      stage.get_scene_by_id(stage.core.scenes.get_current_scene()).on_tick();
      const app=stage.core.app.get_app();app.renderer.render(app.stage);source=app.view;}
    else{window.renderer.dirty=true;window.renderer.render();source=window.renderer.canvas;}
    if(!source)throw Error('Missing stage canvas');
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let bytes='';for(let i=0;i<rgba.length;i+=8192)bytes+=String.fromCharCode(...rgba.subarray(i,i+8192));
    return {width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png').split(',')[1],rgba:btoa(bytes)};
  },official);
}
export async function visualWork(input,options){
  options={wallTimeoutMs:90000,...options};
  const artifact=path.join(options.artifactsDir,path.basename(input));await mkdir(artifact,{recursive:true});
  const exe=options.nekoc||path.join(root,'target/debug/k4-trace'+(process.platform==='win32'?'.exe':''));
  const args=[path.resolve(input),'--render','--frames',String(Math.max(...options.captureFrames)),'--seed',String(options.seed??1)];
  let rendered,nekoPage;
  const frames=[];
  try{
    const inputProject=await readJson(input);
    // Videos run on an independent media clock; fixed VM updates cannot freeze
    // them. Keep diagnostic PNGs but do not mix them into a pixel distribution.
    const dynamicMedia=Object.values(inputProject.theatre?.videos||{}).some(v=>v.visible!==false);
    rendered=JSON.parse(await command(exe,args));
    const official=await runOracle(inputProject,{...options,frames:Math.max(...options.captureFrames),
      beforeStart:async(page)=>{
        nekoPage=await page.context().newPage();
        await nekoPage.route('**/nekoc-visual',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas id="stage"></canvas>'}));
        await nekoPage.route('**/nekoc-renderer.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(options.rendererSource||path.join(root,'web/renderer.js'),'utf8')}));
        await nekoPage.goto(new URL('/nekoc-visual',page.url()).href);
        await nekoPage.evaluate(async project=>{
          const {StageRenderer}=await import('/nekoc-renderer.js');
          window.renderer=new StageRenderer(document.querySelector('canvas'));window.renderer.resolutionScale=1;
          window.assetErrors=[];window.renderer.onError=e=>window.assetErrors.push(e);await window.renderer.load(project);
          if(window.assetErrors.length)throw Error(window.assetErrors.join('\n'));
        },rendered.project);
        const costumes=await nekoPage.evaluate(()=>window.renderer.costumeInfo(true).map(c=>({...c,
          mask_bytes:[...atob(c.mask)].map(x=>x.charCodeAt(0)),rgb_bytes:[...atob(c.rgb)].map(x=>x.charCodeAt(0))})));
        const file=path.join(artifact,'costumes.json');await saveJson(file,costumes);
        rendered=JSON.parse(await command(exe,[...args,'--costumes',path.resolve(file)]));
      },
      onFrame:async(page,frame)=>{
        const delta=rendered.frames[frame-1];
        await nekoPage.evaluate(({frame,lines})=>window.renderer.apply(frame,new Float32Array(lines)),delta);
        if(!options.captureFrames.includes(frame))return;
        const [a,b]=await Promise.all([capture(nekoPage,false),capture(page,true)]);
        if(a.width!==b.width||a.height!==b.height)throw Error(`Canvas size mismatch: NekoC ${a.width}x${a.height}, official ${b.width}x${b.height}`);
        const metrics=pixelDifference(Buffer.from(a.rgba,'base64'),Buffer.from(b.rgba,'base64'),options.pixelTolerance??8);
        for(const [name,image]of [['nekoc',a],['official',b]])await writeFile(path.join(artifact,`${frame}-${name}.png`),Buffer.from(image.png,'base64'));
        const officialState=await page.evaluate(()=>{
          const stage=window.__k4OracleRequire('a1xw').a(),scene=stage.get_scene_by_id(stage.core.scenes.get_current_scene());
          const dialog=stage.core.components.get_stage_dialog();
          return {order:scene.get_actor_ids(),brushTarget:scene.get_brush_target()?.get_id()??null,
            stageDialog:dialog?{visible:dialog.visible,printing:dialog.is_printing,text:dialog.content.text,name:dialog.target_name.text}:null};
        });
        await saveJson(path.join(artifact,`${frame}-state.json`),{nekoc:delta.frame,official:officialState});
        frames.push({frame,width:a.width,height:a.height,...metrics});
      }});
    await saveJson(path.join(artifact,'diagnostics.json'),official.diagnostics);
    return {file:input,status:dynamicMedia?'unverified':'captured',...(dynamicMedia?{error:'visible video: media clock is not controlled; diagnostic screenshots only'}:{}),frames,artifacts:artifact,kernelAssets:official.diagnostics.assets};
  }catch(error){if(error.diagnostics)await saveJson(path.join(artifact,'failure.json'),error.diagnostics);return {file:input,status:'unverified',error:error.message,frames,artifacts:artifact};}
}
export function markdown(report){
  return '# K4 固定帧像素对比\n\n'+
    `帧 ${report.captureFrames.join('/')}；RGB 单通道容差 ${report.pixelTolerance}/255，任一通道超差计为差异像素；MAE/RMSE 使用全部 RGB 通道。透明区域合成白底，不缩放画布。只纳入非随机 equal/different；不同 VM 状态仍可能导致画面不同，不能全部归因渲染器。\n\n分布：\`${JSON.stringify(report.distribution)}\`\n\n`+
    '|作品|状态|帧|差异像素 %|MAE|\n|---|---|---|---|---|\n'+report.works.flatMap(w=>w.frames?.length?w.frames.map(f=>`|${path.basename(w.file)}|${w.status}|${f.frame}|${f.changedPercent.toFixed(4)}|${f.mae.toFixed(4)}|`):[`|${path.basename(w.file)}|${w.status}|—|${String(w.error||w.reason||'').replaceAll('|','\\|')}|—|`]).join('\n')+'\n';
}
async function main(){
  const options={captureFrames:[1,30,60],seed:1,pixelTolerance:8,channel:'msedge',wallTimeoutMs:90000,corpus:'E:/nekoc/dist/kitten4-corpus',artifactsDir:'dist/k4-visual/frames',out:'dist/k4-visual/report.json',assetCache:new Map()};
  const keys={'--input':'input','--corpus':'corpus','--classification':'classification','--out':'out','--artifacts-dir':'artifactsDir','--frames':'captureFrames','--seed':'seed','--pixel-tolerance':'pixelTolerance','--channel':'channel','--player-dir':'playerDir','--nekoc':'nekoc','--renderer-source':'rendererSource'};
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--help'){console.log('node tools/compat/k4-visual.mjs [--input own.bcm | --corpus directory] [--classification k4-diff.json] [--frames 1,30,60] [--allow-assets] [--out dist/k4-visual/report.json]');return;}
    if(argv[i]==='--allow-assets'){options.allowAssets=true;continue;}
    const key=keys[argv[i]];if(!key||!argv[i+1])throw Error(`Invalid option: ${argv[i]}`);options[key]=argv[++i];
  }
  options.captureFrames=String(options.captureFrames).split(',').map(Number);
  if(!options.captureFrames.length||options.captureFrames.some(n=>!Number.isSafeInteger(n)||n<1||n>10000))throw Error('Invalid frames');
  for(const key of ['seed','pixelTolerance'])options[key]=Number(options[key]);
  if(!Number.isSafeInteger(options.seed)||options.seed<0||options.seed>0xffffffff)throw Error('Invalid seed');
  if(!Number.isFinite(options.pixelTolerance)||options.pixelTolerance<0||options.pixelTolerance>255)throw Error('Invalid pixel tolerance');
  // All generated artifacts, including diagnostic costumes, must remain ignored.
  for(const file of [options.out,options.artifactsDir]){const relative=path.relative(path.join(root,'dist'),path.resolve(file));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Output must be inside this worktree dist/');}
  if(!options.nekoc)await command('cargo',['build','--quiet','--bin','k4-trace']);
  const classified=options.classification?(await readJson(options.classification)).works:null;
  const files=options.input?[options.input]:classified?classified.map(w=>w.file):(await readdir(options.corpus)).filter(f=>/\.bcm4?$/i.test(f)).sort().map(f=>path.join(options.corpus,f));
  if(!files.length)throw Error('No works found');
  const report={schema:'nekoc-k4-visual-v1',captureFrames:options.captureFrames,pixelTolerance:options.pixelTolerance,works:[]};
  for(const file of files){
    console.error(`Visual ${file}`);
    let classification=classified?.find(w=>path.resolve(w.file)===path.resolve(file));
    if(!classification){const project=await readJson(file);if(projectCapabilities(project).randomBlocks.length){report.works.push({file,status:'excluded',reason:'random candidate'});continue;}
      classification=await compareWork(file,{...options,frames:Math.max(...options.captureFrames),artifactsDir:path.join(options.artifactsDir,'classification')});}
    await saveJson(path.join(options.artifactsDir,'classification',path.basename(file),'result.json'),classification);
    const result=selectedWork(classification)?await visualWork(file,options):{file,status:'excluded',reason:classification.status,error:classification.error};
    report.works.push({...result,classification:classification.status});report.distribution=distribution(report.works);
    await saveJson(options.out,report);await writeFile(options.out+'.md',markdown(report));
  }
  report.distribution=distribution(report.works);await saveJson(options.out,report);await writeFile(options.out+'.md',markdown(report));
  if(!report.distribution.count||report.works.some(w=>w.status==='unverified'))process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
