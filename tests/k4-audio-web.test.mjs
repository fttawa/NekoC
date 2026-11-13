import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectAudio} from '../web/audio.js';
import {K4DeviceHost} from '../web/k4-device.js';
import {PlayerConnection} from '../web/player.js';
import {ExtensionRegistry} from '../web/extensions.js';

// Synthetic browser-host tests, not official runtime or acoustic evidence.
function setup(t) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Audio');
  const elements=[],done=[],errors=[];
  globalThis.Audio=class {
    constructor(url){this.url=url;this.volume=1;this.playbackRate=1;this.currentTime=0;this.paused=true;this.plays=0;this.results=[];elements.push(this);}
    play(){this.paused=false;this.plays++;return this.results.shift()||Promise.resolve();}
    pause(){this.paused=true;}
    removeAttribute(name){if(name==='src')this.url='';}
    load(){}
    end(){this.paused=true;this.onended?.();}
  };
  const audio=new ProjectAudio(message=>errors.push(message),id=>done.push(id));
  audio.load({audios:{sortList:['tone','other'],audiosDict:{
    tone:{id:'tone',name:'Tone',url:'tone.wav',volume:.6,playback_rate:1.2},
    other:{id:'other',name:'Other',url:'other.wav',volume:.8,playback_rate:1},
  }}});
  t.after(()=>{audio.stop();if(previous)Object.defineProperty(globalThis,'Audio',previous);else delete globalThis.Audio;});
  const apply=(...audio_commands)=>audio.apply({audio_commands});
  const play=wait=>apply({audio:'tone',play:true,wait});
  const voices=()=>[...audio.voices.values()].filter(voice=>voice.id==='tone');
  return {audio,apply,play,voices,elements,done,errors};
}

const deferred=()=>{let reject;const promise=new Promise((_,fail)=>{reject=fail;});return {promise,reject};};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('property edits reuse the retained idle instance after voices finish in reverse order',t=>{
  const {audio,apply,play,voices,elements}=setup(t);audio.resume();
  play(1);play(2);const [first,second]=voices();
  second.element.end();first.element.end();
  assert.deepEqual(voices(),[second]);assert.equal(audio.voices.has('tone'),false);
  apply({audio:'tone',play:false,property:{rate:false,change:false,value:.25}});
  assert.deepEqual(voices(),[second]);assert.equal(elements.length,2);
  assert.equal(second.element.volume,.25);assert.equal(second.element.plays,1);
  play(3);assert.deepEqual(voices(),[second]);assert.equal(second.element.plays,2);
});

test('repeated edits during overlap cannot create multiple idle voices for one resource',t=>{
  const {audio,apply,play,voices}=setup(t);audio.resume();
  play(1);play(2);const [first,second]=voices();
  second.element.end();first.element.end();play(3);
  apply({audio:'tone',play:false,property:{rate:true,change:false,value:2}});
  play(4);const active=voices().find(voice=>voice!==second&&voice.wanted);
  second.element.end();active.element.end();
  for(let i=0;i<3;i++)apply({audio:'tone',play:false,property:{rate:false,change:true,value:.1}});
  assert.equal(voices().length,1);
});

test('obsolete play rejection after stop/replay cannot end the current attempt',async t=>{
  const {audio,apply,play,voices,done,errors}=setup(t);
  const pending=deferred();play(1);const voice=voices()[0];voice.element.results.push(pending.promise);audio.resume();
  // The first play is already in flight. Stop/replay reuses its element but
  // advances generation, so the first promise must not settle the new waiter.
  apply({audio:'all',play:false});play(2);
  pending.reject(Object.assign(Error('obsolete'),{name:'NotSupportedError'}));await flush();
  assert.deepEqual(done,[1]);assert.deepEqual(errors,[]);assert.equal(voice.wanted,true);
  voice.element.end();assert.deepEqual(done,[1,2]);
});

