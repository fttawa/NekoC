// Audio commands are ordered VM deltas. A paused player retains positions, a new VM resets them.
export class ProjectAudio {
  constructor(onError=()=>{},onDone=()=>{}){this.onError=onError;this.onDone=onDone;this.voices=new Map();this.paused=true;this.context=null;}
  load(project){this.stop();this.resources=project.audios?.audiosDict||{};this.order=project.audios?.audioIds||Object.keys(this.resources);}
  unlock(){
    try{
      this.context??=new AudioContext();
      void this.context.resume().catch(()=>{});
      for(const voice of this.voices.values())if(voice.wanted&&!this.paused)this.play(voice);
    }catch{/* HTMLAudio remains usable if Web Audio is unavailable. */}
  }
  resolve(value){
    if(typeof value==='number')return this.resources[this.order[Math.round(value)-1]];
    return this.resources[value]||Object.values(this.resources).find(audio=>audio.name===value);
  }
  resolveMany(value){
    if(value==='all')return Object.values(this.resources);
    return [this.resolve(value)].filter(Boolean);
  }
  play(voice){
    void voice.element.play().catch(error=>{
      if(!voice.wanted||this.paused||error.name==='AbortError')return;
      this.onError(error.name==='NotAllowedError'?'点击舞台或按键以启用声音':`音频播放失败：${error.message}`);
    });
  }
  apply(frame){
    for(const command of frame.audio_commands||[]){
      if(command.property){
        const {rate,change,value}=command.property;
        for(const resource of this.resolveMany(command.audio)){
          let voice=this.voices.get(resource.id);
          if(!voice){voice=this.createVoice(resource);}
          const key=rate?'playbackRate':'volume',min=rate?0.05:0,max=rate?4:1;
          voice.element[key]=Math.min(max,Math.max(min,(change?voice.element[key]:0)+value));
        }
        continue;
      }
      const resource=this.resolve(command.audio);
      if(!resource){this.onError(`找不到音频：${command.audio}`);if(command.wait)this.onDone(command.wait);continue;}
      let voice=this.voices.get(resource.id);
      if(command.play){
        if(!voice){
          voice=this.createVoice(resource);
        }
        // Restarting a sound ends earlier play-and-wait blocks on it.
        for(const id of voice.waits.splice(0))this.onDone(id);
        if(command.wait)voice.waits.push(command.wait);
        voice.element.currentTime=0;voice.wanted=true;
        if(!this.paused)this.play(voice);
      }else if(voice){voice.wanted=false;voice.element.pause();voice.element.currentTime=0;for(const id of voice.waits.splice(0))this.onDone(id);}
    }
  }
  createVoice(resource){
    const element=new Audio(resource.url);element.preload='auto';
    const voice={element,wanted:false,waits:[]};this.voices.set(resource.id,voice);
    element.onended=()=>{voice.wanted=false;for(const id of voice.waits.splice(0))this.onDone(id);};
    element.onerror=()=>{for(const id of voice.waits.splice(0))this.onDone(id);};
    return voice;
  }
  pause(){this.paused=true;for(const voice of this.voices.values())voice.element.pause();}
  resume(){this.paused=false;for(const voice of this.voices.values())if(voice.wanted)this.play(voice);}
  stop(){this.pause();for(const {element} of this.voices.values()){element.removeAttribute('src');element.load();}this.voices.clear();}
  snapshot(){return [...this.voices].map(([id,v])=>({id,wanted:v.wanted,paused:v.element.paused,time:v.element.currentTime,ready:v.element.readyState}));}
}
