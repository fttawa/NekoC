#!/usr/bin/env node
// Original fixtures + diagnostic host stub. Domain functions, Howler voice
// pooling, callbacks, setters and the official scheduler are NOT replaced.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readJson,saveJson,runOracle} from './k4-oracle.mjs';
import {workspace} from './k4-scheduling-fixtures.mjs';
import {tone} from './audio-fixtures.mjs';

const A='71000000-0000-4000-8000-000000000001',B='71000000-0000-4000-8000-000000000002';
const block=(type,fields={},inputs={})=>({type,fields,inputs,statements:{}});
const num=n=>block('math_number',{NUM:String(n)});
const set=(VAR,n)=>block('variables_set',{VAR},{VALUE:num(n)});
const wait=n=>block('wait',{}, {time:num(n)});
const play=(id,blocking=false)=>block(blocking?'play_audio_and_wait':'play_audio',{audio:id});
const prop=(key,n,change=false,id=A)=>block(change?'change_volume_or_rate':'set_volume_or_rate',{audio:id,audio_key:key},{audio_value:num(n)});
const chain=(...nodes)=>{nodes.slice(1).forEach((n,i)=>nodes[i].next=n);return nodes[0];};

export async function audioTimelineFixtures(){
  const base=await readJson('tests/fixtures/kitten4/audio.bcm');
  const schema=(await readJson('docs/kitten4-block-schema.json')).blocks;
  const cases={
    properties:[[prop('volume',-10),prop('volume',200),prop('volume',-30,true),prop('rate',0),prop('rate',900),prop('rate',-250,true),play(A),set('after',1)]],
    overlap:[[play(A),play(A),play(B),set('after',1)]],
    natural:[[prop('rate',200),play(A,true),set('after',1)]],
    'stop-waits':[[play(A,true),set('after',1)],[wait(0),block('stop_all_audios'),set('stopped',1)]],
    'stop-overlap':[[play(A),play(A,true),set('after',1)],[play(B),wait(0),block('stop_all_audios'),set('stopped',1)]],
    'midi-note':[[block('midi_play_note',{note:'39'},{beats:num(.08)}),set('after',1)]],
    'midi-number':[[block('midi_play_num_note',{}, {num_note:num(100),beats:num(.08)}),set('after',1)]],
    'midi-invalid':[[block('midi_play_num_note',{}, {num_note:num(101),beats:num(1)}),block('midi_play_note',{note:'1'},{beats:num(0)}),set('after',1)]],
  };
  const result={};
  for(const [name,scripts] of Object.entries(cases)){
    const p=structuredClone(base);delete p.compile_result;
    p.project_name=`NekoC original K4 audio timeline ${name}`;
    p.audio=Object.fromEntries([[A,'Tone A'],[B,'Tone B']].map(([id,name])=>[id,{id,name,url:tone(),volume:.4,playback_rate:1}]));p.audio_order=[A,B];
    p.variables=Object.fromEntries(['after','stopped'].map(id=>[id,{id,name:id,value:0,is_global:true}]));p.variable_order=Object.keys(p.variables);
    for(const owner of [...Object.values(p.theatre.scenes),...Object.values(p.theatre.actors)])owner.block_data_json=workspace([],schema);
    Object.values(p.theatre.actors)[0].block_data_json=workspace(scripts.map(nodes=>chain(block('start_on_click'),...nodes)),schema);
    result[name]=p;
  }
  return result;
}