test('current play failure still reports and completes exactly its own waiter',async t=>{
  const {audio,play,voices,done,errors}=setup(t);play(1);
  const voice=voices()[0];voice.element.results.push(Promise.reject(Object.assign(Error('current'),{name:'NotSupportedError'})));
  audio.resume();await flush();assert.deepEqual(done,[1]);assert.equal(errors.length,1);
  voice.element.end();assert.deepEqual(done,[1]);
});

test('resource properties are shared across concurrent requests; all updates every resource without restarting',t=>{
  const {audio,apply,play,voices,elements,done}=setup(t);audio.resume();
  play(1);play(2);apply({audio:'other',play:true,wait:3});
  for(const element of elements)element.currentTime=.4;
  apply({audio:'all',play:false,property:{rate:false,change:false,value:.25}},
    {audio:'Tone',play:false,property:{rate:true,change:true,value:.3}});
  assert.ok(voices().every(voice=>voice.element.volume===.25&&voice.element.playbackRate===1.5));
  assert.ok(elements.every(element=>element.volume===.25&&element.currentTime===.4&&element.plays===1));
  assert.equal(elements[2].playbackRate,1);assert.deepEqual(done,[]);
  apply({audio:'tone',play:false});assert.deepEqual(done,[1,2]);assert.equal(elements[2].paused,false);
  apply({audio:'all',play:false});assert.deepEqual(done,[1,2,3]);
});

test('ordered stop then replay ignores old callbacks and keeps the new wait alive',async t=>{
  const {audio,apply,play,voices,done,errors}=setup(t);audio.resume();play(1);
  const element=voices()[0].element,oldEnd=element.onended,oldError=element.onerror;
  apply({audio:'all',play:false},{audio:'tone',play:true,wait:2});
  oldEnd();oldError();await flush();assert.deepEqual(done,[1]);assert.deepEqual(errors,[]);
  assert.equal(element.paused,false);element.end();assert.deepEqual(done,[1,2]);
});

