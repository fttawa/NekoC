import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const modules=process.env.NEKOC_NODE_MODULES;
const require=createRequire(modules?path.join(modules,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output=process.argv[2]||'D:/AppData/Local/Temp/opencode/nekoc-web-verification';
const base=process.argv[3]||process.env.NEKOC_WEB_URL||'http://127.0.0.1:4173';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={browser:await browser.version(),tests:[],errors};
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.nekoImportReport);
  const chooser=page.waitForEvent('filechooser');await page.locator('#open').click();await(await chooser).setFiles('samples/native-studio.bcmkn');
  await page.waitForFunction(()=>window.nekoImportReport?.inspection?.project_name==='Rust Studio · Polygon'&&window.nekoImportReport?.fast_runtime_ready===true);
  await page.screenshot({path:path.join(output,'editor.png'),fullPage:true});
  await page.getByRole('button',{name:'▶ 运行',exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics?.().frame?.active===0);
  await page.getByTitle('暂停',{exact:true}).dispatchEvent('click');
  const first=await page.evaluate(()=>window.nekoDiagnostics());
  assert.equal(first.sprites.find(a=>a.id==='sprite').direction,360);
  assert.ok(Math.abs(first.sprites.find(a=>a.id==='sprite').y+80)<1e-7);
  report.tests.push('bcmkn bytecode execution, closed pen path');
  await page.screenshot({path:path.join(output,'running-result.png'),fullPage:true});
  await page.getByTitle('停止',{exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics().started===false);

  // Import unsupported scripts but preserve and export them exactly.
  const original=JSON.parse(await readFile('samples/native-studio.bcmkn','utf8'));
  original.projectName='BCMKN 往返测试';original.futureExtension={opaque:[1,'two',{x:null}]};
  original.actors.actorsDict.sprite.nekoBlockJsonList[0].next={id:'unsupported-sound',type:'play_audio',mutation:'<mutation unknown="keep"/>'};
  await page.locator('#file').setInputFiles({name:'保真.bcmkn',mimeType:'application/json',buffer:Buffer.from('\uFEFF'+JSON.stringify(original))});
  await page.waitForFunction(()=>window.nekoImportReport?.script_diagnostics?.some(d=>d.message.includes('unsupported-sound')));
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 .bcmkn'}).click();
  const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(exported,original);
  report.tests.push('BOM bcmkn import; unsupported block diagnostics; unknown fields/mutation preserved on export');
  await page.locator('#file').setInputFiles('samples/native-studio.bcmkn');
  await page.waitForFunction(()=>window.nekoImportReport?.fast_runtime_ready===true);
  // Edit a numeric block, undo, redo, and export.
  const field=page.locator('[data-block="move"] input').first();await field.fill('32');await field.dispatchEvent('change');
  await page.getByTitle('撤销',{exact:true}).click();assert.equal(await page.locator('[data-block="move"] input').inputValue(),'40');
  await page.getByTitle('重做',{exact:true}).click();assert.equal(await page.locator('[data-block="move"] input').inputValue(),'32');
  report.tests.push('numeric block edit, undo/redo');
  const renderer=await page.evaluate(async()=>{
    const {StageRenderer}=await import('/renderer.js');
    const canvas=document.createElement('canvas');const r=new StageRenderer(canvas);
    await r.load({stageSize:{width:100,height:100},scenes:{currentSceneId:'s',scenesDict:{s:{actorIds:[]}}},actors:{actorsDict:{}},styles:{stylesDict:{}}});
    const gl=r.gl;
    function pixel(x,y){const p=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return [...p];}
    const base={clear:true,sprites:[]};
    r.apply(base,new Float32Array([-20,0,20,0,10,1,0,0,1]));const center=pixel(50,50),outside=pixel(50,65),cap=pixel(27,50);
    r.apply({clear:false,sprites:[]},new Float32Array([0,-20,0,20,10,0,0,1,1]));const overwrite=pixel(50,50),retained=pixel(35,50);
    r.apply({clear:false,sprites:[]},new Float32Array());const idleCalls=r.stats.drawCalls;
    r.apply({clear:true,sprites:[]},new Float32Array());const cleared=pixel(50,50);
    const instances=new Float32Array(9*10000);for(let i=0;i<10000;i++)instances.set([-30,-30,30,30,1,0,1,0,1],i*9);
    r.apply({clear:true,sprites:[]},instances);const drawCalls=r.stats.drawCalls;const capacity=r.bufferCapacity;
    r.apply({clear:true,sprites:[]},new Float32Array([0,0,1,1,1,1,0,0,1]));
    const reusedCapacity=r.bufferCapacity;
    const stamp={before_line:1,text:'MMMM',x:0,y:0,size:24,direction:0,align:'center',color:[0,1,0,1]};
    const red=[-30,0,30,0,60,1,0,0,1],blue=[-30,0,30,0,60,0,0,1,1];
    function greenPixels(){const pixels=new Uint8Array(100*100*4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(0,0,100,100,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.FRAMEBUFFER,null);let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>200&&pixels[i]<20&&pixels[i+2]<20)count++;return count;}
    r.apply({clear:true,sprites:[],text_stamps:[stamp]},new Float32Array(red));const textOnTop=greenPixels(),textUploads=r.stats.textUploads;
    r.apply({clear:true,sprites:[],text_stamps:[stamp]},new Float32Array([...red,...blue]));const textUnderLine=greenPixels(),cachedUploads=r.stats.textUploads;
    r.apply({clear:true,sprites:[],text_stamps:[{...stamp,before_line:2}]},new Float32Array([...red,...blue]));const textAfterLines=greenPixels();
    r.apply({clear:false,sprites:[]},new Float32Array());const retainedText=greenPixels(),textIdleCalls=r.stats.drawCalls;
    r.apply({clear:true,sprites:[]},new Float32Array());const clearedText=greenPixels();
    for(let i=0;i<140;i++)r.apply({clear:true,sprites:[],text_stamps:[{...stamp,before_line:0,text:String(i)}]},new Float32Array());
    const result={center,outside,cap,overwrite,retained,cleared,idleCalls,drawCalls,instances:10000,capacity,reusedCapacity,glError:gl.getError(),framebufferBytes:r.stats.framebufferBytes,
      text:{textOnTop,textUnderLine,textAfterLines,retainedText,clearedText,textUploads,cachedUploads,textIdleCalls,cacheEntries:r.textCache.size,cacheBytes:r.stats.textTextureBytes}};
    gl.getExtension('WEBGL_lose_context').loseContext();return result;
  });
  assert.deepEqual(renderer.center,[255,0,0,255]);assert.equal(renderer.outside[3],0);assert.ok(renderer.cap[0]>200);
  assert.deepEqual(renderer.overwrite,[0,0,255,255]);assert.deepEqual(renderer.retained,[255,0,0,255]);assert.equal(renderer.cleared[3],0);
  assert.equal(renderer.idleCalls,0);assert.equal(renderer.drawCalls,2);assert.equal(renderer.capacity,renderer.reusedCapacity);assert.equal(renderer.glError,0);
  assert.ok(renderer.text.textOnTop>100);assert.equal(renderer.text.textUnderLine,0);assert.equal(renderer.text.textAfterLines,renderer.text.textOnTop);
  assert.equal(renderer.text.retainedText,renderer.text.textOnTop);assert.equal(renderer.text.clearedText,0);
  assert.equal(renderer.text.textUploads,1);assert.equal(renderer.text.cachedUploads,0);assert.equal(renderer.text.textIdleCalls,0);
  assert.equal(renderer.text.cacheEntries,128);assert.ok(renderer.text.cacheBytes<=16*1024*1024);
  report.renderer=renderer;report.tests.push('GPU pixels: capsule coverage, ordered overwrite, persistent layer, clear, 10k instances / 1 pen draw, idle zero draws, buffer reuse');
  // Run an actual 10k-segment bcmkn through the Rust server and GPU together.
  const saved=page.waitForEvent('download');await page.getByRole('button',{name:'导出 .bcmkn'}).click();await saved; // clear the edit dirty flag before import
  await page.locator('#file').setInputFiles('samples/web-pen-stress.bcmkn');
  await page.waitForFunction(()=>window.nekoImportReport?.inspection?.project_name==='GPU Pen · 10,000 segments');
  await page.getByRole('button',{name:'▶ 运行',exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics().frame?.sequence>=10);
  await page.getByTitle('暂停',{exact:true}).dispatchEvent('click');
  report.stress=await page.evaluate(()=>window.nekoDiagnostics());
  assert.equal(report.stress.frame.active,1);assert.ok(report.stress.bytes>1000);assert.ok(report.stress.renderer.drawCalls<=3);
  await page.screenshot({path:path.join(output,'stress.png'),fullPage:true});
  report.tests.push('10k-segment bcmkn runs through binary transport and WebGL2');
  await page.locator('#file').setInputFiles('samples/pen_display_fast.bcmkn');
  await page.waitForFunction(()=>window.nekoImportReport?.block_types?.stamp===1&&window.nekoImportReport?.fast_runtime_ready===true);
  await page.getByRole('button',{name:'▶ 运行',exact:true}).click();
  await page.waitForFunction(()=>window.nekoDiagnostics().frame?.sequence>=90);
  await page.getByTitle('暂停',{exact:true}).dispatchEvent('click');
  await page.screenshot({path:path.join(output,'pen-display-fast.png'),fullPage:true});
  report.penDisplay=await page.evaluate(async()=>{
    const {StageRenderer,decodeFrame}=await import('/renderer.js');
    const post=async(path,data={})=>{const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw Error(await response.text());return response;};
    const project=await(await fetch('/api/project')).json();
    const r=new StageRenderer(document.createElement('canvas'));await r.load(project);await post('start');
    let strokes=0,stamps=0,lastStamp='',maxDrawCalls=0;
    for(let i=0;i<100;i++){
      const {frame,lines}=decodeFrame(await(await post('frame',{dt:1/60})).arrayBuffer());
      r.apply(frame,lines);strokes+=lines.length/9;stamps+=frame.text_stamps?.length||0;
      if(frame.text_stamps?.length)lastStamp=frame.text_stamps.at(-1).text;
      maxDrawCalls=Math.max(maxDrawCalls,r.stats.drawCalls);
    }
    const gl=r.gl;
    const pixel=(x,y)=>{const p=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(Math.round(x+r.width/2),Math.round(y+r.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return [...p];};
    const bands=Array.from({length:8},(_,i)=>pixel(-392+i*112,200));
    const textPixels=new Uint8Array(220*44*4);gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.readPixels(650,35,220,44,gl.RGBA,gl.UNSIGNED_BYTE,textPixels);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    let brightTextPixels=0;for(let i=0;i<textPixels.length;i+=4)if(textPixels[i]>150&&textPixels[i+1]>150&&textPixels[i+2]>150)brightTextPixels++;
    await post('stop');
    const result={bands,background:pixel(0,0),strokes,stamps,lastStamp,brightTextPixels,maxDrawCalls,cacheEntries:r.textCache.size,glError:gl.getError()};
    gl.getExtension('WEBGL_lose_context').loseContext();return result;
  });
  for(let i=0;i<8;i++)assert.deepEqual(report.penDisplay.bands[i],[i*36,255-i*36,128,255]);
  assert.deepEqual(report.penDisplay.background,[8,12,24,255]);assert.ok(report.penDisplay.strokes>500);assert.ok(report.penDisplay.stamps>=2);
  assert.match(report.penDisplay.lastStamp,/^FPS: \d+\.\d$/);assert.ok(report.penDisplay.brightTextPixels>100);assert.equal(report.penDisplay.glError,0);
  report.tests.push('ordered text stamps, persistent text, bounded LRU texture cache; real pen_display_fast bands/background/FPS GPU pixels');
  // Real mixed-list project, including drag/drop and held input through WebSocket.
  const pencraft=JSON.parse(await readFile('samples/pencraft.bcmkn','utf8'));
  console.log('Verifying Pencraft import and input');
  await page.evaluate(value=>{
    const dt=new DataTransfer();dt.items.add(new File([value],'pencraft.bcmkn',{type:'application/json'}));
    window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
  },JSON.stringify(pencraft));
  await page.waitForFunction(name=>window.nekoImportReport?.inspection?.project_name===name,pencraft.projectName);
  console.log('Pencraft imported');
  assert.equal(await page.locator('#logs .error').count(),0);
  assert.equal(await page.locator('#logs p').count(),1);
  const names=Object.entries(pencraft.variables.variablesDict).filter(([,v])=>v.type!=='list').map(([id])=>id).sort();
  const at=Object.fromEntries(['frames','pz','yaw','selected','help'].map(name=>[name,names.indexOf('kn-var-'+name)]));
  assert.ok(Object.values(at).every(i=>i>=0));
  await page.locator('#run').click();
  console.log('Pencraft started',at);
  await page.waitForFunction(i=>window.nekoDiagnostics().frame?.variables[i]>=5,at.frames);
  console.log('Pencraft five complete frames');
  const before=await page.evaluate(()=>window.nekoDiagnostics());
  await page.keyboard.down('w');
  await page.waitForFunction(({i,value})=>Math.abs(window.nekoDiagnostics().frame.variables[i]-value)>.1,{i:at.pz,value:before.frame.variables[at.pz]});
  await page.keyboard.up('w');
  console.log('Pencraft moved');
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(({i,value})=>Math.abs(window.nekoDiagnostics().frame.variables[i]-value)>.1,{i:at.yaw,value:before.frame.variables[at.yaw]});
  await page.keyboard.up('ArrowRight');
  console.log('Pencraft turned');
  await page.keyboard.press('3');await page.waitForFunction(i=>window.nekoDiagnostics().frame.variables[i]===3,at.selected);
  await page.keyboard.press('h');await page.waitForFunction(i=>window.nekoDiagnostics().frame.variables[i]===0,at.help);
  await page.waitForFunction(i=>window.nekoDiagnostics().frame.variables[i]>=15,at.frames);
  await page.locator('#pause').click();report.pencraft=await page.evaluate(()=>window.nekoDiagnostics());
  assert.equal(report.pencraft.pipeline.transport,'websocket');assert.ok(report.pencraft.renderer.textTextureBytes>0);
  assert.equal(await page.locator('#logs .error').count(),0);
  await page.screenshot({path:path.join(output,'pencraft.png'),fullPage:true});
  console.log('Pencraft screenshot saved');
  await page.locator('#stop').click();await page.waitForFunction(()=>!window.nekoDiagnostics().started);
  await page.locator('#step').click();await page.waitForFunction(()=>document.querySelector('#runtime-state').textContent.includes('单步完成'));
  const restarted=await page.evaluate(()=>window.nekoDiagnostics());assert.equal(restarted.pipeline.completedFrames,1);
  assert.equal(restarted.frame.variables[at.selected],2);
  await page.locator('#stop').click();await page.waitForFunction(()=>!window.nekoDiagnostics().started);
  // The connection rejects overlapping frame requests and is reusable after close.
  report.socket=await page.evaluate(async()=>{
    const {PlayerConnection}=await import('/player.js');const {decodeFrame}=await import('/renderer.js');const p=new PlayerConnection();
    await p.open();const first=p.frame({dt:1/60});let overlap='';try{await p.frame({dt:1/60});}catch(e){overlap=e.message;}
    const sequence=decodeFrame(await first).frame.sequence;p.close();await p.open();const fresh=decodeFrame(await p.frame({dt:1/60})).frame.sequence;p.close();return {overlap,sequence,fresh};
  });
  assert.match(report.socket.overlap,/等待响应/);assert.equal(report.socket.sequence,1);assert.equal(report.socket.fresh,1);
  report.tests.push('actual chooser + drag/drop import; Pencraft mixed lists, terrain/HUD, held W/right, select/help keys, stop/restart/single-step; bounded WebSocket lifecycle');
  report.diagnostics=first;assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
