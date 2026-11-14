// 播放器后端：本机 Rust（HTTP + WebSocket）或浏览器内 wasm（Web Worker）。
// 两者对 play.js / player.js 暴露同样的接口：api(path,data) 和 connect(url)。
// connect 返回的对象具有 WebSocket 的 send/close/onopen/onmessage/onerror/onclose。

export function httpBackend(origin){
  return {
    kind:'rust',origin,
    async api(path,data){
      const response=await fetch(`${origin}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
      let value;
      try{value=await response.json();}catch{throw Error(response.ok?'服务返回了无效的作品数据':`请求失败：HTTP ${response.status}`);}
      if(!response.ok)throw Error(value.error||`HTTP ${response.status}`);return value;
    },
    connect(project){
      const url=new URL(project?'/api/player-private':'/api/player',origin);
      url.protocol=url.protocol==='https:'?'wss:':'ws:';
      const socket=new WebSocket(url);socket.binaryType='arraybuffer';return socket;
    },
  };
}

// 每个 wasm 后端一个 Worker：导入、检查和运行都在 Worker 里，不阻塞画面。
export function wasmBackend(workerURL=new URL('./wasm-worker.js',import.meta.url)){
  const worker=new Worker(workerURL,{type:'module'});
  const calls=new Map(),sockets=new Map();let nextId=1;
  worker.onmessage=({data})=>{
    if(data.call){const call=calls.get(data.call);calls.delete(data.call);if(data.error)call?.reject(Error(data.error));else call?.resolve(data.value);return;}
    const socket=sockets.get(data.socket);if(!socket)return;
    if(data.message!==undefined)socket.onmessage?.({data:data.message});
    if(data.closed){sockets.delete(data.socket);socket.onclose?.({});}
  };
  worker.onerror=event=>{
    event.preventDefault();const error=Error(`wasm 运行时载入失败：${event.message||'未知错误'}`);
    for(const call of calls.values())call.reject(error);calls.clear();
    for(const socket of sockets.values())socket.onerror?.({error});
  };
  const call=(name,value)=>new Promise((resolve,reject)=>{const id=nextId++;calls.set(id,{resolve,reject});worker.postMessage({call:id,name,value});});
  return {
    kind:'wasm',origin:null,
    async api(path,data){
      if(path==='import-player')return call('importProject',data);
      if(path==='extension-check')return call('checkExtensions',data);
      throw Error(`wasm 后端不支持 ${path}`);
    },
    connect(project){
      if(!project)throw Error('wasm 后端需要作品数据');
      const id=nextId++;
      const socket={
        binaryType:'arraybuffer',onopen:null,onmessage:null,onerror:null,onclose:null,
        send(text){if(sockets.has(id))worker.postMessage({socket:id,text});},
        close(){if(sockets.delete(id))worker.postMessage({socket:id,close:true});},
      };
      sockets.set(id,socket);
      queueMicrotask(()=>{if(sockets.has(id))socket.onopen?.({});});
      return socket;
    },
    terminate(){worker.terminate();},
  };
}
