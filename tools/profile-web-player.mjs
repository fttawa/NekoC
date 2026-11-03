import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const base=process.env.NEKOC_WEB_URL||'http://127.0.0.1:4173';
const output=process.argv[2]||'docs/web-player-profile.json';
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const report={browser:await browser.version(),gpu:'SwiftShader (correctness / software-rendering measurements)',projects:[]};
try {
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.nekoImportReport);
  for(const file of ['samples/pen_display_fast.bcmkn','samples/web-pen-stress.bcmkn','samples/pencraft.bcmkn']){
    console.log('Profiling',file);
    const started=performance.now();
    await page.locator('#file').setInputFiles(file);
    const project=JSON.parse(await readFile(file,'utf8')),name=project.projectName;
    const names=Object.entries(project.variables?.variablesDict||{}).filter(([,v])=>v.type!=='list').map(([id])=>id).sort();
    const frameIndex=names.indexOf('kn-var-frames');
    await page.waitForFunction(name=>window.nekoImportReport?.inspection?.project_name===name,name);
    const importMs=performance.now()-started;
    await page.locator('#run').click();
    const ui=await page.evaluate(async frameIndex=>{
      const samples=[],windows=[];let start=performance.now(),previous=-1,frames=0,windowStart=start;
      const initial=window.nekoDiagnostics().frame?.variables[frameIndex]||0;
      let windowFrames=initial;
      await new Promise(resolve=>{
        function measure(now){
          const d=window.nekoDiagnostics();
          if(d.frame&&d.frame.sequence!==previous){previous=d.frame.sequence;frames++;samples.push({vm:d.frame.execute_us/1000,submit:d.renderer.submitMs,bytes:d.bytes,roundtrip:d.pipeline.roundtripMs,decode:d.pipeline.decodeMs,gpu:d.renderer.gpuMs});}
           if(frameIndex>=0&&now-windowStart>=8000){const value=d.frame?.variables[frameIndex]||0;windows.push({elapsedMs:now-windowStart,frames:value-windowFrames,fps:(value-windowFrames)*1000/(now-windowStart)});windowStart=now;windowFrames=value;}
           if(frameIndex>=0?windows.length<3:now-start<4000)requestAnimationFrame(measure);else resolve();
        }
        requestAnimationFrame(measure);
      });
      const mean=key=>samples.reduce((a,s)=>a+s[key],0)/samples.length;
      const d=window.nekoDiagnostics(),elapsedMs=performance.now()-start;
      return {elapsedMs,frames,framesPerSecond:frames*1000/elapsedMs,vmMs:mean('vm'),submitMs:mean('submit'),bytes:mean('bytes'),roundtripMs:mean('roundtrip'),decodeMs:mean('decode'),gpuMs:samples.every(s=>s.gpu==null)?null:mean('gpu'),domNodes:document.querySelectorAll('*').length,diagnostics:d.pipeline,
        projectFrames:frameIndex>=0?d.frame.variables[frameIndex]-initial:null,projectFps:frameIndex>=0?(d.frame.variables[frameIndex]-initial)*1000/elapsedMs:null,windows};
    },frameIndex);
    console.log('UI sample',ui.framesPerSecond);
    await page.locator('#pause').dispatchEvent('click');
    const api=await page.evaluate(async()=>{
      const post=async(name,data={})=>fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      await post('start');const {decodeFrame}=await import('/renderer.js');const times=[],vm=[];let bytes=0;
      for(let i=0;i<100;i++){
        const start=performance.now();const buffer=await(await post('frame',{dt:1/60})).arrayBuffer();times.push(performance.now()-start);
        const {frame}=decodeFrame(buffer);vm.push(frame.execute_us/1000);bytes+=buffer.byteLength;
      }
      const sorted=times.toSorted((a,b)=>a-b);
      return {meanMs:times.reduce((a,b)=>a+b)/times.length,p50Ms:sorted[50],p95Ms:sorted[95],vmMs:vm.reduce((a,b)=>a+b)/vm.length,meanBytes:bytes/100};
    });
    const websocket=await page.evaluate(async()=>{
      const {PlayerConnection}=await import('/player.js'),{decodeFrame}=await import('/renderer.js');const p=new PlayerConnection();await p.open();const times=[];let vm=0,bytes=0;
      try{for(let i=0;i<100;i++){const start=performance.now(),buffer=await p.frame({dt:1/60});times.push(performance.now()-start);vm+=decodeFrame(buffer).frame.execute_us/1000;bytes+=buffer.byteLength;}}
      finally{p.close();}
      const sorted=times.toSorted((a,b)=>a-b);return {meanMs:times.reduce((a,b)=>a+b)/times.length,p50Ms:sorted[50],p95Ms:sorted[95],vmMs:vm/100,meanBytes:bytes/100};
    });
    await page.locator('#stop').click();await page.waitForFunction(()=>!window.nekoDiagnostics().started);
    report.projects.push({file,importMs,ui,api,websocket});
  }
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
