// Bounded request/response over one connection; no queued frame history.
import {playerExtensions,SUPPORTED_API_VERSIONS,negotiateVersion} from './extensions.js';
import {KnMicrophone,needsMicrophone} from './kn-microphone.js';
export class PlayerConnection {
  constructor(extensions=playerExtensions){this.extensions=extensions;this.extensionSession=null;this.socket=null;this.pending=null;this.ready=false;this.openReject=null;this.timer=null;this.microphone=null;}
  async open(project=null,base=location.origin){
    this.close();
    const schemas=this.extensions.schemas();
    const usesV2=schemas.some(schema=>schema.api_version===2);
    if(schemas.length&&!project)throw Error('Extensions require a private player project snapshot');
    this.extensionSession=this.extensions.session();
    if(project&&needsMicrophone(project)){this.microphone=new KnMicrophone();void this.microphone.start();}
    const url=new URL(project?'/api/player-private':'/api/player',base);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);
    this.socket=socket;socket.binaryType='arraybuffer';
    return new Promise((resolve,reject)=>{
      this.openReject=reject;
      this.timer=setTimeout(()=>this.fail(Error('运行时连接超时')),30000);
      socket.onopen=()=>{if(project&&this.socket===socket)socket.send(JSON.stringify(schemas.length?{nekoc_extension_handshake:1,project,extensions:schemas,...(usesV2?{extension_api_versions:SUPPORTED_API_VERSIONS}:{})}:project));};
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        try{
          if(typeof event.data==='string'){
            const message=JSON.parse(event.data);
            if(message.ready){
              if(usesV2&&(negotiateVersion([message.extension_api_version])!==2))throw Error('Extension API v2 negotiation failed');
              clearTimeout(this.timer);this.openReject=null;this.ready=true;resolve(message);
            }
            else if(message.snapshot){const pending=this.pending;this.pending=null;clearTimeout(this.timer);pending?.resolve(message.snapshot);}
            else if(message.error)this.fail(Error(message.error));
          }else{
            if(schemas.length){
              const view=new DataView(event.data),length=view.getUint32(0,true);
              const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(event.data,4,length)).trim());
              this.extensionSession?.update(metadata.extension_requests||[]);
            }
            const pending=this.pending;this.pending=null;clearTimeout(this.timer);pending?.resolve(event.data);
          }
        }catch(error){this.fail(error);}
      };
      socket.onerror=()=>{if(this.socket===socket)this.fail(Error('运行时连接失败'));};
      socket.onclose=()=>{if(this.socket===socket)this.fail(Error('运行时连接已关闭'));};
    });
  }
  emitExtension(opcode,value=null){
    if(!this.ready||!this.extensionSession)throw Error('运行时尚未连接');
    this.extensionSession.emit(opcode,value);
  }
  frame(payload){
    if(!this.ready)return Promise.reject(Error('运行时尚未连接'));
    if(this.pending)return Promise.reject(Error('已有运行帧等待响应'));
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};this.timer=setTimeout(()=>this.fail(Error('运行帧响应超时')),10000);
      try{
        const results=payload.debug_snapshot?[]:this.extensionSession?.drain()||[];
        const events=[...(payload.events||[])];
        // Backend accepts at most 256 events. Preserve input order and requeue
        // excess extension completions and hat events together.
        const available=Math.max(0,256-events.length),sent=results.splice(0,available);
        if(results.length)this.extensionSession.results.unshift(...results);
        const input=this.microphone&&!payload.debug_snapshot?{...payload,kn_microphone:this.microphone.snapshot()}:payload;
        this.socket.send(JSON.stringify(sent.length?{...input,events:[...events,...sent]}:input));
      }catch(error){this.fail(error);}
    });
  }
  // Read-only request on this VM's loopback, same-origin protected socket.
  snapshot(){return this.frame({debug_snapshot:true});}
  fail(error){
    this.microphone?.close();this.microphone=null;
    this.extensionSession?.close();this.extensionSession=null;
    this.ready=false;clearTimeout(this.timer);this.openReject?.(error);this.openReject=null;
    this.pending?.reject(error);this.pending=null;
    const socket=this.socket;this.socket=null;socket?.close();
  }
  close(){this.fail(Error('运行已停止'));}
}
