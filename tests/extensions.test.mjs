import test from 'node:test';
import assert from 'node:assert/strict';
import {API_VERSION,SUPPORTED_API_VERSIONS,negotiateVersion,ExtensionRegistry,registerJsonParse} from '../web/extensions.js';
import {PlayerConnection} from '../web/player.js';
const schema={api_version:1,opcode:'test.echo',parameters:[{name:'value',value_type:'number'}],returns:'number',blocking:true,network:false};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('web schemas are explicit, detached, versioned and offline',()=>{
  const r=new ExtensionRegistry();
  for(const extra of [{api_version:3},{blocking:false},{network:true},{network:0},{extra:true},{kind:'command'},{metadata:{name:'Echo',category:'Test'}},{parameters:[{name:'value',value_type:'number',extra:true}]},{opcode:'bare'},{returns:'object'}])assert.throws(()=>r.register({...schema,...extra},()=>0));
  r.register(schema,([x])=>x);
  assert.throws(()=>r.register(schema,()=>0));
  const copy=r.schemas();copy[0].parameters[0].name='changed';
  assert.equal(r.schemas()[0].parameters[0].name,'value');
  assert.equal(JSON.stringify(r.schemas()),JSON.stringify([schema]));
});

const v2={...schema,api_version:2};
const hat={api_version:2,opcode:'test.changed',kind:'hat',parameters:[],returns:null,blocking:false};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('version negotiation chooses the highest common version, not caller order',()=>{
  assert.equal(API_VERSION,2);assert.deepEqual(SUPPORTED_API_VERSIONS,[2,1]);
  for(const [versions,expected] of [[[1,2],2],[[2,1],2],[[1],1],[[3,1,2],2],[[2,2],2]])assert.equal(negotiateVersion(versions),expected);
  for(const versions of [[],[3],[0],null,'2',[2,'1'],[NaN],[-1],[2.5]])assert.throws(()=>negotiateVersion(versions));
});

test('v2 schemas validate block kinds, remote blocking and UTF8 metadata',()=>{
  for(const extra of [
    {kind:'unknown'},{kind:null},{kind:'reporter',returns:undefined},{kind:'reporter',returns:null},{kind:'boolean',returns:'number'},
    {kind:'reporter',blocking:false},{kind:'boolean',returns:'boolean',blocking:false},
    {metadata:null},{metadata:[]},{metadata:{}},{metadata:{name:'x'}},
    {metadata:{name:'',category:'x'}},{metadata:{name:'猫'.repeat(43),category:'x'}},
    {metadata:{name:'x',category:'猫'.repeat(43)}},{metadata:{name:'x',category:'y',extra:true}},
  ])assert.throws(()=>new ExtensionRegistry().register({...v2,...extra},()=>0));
  for(const extra of [{returns:'any'},{blocking:true},{parameters:schema.parameters}])assert.throws(()=>new ExtensionRegistry().register({...hat,...extra}));
  assert.throws(()=>new ExtensionRegistry().register(hat,()=>null));
  assert.throws(()=>new ExtensionRegistry().register(v2));
  const metadata={name:'猫'.repeat(42)+'ab',category:'Test'};
  const registry=new ExtensionRegistry().register({...v2,metadata},()=>0).register(hat);
  metadata.name='changed';assert.equal(new TextEncoder().encode(registry.schemas()[0].metadata.name).length,128);
  assert.deepEqual(registry.schemas()[1],hat);
});

test('palette groups detached command/reporter/boolean/hat descriptions by metadata',()=>{
  const registry=new ExtensionRegistry().register(schema,()=>0)
    .register({...v2,opcode:'demo.report',kind:'reporter',metadata:{name:'Read',category:'Sensors'}},()=>1)
    .register({...v2,opcode:'demo.check',kind:'boolean',returns:'boolean',metadata:{name:'Check',category:'Sensors'}},()=>true)
    .register(hat);
  assert.deepEqual(registry.palette(),[
    {category:'test',blocks:[{kind:'command',name:'test.echo',opcode:'test.echo',parameters:schema.parameters,returns:'number'},{kind:'hat',name:hat.opcode,opcode:hat.opcode,parameters:[],returns:null}]},
    {category:'Sensors',blocks:[{kind:'reporter',name:'Read',opcode:'demo.report',parameters:schema.parameters,returns:'number'},{kind:'boolean',name:'Check',opcode:'demo.check',parameters:schema.parameters,returns:'boolean'}]},
  ]);
  registry.palette()[0].blocks[0].parameters[0].name='changed';
  assert.equal(registry.schemas()[0].parameters[0].name,'value');
});

