import test from 'node:test';
import assert from 'node:assert/strict';
import {K4DeviceHost} from '../web/k4-device.js';
import {PlayerConnection} from '../web/player.js';
import {ExtensionRegistry} from '../web/extensions.js';

function environment({permission=false}={}) {
  const listeners=new Map(),vibrations=[];
  const window={DeviceMotionEvent:class{},DeviceOrientationEvent:class{},innerWidth:390,innerHeight:844,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
  if(permission){
    window.DeviceMotionEvent={requestPermission:async()=> 'granted'};
    window.DeviceOrientationEvent={requestPermission:async()=> 'granted'};
  }
  return {window,navigator:{vibrate(pattern){vibrations.push(pattern);return true;}},listeners,vibrations};
}

test('motion and orientation use real sensor fields and initial portrait state',async()=>{
  const env=environment(),host=new K4DeviceHost(env);await host.requestPermission();
  env.listeners.get('devicemotion')({accelerationIncludingGravity:{x:1,y:-2,z:9.8},timeStamp:123.5});
  env.listeners.get('deviceorientation')({beta:12,gamma:-4});
  assert.deepEqual(host.take(),[
    {kind:'device_motion',x:1,y:-2,z:9.8,time_ms:123.5},
    {kind:'device_orientation',beta:12,gamma:-4,portrait:true},
  ]);
});

test('motion without a real event timestamp is ignored rather than fabricated',async()=>{
  const env=environment(),host=new K4DeviceHost(env);await host.requestPermission();
  env.listeners.get('devicemotion')({accelerationIncludingGravity:{x:1,y:2,z:3}});
  assert.deepEqual(host.take(),[]);
});

test('explicit remote inputs use the server kind contract and touch is not involved',async()=>{
  const host=new K4DeviceHost(environment());
  host.button('phone-a','down','A');host.slide('phone-a','left');host.slope('phone-a','up');host.shake('phone-a');
  assert.deepEqual(host.take(),[
    {kind:'mobile_button',device:'phone-a',event:'down',button:'A'},
    {kind:'device_event',action:'on_mobile_slide',device:'phone-a',value:'left'},
    {kind:'device_event',action:'on_mobile_slope',device:'phone-a',value:'up'},
    {kind:'device_event',action:'on_mobile_shake',device:'phone-a',value:''},
  ]);
});

test('denied permission does not throw or attach denied sensor listeners',async()=>{
  const env=environment({permission:true});env.window.DeviceMotionEvent.requestPermission=async()=> 'denied';
  const host=new K4DeviceHost(env);assert.equal(await host.requestPermission(),'denied');
  assert.equal(env.listeners.has('devicemotion'),false);assert.equal(env.listeners.has('deviceorientation'),true);
  assert.deepEqual(host.take(),[]);host.stop();assert.equal(env.listeners.size,0);
});

test('vibrate output calls navigator only for valid commands and cleanup removes listeners',async()=>{
  const env=environment(),host=new K4DeviceHost(env);await host.requestPermission();
  host.apply({k4_media_output:[{kind:'vibrate',pattern_ms:[10,20]},{kind:'other',pattern_ms:[1]},{kind:'vibrate',pattern_ms:[NaN]}]});
  assert.deepEqual(env.vibrations,[[10,20]]);host.stop();assert.equal(env.listeners.size,0);
});

test('missing, null, string and non-finite samples never become simulated zero data',async()=>{
  const env=environment(),host=new K4DeviceHost(env);await host.requestPermission();
  const motion=env.listeners.get('devicemotion'),orientation=env.listeners.get('deviceorientation');
  for(const value of [null,undefined,NaN,Infinity,'3']){
    motion({accelerationIncludingGravity:{x:value,y:2,z:3},acceleration:{x:1,y:2,z:3},timeStamp:1});
    orientation({beta:value,gamma:2});
  }
  motion({acceleration:{x:1,y:2,z:3},timeStamp:1});
  assert.deepEqual(host.take(),[]);
  env.window.innerWidth=1000;env.window.innerHeight=390;
  orientation({beta:90,gamma:-45});
  assert.deepEqual(host.take(),[{kind:'device_orientation',beta:90,gamma:-45,portrait:true}]);
  host.close();motion({accelerationIncludingGravity:{x:1,y:2,z:3},timeStamp:1});
  assert.deepEqual(host.take(),[]);assert.equal(host.button('phone','down','A'),false);
});

test('both permission APIs are invoked in the gesture, concurrent calls deduplicate and late grants cannot revive a stopped host',async()=>{
  const env=environment({permission:true}),requests=[],settle=[];
  for(const name of ['Motion','Orientation'])env.window[`Device${name}Event`].requestPermission=()=>{
    requests.push(name);return new Promise(resolve=>settle.push(resolve));
  };
  const host=new K4DeviceHost(env),first=host.requestPermission(),second=host.requestPermission();
  assert.deepEqual(requests,['Motion','Orientation']);assert.equal(env.listeners.size,0);
  host.close();for(const resolve of settle)resolve('granted');await Promise.all([first,second]);
  assert.equal(env.listeners.size,0);assert.deepEqual(host.take(),[]);
});

test('unsupported and throwing APIs settle safely without creating sensor events',async()=>{
  const absent=new K4DeviceHost({});assert.equal(await absent.requestPermission(),'unavailable');
  absent.apply({k4_media_output:[{kind:'vibrate',pattern_ms:[10]}]});assert.deepEqual(absent.take(),[]);
  const env=environment({permission:true});env.window.DeviceMotionEvent.requestPermission=()=>{throw Error('denied');};
  env.window.DeviceOrientationEvent.requestPermission=()=>Promise.reject(Error('denied'));
  env.navigator.vibrate=()=>{throw Error('blocked');};
  const host=new K4DeviceHost(env);assert.equal(await host.requestPermission(),'denied');
  assert.equal(env.listeners.size,0);assert.doesNotThrow(()=>host.apply({k4_media_output:[{kind:'vibrate',pattern_ms:[10]}]}));
  assert.deepEqual(host.take(),[]);
});

test('pause clears queued inputs and listeners, resume attaches each sensor once',async()=>{
  const env=environment(),host=new K4DeviceHost(env);
  env.window.innerWidth=844;env.window.innerHeight=390;
  const landscape=new K4DeviceHost(env);await landscape.requestPermission();
  env.listeners.get('deviceorientation')({beta:3,gamma:4});
  assert.deepEqual(landscape.take(),[{kind:'device_orientation',beta:3,gamma:4,portrait:false}]);landscape.close();
  await host.requestPermission();host.slide('phone','left');host.stop();
  assert.equal(env.listeners.size,0);assert.deepEqual(host.take(),[]);
  await Promise.all([host.requestPermission(),host.requestPermission()]);assert.equal(env.listeners.size,2);
  env.listeners.get('deviceorientation')({beta:10,gamma:20});
  assert.equal(host.take().length,1);host.close();assert.equal(env.listeners.size,0);
});

test('vibration rejection is returned by the platform, not synthesized into a success event',()=>{
  const calls=[],env=environment();env.navigator.vibrate=function(pattern){assert.equal(this,env.navigator);calls.push(pattern);return false;};
  const host=new K4DeviceHost(env);
  host.apply({k4_media_output:[{kind:'midi',pattern_ms:[1]},{kind:'vibrate',pattern_ms:[10,20]},{kind:'vibrate',pattern_ms:[null]},{kind:'vibrate',pattern_ms:[-1]}]});
  assert.deepEqual(calls,[[10,20],[-1]]);assert.deepEqual(host.take(),[]);
});

test('PlayerConnection sends device events with or without ordinary input, bounds frames, preserves snapshot queues and closes sensors',async()=>{
  const previous=globalThis.WebSocket,env=environment(),host=new K4DeviceHost(env);let socket;
  globalThis.WebSocket=class {
    constructor(){socket=this;}
    send(value){this.payload=JSON.parse(value);}close(){}
  };
  const player=new PlayerConnection(new ExtensionRegistry(),host);
  const response=()=>socket.onmessage({data:new ArrayBuffer(0)});
  try{
    await player.requestDevicePermission();const open=player.open(null,'http://127.0.0.1:1234');
    socket.onmessage({data:'{"ready":true}'});await open;
    player.sendButton('phone-a','down','A');
    let frame=player.frame({dt:.016});
    assert.deepEqual(socket.payload.events,[{kind:'mobile_button',device:'phone-a',event:'down',button:'A'}]);response();await frame;
    env.listeners.get('devicemotion')({accelerationIncludingGravity:{x:1,y:2,z:9.8},timeStamp:21});
    const snapshot=player.snapshot();assert.deepEqual(socket.payload,{debug_snapshot:true});
    socket.onmessage({data:'{"snapshot":{"sequence":1}}'});await snapshot;
    const keys=Array.from({length:256},()=>({kind:'key',key:'32',down:true}));
    frame=player.frame({dt:.016,events:keys});assert.equal(socket.payload.events.length,256);response();await frame;
    frame=player.frame({dt:.016,events:[]});
    assert.deepEqual(socket.payload.events,[{kind:'device_motion',x:1,y:2,z:9.8,time_ms:21}]);response();await frame;
    player.applyFrame({k4_media_output:[{kind:'vibrate',pattern_ms:[7,3,7]}]});assert.deepEqual(env.vibrations,[[7,3,7]]);
    player.close();assert.equal(env.listeners.size,0);assert.equal(host.closed,true);
  }finally{player.close();globalThis.WebSocket=previous;}
});
