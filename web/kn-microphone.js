// Independent implementation of the official 0.27.4 desktop worklet algorithm.
// Raw RMS percent -> max(current, .8 * previous); publish every ~25 ms.
// Desktop reporter maps raw / 70 * 100, clamps, then Math.round.
export function microphoneVolume(raw){
  if(!Number.isFinite(raw))return null;
  return Math.round(Math.max(0,Math.min(100,raw/70*100)));
}
export class VolumeMeter {
  constructor(sampleRate){this.volume=0;this.nextUpdate=0;this.interval=Math.floor(.025*sampleRate);}
  process(samples){
    if(!samples.length)return null;
    let sum=0;for(const sample of samples)sum+=sample*sample;
    this.volume=Math.max(100*Math.sqrt(sum/samples.length),.8*this.volume);
    this.nextUpdate-=samples.length;
    if(this.nextUpdate<0){this.nextUpdate+=this.interval;return this.volume;}
    return null;
  }
}

const worklet=`class KnVolumeMeter extends AudioWorkletProcessor {
  constructor(){super();this.volume=0;this.nextUpdate=0;}
  process(inputs){const samples=inputs[0]?.[0];if(samples?.length){
    let sum=0;for(const sample of samples)sum+=sample*sample;
    this.volume=Math.max(100*Math.sqrt(sum/samples.length),.8*this.volume);
    this.nextUpdate-=samples.length;
    if(this.nextUpdate<0){this.nextUpdate+=Math.floor(.025*sampleRate);this.port.postMessage(this.volume);}
  }return true;}
}registerProcessor('nekoc-kn-volume',KnVolumeMeter);`;

export function needsMicrophone(project){
  // Scan project data, not executable code. Never request permission on import.
  // K4's separate microphone lowering/profile is not changed by this KN host.
  if(project&&Object.hasOwn(project,'_nekocKitten4'))return false;
  const work=[project];
  while(work.length){const node=work.pop();if(!node||typeof node!=='object')continue;
    if(node.type==='get_voice_volume')return true;
    work.push(...Object.values(node));
  }
  return false;
}

export class KnMicrophone {
  constructor(env=globalThis){this.env=env;this.closed=false;this.status='pending';this.value=null;this.context=null;this.stream=null;this.source=null;this.node=null;this.starting=null;}
  snapshot(){return {status:this.status,value:this.value};}
  start(){return this.starting??=this.open();}
  async open(){
    const env=this.env,Context=env.AudioContext||env.webkitAudioContext;
    if(!env.navigator?.mediaDevices?.getUserMedia||!Context){this.status='unavailable';this.value=0;return;}
    try{
      const stream=await env.navigator.mediaDevices.getUserMedia({audio:true});
      if(this.closed){for(const track of stream.getTracks())track.stop();return;}
      this.stream=stream;
      const context=this.context=new Context();
      await context.resume();
      if(this.closed)return;
      const source=this.source=context.createMediaStreamSource(stream);
      if(!context.audioWorklet||!env.AudioWorkletNode)throw Error('AudioWorklet unavailable');
      const url=env.URL.createObjectURL(new env.Blob([worklet],{type:'text/javascript'}));
      try{await context.audioWorklet.addModule(url);}finally{env.URL.revokeObjectURL(url);}
      if(this.closed)return;
      const node=this.node=new env.AudioWorkletNode(context,'nekoc-kn-volume');
      node.port.onmessage=event=>{
        if(this.closed)return;
        const value=microphoneVolume(event.data);
        if(value!==null){this.value=value;this.status='ready';}
      };
      // Processor output is left silent; no microphone loopback.
      source.connect(node).connect(context.destination);
      for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{if(!this.closed){this.value=0;this.status='unavailable';void this.release();}},{once:true});
    }catch(error){
      if(!this.closed){this.value=0;this.status=error?.name==='NotAllowedError'?'denied':'unavailable';}
      await this.release();
    }
  }
  async release(){
    this.node?.disconnect();this.source?.disconnect();
    for(const track of this.stream?.getTracks()||[])track.stop();
    const context=this.context;this.node=null;this.source=null;this.stream=null;this.context=null;
    if(context&&context.state!=='closed')await context.close().catch(()=>{});
  }
  close(){this.closed=true;this.value=0;this.status='unavailable';void this.release();}
}
