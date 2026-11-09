// Bounded request/response over one connection; no queued frame history.
export class PlayerConnection {
  constructor(){this.socket=null;this.pending=null;this.ready=false;this.openReject=null;this.timer=null;}
  async open(project=null,base=location.origin){
    this.close();
    const url=new URL(project?'/api/player-private':'/api/player',base);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);
    this.socket=socket;socket.binaryType='arraybuffer';
    return new Promise((resolve,reject)=>{
      this.openReject=reject;
      this.timer=setTimeout(()=>this.fail(Error('运行时连接超时')),30000);
      socket.onopen=()=>{if(project&&this.socket===socket)socket.send(JSON.stringify(project));};
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        try{
          if(typeof event.data==='string'){
            const message=JSON.parse(event.data);
            if(message.ready){clearTimeout(this.timer);this.openReject=null;this.ready=true;resolve(message);}
            else if(message.snapshot){const pending=this.pending;this.pending=null;clearTimeout(this.timer);pending?.resolve(message.snapshot);}
            else if(message.error)this.fail(Error(message.error));
          }else{const pending=this.pending;this.pending=null;clearTimeout(this.timer);pending?.resolve(event.data);}
        }catch(error){this.fail(error);}
      };
      socket.onerror=()=>{if(this.socket===socket)this.fail(Error('运行时连接失败'));};
      socket.onclose=()=>{if(this.socket===socket)this.fail(Error('运行时连接已关闭'));};
    });
  }
  frame(payload){
    if(!this.ready)return Promise.reject(Error('运行时尚未连接'));
    if(this.pending)return Promise.reject(Error('已有运行帧等待响应'));
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};this.timer=setTimeout(()=>this.fail(Error('运行帧响应超时')),10000);
      try{this.socket.send(JSON.stringify(payload));}catch(error){this.fail(error);}
    });
  }
  // Read-only request on this VM's loopback, same-origin protected socket.
  snapshot(){return this.frame({debug_snapshot:true});}
  fail(error){
    this.ready=false;clearTimeout(this.timer);this.openReject?.(error);this.openReject=null;
    this.pending?.reject(error);this.pending=null;
    const socket=this.socket;this.socket=null;socket?.close();
  }
  close(){this.fail(Error('运行已停止'));}
}
