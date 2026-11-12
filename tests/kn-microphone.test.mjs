import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {KnMicrophone,VolumeMeter,microphoneVolume,needsMicrophone} from '../web/kn-microphone.js';
import {PlayerConnection} from '../web/player.js';
import {ExtensionRegistry} from '../web/extensions.js';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

test('official desktop normalization clamps, rounds, and does not invent samples',()=>{
  assert.deepEqual([0,7,35,69.9,70,140,-1].map(microphoneVolume),[0,10,50,100,100,100,0]);
  assert.equal(microphoneVolume(NaN),null);
  assert.equal(microphoneVolume(Infinity),null);
});

test('RMS percent and 0.8 decay use first channel buffer and ~25ms publication',()=>{
  const meter=new VolumeMeter(48000);
  assert.equal(meter.process([]),null);
  assert.equal(meter.process(new Float32Array(128).fill(.5)),50);
  assert.equal(meter.volume,50);
  assert.equal(meter.process(new Float32Array(128)),null);
  assert.equal(meter.volume,40);
  for(let i=0;i<7;i++)assert.equal(meter.process(new Float32Array(128)),null);
  assert.ok(meter.process(new Float32Array(128))>0);
});

function host({denied=false,late=false}={}){
  let stops=0,closes=0,requests=0,resolve,source,code;
  const stream={getTracks:()=>[{stop:()=>stops++,addEventListener(){}}]};
  const env={
    navigator:{mediaDevices:{getUserMedia:()=>{requests++;return denied?Promise.reject(Object.assign(Error(),{name:'NotAllowedError'})):late?new Promise(r=>{resolve=r;}):Promise.resolve(stream);}}},
    Blob:class {constructor(parts){code=parts.join('');}},URL:{createObjectURL:()=> 'blob:meter',revokeObjectURL(){}},
    AudioContext:class {constructor(){this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}resume(){return Promise.resolve();}close(){closes++;this.state='closed';return Promise.resolve();}createMediaStreamSource(){return source={connect:node=>node,disconnect(){}};}},
    AudioWorkletNode:class {constructor(){this.port={};}connect(){return this;}disconnect(){}},
  };
  return {env,stream,get stops(){return stops;},get closes(){return closes;},get requests(){return requests;},get source(){return source;},get code(){return code;},resolve:()=>resolve(stream)};
}

test('permission is lazy, concurrent starts deduplicate, samples are not initially zero, and stop releases device',async()=>{
  const h=host(),mic=new KnMicrophone(h.env);
  assert.equal(h.requests,0);assert.deepEqual(mic.snapshot(),{status:'pending',value:null});
  await Promise.all([mic.start(),mic.start()]);assert.equal(h.requests,1);
  assert.equal(mic.status,'pending');
  mic.node.port.onmessage({data:35});assert.deepEqual(mic.snapshot(),{status:'ready',value:50});
  mic.close();await flush();assert.equal(h.stops,1);assert.equal(h.closes,1);
});

test('actual generated AudioWorklet executes the same RMS/decay/publication algorithm',async()=>{
  const h=host(),mic=new KnMicrophone(h.env);await mic.start();
  let Processor;const messages=[];
  vm.runInNewContext(h.code,{sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port={postMessage:n=>messages.push(n)};}},registerProcessor:(name,cls)=>{assert.equal(name,'nekoc-kn-volume');Processor=cls;}});
  const processor=new Processor();
  assert.equal(processor.process([[new Float32Array(128).fill(.5)]]),true);
  assert.deepEqual(messages,[50]);
  processor.process([[new Float32Array(128)]]);assert.equal(processor.volume,40);
  assert.deepEqual(messages,[50]);mic.close();
});

test('denial and unavailable settle to zero while permission still pending has no result',async()=>{
  const missing=new KnMicrophone({});await missing.start();assert.deepEqual(missing.snapshot(),{status:'unavailable',value:0});
  const denied=host({denied:true}),mic=new KnMicrophone(denied.env);await mic.start();assert.deepEqual(mic.snapshot(),{status:'denied',value:0});
  const late=host({late:true}),cancelled=new KnMicrophone(late.env),start=cancelled.start();
  await flush();assert.deepEqual(cancelled.snapshot(),{status:'pending',value:null});
  cancelled.close();late.resolve();await start;
  assert.equal(late.stops,1);assert.equal(late.closes,0);assert.equal(cancelled.value,0);
});

test('project demand detection is data-only and bundled extension ships the module',async()=>{
  assert.equal(needsMicrophone({actors:[{next:{type:'get_voice_volume'}}]}),true);
  assert.equal(needsMicrophone({type:'get_voice_answer'}),false);
  assert.equal(needsMicrophone({_nekocKitten4:{source:{type:'get_voice_volume'}}}),false);
  assert.match(await readFile(new URL('../tools/build-extension.mjs',import.meta.url),'utf8'),/'kn-microphone.js'/);
});

test('project scan survives lists far larger than the call stack allows',()=>{
  // 大模型作品的列表可达几十万项；展开成 push 参数会抛 Maximum call stack size exceeded。
  const weights=new Array(1_000_000).fill(0.5);
  assert.equal(needsMicrophone({variables:{w:{value:weights}},actors:[]}),false);
  assert.equal(needsMicrophone({variables:{w:{value:weights}},actors:[{next:{type:'get_voice_volume'}}]}),true);
});

test('existing player host frame transports unavailable zero without extension schema',async()=>{
  const previous=globalThis.WebSocket;let socket;
  globalThis.WebSocket=class {
    constructor(){socket=this;queueMicrotask(()=>this.onopen());}
    send(value){this.payload=JSON.parse(value);}close(){}
  };
  const player=new PlayerConnection(new ExtensionRegistry());
  try{
    const project={actors:[{type:'get_voice_volume'}]};
    const open=player.open(project,'http://127.0.0.1:1234');await flush();
    assert.deepEqual(socket.payload,project);
    socket.onmessage({data:'{"ready":true}'});await open;
    const frame=player.frame({dt:.016});
    assert.deepEqual(socket.payload.kn_microphone,{status:'unavailable',value:0});
    socket.onmessage({data:new ArrayBuffer(0)});await frame;
    const snapshot=player.snapshot();assert.deepEqual(socket.payload,{debug_snapshot:true});
    socket.onmessage({data:'{"snapshot":{"sequence":1}}'});await snapshot;
    const microphone=player.microphone;player.close();assert.equal(microphone.closed,true);
  }finally{player.close();globalThis.WebSocket=previous;}
});
