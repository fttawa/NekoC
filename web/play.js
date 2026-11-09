import {StageRenderer,decodeFrame,sensesColor} from './renderer.js';
import {PlayerConnection} from './player.js';
import {ProjectAudio} from './audio.js';
import {StageInput} from './input.js';
import {StageOverlay} from './overlay.js';

const extension=location.protocol==='chrome-extension:'?await import('./extension.js'):null;
// Exported executables: stage and performance settings only.
const app=new URLSearchParams(location.search).has('app');
document.body.classList.toggle('native',new URLSearchParams(location.search).has('native'));
if(app){document.body.classList.add('app');document.querySelector('#settings').hidden=true;document.querySelector('#settings-toggle').setAttribute('aria-expanded','false');}
const backend=extension?await extension.backendURL():location.origin;

const $=selector=>document.querySelector(selector);
const canvas=$('#stage'),shell=$('#player-shell');
let renderer,input,overlay,sendCostumes=false,project=null,playable=false,busy=true,running=false,connection=null,inFlight=null,observing=false,epoch=0;
let lastTick=0,nextDue=0,lastFrame=null,roundtripMs=0,updates=0,draws=0,totalUpdates=0,pumpTimer=0;
let sampleStart=performance.now(),lastMonitor=0,drawFps=0,updateFps=0;
const audio=new ProjectAudio(notice,id=>input?.push({kind:'audio_done',id}));
const settings={limit:60,budget:12,resolution:0,coalesce:0};
const choices={limit:[0,30,60,120,240,480,1000,-1],budget:[2,4,8,12,16],resolution:[0,.5,1,2],coalesce:[0,1]};
try{
  const saved=JSON.parse(localStorage.getItem('neko-play-settings-v2')||'{}');
  for(const key of Object.keys(settings))if(choices[key].includes(saved[key]))settings[key]=saved[key];
}catch{/* Storage can be unavailable in private browsing. */}

