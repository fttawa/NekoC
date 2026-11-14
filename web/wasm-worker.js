// wasm 后端 Worker：nekoc-wasm 的 web 绑定。消息格式见 backend.js。
// wasm/ 由 tools/build-web-wasm.mjs 从 packages/nekoc/dist/web 复制。
import init,{importProject,checkExtensions,Player} from './wasm/nekoc_wasm.js';

const ready=init({module_or_path:new URL('./wasm/nekoc_wasm_bg.wasm',import.meta.url)});
const players=new Map();
const errorText=error=>typeof error==='string'?error:error?.message||String(error);

const calls={
  // Same shape as the backend's /api/import-player: report fields plus project.
  importProject:value=>{const {project,report}=JSON.parse(importProject(JSON.stringify(value)));return {...report,project};},
  checkExtensions:value=>JSON.parse(checkExtensions(JSON.stringify(value))),
};

function reply(socket,message){
  if(message instanceof Uint8Array){
    // 帧通过 transfer 交给页面；页面拿到的是 ArrayBuffer，和 WebSocket 一致。
    const buffer=message.byteOffset===0&&message.byteLength===message.buffer.byteLength?message.buffer:message.slice().buffer;
    postMessage({socket,message:buffer},[buffer]);
  }else postMessage({socket,message});
}

self.onmessage=async({data})=>{
  await ready;
  if(data.call){
    try{postMessage({call:data.call,value:calls[data.name](data.value)});}
    catch(error){postMessage({call:data.call,error:errorText(error)});}
    return;
  }
  const id=data.socket;
  if(data.close){players.get(id)?.free();players.delete(id);return;}
  try{
    const player=players.get(id);
    if(!player){
      // 第一条消息是握手：作品，或带扩展积木的握手对象。
      const created=new Player(data.text);players.set(id,created);reply(id,created.ready());
    }else reply(id,player.handle(data.text));
  }catch(error){
    // 与 WebSocket 后端一致：先发 {error}，再关闭会话。
    reply(id,JSON.stringify({error:errorText(error)}));
    players.get(id)?.free();players.delete(id);postMessage({socket:id,closed:true});
  }
};
