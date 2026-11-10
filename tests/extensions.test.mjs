import test from 'node:test';
import assert from 'node:assert/strict';
import {ExtensionRegistry,registerJsonParse} from '../web/extensions.js';
import {PlayerConnection} from '../web/player.js';
const schema={api_version:1,opcode:'test.echo',parameters:[{name:'value',value_type:'number'}],returns:'number',blocking:true,network:false};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('web schemas are explicit, detached, versioned and offline',()=>{
  const r=new ExtensionRegistry();
  for(const extra of [{api_version:2},{blocking:false},{network:true},{network:0},{extra:true},{parameters:[{name:'value',value_type:'number',extra:true}]},{opcode:'bare'},{returns:'object'}])assert.throws(()=>r.register({...schema,...extra},()=>0));
  r.register(schema,([x])=>x);
  assert.throws(()=>r.register(schema,()=>0));
  const copy=r.schemas();copy[0].parameters[0].name='changed';
  assert.equal(r.schemas()[0].parameters[0].name,'value');
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
