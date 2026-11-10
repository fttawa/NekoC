import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';
import { visualFixtures } from '../tools/compat/k4-visual-fixtures.mjs';
import { readJson, runOracle, saveJson } from '../tools/compat/k4-oracle.mjs';
import { workspace } from '../tools/compat/k4-scheduling-fixtures.mjs';
import { visualWork } from '../tools/compat/k4-visual.mjs';
import { loadPlaywright } from '../tools/probe-kitten4.mjs';

// Repository-owned blue 64x48 / 0.4s WebM, generated from ffmpeg's color source.
const media='data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJNEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggI37AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAeQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIPKxZQ09HUG6cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgUC6gTCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIPKxZQ09HUG5nyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjQwMDAwMDAwMAAfQ7Z1QI7ngQCjwYEAAIBQAwCdASpAADAAAEcIhYWIhYSIAgICdaoD+AIHCNVnmY830gD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5aBAGQA0QEABRCsABgAGFgv9AAIjAAAo5aBAMgA0QEABRCsABgAGFgv9AAIjAAAo5aBASwA0QEABRCsABgAGFgv9AAIjAAAHFO7a5G7j7OBALeK94EB8YIBo/CBAw==';
async function project(){const p=(await visualFixtures()).layers;p.theatre.videos={v:{id:'v',name:'owned video',url:media,x:17,y:-9,width:128,height:96,scale:2,visible:true}};return p;}

test('editor single-step initializes without resuming media and stays paused after its frame',async()=>{
  const source=await readFile('web/app.js','utf8');
  for(const initiallyStarted of [false,true]){
    const button={},audio={paused:false,resumes:0,pause(){this.paused=true;},resume(){this.paused=false;this.resumes++;},load(){}},renderer={paused:false,pauseMedia(value=true){this.paused=value;}};
    const context={running:false,started:initiallyStarted,inFlight:null,starting:null,project:{},audio,renderer,performance:{now:()=>0},api:async()=>{},
      PlayerConnection:class{async open(){return {stats:{}};}},playerExtensions:{schemas:()=>[]},compiled(){},sendCostumes:false,overlay:null,epoch:0,input:{reset(){}},lastFrame:null,lastBytes:0,history:[],pipeline:{},frames:0,fpsStart:0,fps:0,lastTick:0,
      renderEditor(){},renderPalette(){},state(value){context.status=value;},$:id=>id==='#step'?button:{focus(){}},handleError(error){throw error;},
      async nextFrame(){assert.ok(audio.paused&&renderer.paused,'media must already be paused while applying the step frame');context.steps=(context.steps||0)+1;},
    };
    const start=source.slice(source.indexOf('async function start('),source.indexOf('function state('));
    const step=source.slice(source.indexOf("$('#step').onclick="),source.indexOf("$('#open').onclick="));
    runInNewContext(start+'\n'+step,context);await button.onclick();
    assert.equal(context.steps,1);assert.equal(context.running,false);assert.equal(context.status,'单步完成');assert.equal(button.disabled,false);
    assert.equal(audio.resumes,0);assert.ok(audio.paused&&renderer.paused);
  }
});