export async function installAudioHost(page){
  await page.evaluate(()=>{
    const req=window.__k4OracleRequire,host=req('xQfl').a.AudioPlayer;
    const howler=req('HlzF');
    // Freeze the browser's real AudioContext. Howler still allocates its native
    // Sounds and WebAudio nodes; only currentTime/end scheduling is controlled.
    const context=howler.Howler.ctx;
    if(!context)throw Error('Missing official WebAudio context');
    void context.suspend();
    let now=0,frame=1,serial=0;
    const timers=new Map(),events=[],snapshots=[];
    const nativeSet=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);
    let inAudio=0;
    Object.defineProperty(context,'currentTime',{configurable:true,get:()=>now});
    // The callback deferral used by Howler is retained (zero timers run between
    // updates); no callback is executed synchronously inside a domain call.
    window.setTimeout=(callback,ms,...args)=>{
      if(!inAudio)return nativeSet(callback,ms,...args);
      const id=--serial;timers.set(id,{at:now+Math.max(0,Number(ms)||0)/1000,callback:()=>callback(...args)});return id;
    };
    window.clearTimeout=id=>{if(timers.delete(id))return;nativeClear(id);};
    const proto=howler.Howl.prototype;
    for(const name of ['play','stop','rate','volume','fade','_ended','_emit']){
      const original=proto[name];
      if(typeof original!=='function')throw Error(`Missing Howl.${name}`);
      proto[name]=function(...args){inAudio++;try{return original.apply(this,args);}finally{inAudio--;}};
    }
    for(const name of ['play','stop','set_volume','set_rate','load']){
      const original=host[name];
      host[name]=function(...args){
        if(window.__k4Oracle?.frames.length||window.__audioStarted){
          events.push({frame,action:name,args:args.filter(a=>typeof a!=='function').slice(0,3)});
        }
        inAudio++;try{return original.apply(this,args);}finally{inAudio--;}
      };
    }
    window.__audioHost={events,snapshots,advance(nextFrame){
      frame=nextFrame;now=(nextFrame-1)/60;
      for(let guard=0;guard<1000;guard++){
        const due=[...timers].filter(([,t])=>t.at<=now+1e-12).sort((a,b)=>a[1].at-b[1].at||b[0]-a[0]);
        if(!due.length)return;
        for(const [id,t]of due){if(!timers.delete(id))continue;inAudio++;try{t.callback();}finally{inAudio--;}}
      }
      throw Error('Audio host timer loop');
    }};
    const runtime=window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
    const update=runtime.update;
    runtime.update=function(...args){window.__audioStarted=true;return update.apply(this,args);};
  });
}

async function main(){
  const cases=await audioTimelineFixtures();
  const evidence={schema:'nekoc-k4-audio-timeline-v1',fps:60,scope:'diagnostic WebAudio currentTime/end timers; original domain + Howler; not native wall-clock/acoustic parity',cases:{}};
  for(const [name,p]of Object.entries(cases)){
    const file=`tests/fixtures/kitten4/audio-timeline-${name}.bcm`;await saveJson(file,p);
    if(!process.argv.includes('--record'))continue;
    let events=[];
    const trace=await runOracle(p,{frames:18,seed:1,wallTimeoutMs:60000,beforeStart:installAudioHost,onFrame:async(page,n)=>{
      events=await page.evaluate(n=>{const h=window.__audioHost;const result=structuredClone(h.events);h.advance(n+1);return result;},n);
    }});
    const vm=JSON.parse(execFileSync(path.resolve('target/debug/k4-trace.exe'),[file,'--render','--frames','18'],{encoding:'utf8',maxBuffer:32*1024*1024}));
    const expected=trace.frames.map(f=>f.variables),actual=vm.trace.frames.map(f=>f.variables);
    const equal=JSON.stringify(expected)===JSON.stringify(actual);
    evidence.assets=trace.diagnostics.assets;
     evidence.cases[name]={fixture:file,sha256:createHash('sha256').update(JSON.stringify(p,null,2)+'\n').digest('hex'),events,officialVariables:expected,vmVariables:actual,variablesEqual:equal,errors:trace.errors,pageErrors:trace.diagnostics.pageErrors,externalAllowed:trace.diagnostics.externalRequests.filter(r=>r.action==='asset-fetch').length};
    await saveJson(`dist/k4audio/${name}-official.json`,trace);await saveJson(`dist/k4audio/${name}-vm.json`,vm);
     console.log(name,equal?'variables equal':'VARIABLE DIFFERENCE',JSON.stringify(events));
     if(!equal||trace.errors.length||trace.diagnostics.pageErrors.length)throw Error(`Invalid audio timeline evidence: ${name}`);
  }
  if(process.argv.includes('--record'))await saveJson('docs/kitten4-audio-timeline-evidence.json',evidence);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
