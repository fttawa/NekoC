#!/usr/bin/env node
// Real VM deltas -> web/renderer.js, compared with the external player's canvas.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, compareWork, projectCapabilities } from './k4-diff.mjs';
import { readJson, saveJson, runOracle } from './k4-oracle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function pixelDifference(a,b,tolerance=8,mask=null){
  if(a.length!==b.length||!a.length||a.length%4)throw Error('RGBA size mismatch');
  if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255)throw Error('Invalid pixel tolerance');
  if(mask&&mask.length!==a.length/4)throw Error('Mask size mismatch');
  let changed=0,absolute=0,squared=0,pixels=0;
  for(let i=0;i<a.length;i+=4){if(mask?.[i/4])continue;pixels++;let max=0;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);max=Math.max(max,d);absolute+=d;squared+=d*d;}if(max>tolerance)changed++;}
  const mse=pixels?squared/(pixels*3):null;
  return {pixels,maskedPixels:a.length/4-pixels,changedPixels:changed,changedPercent:pixels?changed/pixels*100:null,mae:pixels?absolute/(pixels*3):null,rmse:mse===null?null:Math.sqrt(mse),psnr:mse?10*Math.log10(255**2/mse):null,tolerance};
}
// Rectangles use backing-pixel coordinates from each actual renderer. Exclude
// their union, with a one-pixel edge guard; do not compare asynchronous video.
export function videoMask(width,height,rectangles){
  const mask=new Uint8Array(width*height);
  for(const r of rectangles){if(![r.x,r.y,r.width,r.height].every(Number.isFinite))throw Error('Invalid video bounds');
    if(r.width<=0||r.height<=0)continue;
    const x0=Math.max(0,Math.floor(r.x)-1),y0=Math.max(0,Math.floor(r.y)-1),x1=Math.min(width,Math.ceil(r.x+r.width)+1),y1=Math.min(height,Math.ceil(r.y+r.height)+1);
    if(x1<=x0||y1<=y0)continue;
    for(let y=y0;y<y1;y++)mask.fill(1,y*width+x0,y*width+x1);
  }return mask;
}
export function selectedWork(w){return ['equal','different'].includes(w.status)&&!w.randomness?.detected;}
// Rank works, not individual frames; keep failed captures separate rather than
// interpreting a missing image as zero difference. Ties are reproducible.
export function rankWorks(works){
  return works.filter(w=>w.status==='captured').map(w=>{
    const values=(w.frames||[]).map(f=>f.changedPercent).filter(Number.isFinite);
    return {file:w.file,max:values.length?Math.max(...values):null,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  }).filter(w=>w.max!==null).sort((a,b)=>b.max-a.max||b.mean-a.mean||a.file.localeCompare(b.file));
}
export function mediaWaitCandidate(project){
  const stack=[project.compile_result,...Object.values(project.theatre?.actors||{}).map(a=>a.block_data_json),...Object.values(project.theatre?.scenes||{}).map(s=>s.block_data_json)];
  while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;if(node.type==='play_video_until_end')return true;stack.push(...Object.values(node));}
  return false;
}
export function audioWaitCandidate(project){
  const stack=[project.compile_result,...Object.values(project.theatre?.actors||{}).map(a=>a.block_data_json),...Object.values(project.theatre?.scenes||{}).map(s=>s.block_data_json)];
  while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;if(['play_audio_and_wait','play_audio_and_wait_2'].includes(node.type))return true;stack.push(...Object.values(node));}
  return false;
}
export function audioWaitIssue(project,audios,frames){
  if(!audioWaitCandidate(project))return null;
  if(!audios.length||audios.some(a=>!a.loaded||!Number.isFinite(a.duration)||a.duration<=0))return 'audio wait has unavailable decoded duration';
  // Natural end callbacks still follow the browser media clock, not virtual Date.
  // Do not claim end-boundary agreement from a duration-only trace.
  if(audios.some(a=>a.duration/(Number.isFinite(a.rate)&&a.rate>0?a.rate:1)<=frames/60))return 'audio completion falls within sampled virtual window: official media clock is uncontrolled';
  return null;
}
export function distribution(works){
  const values=works.filter(w=>w.status==='captured').flatMap(w=>(w.frames||[]).filter(f=>Number.isFinite(f.changedPercent)).map(f=>f.changedPercent)).sort((a,b)=>a-b);
  return {count:values.length,exact:values.filter(x=>x===0).length,under1:values.filter(x=>x<1).length,under5:values.filter(x=>x<5).length,
    median:values.length?values[Math.floor((values.length-1)*.5)]:null,p90:values.length?values[Math.floor((values.length-1)*.9)]:null,max:values.at(-1)??null};
}
// Both sides are sampled synchronously after explicit render, before the browser
// can discard a non-preserved WebGL drawing buffer. DOM overlays use a 1:1
// container screenshot; neither path rescales stage pixels.
async function capture(page,official){
  if(!official)await page.evaluate(()=>{
    if(window.assetErrors.length)throw Error(window.assetErrors.join('\n'));
  });
  // NekoC draws bubbles, monitors and the stage dialog as DOM over the canvas
  // (web/overlay.js); the official player draws them into its canvas. Composite
  // the real overlay via a 1:1 element screenshot so both sides show the same layers.
  const overlay=!official&&await page.evaluate(()=>
    [...document.querySelectorAll('.neko-overlay > :not(.neko-monitors), .neko-monitor')]
      .some(e=>e.getClientRects().length));
  if(overlay){
    await page.evaluate(()=>{window.renderer.dirty=true;window.renderer.render();});
    const png=(await page.locator('#box').screenshot({animations:'disabled',caret:'hide',scale:'css'})).toString('base64');
    return page.evaluate(async png=>{
      const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
      const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let bytes='';for(let i=0;i<rgba.length;i+=8192)bytes+=String.fromCharCode(...rgba.subarray(i,i+8192));
      // Overlay captures are taken at CSS 1:1 canonical size, so VM video rects map directly.
      const r=window.renderer,videoBounds=(r.videoStates||[]).filter(v=>v.visible).map(v=>({id:v.id,x:(r.width/2+v.x-v.width/2)*canvas.width/r.width,y:(r.height/2-v.y-v.height/2)*canvas.height/r.height,width:v.width*canvas.width/r.width,height:v.height*canvas.height/r.height}));
      return {width:canvas.width,height:canvas.height,png,rgba:btoa(bytes),overlay:true,videoBounds};
    },png);
  }
  return page.evaluate(official=>{
    let source,videoBounds=[];
    if(official){const stage=window.__k4OracleRequire('a1xw').a();
      // Ct.on_tick uploads pending brush deltas; this does not advance the VM,
      // clocks or transitions. Start's first update occurs before the ticker.
      stage.get_scene_by_id(stage.core.scenes.get_current_scene()).on_tick();
      const app=stage.core.app.get_app();app.renderer.render(app.stage);source=app.view;
      videoBounds=(stage.core.components.get_playable_manager()?.get_all_videos()||[]).filter(v=>v.visible&&v.worldVisible).map(v=>{const b=v.getBounds();return {id:v.get_id(),x:b.x,y:b.y,width:b.width,height:b.height};});}
    else{const r=window.renderer;r.dirty=true;r.render();source=r.canvas;
      videoBounds=(r.videoStates||[]).filter(v=>v.visible).map(v=>({id:v.id,x:(r.width/2+v.x-v.width/2)*source.width/r.width,y:(r.height/2-v.y-v.height/2)*source.height/r.height,width:v.width*source.width/r.width,height:v.height*source.height/r.height}));}
    if(!source)throw Error('Missing stage canvas');
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let bytes='';for(let i=0;i<rgba.length;i+=8192)bytes+=String.fromCharCode(...rgba.subarray(i,i+8192));
    return {width:canvas.width,height:canvas.height,videoBounds,png:canvas.toDataURL('image/png').split(',')[1],rgba:btoa(bytes)};
  },official);
}
export async function visualWork(input,options){
  options={wallTimeoutMs:90000,...options};
  const artifact=path.join(options.artifactsDir,path.basename(input));await mkdir(artifact,{recursive:true});
  const exe=options.nekoc||path.join(root,'target/debug/k4-trace'+(process.platform==='win32'?'.exe':''));
  const args=[path.resolve(input),'--render',...(!options.nekoc?['--render-only']:[]),'--frames',String(Math.max(...options.captureFrames)),'--seed',String(options.seed??1)];
  const audioMetadata=options.audioMetadata??!options.nekoc;
  let rendered,nekoPage,audioIssue=null;
  const frames=[];
  try{
    const inputProject=await readJson(input);
    rendered=JSON.parse(await command(exe,args));
    // k4-trace runs on the virtual clock; give the official side the same one so
    // timer-driven works are sampled at the same script time on both sides.
    const official=await runOracle(inputProject,{...options,virtualTime:true,frames:Math.max(...options.captureFrames),
      beforeStart:async(page)=>{
        const videos=await page.evaluate(()=>{
          const stage=window.__k4OracleRequire('a1xw').a();
          return (stage.core.components.get_playable_manager()?.get_all_videos()||[]).map(v=>({id:v.get_id(),duration:v.get_video_element_from_base_texture()?.duration,...v.get_size()}));
        });
         await saveJson(path.join(artifact,'videos.json'),videos);
         const audios=await page.evaluate(()=>{
           const req=window.__k4OracleRequire,player=req('xQfl').a.AudioPlayer;
           return Object.values(req('ALsR').a.get_state().audio_state||{}).map(audio=>{
             const howl=player.get_howl(audio.id),loaded=howl?.state()==='loaded',duration=loaded?howl.duration():null;
             return {id:audio.id,loaded,duration:Number.isFinite(duration)&&duration>0?duration:null,rate:audio.playback_rate};
           });
         });
         await saveJson(path.join(artifact,'audio-metadata.json'),audios);
         if(audioMetadata)audioIssue=audioWaitIssue(inputProject,audios,Math.max(...options.captureFrames));
        nekoPage=await page.context().newPage();
        const {width,height}=rendered.project.stageSize;
        await nekoPage.setViewportSize({width,height});
        await nekoPage.route('**/nekoc-visual',route=>route.fulfill({contentType:'text/html',
          body:`<!doctype html><style>html,body{margin:0}#box{position:relative;width:${width}px;height:${height}px;overflow:hidden}#stage{display:block;width:100%;height:100%}</style><div id="box"><canvas id="stage"></canvas></div>`}));
        await nekoPage.route('**/nekoc-overlay.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(options.overlaySource||path.join(root,'web/overlay.js'),'utf8')}));
        await nekoPage.route('**/nekoc-renderer.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(options.rendererSource||path.join(root,'web/renderer.js'),'utf8')}));
        await nekoPage.route('**/pen-k4.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(path.join(root,'web/pen-k4.js'),'utf8')}));
        await nekoPage.goto(new URL('/nekoc-visual',page.url()).href);
        await nekoPage.evaluate(async project=>{
          const {StageRenderer}=await import('/nekoc-renderer.js');
          const {StageOverlay}=await import('/nekoc-overlay.js');
          window.renderer=new StageRenderer(document.querySelector('canvas'));window.renderer.resolutionScale=1;window.renderer.skipVideos=true;
          window.overlay=new StageOverlay(document.getElementById('box'),window.renderer,()=>{});
          window.assetErrors=[];window.renderer.onError=e=>window.assetErrors.push(e);await window.renderer.load(project);
          if(window.assetErrors.length)throw Error(window.assetErrors.join('\n'));
        },rendered.project);
        const costumes=await nekoPage.evaluate(()=>window.renderer.costumeInfo(true).map(c=>({...c,
          mask_bytes:[...atob(c.mask)].map(x=>x.charCodeAt(0)),rgb_bytes:[...atob(c.rgb)].map(x=>x.charCodeAt(0))})));
        const file=path.join(artifact,'costumes.json');await saveJson(file,costumes);
        const videoFile=path.join(artifact,'video-metadata.json');await saveJson(videoFile,videos.filter(v=>Number.isFinite(v.duration)));
         const audioFile=path.join(artifact,'audio-durations.json');await saveJson(audioFile,audios.filter(a=>a.loaded&&Number.isFinite(a.duration)&&a.duration>0).map(({id,duration})=>({id,duration})));
         rendered=JSON.parse(await command(exe,[...args,'--costumes',path.resolve(file),'--videos',path.resolve(videoFile),...(audioMetadata?['--audios',path.resolve(audioFile)]:[])]));
      },
      onFrame:async(page,frame)=>{
        const delta=rendered.frames[frame-1];
        await nekoPage.evaluate(({frame,lines})=>{window.renderer.videoStates=frame.videos||[];window.renderer.apply(frame,new Float32Array(lines));window.overlay.apply(frame);window.overlay.update();},delta);
        if(!options.captureFrames.includes(frame))return;
        const [a,b]=await Promise.all([capture(nekoPage,false),capture(page,true)]);
        if(a.width!==b.width||a.height!==b.height)throw Error(`Canvas size mismatch: NekoC ${a.width}x${a.height}, official ${b.width}x${b.height}`);
        const rgbaA=Buffer.from(a.rgba,'base64'),rgbaB=Buffer.from(b.rgba,'base64'),mask=videoMask(a.width,a.height,[...a.videoBounds,...b.videoBounds]);
        const metrics=pixelDifference(rgbaA,rgbaB,options.pixelTolerance??8,mask);
        if(options.additionalPixelTolerances)metrics.additionalTolerances=Object.fromEntries(options.additionalPixelTolerances.map(t=>[t,pixelDifference(rgbaA,rgbaB,t,mask)]));
        for(const [name,image]of [['nekoc',a],['official',b]])await writeFile(path.join(artifact,`${frame}-${name}.png`),Buffer.from(image.png,'base64'));
        const officialState=await page.evaluate(()=>{
          const stage=window.__k4OracleRequire('a1xw').a(),scene=stage.get_scene_by_id(stage.core.scenes.get_current_scene());
          const dialog=stage.core.components.get_stage_dialog();
          return {order:scene.get_actor_ids(),brushTarget:scene.get_brush_target()?.get_id()??null,
            stageDialog:dialog?{visible:dialog.visible,printing:dialog.is_printing,text:dialog.content.text,name:dialog.target_name.text}:null};
        });
        const videoBounds={nekoc:a.videoBounds,official:b.videoBounds};
        await saveJson(path.join(artifact,`${frame}-state.json`),{nekoc:delta.frame,official:officialState,videoBounds});
        await nekoPage.evaluate(()=>{if(window.assetErrors.length)throw Error(window.assetErrors.join('\n'));});
        frames.push({frame,width:a.width,height:a.height,overlay:!!a.overlay,videoBounds,scope:metrics.maskedPixels?'non-video':'canvas',...metrics});
      }});
    await saveJson(path.join(artifact,'diagnostics.json'),official.diagnostics);
    const empty=frames.some(f=>!f.pixels);
    const wait=mediaWaitCandidate(inputProject);
     const error=empty?'video mask leaves no comparable pixels':wait?'video completion can affect non-video control flow: official media clock is uncontrolled':audioIssue;
     return {file:input,status:error?'unverified':'captured',...(error?{error}:{}),audioMetadata,frames,artifacts:artifact,kernelAssets:official.diagnostics.assets};
  }catch(error){if(error.diagnostics)await saveJson(path.join(artifact,'failure.json'),error.diagnostics);return {file:input,status:'unverified',error:error.message,frames,artifacts:artifact};}
}
export function markdown(report){
  return '# K4 固定帧像素对比\n\n'+
    `帧 ${report.captureFrames.join('/')}；RGB 单通道容差 ${report.pixelTolerance}/255，任一通道超差计为差异像素；MAE/RMSE 使用未遮罩区域全部 RGB 通道。逐帧排除双方视频矩形并集和 1 像素边缘，不验证视频及其覆盖内容；零有效像素不算通过。透明区域合成白底，不缩放画布。只纳入非随机 equal/different；不同 VM 状态仍可能导致画面不同，不能全部归因渲染器。\n\n分布：\`${JSON.stringify(report.distribution)}\`\n\n`+
    '按作品最大差异降序（并列按均值）：\n\n|作品|最大差异 %|平均差异 %|\n|---|---|---|\n'+rankWorks(report.works).map(w=>`|${path.basename(w.file)}|${w.max.toFixed(4)}|${w.mean.toFixed(4)}|`).join('\n')+'\n\n'+
    '|作品|状态|帧|差异像素 %|MAE|排除视频像素|\n|---|---|---|---|---|---|\n'+report.works.flatMap(w=>w.frames?.length?w.frames.map(f=>`|${path.basename(w.file)}|${w.status}|${f.frame}|${f.changedPercent?.toFixed(4)??'无可比较区域'}|${f.mae?.toFixed(4)??'—'}|${f.maskedPixels||0}|`):[`|${path.basename(w.file)}|${w.status}|—|${String(w.error||w.reason||'').replaceAll('|','\\|')}|—|—|`]).join('\n')+'\n';
}
async function main(){
  const options={captureFrames:[1,30,60],seed:1,pixelTolerance:8,channel:'msedge',wallTimeoutMs:90000,corpus:'E:/nekoc/dist/kitten4-corpus',artifactsDir:'dist/k4-visual/frames',out:'dist/k4-visual/report.json',assetCache:new Map()};
  const keys={'--input':'input','--corpus':'corpus','--classification':'classification','--out':'out','--artifacts-dir':'artifactsDir','--frames':'captureFrames','--seed':'seed','--pixel-tolerance':'pixelTolerance','--channel':'channel','--player-dir':'playerDir','--nekoc':'nekoc','--renderer-source':'rendererSource','--overlay-source':'overlaySource'};
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--help'){console.log('node tools/compat/k4-visual.mjs [--input own.bcm | --corpus directory] [--classification k4-diff.json] [--frames 1,30,60] [--allow-assets] [--nekoc legacy-exe [--audio-metadata]] [--out dist/k4-visual/report.json]');return;}
     if(argv[i]==='--allow-assets'){options.allowAssets=true;continue;}
     if(argv[i]==='--audio-metadata'){options.audioMetadata=true;continue;}
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
    const result=selectedWork(classification)?await visualWork(file,options):{file,status:classification.randomness?.detected?'excluded':'unverified',reason:classification.status,error:classification.error};
    report.works.push({...result,classification:classification.status});report.distribution=distribution(report.works);report.ranking=rankWorks(report.works);
    await saveJson(options.out,report);await writeFile(options.out+'.md',markdown(report));
  }
  report.distribution=distribution(report.works);report.ranking=rankWorks(report.works);await saveJson(options.out,report);await writeFile(options.out+'.md',markdown(report));
  if(!report.distribution.count||report.works.some(w=>w.status==='unverified'))process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
