// Audio commands are ordered VM deltas. A paused player retains positions, a new VM resets them.
export class ProjectAudio {
  constructor(onError=()=>{}){this.onError=onError;this.voices=new Map();this.paused=true;this.context=null;}
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
  play(voice){
    void voice.element.play().catch(error=>{
      if(!voice.wanted||this.paused||error.name==='AbortError')return;
      this.onError(error.name==='NotAllowedError'?'点击舞台或按键以启用声音':`音频播放失败：${error.message}`);
    });
  }
  apply(frame){
    for(const command of frame.audio_commands||[]){
      const resource=this.resolve(command.audio);
      if(!resource){this.onError(`找不到音频：${command.audio}`);continue;}
      let voice=this.voices.get(resource.id);
      if(command.play){
        if(!voice){
          const element=new Audio(resource.url);element.preload='auto';
          voice={element,wanted:false};this.voices.set(resource.id,voice);
          element.onended=()=>{voice.wanted=false;};
        }
        voice.element.currentTime=0;voice.wanted=true;
        if(!this.paused)this.play(voice);
      }else if(voice){voice.wanted=false;voice.element.pause();voice.element.currentTime=0;}
    }
  }
  pause(){this.paused=true;for(const voice of this.voices.values())voice.element.pause();}
  resume(){this.paused=false;for(const voice of this.voices.values())if(voice.wanted)this.play(voice);}
  stop(){this.pause();for(const {element} of this.voices.values()){element.removeAttribute('src');element.load();}this.voices.clear();}
  snapshot(){return [...this.voices].map(([id,v])=>({id,wanted:v.wanted,paused:v.element.paused,time:v.element.currentTime,ready:v.element.readyState}));}
}