test('v2 remote commands, reporters and booleans accept Promise handlers and validate results',async()=>{
  for(const [kind,returns,value] of [['command',null,null],['reporter','number',7],['boolean','boolean',true]]){
    const s=new ExtensionRegistry().register({...v2,kind,returns},async()=>value).session();
    s.update([{id:1,opcode:v2.opcode,arguments:[1]}]);await flush();
    assert.deepEqual(s.drain(),[{kind:'extension_result',id:1,value}]);s.close();
  }
  const s=new ExtensionRegistry().register({...v2,kind:'boolean',returns:'boolean'},async()=>1).session();
  s.update([{id:1,opcode:v2.opcode,arguments:[1]}]);await flush();
  assert.match(s.drain()[0].error,/expected boolean/);s.close();
});

test('hat emits detached scalar/list events only for registered hats',async()=>{
  const s=new ExtensionRegistry().register(hat).register(v2,()=>1).session();
  const payload=['猫',[true,null,3]];s.emit(hat.opcode,payload);payload[1][0]=false;
  s.emit(hat.opcode);
  assert.deepEqual(s.drain(),[{kind:'extension_event',opcode:hat.opcode,value:['猫',[true,null,3]]},{kind:'extension_event',opcode:hat.opcode,value:null}]);
  for(const value of [{},undefined,NaN,Infinity,[{}],new Array(4097).fill(0),'x'.repeat(65536)]){
    if(value!==undefined)assert.throws(()=>s.emit(hat.opcode,value));
  }
  const cyclic=[];cyclic.push(cyclic);assert.throws(()=>s.emit(hat.opcode,cyclic));
  assert.throws(()=>s.emit(v2.opcode));assert.throws(()=>s.emit('missing.hat'));
  s.update([{id:1,opcode:hat.opcode,arguments:[]}]);await flush();assert.match(s.drain()[0].error,/hats cannot be called/);
  s.close();assert.throws(()=>s.emit(hat.opcode));
});

test('timeouts abort only their own calls, finish once, and ignore late fulfillment/rejection',async()=>{
  for(const settleWithError of [false,true]){
    let settle,signal,count=0;
    const s=new ExtensionRegistry({timeoutMs:15}).register(v2,([x],context)=>{
      count++;if(x===2)return x;
      signal=context.signal;return new Promise((resolve,reject)=>{settle=settleWithError?reject:resolve;});
    }).session();
    const requests=[{id:1,opcode:v2.opcode,arguments:[1]},{id:2,opcode:v2.opcode,arguments:[2]}];
    s.update(requests);await flush();assert.deepEqual(s.drain(),[{kind:'extension_result',id:2,value:2}]);
    await wait(35);assert.equal(signal.aborted,true);
    const results=s.drain();assert.equal(results.length,1);assert.equal(results[0].id,1);assert.match(results[0].error,/timed out/);
    settle(settleWithError?Error('late rejection'):1);await flush();s.update(requests);await flush();
    assert.equal(count,2);assert.deepEqual(s.drain(),[]);s.close();
  }
});

test('late synchronous results cannot beat the timeout timer via microtasks',async()=>{
  let signal;
  const s=new ExtensionRegistry({timeoutMs:5}).register(v2,(_,context)=>{
    signal=context.signal;
    const end=performance.now()+20;while(performance.now()<end){}
    return 1;
  }).session();
  s.update([{id:1,opcode:v2.opcode,arguments:[1]}]);await flush();
  assert.match(s.drain()[0].error,/timed out/);assert.equal(signal.aborted,true);
  await wait(10);assert.deepEqual(s.drain(),[]);s.close();
});

