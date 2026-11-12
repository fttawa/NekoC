import {decodeProject} from './resource.js';
export async function backendURL(){
  const {port}=await chrome.storage.local.get({port:4173});
  return `http://127.0.0.1:${Number.isInteger(port)&&port>0&&port<65536?port:4173}`;
}
let takeoverShown=false,takeoverTimer=null;
export function reportStatus(status){
  if(parent!==window)parent.postMessage({type:'neko-rust-status',status},'https://pickcat.dao3.fun');
  if(status==='Rust 已连接'&&!takeoverShown){
    takeoverShown=true;
    const hint=document.querySelector('#takeover-hint');
    if(hint){hint.textContent='✓ Rust 已接管播放器';hint.hidden=false;takeoverTimer=setTimeout(()=>{hint.hidden=true;},4000);}
  }
  if(status==='Rust 未连接'||status==='Rust 连接中断'){
    clearTimeout(takeoverTimer);takeoverShown=false;
    const hint=document.querySelector('#takeover-hint');if(hint)hint.hidden=true;
  }
}
async function json(url,limit=64*1024*1024){
  const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`下载失败（HTTP ${response.status}）`);
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('作品超过 64 MiB 限制');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return decodeProject(new TextDecoder().decode(bytes));
}
export async function loadWork(backend,status){
  document.body.classList.add('embedded');
  const reconnect=document.createElement('button');reconnect.textContent='↻ 重连';reconnect.id='reconnect';reconnect.onclick=()=>location.reload();
  document.querySelector('#import').before(reconnect);
  // Compact embedded layout: performance settings start collapsed.
  document.querySelector('#settings').hidden=true;document.querySelector('#settings-toggle').setAttribute('aria-expanded','false');
  const style=document.createElement('link');style.rel='stylesheet';style.href='./embedded.css';document.head.append(style);
  const viewport=document.querySelector('#viewport');
  const fps=document.querySelector('.fps-tile');fps.id='extension-fps';
  const badge=document.createElement('span');badge.className='engine-badge';badge.textContent='RUST';fps.prepend(badge);
  viewport.append(fps);
  const hint=document.createElement('div');hint.id='takeover-hint';hint.hidden=true;hint.setAttribute('role','status');viewport.append(hint);
  status('正在连接本机 Rust…');
  try{
    const response=await fetch(`${backend}/api/health`,{signal:AbortSignal.timeout(4000)});
    if(!response.ok||(await response.json()).player_protocol!==2)throw Error('version');
  }catch{
    throw Error(`无法连接 Rust 后端：${backend}\n请在电脑运行 start-rust-backend.cmd，然后点击「重连」。`);
  }
  reportStatus('Rust 已连接 · 下载中');status('正在下载本站作品…');
  const params=new URLSearchParams(location.search),id=params.get('workId');
  if(!/^\d+$/.test(id||''))throw Error('作品编号无效');
  // Kitten N sources come from creation.bcmcdn.com (often encrypted); Kitten 4 published
  // works are plain JSON on creation.codemao.cn and are converted by the backend import.
  const sourceOrigin={kn:'https://creation.bcmcdn.com',k4:'https://creation.codemao.cn'}[params.get('kind')||'kn'];
  if(!sourceOrigin)throw Error('作品类型暂不支持');
  const url=new URL(params.get('bcm'));
  if(url.origin!==sourceOrigin)throw Error('作品资源地址暂不支持');
  const project=await json(url.href);status('正在编译作品…');return project;
}
