import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectAudio} from '../web/audio.js';

const tick=async()=>{await Promise.resolve();await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const failure=name=>Object.assign(new Error(name),{name});

function setup(t,{speech=true}={}) {
  const originals=new Map(['Audio','speechSynthesis','SpeechSynthesisUtterance'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const events=[],elements=[],done=[],errors=[];
  class MockAudio {
    constructor(url){this.url=url;this.volume=1;this.playbackRate=1;this.currentTime=0;this.paused=true;this.readyState=4;this.plays=0;this.loads=0;this.results=[];elements.push(this);}
    pause(){this.paused=true;events.push(['pause',this.url]);}
    play(){this.plays++;this.paused=false;events.push(['play',this.url]);return this.results.shift()||Promise.resolve();}
    removeAttribute(name){if(name==='src')this.url='';}
    load(){this.loads++;}
    end(){this.paused=true;this.onended?.();}
    error(){this.onerror?.();}
  }
  const synthesizer={
    voices:[{name:'first'},{name:'second'}],utterances:[],
    getVoices(){return this.voices;},
    speak(utterance){this.utterances.push(utterance);events.push(['speak',utterance.text]);},
    pause(){events.push(['speech-pause']);},resume(){events.push(['speech-resume']);},cancel(){events.push(['speech-cancel']);},
  };
  globalThis.Audio=MockAudio;
  globalThis.speechSynthesis=speech?synthesizer:undefined;
  globalThis.SpeechSynthesisUtterance=speech?class {constructor(text){this.text=text;}}:undefined;
  const audio=new ProjectAudio(error=>errors.push(error),id=>done.push(id));
  audio.load({audios:{sortList:['b','a'],audioIds:['a','b'],audiosDict:{
    a:{id:'a',name:'Alpha',url:'a.wav',volume:.4,playback_rate:1.5},
    b:{id:'b',name:'Beta',cdn_url:'b.wav',volume:.7,playback_rate:.8},
  }}});
  events.length=0;
  t.after(()=>{
    audio.stop();
    for(const [key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  });
  const apply=(...commands)=>audio.apply({audio_commands:commands});
  const play=(target='a',wait)=>apply({audio:target,play:true,wait});
  const property=(target,rate,change,value)=>apply({audio:target,property:{rate,change,value}});
  const voices=id=>[...audio.voices.values()].filter(voice=>voice.id===id);
  return {audio,events,elements,done,errors,synthesizer,apply,play,property,voices};
}

test('sortList wins over audioIds; selectors and initial resource properties are preserved',t=>{
  const {audio,play,voices}=setup(t);
  assert.equal(audio.resolve(1).id,'b');assert.equal(audio.resolve(2).id,'a');
  assert.equal(audio.resolve('Alpha').id,'a');assert.equal(audio.resolve('a').id,'a');
  assert.equal(audio.resolve('--all--').id,'b');assert.equal(audio.resolve(0),undefined);
  play(1,'first');play('Alpha','second');
  const a=voices('a')[0].element,b=voices('b')[0].element;
  assert.equal(a.volume,.4);assert.equal(a.playbackRate,1.5);assert.equal(a.url,'a.wav');
  assert.equal(b.volume,.7);assert.equal(b.playbackRate,.8);assert.equal(b.url,'b.wav');
  assert.equal(a.preservesPitch,false);assert.equal(a.preload,'auto');
  assert.equal(a.plays,0);assert.equal(b.plays,0);
});

test('audioIds and dictionary order are fallbacks when sortList is absent',t=>{
  const {audio}=setup(t);
  const audiosDict={x:{name:'X'},y:{name:'Y'}};
  audio.load({audios:{audioIds:['y','x'],audiosDict}});assert.equal(audio.resolve(1).name,'Y');
  audio.load({audios:{audiosDict}});assert.equal(audio.resolve(1).name,'X');
});

test('same resource overlaps with independent waits; replay never ends an older waiter',t=>{
  const {audio,play,voices,done}=setup(t);audio.resume();
  play('a','older');const first=voices('a')[0];first.element.currentTime=.35;
  play('a','newer');const second=voices('a')[1];
  assert.notEqual(first.element,second.element);assert.equal(first.element.currentTime,.35);
  assert.equal(second.element.currentTime,0);assert.deepEqual(done,[]);
  second.element.end();assert.deepEqual(done,['newer']);assert.equal(first.wanted,true);
  first.element.end();first.element.end();assert.deepEqual(done,['newer','older']);
  play('a','third');assert.equal(voices('a').length,1);assert.deepEqual(done,['newer','older']);
});

test('properties affect every instance and future plays, clamp, and never start playback',t=>{
  const {audio,play,property,voices,elements,done,errors}=setup(t);
  property('all',false,false,.5);assert.equal(elements.length,2);assert.ok(elements.every(e=>e.plays===0));
  audio.resume();play('a','one');play('a','two');
  for(const voice of voices('a'))voice.element.currentTime=.3;
  property('Alpha',false,true,-.2);property(2,true,true,10);
  for(const {element,wanted}of voices('a')){
    assert.equal(element.volume,.3);assert.equal(element.playbackRate,4);
    assert.equal(element.currentTime,.3);assert.equal(element.paused,false);assert.equal(wanted,true);
  }
  play('a','three');assert.equal(voices('a')[2].element.volume,.3);assert.equal(voices('a')[2].element.playbackRate,4);
  property('--all--',false,false,100);assert.ok(elements.every(e=>e.volume===1));
  property('a',true,false,-10);assert.ok(voices('a').every(v=>v.element.playbackRate===.05));
  for(const value of [NaN,Infinity,'0.2'])property('a',false,false,value);
  assert.ok(voices('a').every(v=>v.element.volume===1));
  property('missing',false,true,.1);assert.deepEqual(done,[]);assert.deepEqual(errors,[]);
});

test('pause/resume preserves positions and only resumes wanted voices',t=>{
  const {audio,play,voices,done}=setup(t);audio.resume();play('a','waiting');play('b','ended');
  const a=voices('a')[0].element,b=voices('b')[0].element;b.end();a.currentTime=.42;
  audio.pause();assert.equal(a.paused,true);assert.equal(a.currentTime,.42);assert.deepEqual(done,['ended']);
  audio.resume();assert.equal(a.plays,2);assert.equal(b.plays,1);assert.equal(a.currentTime,.42);
  a.end();audio.resume();assert.equal(a.plays,2);assert.deepEqual(done,['ended','waiting']);
});

test('target stop finishes all matching waits once and all-stop includes speech',t=>{
  const {audio,play,apply,voices,done,synthesizer}=setup(t);audio.resume();
  play('a','a1');play('a','a2');play('b','b');
  audio.apply({speech_commands:[{text:'hello',wait:'speech'}]});
  apply({audio:'Alpha',play:false});assert.deepEqual(done,['a1','a2']);
  for(const voice of voices('a')){assert.equal(voice.wanted,false);assert.equal(voice.element.paused,true);assert.equal(voice.element.currentTime,0);voice.element.end();}
  assert.equal(voices('b')[0].wanted,true);
  apply({audio:'--all--',play:false});assert.deepEqual(done,['a1','a2','b','speech']);
  synthesizer.utterances[0].onend();apply({audio:'all',play:false});assert.deepEqual(done,['a1','a2','b','speech']);
});

test('stop and reset discard obsolete waits, unload media, and restore initial settings',async t=>{
  const {audio,play,property,voices,done,errors}=setup(t);audio.resume();property('a',false,false,.9);play('a','old');
  const old=voices('a')[0].element,ended=old.onended,errored=old.onerror;
  audio.stop();assert.equal(audio.paused,true);assert.equal(audio.voices.size,0);
  assert.equal(old.url,'');assert.equal(old.loads,1);assert.equal(old.onended,null);assert.equal(old.onerror,null);
  ended();errored();assert.deepEqual(done,[]);assert.deepEqual(errors,[]);
  play('a','new');assert.equal(voices('a')[0].element.volume,.4);assert.equal(voices('a')[0].element.plays,0);
  audio.resume();audio.apply({reset:true,audio_commands:[{audio:'b',play:true,wait:'reset'}]});
  assert.equal(audio.paused,false);assert.equal(voices('b')[0].element.plays,1);
  assert.deepEqual(done,[]);voices('b')[0].element.end();assert.deepEqual(done,['reset']);
  audio.pause();audio.apply({reset:true,audio_commands:[{audio:'a',play:true,wait:'paused-reset'}]});
  assert.equal(audio.paused,true);assert.equal(voices('a')[0].element.plays,0);await tick();
});

test('late play rejection after stop/reuse cannot finish the next generation',async t=>{
  const {audio,play,apply,voices,done,errors}=setup(t);
  play('a','old');const element=voices('a')[0].element,pending=deferred();element.results.push(pending.promise);audio.resume();
  apply({audio:'a',play:false});play('a','new');pending.reject(failure('NotSupportedError'));await tick();
  assert.deepEqual(done,['old']);assert.deepEqual(errors,[]);assert.equal(voices('a')[0].wanted,true);
  element.end();assert.deepEqual(done,['old','new']);
});

for(const callback of ['onended','onerror'])test(`stale ${callback} from earlier playback cannot settle a reused voice`,t=>{
  const {audio,play,apply,voices,done,errors}=setup(t);audio.resume();play('a','old');
  const element=voices('a')[0].element,stale=element[callback];
  apply({audio:'a',play:false});play('a','new');stale();
  assert.deepEqual(done,['old']);assert.deepEqual(errors,[]);assert.equal(voices('a')[0].wanted,true);
  element.end();assert.deepEqual(done,['old','new']);
});

test('missing, media error and failed play settle once rather than deadlocking',async t=>{
  const {audio,play,voices,done,errors}=setup(t);audio.resume();
  play('absent','missing');assert.deepEqual(done,['missing']);assert.match(errors[0],/找不到音频/);
  play('a','load-error');voices('a')[0].element.error();voices('a')[0].element.error();
  assert.deepEqual(done,['missing','load-error']);assert.equal(errors.length,2);
  const element=voices('a')[0].element;element.results.push(Promise.reject(failure('NotSupportedError')));
  play('a','play-error');await tick();assert.deepEqual(done,['missing','load-error','play-error']);assert.equal(errors.length,3);
  play('a','recovered');element.end();assert.deepEqual(done,['missing','load-error','play-error','recovered']);
});

test('NotAllowedError retains wait for unlock retry; AbortError is not a completion',async t=>{
  const {audio,play,voices,done,errors}=setup(t);play('a','blocked');
  const element=voices('a')[0].element;element.results.push(Promise.reject(failure('NotAllowedError')));
  audio.resume();await tick();assert.deepEqual(done,[]);assert.equal(voices('a')[0].wanted,true);assert.match(errors[0],/启用声音/);
  audio.unlock();assert.equal(element.plays,2);assert.deepEqual(done,[]);
  audio.pause();audio.unlock();assert.equal(element.plays,2);
  audio.resume();element.end();assert.deepEqual(done,['blocked']);
  element.results.push(Promise.reject(failure('AbortError')));play('a','aborted');await tick();
  assert.deepEqual(done,['blocked']);assert.equal(errors.length,1);
  audio.unlock();element.end();assert.deepEqual(done,['blocked','aborted']);
});

test('speech interleaves with audio by before_audio and maps offline properties',t=>{
  const {audio,events,synthesizer,done}=setup(t);audio.resume();events.length=0;
  audio.apply({audio_commands:[{audio:'a',play:true},{audio:'b',play:true}],speech_commands:[
    {text:'first',wait:'s1',before_audio:0,config:[1,15,5,4]},
    {text:'中文',wait:'s2',before_audio:1,kitten4:true,config:[1,99,99,0]},
    {text:'last',wait:'s3'},
  ]});
  assert.deepEqual(events,[['speak','first'],['play','a.wav'],['speak','中文'],['play','b.wav'],['speak','last']]);
  const [first,second,last]=synthesizer.utterances;
  assert.equal(first.voice,synthesizer.voices[1]);assert.equal(first.rate,1.5);assert.equal(first.pitch,.5);assert.equal(first.volume,.4);assert.equal(first.lang,'en-GB');
  assert.equal(second.rate,.8);assert.equal(second.pitch,1);assert.equal(second.volume,1);assert.equal(second.lang,'zh-CN');assert.equal(second.voice,undefined);
  assert.equal(last.rate,1);assert.equal(last.pitch,1);assert.equal(last.volume,1);
  first.onend();first.onend();second.onend();last.onend();assert.deepEqual(done,['s1','s2','s3']);
});

test('K4 speech consumes explicit language while old frames and KN keep text fallback',t=>{
  const {audio,synthesizer}=setup(t);audio.resume();
  audio.apply({speech_commands:[
    {text:'hello',kitten4:true,language:'ja'},
    {text:'中文',kitten4:true,language:'en-UK'},
    {text:'bonjour',kitten4:true,language:'fr'},
    {text:'中文',kitten4:true},
    {text:'hello',language:'ja'},
  ]});
  assert.deepEqual(synthesizer.utterances.map(u=>u.lang),['ja','en-UK','fr','zh-CN','en-GB']);
});

test('speech queues while paused, resumes once, clamps config and completes empty/error/unsupported',t=>{
  const {audio,synthesizer,done,errors}=setup(t);
  audio.apply({speech_commands:[{text:'queued',wait:'queued',config:[20,-10,50,50]},{text:'',wait:'empty'}]});
  assert.deepEqual(done,['empty']);assert.equal(synthesizer.utterances.length,0);
  audio.resume();audio.pause();audio.resume();assert.equal(synthesizer.utterances.length,1);
  const utterance=synthesizer.utterances[0];assert.equal(utterance.rate,.1);assert.equal(utterance.pitch,2);assert.equal(utterance.volume,1);
  utterance.onerror();utterance.onend();assert.deepEqual(done,['empty','queued']);assert.equal(errors.length,1);
  globalThis.speechSynthesis=undefined;audio.apply({speech_commands:[{text:'unsupported',wait:'unsupported'}]});
  assert.deepEqual(done,['empty','queued','unsupported']);assert.match(errors[1],/不支持/);
});

test('stop/reset cancel speech without completing abandoned waits; stale ends are ignored',t=>{
  const {audio,synthesizer,done}=setup(t);audio.resume();audio.apply({speech_commands:[{text:'old',wait:'old'}]});
  const old=synthesizer.utterances[0];audio.stop();old.onend();assert.deepEqual(done,[]);
  audio.resume();audio.apply({speech_commands:[{text:'reset old',wait:'reset-old'}]});
  const beforeReset=synthesizer.utterances[1];
  audio.apply({reset:true,speech_commands:[{text:'new',wait:'new'}]});beforeReset.onend();assert.deepEqual(done,[]);
  synthesizer.utterances[2].onend();assert.deepEqual(done,['new']);
});

test('speech cancellation errors from stale utterances must not report a new failure',t=>{
  const {audio,synthesizer,done,errors}=setup(t);audio.resume();audio.apply({speech_commands:[{text:'cancel me',wait:'old'}]});
  const old=synthesizer.utterances[0];audio.stop();old.onerror({error:'canceled'});old.onend();
  assert.deepEqual(done,[]);assert.deepEqual(errors,[]);
});

test('official KN all_audio token stops every resource and speech waiter',t=>{
  const {audio,play,apply,done,synthesizer}=setup(t);audio.resume();
  play('a','a');play('b','b');
  audio.apply({speech_commands:[{text:'KN',wait:'speech'}]});
  apply({audio:'all_audio',play:false});
  assert.deepEqual(done,['a','b','speech']);
  assert.ok([...audio.voices.values()].every(v=>!v.wanted&&v.element.paused));
  synthesizer.utterances[0].onend();assert.equal(done.length,3);
});

test('voice keys cannot hide an external resource whose id resembles an instance key',t=>{
  const {audio,play,elements}=setup(t);audio.resources['a#1']={id:'a#1',url:'collision.wav'};
  audio.resume();play('a');play('a#1');play('a');
  assert.equal(audio.voices.size,3);audio.stop();
  assert.ok(elements.every(element=>element.paused));
});

test('blocked cross-frame playback is bounded and stop releases the overlap peak',async t=>{
  const {audio,apply,elements,done,errors}=setup(t);audio.resume();
  const play=globalThis.Audio.prototype.play;
  globalThis.Audio.prototype.play=function(){return Promise.reject(failure('NotAllowedError'));};
  try {
    for(let frame=0;frame<4;frame++){
      apply(...Array.from({length:100},(_,i)=>({audio:'a',play:true,wait:`${frame}-${i}`})));
      await tick();assert.ok(audio.voices.size<=128);
    }
    apply({audio:'all_audio',play:false});
    assert.equal(done.length,400);assert.equal(new Set(done).size,400);
    assert.ok(audio.voices.size<=1);assert.ok(elements.every(e=>e.paused));
    assert.ok(errors.some(e=>e.includes('128')));
  }finally{globalThis.Audio.prototype.play=play;}
});
