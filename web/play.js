import {StageRenderer,decodeFrame} from './renderer.js';
import {PlayerConnection} from './player.js';
import {ProjectAudio} from './audio.js';
import {StageInput} from './input.js';

const extension=location.protocol==='chrome-extension:'?await import('./extension.js'):null;
const backend=extension?await extension.backendURL():location.origin;

const $=selector=>document.querySelector(selector);
const canvas=$('#stage'),shell=$('#player-shell');
let renderer,input,project=null,playable=false,busy=true,running=false,connection=null,inFlight=null,epoch=0;
let lastTick=0,nextDue=0,lastFrame=null,roundtripMs=0,updates=0,draws=0,totalUpdates=0;
let sampleStart=performance.now(),lastMonitor=0,drawFps=0,updateFps=0;
const audio=new ProjectAudio(notice);
const settings={limit:60,budget:4,resolution:1};
const choices={limit:[0,30,60,120],budget:[2,4,8,12],resolution:[.5,1,2]};
try{
  const saved=JSON.parse(localStorage.getItem('neko-play-settings')||'{}');
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
  for(const id of ['frame-limit','budget','resolution'])$(`#${id}`).disabled=busy;
  shell.classList.toggle('running',running);
}
function clearKeys(){input?.release();}
function resetMeter(){updates=0;draws=0;sampleStart=performance.now();drawFps=0;updateFps=0;}
function pause(message='已暂停'){
  running=false;audio.pause();clearKeys();resetMeter();status(message);syncControls();
}
async function closeRuntime(){
  running=false;epoch++;clearKeys();connection?.close();connection=null;
  input?.reset();
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
    const next=new PlayerConnection();connection=next;await next.open(project,backend);
    epoch++;lastFrame=null;totalUpdates=0;
  }
  clearKeys();resetMeter();running=true;lastTick=performance.now();nextDue=lastTick;
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
    const buffer=await connection.frame({dt,...input.take(),budget_ms:settings.budget});
    if(token!==epoch)return;
    roundtripMs=performance.now()-start;
    const {frame,lines}=decodeFrame(buffer);renderer.apply(frame,lines);lastFrame=frame;
    audio.apply(frame);
    updates++;totalUpdates++;if(renderer.stats.drawCalls>0)draws++;
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
  $('#render-size').textContent=project?`${canvas.width} × ${canvas.height} · WebGL 2`:'WebGL 2';
  $('#timer').hidden=!lastFrame?.timer_visible;
  if(lastFrame?.timer_visible)$('#timer').textContent=`计时器 ${lastFrame.timer.toFixed(2)}`;
}
function loop(now){
  if(running&&!busy&&!inFlight&&now>=nextDue-.5){
    const dt=Math.min((now-lastTick)/1000,.25);lastTick=now;
    const interval=settings.limit?1000/settings.limit:0;
    nextDue=interval?Math.max(nextDue+interval,now):now;
    inFlight=advance(dt).finally(()=>{inFlight=null;});
  }
  if(renderer){renderer.render();renderer.collectGpuTimes();monitor(now);}
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
for(const [id,key]of [['frame-limit','limit'],['budget','budget'],['resolution','resolution']]){
  const select=$(`#${id}`);select.value=String(settings[key]);
  select.onchange=()=>{
    const value=Number(select.value);if(!choices[key].includes(value))return;
    try{
      if(key==='resolution')renderer.setResolution(value);
      settings[key]=value;nextDue=performance.now();
      lastMonitor=0;monitor(performance.now());
      try{localStorage.setItem('neko-play-settings',JSON.stringify(settings));}catch{}
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
window.addEventListener('drop',event=>{event.preventDefault();shell.classList.remove('file-drag');void importFile(event.dataTransfer.files[0]);});
new ResizeObserver(fitStage).observe($('#viewport'));

try{
  renderer=new StageRenderer(canvas);renderer.resolutionScale=settings.resolution;
  input=new StageInput(canvas,renderer,()=>running&&!busy);
  renderer.onError=message=>{pause('渲染提示');notice(message);};
  const value=extension?await extension.loadWork(backend,status):await(await fetch('/api/project')).json();
  await install(await api('import-player',value));
  if(extension&&playable)await launch();
}catch(error){notice(error.message);status(extension?'连接或载入失败 · 点击重连': '请选择作品');extension?.reportStatus('Rust 未连接');}
finally{busy=false;syncControls();requestAnimationFrame(loop);}

// Read-only test/performance snapshot; the standalone page never builds editor DOM.
window.nekoPlayDiagnostics=()=>({running,busy,playable,settings:{...settings},frame:lastFrame,totalUpdates,drawFps,updateFps,
  framebuffer:[canvas.width,canvas.height],renderer:{...renderer?.stats},pending:!!inFlight,projectName:project?.projectName,audio:audio.snapshot()});