async function api(path,data){
  const response=await fetch(`${backend}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
  const value=await response.json();if(!response.ok)throw Error(value.error||`HTTP ${response.status}`);return value;
}
function notice(message){$('#notice-text').textContent=message;$('#notice').hidden=false;}
function status(message){$('#status').textContent=message;}
function syncControls(){
  $('#import').disabled=busy;$('#import').textContent=busy?'载入中…':'＋ 导入作品';
  $('#toggle').disabled=busy||!playable;$('#restart').disabled=busy||!playable;
  $('#toggle').textContent=running?'Ⅱ 暂停':connection?.ready?'▶ 继续游玩':'▶ 开始游玩';
  for(const id of ['frame-limit','budget','resolution','coalesce'])$(`#${id}`).disabled=busy;
  shell.classList.toggle('running',running);
}
function clearKeys(){input?.release();}
function resetMeter(){updates=0;draws=0;sampleStart=performance.now();drawFps=0;updateFps=0;}
function pause(message='已暂停'){
  running=false;audio.pause();clearKeys();resetMeter();status(message);syncControls();
}
async function closeRuntime(){
  running=false;epoch++;clearKeys();connection?.close();connection=null;
  input?.reset();overlay?.reset();
  audio.stop();
  await inFlight;resetMeter();
}
function fitStage(){
  if(!renderer||!project)return;
  const area=$('#viewport'),scale=Math.min((area.clientWidth-2)/renderer.width,(area.clientHeight-2)/renderer.height);
  $('#stage-box').style.width=`${Math.max(1,renderer.width*scale)}px`;
  $('#stage-box').style.height=`${Math.max(1,renderer.height*scale)}px`;
}
async function install(report){
  await closeRuntime();project=report.project;playable=false;lastFrame=null;totalUpdates=0;
  $('#timer').hidden=true;$('#notice').hidden=true;
  $('#project-name').textContent=project.projectName||'未命名作品';document.title=`${project.projectName||'Neko'} · 播放器`;
  await renderer.load(project);renderer.render();fitStage();
  audio.load(project);
  $('#stage-box').classList.add('loaded');$('#welcome').hidden=true;
  playable=report.fast_runtime_ready;
  if(playable)status('就绪 · 点击开始游玩');
  else{
    const issues=report.script_diagnostics||[];
    notice(issues.length?issues.slice(0,4).map(issue=>`${issue.message}${issue.affected_scripts>1?`（影响 ${issue.affected_scripts} 个脚本）`:''}`).join('\n'):report.runtime_error||'此作品包含尚未支持的积木');
    status('作品暂无法运行');
  }
}
async function launch(){
  if(!playable)return;
  if(!connection?.ready){
    input?.reset();
    const next=new PlayerConnection();connection=next;await next.open(project,backend);sendCostumes=true;overlay.reset();
    // Opt-in observation before any scheduler tick, not an extra simulation frame.
    if(new URLSearchParams(location.search).has('compare'))window.nekoCompareZero=await next.snapshot();
    epoch++;lastFrame=null;totalUpdates=0;
  }
  clearKeys();resetMeter();running=true;lastTick=performance.now();nextDue=lastTick;queueMicrotask(pump);
  audio.resume();extension?.reportStatus('Rust 已连接');
  status('运行中');canvas.focus({preventScroll:true});syncControls();
}
async function action(work){
  if(busy)return;busy=true;syncControls();
  try{await work();}catch(error){pause('已暂停');notice(error.message);}
  finally{busy=false;syncControls();}
}
async function importFile(file){
  if(!file)return;
  await action(async()=>{
    pause('正在导入…');
    const value=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const report=await api('import-player',value);
    await install(report);
    if(playable)await launch();
  });
}
async function advance(dt){
  const token=epoch,start=performance.now();
  try{
    // Costume geometry is sent once per connection, after the renderer decoded it.
    const costumes=sendCostumes?renderer.costumeInfo(sensesColor(project)):undefined;sendCostumes=false;
    const buffer=await connection.frame({dt,...input.take(),costumes,budget_ms:settings.budget,coalesce:settings.coalesce===1,utc_offset:-new Date().getTimezoneOffset()});
    if(token!==epoch)return;
    roundtripMs=performance.now()-start;
    // Draw pen deltas now; the stage is composited once on the next display frame.
    const {frame,lines}=decodeFrame(buffer);renderer.apply(frame,lines,false);overlay.apply(frame);lastFrame=frame;
    audio.apply(frame);
    updates++;totalUpdates++;if(renderer.changed)draws++;
  }catch(error){
    if(token!==epoch)return;
    epoch++;connection?.close();connection=null;pause('运行已中断');notice(error.message);
    extension?.reportStatus('Rust 连接中断');
  }
}
function monitor(now){
  if(now-sampleStart>=1000){
    drawFps=draws*1000/(now-sampleStart);updateFps=updates*1000/(now-sampleStart);
    updates=0;draws=0;sampleStart=now;
  }
  if(now-lastMonitor<250)return;lastMonitor=now;
  $('#fps').textContent=running?drawFps.toFixed(0):'—';
  $('#update-fps').textContent=running?`${updateFps.toFixed(0)} /s`:'—';
  $('#vm-time').textContent=lastFrame?`${(lastFrame.execute_us/1000).toFixed(2)} ms`:'—';
  $('#gpu-time').textContent=renderer.stats.gpuMs==null?'不可用':`${renderer.stats.gpuMs.toFixed(2)} ms`;
  $('#roundtrip').textContent=lastFrame?`${roundtripMs.toFixed(2)} ms`:'—';
  $('#render-size').textContent=project?`${canvas.width}×${canvas.height}`:'—';
  $('#timer').hidden=!lastFrame?.timer_visible;
  if(lastFrame?.timer_visible)$('#timer').textContent=`计时器 ${lastFrame.timer.toFixed(2)}`;
}
// Runtime updates are paced by the update limit, not by the display: a limit above
// the refresh rate (or a project that yields between compute and draw) is no longer
// capped at one round trip per animation frame. Only one request is ever in flight.
function step(now,continuation=false){
  const dt=Math.min((now-lastTick)/1000,.25);lastTick=now;
  const interval=settings.limit>0?1000/settings.limit:0;
  // A continuation finishes work the last update ran out of budget for: it is not a
  // new paced update, so it neither waits for the limit nor delays the next one.
  if(!continuation)nextDue=interval?Math.max(nextDue+interval,now):now;
  inFlight=advance(dt).finally(()=>{inFlight=null;pump();});
}
const pumpChannel=new MessageChannel();
pumpChannel.port1.onmessage=()=>pump();
function pump(){
  clearTimeout(pumpTimer);pumpTimer=0;
  // "Follow screen" keeps exactly one update per display frame.
  if(!running||busy||inFlight||observing)return;
  if(lastFrame?.budget_yield){step(performance.now(),true);return;}
  if(!settings.limit)return;
  const now=performance.now(),wait=nextDue-now;
  if(wait<=.5)step(now);
  // Nested timers clamp to 4ms; shorter waits need a task that is not throttled.
  else if(wait<4)pumpChannel.port2.postMessage(0);
  else pumpTimer=setTimeout(pump,wait);
}
function loop(now){
  if(running&&!busy&&!inFlight&&!observing&&now>=nextDue-.5)step(now);
  if(renderer){renderer.render();overlay?.update();renderer.collectGpuTimes();monitor(now);}
  requestAnimationFrame(loop);
}

$('#import').onclick=()=>$('#file').click();
$('#file').onchange=async event=>{const file=event.target.files[0];event.target.value='';await importFile(file);};
$('#toggle').onclick=()=>action(async()=>{if(running)pause();else await launch();});
$('#restart').onclick=()=>action(async()=>{
  await closeRuntime();lastFrame=null;$('#timer').hidden=true;await renderer.load(project);renderer.render();await launch();
});
$('#settings-toggle').onclick=()=>{
  const open=$('#settings').hidden;$('#settings').hidden=!open;$('#settings-toggle').setAttribute('aria-expanded',String(open));
};
$('#dismiss').onclick=()=>{$('#notice').hidden=true;};
for(const [id,key]of [['frame-limit','limit'],['budget','budget'],['resolution','resolution'],['coalesce','coalesce']]){
  const select=$(`#${id}`);select.value=String(settings[key]);
  select.onchange=()=>{
    const value=Number(select.value);if(!choices[key].includes(value))return;
    try{
      if(key==='resolution')renderer.setResolution(value);
      settings[key]=value;nextDue=performance.now();pump();
      lastMonitor=0;monitor(performance.now());
      try{localStorage.setItem('neko-play-settings-v2',JSON.stringify(settings));}catch{}
      if(running)canvas.focus({preventScroll:true});
    }catch(error){select.value=String(settings[key]);notice(error.message);}
  };
}
$('#fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await shell.requestFullscreen();canvas.focus({preventScroll:true});}
  catch{notice('当前浏览器无法进入全屏');}
};
document.addEventListener('fullscreenchange',()=>{
  const active=!!document.fullscreenElement;$('#fullscreen').setAttribute('aria-label',active?'退出全屏':'全屏游玩');
  $('#fullscreen').title=active?'退出全屏':'全屏游玩';$('#fullscreen span').textContent=active?'退出全屏':'全屏';fitStage();
});
window.addEventListener('pointerdown',()=>audio.unlock(),{capture:true});
window.addEventListener('keydown',()=>audio.unlock(),{capture:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause('已暂停 · 页面切到后台');});
window.addEventListener('pagehide',()=>{connection?.close();audio.stop();});
window.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();shell.classList.add('file-drag');}});
window.addEventListener('dragleave',event=>{if(!event.relatedTarget)shell.classList.remove('file-drag');});
window.addEventListener('drop',event=>{event.preventDefault();shell.classList.remove('file-drag');if(!app)void importFile(event.dataTransfer.files[0]);});
let resizeTimer=0;
new ResizeObserver(()=>{
  fitStage();
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{if(settings.resolution===0)renderer?.setResolution(0);},200);
}).observe($('#viewport'));