test('timeout configuration is bounded and timers are cleared on finish/cancel/close',async()=>{
  assert.equal(new ExtensionRegistry().timeoutMs,1000);
  for(const timeoutMs of [0,60001,-1,1.5,NaN,Infinity,'10',null])assert.throws(()=>new ExtensionRegistry({timeoutMs}));
  for(const timeoutMs of [1,60000])assert.equal(new ExtensionRegistry({timeoutMs}).timeoutMs,timeoutMs);
  for(const action of ['finish','cancel','close']){
    let signal;
    const s=new ExtensionRegistry({timeoutMs:10}).register(v2,(_,context)=>{signal=context.signal;return action==='finish'?1:new Promise(()=>{});}).session();
    s.update([{id:1,opcode:v2.opcode,arguments:[1]}]);await flush();
    const call=s.calls.get(1),timer=call.timer;
    if(action==='cancel')s.update([]);if(action==='close')s.close();
    await wait(25);assert.equal(timer===null||timer._destroyed,true);
    if(action==='finish'){assert.equal(signal.aborted,false);assert.deepEqual(s.drain(),[{kind:'extension_result',id:1,value:1}]);}
    else{assert.equal(signal.aborted,true);assert.deepEqual(s.drain(),[]);}
    s.close();s.update([{id:2,opcode:v2.opcode,arguments:[1]}]);assert.equal(s.calls.size,0);
  }
});

test('invalid requests produce a single error without unhandled rejections',async()=>{
  const s=new ExtensionRegistry().register(v2,()=>Promise.reject({toString(){throw Error('bad error');}})).session();
  for(const [id,request] of [
    {opcode:'missing.block',arguments:[]},{opcode:v2.opcode},{opcode:v2.opcode,arguments:null},
    {opcode:v2.opcode,arguments:['wrong']},{opcode:v2.opcode,arguments:[1]},
  ].entries()){
    s.update([{id,...request}]);await flush();const results=s.drain();assert.equal(results.length,1);assert.equal(results[0].id,id);assert.ok(results[0].error);
  }
  for(const requests of [null,{},[null],[{id:'1'}],[{id:NaN}]])assert.throws(()=>s.update(requests));
  s.close();await wait(0);
});

test('cancelled queued handlers never start',async()=>{
  for(const close of [false,true]){
    let calls=0;
    const s=new ExtensionRegistry().register(schema,()=>{calls++;return 1;}).session();
    s.update([{id:1,opcode:schema.opcode,arguments:[1]}]);
    if(close)s.close();else s.update([]);
    await flush();assert.equal(calls,0);assert.deepEqual(s.drain(),[]);
  }
});

test('session deduplicates retries, validates arguments/results and cancels stale calls',async()=>{
  let count=0,resolve,signal;
  const r=new ExtensionRegistry().register(schema,([x],context)=>{count++;signal=context.signal;return new Promise(r=>{resolve=r;});});
  const s=r.session(),request={id:1,opcode:'test.echo',arguments:[4],actor:'a'};
  s.update([request]);s.update([request]);await flush();assert.equal(count,1);
  resolve(4);await flush();assert.deepEqual(s.drain(),[{kind:'extension_result',id:1,value:4}]);
  s.update([request]);await flush();assert.equal(count,1);
  s.update([]);assert.equal(signal.aborted,true);
  s.update([{...request,id:2,arguments:['wrong']}]);await flush();assert.match(s.drain()[0].error,/expected number/);
  s.update([{...request,id:3}]);await flush();s.close();resolve(5);await flush();assert.deepEqual(s.drain(),[]);
});

test('JSON example accepts scalars/lists and rejects objects, invalid JSON and nonfinite results',async()=>{
  const s=registerJsonParse(new ExtensionRegistry()).session();
  for(const [id,text] of ['[1,true,"猫",null]','{"a":1}','bad','1e400'].entries()){
    s.update([{id,opcode:'example.json.parse',arguments:[text]}]);await flush();
    const result=s.drain()[0];
    if(id===0)assert.deepEqual(result.value,[1,true,'猫',null]);else assert.ok(result.error);
  }
  s.close();
});

