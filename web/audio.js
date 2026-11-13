// Ordered VM deltas. Resource properties are shared, playback positions are not.
// Source evidence and the deliberately non-identical offline TTS: docs/audio.md.
export class ProjectAudio {
  constructor(onError=()=>{},onDone=()=>{}) {
    this.onError=onError;this.onDone=onDone;this.voices=new Map();this.settings=new Map();
    this.paused=true;this.serial=0;this.speech=new Set();this.resources={};this.order=[];
    this.midiContext=null;this.midiVoices=new Set();
  }
  load(project) {
    this.stop();this.resources=project.audios?.audiosDict||{};
    this.order=project.audios?.sortList||project.audios?.audioIds||Object.keys(this.resources);
  }
  unlock() {
    // play() itself must run in the user gesture; an unrelated AudioContext does
    // not unlock HTMLAudio. Keep blocked waits alive so the gesture can retry.
    for(const voice of this.voices.values())if(voice.wanted&&!this.paused)this.play(voice);
    if(!this.paused)this.midiContext?.resume?.().catch(()=>{});
  }
  resolve(value) {
    if(typeof value==='number')return this.resources[this.order[Math.round(value)-1]];
    if(typeof value!=='string')return undefined;
    if(value==='all'||value==='--all--')return this.resources[this.order[0]];
    return this.resources[value]||Object.values(this.resources).find(audio=>audio.name===value);
  }
  resolveMany(value) {
    if(value==='all'||value==='--all--')return this.order.map(id=>this.resources[id]).filter(Boolean);
    return [this.resolve(value)].filter(Boolean);
  }
  resourceId(resource) {
    return resource.id??Object.keys(this.resources).find(id=>this.resources[id]===resource);
  }
  config(resource) {
    const id=this.resourceId(resource);
    if(!this.settings.has(id))this.settings.set(id,{
      volume:clamp(resource.volume??1,0,1),playbackRate:clamp(resource.playback_rate??1,.05,4),
    });
    return this.settings.get(id);
  }
  play(voice) {
    const generation=voice.generation;
    void voice.element.play().catch(error=>{
      if(!voice.wanted||this.paused||generation!==voice.generation||error.name==='AbortError')return;
      this.onError(error.name==='NotAllowedError'?'点击舞台或按键以启用声音':`音频播放失败：${error.message}`);
      if(error.name!=='NotAllowedError')this.finish(voice);
    });
  }
  finish(voice) {
    voice.wanted=false;voice.generation++;
    for(const id of voice.waits.splice(0))this.onDone(id);
    if([...this.voices.values()].some(v=>v!==voice&&v.id===voice.id&&!v.wanted))this.release(voice);
  }
  apply(frame) {
    if(frame.reset){const paused=this.paused;this.stop();this.paused=paused;if(!paused)globalThis.speechSynthesis?.resume();}
    const commands=frame.audio_commands||[],speech=frame.speech_commands||[];
    for(const command of frame.k4_media||[])if(command.kind==='midi')this.playMidi(command);
    for(let i=0;i<=commands.length;i++) {
      for(const command of speech)if((command.before_audio??commands.length)===i)this.speak(command);
      if(i===commands.length)break;
      const command=commands[i];
      if(command.property) {
        const {rate,change,value}=command.property;
        if(typeof value!=='number'||!Number.isFinite(value))continue;
        for(const resource of this.resolveMany(command.audio)) {
          const id=this.resourceId(resource),config=this.config(resource),key=rate?'playbackRate':'volume';
          config[key]=clamp((change?config[key]:0)+value,rate?.05:0,rate?4:1);
          // Retain one idle voice, but do not start playback for a property edit.
          if(![...this.voices.values()].some(voice=>voice.id===id))this.createVoice(resource);
          for(const voice of this.voices.values())if(voice.id===id)voice.element[key]=config[key];
        }
        continue;
      }
      if(!command.play) {
        if(command.audio===null&&command.wait){
          if([...this.speech].some(item=>item.command.wait===command.wait))this.cancelSpeech(true);
          continue;
        }
        const all=command.audio==='all'||command.audio==='--all--'||command.audio==='all_audio';
        const ids=this.resolveMany(command.audio).map(r=>this.resourceId(r));
        for(const voice of this.voices.values())if(all||ids.includes(voice.id)) {
          voice.element.pause();voice.element.currentTime=0;this.finish(voice);
        }
        if(all)this.cancelSpeech(true);
        continue;
      }
      const resource=this.resolve(command.audio);
      if(!resource){this.onError(`找不到音频：${command.audio}`);if(command.wait)this.onDone(command.wait);continue;}
      const id=this.resourceId(resource);
      // K4 Howler permits overlapping plays. Never complete an older waiter just
      // because another thread plays the same resource.
      let voice=[...this.voices.values()].find(v=>v.id===id&&!v.wanted);
      if(!voice&&this.voices.size>=128){
        const oldest=this.voices.values().next().value;
        oldest.element.pause();this.finish(oldest);this.release(oldest);
        if(!this.limitReported){this.limitReported=true;this.onError('同时播放声音超过 128，已停止最早的声音');}
      }
      voice??=this.createVoice(resource);
      voice.waits=command.wait?[command.wait]:[];
      voice.element.currentTime=0;voice.wanted=true;voice.generation++;
      this.bindEvents(voice,resource);
      if(!this.paused)this.play(voice);
    }
    for(const voice of this.voices.values())if(this.voices.size>128&&!voice.wanted)this.release(voice);
  }
  createVoice(resource) {
    const id=this.resourceId(resource),element=new Audio(resource.url||resource.cdn_url||'');
    element.preload='auto';Object.assign(element,this.config(resource));
    // K4 Howler rate changes alter both duration and pitch.
    element.preservesPitch=false;
    const voice={id,element,wanted:false,waits:[],generation:0};
    let key=id;while(this.voices.has(key))key=`${id}#${++this.serial}`;
    this.voices.set(key,voice);
    this.bindEvents(voice,resource);
    return voice;
  }
  release(voice){
    voice.element.onended=null;voice.element.onerror=null;
    voice.element.removeAttribute('src');voice.element.load();
    for(const [key,value]of this.voices)if(value===voice)this.voices.delete(key);
  }
  bindEvents(voice,resource) {
    const generation=voice.generation;
    voice.element.onended=()=>{if(generation===voice.generation)this.finish(voice);};
    voice.element.onerror=()=>{
      if(generation!==voice.generation)return;
      if(voice.wanted)this.onError(`音频加载失败：${resource.name||voice.id}`);
      this.finish(voice);
    };
  }
  speak(command) {
    if(this.speech.size>=128){this.onError('语音等待队列已满');if(command.wait)this.onDone(command.wait);return;}
    const done=()=>{if(!this.speech.delete(item))return;if(command.wait)this.onDone(command.wait);};
    const item={command,utterance:null,done};this.speech.add(item);
    if(!globalThis.speechSynthesis||!globalThis.SpeechSynthesisUtterance){
      this.onError('此浏览器不支持离线语音合成');done();return;
    }
    const utterance=new SpeechSynthesisUtterance(command.text);item.utterance=utterance;
    const [per,speed,pitch,volume]=command.config||[0,10,10,10];
    // KN's remote voice IDs/scale have no exact local equivalent. This is an
    // explicit offline fallback, not an emulation of the authenticated service.
    utterance.rate=command.kitten4?.8:clamp(speed/10,.1,10);
    utterance.pitch=command.kitten4?1:clamp(pitch/10,0,2);
    utterance.volume=command.kitten4?1:clamp(volume/10,0,1);
    utterance.lang=command.kitten4&&command.language?command.language:(/[^\u0000-\u00ff]/.test(command.text)?'zh-CN':'en-GB');
    const voices=speechSynthesis.getVoices();
    if(!command.kitten4&&voices[per])utterance.voice=voices[per];
    utterance.onend=done;utterance.onerror=()=>{if(!this.speech.has(item))return;this.onError('语音合成失败');done();};
    if(!command.text){done();return;}
    if(!this.paused){item.started=true;speechSynthesis.speak(utterance);}
  }
  cancelSpeech(notify) {
    for(const item of [...this.speech]){if(notify)item.done();else this.speech.delete(item);}
    globalThis.speechSynthesis?.cancel();
  }
  playMidi(command) {
    // Rust emits a number for numeric keys and a string for midi_get object
    // ids.  Do not use Number(null): a missing/null key must not become A0.
    const rawKey=command.key;
    const key=typeof rawKey==='number'?rawKey:
      typeof rawKey==='string'&&rawKey.trim()!==''?Number(rawKey):NaN;
    const seconds=Number(command.seconds);
    if(!Number.isInteger(key)||key<0||key>87||!Number.isFinite(seconds)||seconds<=0)return;
    const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Context){this.onError('此浏览器不支持 MIDI 音频');return;}
    if(this.midiVoices.size>=128){this.onError('同时播放 MIDI 音符超过 128，已忽略新的音符');return;}
    this.midiContext??=new Context();
    const context=this.midiContext;
    const oscillator=context.createOscillator(),gain=context.createGain();
    const now=context.currentTime,stop=now+seconds;
    oscillator.type='sine';oscillator.frequency.value=27.5*2**(key/12);
    gain.gain.setValueAtTime(1,now);
    // The official piano request uses a fade of max(.2, seconds).  The local
    // oscillator is only a fallback, not the official piano sample/voice.
    // Start the fade before stop so linearRampToValueAtTime never has a
    // zero-length interval when fade >= the note duration.
    const fadeSeconds=Math.max(.2,seconds);
    const fadeStart=Math.max(now,stop-fadeSeconds);
    if(stop>fadeStart){
      gain.gain.setValueAtTime(1,fadeStart);
      gain.gain.linearRampToValueAtTime(.01,stop);
    }
    oscillator.connect(gain).connect(context.destination);this.midiVoices.add(oscillator);
    oscillator.onended=()=>{this.midiVoices.delete(oscillator);oscillator.disconnect();gain.disconnect();};
    oscillator.start(now);oscillator.stop(stop);
    if(this.paused)context.suspend().catch(()=>{});else context.resume().catch(()=>{});
  }
  pause(){this.paused=true;for(const voice of this.voices.values())voice.element.pause();this.midiContext?.suspend?.().catch(()=>{});globalThis.speechSynthesis?.pause();}
  resume(){
    this.paused=false;for(const voice of this.voices.values())if(voice.wanted)this.play(voice);this.midiContext?.resume?.().catch(()=>{});
    globalThis.speechSynthesis?.resume();
    for(const item of this.speech)if(!item.started&&item.utterance){item.started=true;speechSynthesis.speak(item.utterance);}
  }
  stop(){
    this.pause();this.cancelSpeech(false);
    for(const voice of this.voices.values()){
      voice.wanted=false;voice.generation++;voice.waits=[];
      voice.element.onended=null;voice.element.onerror=null;
      voice.element.removeAttribute('src');voice.element.load();
    }
    this.voices.clear();this.settings.clear();this.limitReported=false;
    for(const oscillator of this.midiVoices)try{oscillator.stop();}catch{};
    this.midiVoices.clear();this.midiContext?.close?.().catch(()=>{});this.midiContext=null;
  }
  snapshot(){return [...this.voices].map(([id,v])=>({id,wanted:v.wanted,paused:v.element.paused,time:v.element.currentTime,ready:v.element.readyState}));}
}
function clamp(value,min,max){return Math.min(max,Math.max(min,Number.isFinite(value)?value:1));}