try{
  renderer=new StageRenderer(canvas);renderer.resolutionScale=settings.resolution;
  input=new StageInput(canvas,renderer,()=>running&&!busy);
  overlay=new StageOverlay($('#stage-box'),renderer,event=>{input.push(event);canvas.focus({preventScroll:true});});
  renderer.onError=message=>{pause('渲染提示');notice(message);};
  const value=extension?await extension.loadWork(backend,status):await(await fetch('/api/project')).json();
  await install(await api('import-player',value));
  if((extension||app)&&playable)await launch();
}catch(error){notice(error.message);status(extension?'连接或载入失败 · 点击重连': '请选择作品');extension?.reportStatus('Rust 未连接');}
finally{busy=false;syncControls();requestAnimationFrame(loop);}

// Read-only test/performance snapshot; the standalone page never builds editor DOM.
window.nekoPlayDiagnostics=()=>({running,busy,playable,settings:{...settings},frame:lastFrame,totalUpdates,drawFps,updateFps,
  framebuffer:[canvas.width,canvas.height],renderer:{...renderer?.stats},pending:!!inFlight,projectName:project?.projectName,audio:audio.snapshot()});
// A detached read, serialized after an outstanding frame. No pause/resume or VM mutation.
window.nekoPlaySnapshot=async()=>{
  if(!connection?.ready)throw Error('运行时尚未连接');
  if(observing)throw Error('已有状态读取等待响应');
  observing=true;
  try{await inFlight;return await connection.snapshot();}
  finally{observing=false;pump();}
};
