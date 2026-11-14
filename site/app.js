// 在线编译页：@nekox-lab/nekoc 的浏览器版负责检查和编译，
// play/play.html（wasm 后端）负责运行。
const $=selector=>document.querySelector(selector);
const samples=await(await fetch('samples/index.json')).json();
let nekoc=null,bcmkn=null,playerReady=false,pendingProject=null;

for(const name of samples){const option=document.createElement('option');option.value=name;option.textContent=name;$('#sample').append(option);}
async function loadSample(name){
  $('#code').value=await(await fetch(`samples/${encodeURIComponent(name)}`)).text();
  $('#filename').value=name;setBcmkn(null);showDiagnostics([]);
}
const saved=(()=>{try{return JSON.parse(localStorage.getItem('nekoc-online')||'null');}catch{return null;}})();
if(saved?.code){$('#code').value=saved.code;$('#filename').value=saved.file||'main.nk.ts';}
else await loadSample(samples[0]);
let saveTimer=0;
$('#code').addEventListener('input',()=>{
  setBcmkn(null);clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{try{localStorage.setItem('nekoc-online',JSON.stringify({code:$('#code').value,file:$('#filename').value}));}catch{}},400);
});
$('#code').addEventListener('keydown',event=>{
  if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();document.execCommand('insertText',false,'  ');}
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('#run').click();}
});
$('#sample').onchange=()=>loadSample($('#sample').value);

function entry(){
  const name=$('#filename').value.trim().replace(/^\/+/,'')||'main.nk.ts';
  return '/'+(/\.ts$/.test(name)?name:`${name}.ts`);
}
function setBcmkn(value){bcmkn=value;$('#download').disabled=!value;}
function state(text){$('#state').textContent=text;}
function showDiagnostics(list){
  const box=$('#diagnostics');box.replaceChildren();box.hidden=!list.length;
  for(const item of list){
    const row=document.createElement('li');row.className=item.severity;
    const where=item.line?`${item.line}:${item.column??1}`:'';
    row.innerHTML='<b></b><span></span><code></code>';
    row.querySelector('b').textContent=where;row.querySelector('span').textContent=item.message;row.querySelector('code').textContent=item.code;
    if(item.line)row.onclick=()=>jump(item.line,item.column??1);
    box.append(row);
  }
}
function jump(line,column){
  const lines=$('#code').value.split('\n');let offset=0;
  for(let i=0;i<line-1&&i<lines.length;i++)offset+=lines[i].length+1;
  offset+=Math.max(0,column-1);$('#code').focus();$('#code').setSelectionRange(offset,offset);
}
async function busy(work){
  for(const id of ['check','run','sample'])$(`#${id}`).disabled=true;
  try{await work();}catch(error){state('出错了');showDiagnostics([{severity:'error',message:error.message||String(error),code:'internal'}]);}
  finally{for(const id of ['check','run','sample'])$(`#${id}`).disabled=!nekoc;}
}
// 检查失败（有 error）返回 false，并显示全部诊断。
function runCheck(){
  const files={[entry()]:$('#code').value};
  const started=performance.now(),result=nekoc.check(entry(),{files});
  showDiagnostics(result.diagnostics);
  const errors=result.diagnostics.filter(item=>item.severity==='error').length,warnings=result.diagnostics.length-errors;
  state(result.ok?`检查通过${warnings?` · ${warnings} 个警告`:''} · ${Math.round(performance.now()-started)} ms`:`${errors} 个错误`);
  return result.ok;
}
function play(project){
  if(playerReady)$('#player').contentWindow.postMessage({type:'nekoc-play',project},location.origin);
  else pendingProject=project;
}
addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==$('#player').contentWindow||event.data?.type!=='nekoc-player-ready')return;
  playerReady=true;if(pendingProject){const project=pendingProject;pendingProject=null;play(project);}
});
$('#check').onclick=()=>busy(async()=>{runCheck();});
$('#run').onclick=()=>busy(async()=>{
  if(!runCheck())return;
  const result=nekoc.compile(entry(),{files:{[entry()]:$('#code').value}});
  setBcmkn(result.bcmkn);state(`${$('#state').textContent} · 已编译`);play(result.bcmkn);
});
$('#download').onclick=()=>{
  if(!bcmkn)return;
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([JSON.stringify(bcmkn)],{type:'application/json'}));
  link.download=entry().slice(1).replace(/(\.nk)?\.ts$/,'')+'.bcmkn';link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
};

await busy(async()=>{nekoc=await import('./nekoc/browser.mjs');state('编译器就绪 · Ctrl+Enter 编译并运行');});