test('K4 MIDI frame outputs use a bounded local oscillator fallback',t=>{
  const previous=globalThis.AudioContext;
  const oscillators=[],contexts=[];
  class Oscillator {
    constructor(){this.frequency={value:0};this.type='';this.onended=null;this.started=0;this.stopped=0;oscillators.push(this);}
    connect(node){this.destination=node;return node;}
    start(time){this.started=time;}
    stop(time){this.stopped=time;}
    disconnect(){}
  }
  class Gain {constructor(){this.gain={setValueAtTime(){},linearRampToValueAtTime(){}};}connect(node){return node;}disconnect(){}}
  class Context {
    constructor(){this.currentTime=10;this.destination={};this.state='running';this.resumes=0;this.suspends=0;contexts.push(this);}
    createOscillator(){return new Oscillator();}
    createGain(){return new Gain();}
    resume(){this.state='running';this.resumes++;return Promise.resolve();}
    suspend(){this.state='suspended';this.suspends++;return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
  }
  globalThis.AudioContext=Context;
  const audio=new ProjectAudio();audio.load({audios:{}});audio.resume();
  t.after(()=>{audio.stop();if(previous)globalThis.AudioContext=previous;else delete globalThis.AudioContext;});
  audio.apply({k4_media:[{kind:'midi',key:39,seconds:.75,fade_seconds:.75}]});
  assert.equal(contexts.length,1);assert.equal(oscillators.length,1);
  assert.equal(oscillators[0].frequency.value,27.5*2**(39/12));
  assert.equal(oscillators[0].started,10);assert.equal(oscillators[0].stopped,10.75);
});

test('MIDI ignores null, fractional and out-of-range keys and avoids zero-length fades',t=>{
  const previous=globalThis.AudioContext;
  const oscillators=[],ramps=[];
  class Oscillator {constructor(){this.frequency={value:0};this.onended=null;oscillators.push(this);}connect(node){return node;}start(){}stop(){}disconnect(){}}
  class Gain {constructor(){this.gain={setValueAtTime:(value,time)=>ramps.push(['set',value,time]),linearRampToValueAtTime:(value,time)=>ramps.push(['ramp',value,time])};}connect(node){return node;}disconnect(){}}
  class Context {constructor(){this.currentTime=4;this.destination={};}createOscillator(){return new Oscillator();}createGain(){return new Gain();}resume(){return Promise.resolve();}suspend(){return Promise.resolve();}close(){return Promise.resolve();}}
  globalThis.AudioContext=Context;
  const audio=new ProjectAudio();audio.load({audios:{}});audio.resume();
  t.after(()=>{audio.stop();if(previous)globalThis.AudioContext=previous;else delete globalThis.AudioContext;});
  for(const key of [null,-1,87.5,88])audio.apply({k4_media:[{kind:'midi',key,seconds:.1,fade_seconds:.2}]});
  audio.apply({k4_media:[{kind:'midi',key:87,seconds:.1,fade_seconds:.2}]});
  assert.equal(oscillators.length,1);assert.ok(ramps.some(([kind,,time])=>kind==='ramp'&&time===4.1));
});

test('shared media frame routes MIDI and vibration once through the viewer consumers',t=>{
  const {audio,errors}=setup(t),previous=globalThis.AudioContext,oscillators=[],vibrations=[];
  class Oscillator {constructor(){this.frequency={value:0};oscillators.push(this);}connect(node){return node;}start(){}stop(){}disconnect(){}}
  class Gain {constructor(){this.gain={setValueAtTime(){},linearRampToValueAtTime(){}};}connect(node){return node;}disconnect(){}}
  class Context {constructor(){this.currentTime=0;this.destination={};}createOscillator(){return new Oscillator();}createGain(){return new Gain();}resume(){return Promise.resolve();}close(){return Promise.resolve();}}
  globalThis.AudioContext=Context;
  const host=new K4DeviceHost({navigator:{vibrate(pattern){vibrations.push(pattern);return true;}}});
  const player=new PlayerConnection(new ExtensionRegistry(),host);
  t.after(()=>{player.close();if(previous)globalThis.AudioContext=previous;else delete globalThis.AudioContext;});
  const output=[{kind:'vibrate',pattern_ms:[250]},{kind:'midi',key:39,beats:.5,seconds:.375,fade_seconds:.375}];
  const frame=JSON.parse(JSON.stringify({k4_media:output,k4_media_output:output})),saved=structuredClone(frame);
  audio.resume();audio.apply(frame);player.applyFrame(frame);
  assert.equal(oscillators.length,1);assert.deepEqual(vibrations,[[250]]);
  assert.deepEqual(frame,saved);assert.deepEqual(errors,[]);
  audio.apply({});player.applyFrame({});
  assert.equal(oscillators.length,1);assert.deepEqual(vibrations,[[250]]);
});

test('MIDI context follows pause, unlock/resume, and stop lifecycle',async t=>{
  const previous=globalThis.AudioContext;let context;
  class Oscillator {constructor(){this.frequency={value:0};this.onended=null;}connect(node){return node;}start(){}stop(){}disconnect(){}}
  class Gain {constructor(){this.gain={setValueAtTime(){},linearRampToValueAtTime(){}};}connect(node){return node;}disconnect(){}}
  class Context {constructor(){context=this;this.currentTime=0;this.destination={};this.state='running';this.resumeCount=0;this.suspendCount=0;}createOscillator(){return new Oscillator();}createGain(){return new Gain();}resume(){this.state='running';this.resumeCount++;return Promise.resolve();}suspend(){this.state='suspended';this.suspendCount++;return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}}
  globalThis.AudioContext=Context;
  const audio=new ProjectAudio();audio.load({audios:{}});audio.resume();audio.apply({k4_media:[{kind:'midi',key:0,seconds:1,fade_seconds:1}]});
  audio.pause();assert.equal(context.state,'suspended');audio.unlock();await flush();assert.equal(context.state,'suspended');
  audio.resume();await flush();assert.ok(context.resumeCount>=1);
  audio.stop();assert.equal(context.state,'closed');
  t.after(()=>{if(previous)globalThis.AudioContext=previous;else delete globalThis.AudioContext;});
});