test('renderer decodes video, uses centre/scale once, composites below actors, pauses and reloads',{
  skip:!process.env.K4_VISUAL_BROWSER,
},async()=>{
  const source=await readFile('web/renderer.js','utf8');
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/renderer.js'?'application/javascript':'text/html');res.end(req.url==='/renderer.js'?source:'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async media=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));r.resolutionScale=1;
      const errors=[];r.onError=e=>errors.push(e);
      const p={_nekocKitten4:{},stageSize:{width:320,height:240},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:['a']}}},actors:{actorsDict:{a:{currentStyleId:'c',scale:100}}},styles:{stylesDict:{c:{url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>')}}},videos:{videosDict:{v:{url:media,x:17,y:-9,width:128,height:96,scale:2,visible:true}}}};
      await r.load(p);const video=r.videos.get('v');const dimensions=[video.state.width,video.state.height];const info=r.videoInfo();
      const pixels=()=>{r.dirty=true;r.render();const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.drawImage(r.canvas,0,0);return [...x.getImageData(0,0,320,240).data];};
      const rgba=pixels(),at=(x,y)=>rgba.slice((y*320+x)*4,(y*320+x)*4+3);
      const actor=at(160,120),blue=at(210,130),outside=at(250,130);
      r.apply({sprites:[],clear:true,pen_layer:0,video_above_pen:false},new Float32Array([30,-10,40,-10,20,0,1,0,1]));
      const penUnder=pixels().slice((130*320+195)*4,(130*320+195)*4+3);
      r.apply({sprites:[],video_above_pen:true},new Float32Array());
      const videoOver=pixels().slice((130*320+195)*4,(130*320+195)*4+3);
      r.applyVideos([{...video.state,width:999,height:777,playing:true,played:true,generation:1,position:0}]);r.pauseMedia();const paused=video.element.paused;
      const preservedDimensions=[video.state.width,video.state.height];
      const seeked=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('seeked timeout')),3000);video.element.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});});
      r.applyVideos([{...video.state,playing:false,generation:1,position:.1}]);r.render();const cleanBeforeSeek=!r.dirty;
      await seeked;const dirtyAfterSeek=r.dirty;let redraws=0;const drawVideos=r.drawVideos;r.drawVideos=function(){redraws++;drawVideos.call(this);};r.render();r.drawVideos=drawVideos;
      const old=video.element,oldSeek=old.onseeked;await r.load({...p,videos:{videosDict:{}}});r.render();oldSeek();const staleSeekIgnored=!r.dirty;
      const disposed=!old.getAttribute('src')&&old.onseeked===null&&r.videos.size===0;
      // Actual decoded geometry wins over saved/editor fallback dimensions, even
      // on the first VM frame before metadata has made the round trip.
      const stale={...p,videos:{videosDict:{v:{...p.videos.videosDict.v,width:999,height:777}}}};
      await r.load(stale);const reloaded=r.videos.get('v');r.applyVideos([{...reloaded.state,width:999,height:777}]);
      const reloadedInfo=r.videoInfo();const reloadedDimensions=[reloaded.state.width,reloaded.state.height];
      return {errors,dimensions,info,actor,blue,outside,penUnder,videoOver,paused,preservedDimensions,cleanBeforeSeek,dirtyAfterSeek,redraws,staleSeekIgnored,disposed,reloadedInfo,reloadedDimensions};
    },media);
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.dimensions,[128,96]);assert.ok(Math.abs(result.info[0].duration-.4)<.001);
    assert.ok(result.actor[0]>240&&result.actor[2]<10,JSON.stringify(result));assert.ok(result.blue[2]>240&&result.blue[0]<10);assert.deepEqual(result.outside,[255,255,255]);assert.ok(result.paused&&result.disposed);
    assert.deepEqual([result.info[0].width,result.info[0].height],[128,96]);assert.deepEqual(result.preservedDimensions,[128,96]);
    assert.ok(result.cleanBeforeSeek&&result.dirtyAfterSeek);assert.equal(result.redraws,1);assert.ok(result.staleSeekIgnored);
    assert.deepEqual(result.reloadedDimensions,[128,96]);assert.deepEqual([result.reloadedInfo[0].width,result.reloadedInfo[0].height],[128,96]);
    assert.ok(result.penUnder[1]>240&&result.videoOver[2]>240,JSON.stringify(result));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('superseded image/video loads settle promptly without stale media injection or errors',{
  skip:!process.env.K4_VISUAL_BROWSER,
},async()=>{
  const source=await readFile('web/renderer.js','utf8');
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/renderer.js'?'application/javascript':'text/html');res.end(req.url==='/renderer.js'?source:'<!doctype html><canvas></canvas>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async media=>{
      const {StageRenderer}=await import('/renderer.js');const r=new StageRenderer(document.querySelector('canvas'));const errors=[];r.onError=e=>errors.push(e);
      const empty={stageSize:{width:320,height:240},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]}}},actors:{actorsDict:{}}};
      const NativeImage=window.Image;let rejectDecode;
      window.Image=class extends NativeImage{decode(){return new Promise((_,reject)=>{rejectDecode=reject;});}};
      const stale=r.load({...empty,scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[],currentStyleId:'c'}}},styles:{stylesDict:{c:{url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}}},videos:{videosDict:{stale:{url:media}}}});
      await r.load(empty);await stale;rejectDecode(Error('old image failed'));await Promise.resolve();window.Image=NativeImage;
      const noInjection=r.videos.size===0&&r.images.size===0;
      const create=document.createElement.bind(document);let pendingElement,created;
      const videoCreated=new Promise(resolve=>{created=resolve;});
      document.createElement=function(tag,...args){const element=create(tag,...args);if(tag==='video'){pendingElement=element;Object.defineProperty(element,'src',{set(){}});created();}return element;};
      const pending=r.load({...empty,videos:{videosDict:{pending:{url:media}}}});await videoCreated;
      const lateError=pendingElement.onerror;await r.load(empty);await pending;lateError();await Promise.resolve();document.createElement=create;
      const cancelled=!pendingElement.getAttribute('src')&&pendingElement.onloadeddata===null&&pendingElement.onerror===null&&pendingElement.onseeked===null&&r.videos.size===0;
      await r.load({...empty,videos:{videosDict:{v:{url:media,scale:1}}}});
      return {errors,noInjection,cancelled,recovered:r.videoInfo().length===1};
    },media);
    assert.deepEqual(result.errors,[]);assert.ok(result.noInjection&&result.cancelled&&result.recovered,JSON.stringify(result));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('official media geometry and non-video fixed-frame comparison for owned inline probe',{
  skip:!process.env.K4_VIDEO_INTEGRATION,
},async()=>{
  const p=await project();const observations=[];
  await runOracle(p,{frames:2,onFrame:async(page)=>observations.push(await page.evaluate(()=>{
    const stage=window.__k4OracleRequire('a1xw').a(),v=stage.core.components.get_playable_manager().get_playable('v');
    const scene=stage.get_scene_by_id(stage.core.scenes.get_current_scene()),container=v.parent.parent;
    const initial=scene.children.indexOf(container);scene.set_brush_target(scene.get_actor_ids()[0]);scene.unset_brush_target();
    const detachedPenBelow=scene.children.indexOf(scene.brush_sprite)<scene.children.indexOf(container);
    return {position:v.get_position(),size:v.get_size(),scale:v.get_scale(),visible:v.get_visible(),containerIndex:initial,detachedPenBelow};
  }))});
  assert.equal(observations[0].containerIndex,1);
  for(const v of observations){assert.deepEqual(v.position,{x:17,y:-9});assert.deepEqual(v.size,{width:128,height:96});assert.equal(v.scale.x,2);assert.ok(v.detachedPenBelow);}
  await mkdir('dist/video',{recursive:true});await saveJson('dist/video/owned.bcm',p);await saveJson('dist/video/official-geometry.json',observations);
  const work=await visualWork('dist/video/owned.bcm',{captureFrames:[1,2],artifactsDir:'dist/video/visual'});
  assert.equal(work.status,'captured',work.error);
  for(const f of work.frames){assert.ok(f.maskedPixels>0);assert.ok(f.pixels>0);assert.equal(f.scope,'non-video');assert.ok(f.changedPercent<.03,JSON.stringify(f));}
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const start={id:'video-start',type:'start_on_click',fields:{},inputs:{},statements:{},next:{id:'video-wait',type:'play_video_until_end',fields:{video:'v'},inputs:{},statements:{},next:{id:'after-video',type:'self_flip',fields:{options:'0'},inputs:{},statements:{}}}};
  p.theatre.actors[Object.keys(p.theatre.actors)[0]].block_data_json=workspace([start],schema);
  await saveJson('dist/video/owned-wait.bcm',p);
  const wait=await visualWork('dist/video/owned-wait.bcm',{captureFrames:[1,2],artifactsDir:'dist/video/visual'});
  assert.equal(wait.status,'unverified');assert.match(wait.error,/completion.*control flow/);assert.equal(wait.frames.length,2);
});
