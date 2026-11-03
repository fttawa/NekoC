const $=s=>document.querySelector(s);
const settings=await chrome.storage.local.get({enabled:true,port:4173});$('#enabled').checked=settings.enabled;$('#port').value=settings.port;
async function check(){
  $('#status').textContent='连接中…';
  try{const response=await fetch(`http://127.0.0.1:${$('#port').value}/api/health`,{signal:AbortSignal.timeout(3000)});if(!response.ok||(await response.json()).player_protocol!==2)throw Error();$('#status').textContent='● Rust 后端已连接';}
  catch{$('#status').textContent='○ 后端未连接，请先启动 Rust 后端';}
}
$('#enabled').onchange=()=>chrome.storage.local.set({enabled:$('#enabled').checked});
$('#save').onclick=async()=>{if(!$('#port').reportValidity())return;await chrome.storage.local.set({port:Number($('#port').value),enabled:$('#enabled').checked});await check();};
await check();
