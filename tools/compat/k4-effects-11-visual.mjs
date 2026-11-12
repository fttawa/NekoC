// Genuine VM frame deltas, no synthetic initial or target effects.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transition11Fixtures } from './k4-partial-transition-11.mjs';
import { transition10Fixtures } from './k4-partial-transition-10.mjs';
import { visualWork } from './k4-visual.mjs';
import { saveJson } from './k4-oracle.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const names=process.argv.slice(2).filter(s=>!s.startsWith('--'));
const rendererLfSha256=hash((await readFile('web/renderer.js','utf8')).replaceAll('\r\n','\n'));
const executableSha256=hash(await readFile('target/debug/k4-trace.exe'));
const diagnose=process.argv.includes('--diagnose');
const fixtures=process.argv.includes('--original')?await transition10Fixtures():await transition11Fixtures();
for(const [name,spec]of Object.entries(fixtures)){
  if(names.length&&!names.includes(name))continue;
  const input=`tests/fixtures/kitten4/partial-transition-11-${name}.bcm`;
  await saveJson(input,spec.project);
  const result=await visualWork(input,{captureFrames:Array.from({length:68},(_,i)=>i+1),seed:1,pixelTolerance:8,
    artifactsDir:'dist/k4effects11/visual',
    onVisualReady:async({page,nekoPage})=>{
      await page.evaluate(()=>{window.__transitionNow=0;Object.defineProperty(performance,'now',{value:()=>window.__transitionNow,configurable:true});window.__k4OracleRequire('a1xw').a().core.app.get_app().ticker.stop();});
      await nekoPage.evaluate(()=>{window.__transitionNow=0;window.renderer.transitionClock=()=>window.__transitionNow;});
    },
    onComparingFrame:async({page,nekoPage,frame})=>{
      const ms=(frame-1)*1000/60;
      await page.evaluate(ms=>{window.__transitionNow=ms;},ms);
      await nekoPage.evaluate(ms=>{window.__transitionNow=ms;},ms);
    },
    onComparedFrame:async({page,nekoPage,frame})=>{
      if(!diagnose||![1,2,8,13].includes(frame))return;
      const official=await page.evaluate(()=>{const s=window.__k4OracleRequire('a1xw').a(),t=s.core.scenes.transition;return {ms:window.__transitionNow,start:t.tl.get_cache_size(),scenes:s.core.app.get_scene_container().children.filter(n=>n.id).map(n=>({id:n.id,x:n.x,y:n.y,alpha:n.alpha}))};});
      const neko=await nekoPage.evaluate(()=>{const r=window.renderer;return {ms:window.__transitionNow,start:r.sceneTransition?.start,kind:r.sceneTransition?.transition};});
      console.log(name,frame,JSON.stringify({official,neko}));
    }});
  await saveJson(`docs/kitten4-partial-transition-11-vm-${name}.json`,{schema:'nekoc-k4-transition-11-vm-v1',scope:'real NekoC VM and official VM; controlled native ticker, 68 consecutive full canvas frames; no masks, RGB tolerance 8',rendererLfSha256,executableSha256,sha256:hash(JSON.stringify(spec.project,null,2)+'\n'),...result});
  console.log(name,result.status,JSON.stringify({maxChanged:Math.max(...result.frames.map(f=>f.changedPixels)),maxMae:Math.max(...result.frames.map(f=>f.mae)),error:result.error,frames:result.frames.filter(f=>f.changedPixels).map(f=>[f.frame,f.changedPixels])}));
  if(result.status!=='captured'||result.frames.length!==68||result.frames.some(f=>f.changedPixels||f.maskedPixels||f.pixels!==960*720))process.exitCode=1;
}