test('PlayerConnection sends schema handshake and returns JS completion in next frame',async()=>{
  const previous=globalThis.WebSocket;let socket;
  globalThis.WebSocket=class {
    constructor(){socket=this;queueMicrotask(()=>this.onopen());}
    send(text){this.payload=JSON.parse(text);}
    close(){}
  };
  const registry=new ExtensionRegistry().register(schema,([x])=>x+1),p=new PlayerConnection(registry);
  try{
    const opened=p.open({toolType:'KN'},'http://127.0.0.1:1234');await flush();
    assert.equal(socket.payload.nekoc_extension_handshake,1);
    assert.deepEqual(socket.payload.extensions,[schema]);
    assert.equal('extension_api_versions' in socket.payload,false);
    socket.onmessage({data:'{"ready":true}'});await opened;
    const pending=p.frame({dt:.016});
    const json=new TextEncoder().encode(JSON.stringify({extension_requests:[{id:4,opcode:'test.echo',arguments:[8],actor:'a'}]}));
    const buffer=new ArrayBuffer(4+json.length);new DataView(buffer).setUint32(0,json.length,true);new Uint8Array(buffer,4).set(json);
    socket.onmessage({data:buffer});assert.equal(await pending,buffer);await flush();
    const snapshot=p.snapshot();assert.deepEqual(socket.payload,{debug_snapshot:true});
    socket.onmessage({data:'{"snapshot":{"sequence":1}}'});await snapshot;
    const next=p.frame({events:[{kind:'key'}]});
    assert.deepEqual(socket.payload.events,[{kind:'key'},{kind:'extension_result',id:4,value:9}]);
    socket.onmessage({data:buffer});await next;
  }finally{p.close();globalThis.WebSocket=previous;}
});

test('v2 PlayerConnection negotiates and sends hat events alongside completions',async()=>{
  const previous=globalThis.WebSocket;let socket;
  globalThis.WebSocket=class {
    constructor(){socket=this;queueMicrotask(()=>this.onopen());}
    send(text){this.payload=JSON.parse(text);}
    close(){}
  };
  const registry=new ExtensionRegistry().register(v2,async([x])=>x+1).register(hat),p=new PlayerConnection(registry);
  try{
    assert.throws(()=>p.emitExtension(hat.opcode));
    const opened=p.open({toolType:'KN'},'http://127.0.0.1:1234');await flush();
    assert.equal(socket.payload.nekoc_extension_handshake,1);assert.deepEqual(socket.payload.extension_api_versions,[2,1]);
    socket.onmessage({data:'{"ready":true,"extension_api_version":2}'});await opened;
    p.extensionSession.update([{id:1,opcode:v2.opcode,arguments:[8]}]);await flush();
    p.emitExtension(hat.opcode,['event']);
    const snapshot=p.snapshot();assert.deepEqual(socket.payload,{debug_snapshot:true});socket.onmessage({data:'{"snapshot":{}}'});await snapshot;
    const pending=p.frame({events:[{kind:'key'}]});
    assert.deepEqual(socket.payload.events,[{kind:'key'},{kind:'extension_result',id:1,value:9},{kind:'extension_event',opcode:hat.opcode,value:['event']}]);
    socket.onmessage({data:'{"snapshot":{}}'});await pending;
    for(let i=0;i<258;i++)p.emitExtension(hat.opcode,i);
    const first=p.frame({events:[{kind:'key'}]});assert.equal(socket.payload.events.length,256);socket.onmessage({data:'{"snapshot":{}}'});await first;
    const second=p.frame({});assert.deepEqual(socket.payload.events.map(e=>e.value),[255,256,257]);socket.onmessage({data:'{"snapshot":{}}'});await second;
  }finally{p.close();globalThis.WebSocket=previous;}
});

test('v2 PlayerConnection rejects missing, unsupported and downgraded ready versions',async()=>{
  const previous=globalThis.WebSocket;let socket;
  globalThis.WebSocket=class {
    constructor(){socket=this;queueMicrotask(()=>this.onopen());}
    send(){}
    close(){}
  };
  try{
    for(const version of [undefined,1,3,'2']){
      const p=new PlayerConnection(new ExtensionRegistry().register(hat));
      const opened=p.open({toolType:'KN'},'http://127.0.0.1:1234');
      const rejected=assert.rejects(opened,/extension API|Extension API/);await flush();
      socket.onmessage({data:JSON.stringify({ready:true,extension_api_version:version})});await rejected;
      assert.equal(p.ready,false);assert.equal(p.extensionSession,null);p.close();
    }
  }finally{globalThis.WebSocket=previous;}
});
