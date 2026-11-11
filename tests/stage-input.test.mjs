import test from 'node:test';
import assert from 'node:assert/strict';
import { StageInput } from '../web/input.js';

class FakeElement {
  listeners = new Map();
  captures = new Set();
  focusCalls = [];
  box = { left:20, top:30, right:260, bottom:210, width:240, height:180 };
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, init = {}) {
    const event = { defaultPrevented:false, preventDefault() { this.defaultPrevented=true; }, ...init };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  focus(options) { this.focusCalls.push(options); }
  getBoundingClientRect() { return this.box; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    if (this.captures.delete(id)) this.emit('lostpointercapture', {pointerId:id});
  }
}

function fixture(t, options = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = new FakeElement(), canvas = new FakeElement();
  Object.defineProperty(globalThis, 'window', {configurable:true, value:window});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  let now=0, active=true, target=null;
  t.mock.method(performance, 'now', () => now);
  const renderer = {width:480, height:360, kitten4:true, sprites:[], hitTest:() => target, ...options};
  const input = new StageInput(canvas, renderer, () => active);
  return {
    input, canvas, window, renderer,
    time(value) { now=value; },
    active(value) { active=value; },
    target(value) { target=value; },
    key(type, keyCode, init = {}) {
      return (type==='keydown' ? canvas : window).emit(type, {keyCode, ...init});
    },
    pointer(type, x=0, y=0, init = {}) {
      const box=canvas.box;
      return canvas.emit(type, {pointerId:1, pointerType:'mouse', isPrimary:true, button:0,
        clientX:box.left+(x+renderer.width/2)*box.width/renderer.width,
        clientY:box.top+(renderer.height/2-y)*box.height/renderer.height, ...init});
    },
  };
}

const pointerEvent = (state, target='', x=0, y=0) => ({kind:'pointer', state, target, x, y});
const keyEvent = (key, down) => ({kind:'key', key:String(key), down});
// CSS/stage round-trips may differ by a few floating-point ULPs.
function assertNear(actual, expected) {
  const rounded=JSON.parse(JSON.stringify(actual, (_key,value) =>
    typeof value==='number' ? Math.round(value*1e9)/1e9 : value));
  assert.deepEqual(rounded,expected);
}

test('quick key down/up pairs survive a frame; repeats do not duplicate downs', t => {
  const f=fixture(t);
  assert.equal(f.key('keydown',65).defaultPrevented, true);
  f.key('keydown',65,{repeat:true});
  f.key('keyup',65);
  f.key('keyup',65);
  assert.deepEqual(f.input.take(), {events:[keyEvent(65,true), keyEvent(65,false)], pressed:[], mouse:{x:0,y:0}});
  assert.deepEqual(f.input.take().events, []);
  f.key('keydown',65);
  assert.deepEqual(f.input.take().pressed, ['65']);
  f.key('keyup',65);
  assert.deepEqual(f.input.take().events, [keyEvent(65,false)]);
});

test('inactive input and shortcuts are ignored, but held keys release after deactivation', t => {
  const f=fixture(t);
  for (const init of [{ctrlKey:true},{metaKey:true},{altKey:true},{key:'Tab'}]) {
    assert.equal(f.key('keydown',65,init).defaultPrevented, false);
  }
  f.active(false);
  assert.equal(f.key('keydown',65).defaultPrevented, false);
  assert.equal(f.pointer('pointerdown').defaultPrevented, false);
  assert.deepEqual(f.input.take().events, []);
  f.active(true);
  f.key('keydown',65);
  f.active(false);
  f.key('keyup',65,{ctrlKey:true});
  assert.deepEqual(f.input.take().events, [keyEvent(65,true),keyEvent(65,false)]);
});

for (const kitten4 of [true,false]) {
  test(`${kitten4?'K4':'KN'} allows only official key codes and normalises all numpad digits`, t => {
    const f=fixture(t,{kitten4});
    const allowed = new Set([13,32,37,38,39,40,
      ...Array.from({length:10},(_,i)=>48+i), ...Array.from({length:26},(_,i)=>65+i),
      ...Array.from({length:10},(_,i)=>96+i)]);
    for (let code=0; code<=255; code++) {
      const down=f.key('keydown',code), up=f.key('keyup',code);
      const key=code>=96&&code<=105 ? code-48 : code;
      assert.equal(down.defaultPrevented, allowed.has(code), `key ${code}`);
      assert.equal(up.defaultPrevented, false);
      assert.deepEqual(f.input.take().events, allowed.has(code) ? [keyEvent(key,true),keyEvent(key,false)] : [], `key ${code}`);
    }
  });
}

for (const source of ['canvas','window']) {
  test(`${source} blur releases held keys once`, t => {
    const f=fixture(t);
    f.key('keydown',65); f.key('keydown',32);
    f.input.take();
    f[source].emit('blur'); f[source].emit('blur');
    f.key('keyup',65); f.key('keyup',32);
    assert.deepEqual(f.input.take(), {events:[keyEvent(65,false),keyEvent(32,false)], pressed:[], mouse:{x:0,y:0}});
  });
}

for (const pointerType of ['mouse','touch']) {
  for (const target of [null,'actor']) {
    test(`K4 ${pointerType} quick pair targets ${target ?? 'background'} only`, t => {
      const f=fixture(t); f.target(target);
      const init={pointerType};
      assert.equal(f.pointer('pointerdown',30,-20,init).defaultPrevented,true);
      assert.equal(f.canvas.hasPointerCapture(1),true);
      f.time(50); f.pointer('pointerup',30,-20,init);
      assert.deepEqual(f.input.take(), {events:[pointerEvent('mouse_down',target ?? '',30,-20),
        pointerEvent('mouse_up',target ?? '',30,-20),pointerEvent('mouse_click',target ?? '',30,-20)],
      pressed:[],mouse:{x:30,y:-20}});
      assert.deepEqual(f.canvas.focusCalls,[{preventScroll:true}]);
      assert.equal(f.canvas.hasPointerCapture(1),false);
      assert.equal(f.input.pointer,null);
    });
  }
}

for (const kitten4 of [true,false]) {
  for (const elapsed of [999,1000,1001]) {
    test(`${kitten4?'K4':'KN'} click requires strictly less than 1000ms (${elapsed}ms)`, t => {
      const f=fixture(t,{kitten4});
      f.time(25); f.pointer('pointerdown');
      f.time(25+elapsed); f.pointer('pointerup');
      const states=f.input.take().events.map(e=>e.state);
      assert.deepEqual(states, elapsed<1000 ? ['mouse_down','mouse_up','mouse_click'] : ['mouse_down','mouse_up']);
    });
  }
}

test('K4 changing targets clears the old down without a background click', t => {
  const f=fixture(t);
  f.target('first'); f.pointer('pointerdown');
  f.target('second'); f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[pointerEvent('mouse_down','first'),pointerEvent('','first'),pointerEvent('mouse_up','second')]);
  f.target('actor'); f.pointer('pointerdown');
  f.target(null); f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[pointerEvent('mouse_down','actor'),pointerEvent('','actor'),pointerEvent('mouse_up')]);
});

test('K4 outside releases clear the down state, with no up or click (right/bottom excluded)', t => {
  const f=fixture(t); f.target('actor');
  for (const [x,y] of [[240,0],[0,-180],[-241,0],[0,181]]) {
    f.pointer('pointerdown'); f.input.take();
    f.target(null); f.pointer('pointerup',x,y);
    assert.deepEqual(f.input.take().events.filter(e=>e.kind==='pointer'),[pointerEvent('','actor',x,y),pointerEvent('','',x,y)]);
    assert.equal(f.canvas.hasPointerCapture(1),false);
    f.target('actor');
  }
});

test('only the active primary pointer moves, releases or cancels a gesture', t => {
  const f=fixture(t);
  assert.equal(f.pointer('pointerdown',0,0,{button:2}).defaultPrevented,false);
  assert.equal(f.pointer('pointerdown',0,0,{isPrimary:false}).defaultPrevented,false);
  assert.deepEqual(f.input.take().events,[]);
  f.pointer('pointerdown',10,20,{pointerType:'touch'}); f.input.take();
  f.pointer('pointerdown',100,100,{pointerId:2,pointerType:'mouse'});
  f.pointer('pointermove',100,100,{pointerId:2,isPrimary:false});
  f.pointer('pointermove',100,100,{pointerId:2});
  f.pointer('pointerup',100,100,{pointerId:2});
  f.pointer('pointercancel',100,100,{pointerId:2});
  assert.equal(f.input.pointer.id,1);
  assertNear(f.input.take(),{events:[],pressed:[],mouse:{x:10,y:20}});
  f.pointer('pointerup',10,20,{pointerType:'touch'});
  assertNear(f.input.take().events,[pointerEvent('mouse_up','',10,20),pointerEvent('mouse_click','',10,20)]);
});

test('K4 cancel clears pointer state and capture without inventing an up/click or releasing keys', t => {
  const f=fixture(t); f.target('actor');
  f.key('keydown',65); f.pointer('pointerdown',10,20); f.input.take();
  f.pointer('pointercancel',10,20);
  f.pointer('pointerup',10,20);
  assertNear(f.input.take(), {events:[pointerEvent('','actor',10,20)],pressed:['65'],mouse:{x:10,y:20}});
  assert.equal(f.input.pointer,null);
  assert.equal(f.canvas.hasPointerCapture(1),false);
});

test('blur and lost capture cannot strand K4 pointer state or duplicate releases', t => {
  const f=fixture(t); f.target('actor');
  f.key('keydown',65); f.pointer('pointerdown'); f.input.take();
  f.window.emit('blur'); f.canvas.emit('blur'); f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[keyEvent(65,false),pointerEvent('','actor')]);
  assert.equal(f.canvas.hasPointerCapture(1),false);
  f.pointer('pointerdown'); f.input.take();
  f.canvas.releasePointerCapture(1);
  f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[pointerEvent('','actor')]);
});

for (const kitten4 of [true,false]) {
  test(`${kitten4?'K4':'KN'} dragging preserves the grabbed offset across scaled canvas moves`, t => {
    const sprite={id:'actor',x:10,y:-15,draggable:true};
    const f=fixture(t,{kitten4,sprites:[sprite]}); f.target('actor');
    f.pointer('pointerdown',30,-5); f.input.take();
    f.pointer('pointermove',70,25);
    f.pointer('pointermove',90,35);
    assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:50,y:15},{kind:'drag',target:'actor',x:70,y:25}]);
    f.pointer('pointerup',90,35);
    assert.deepEqual(f.input.take().events.filter(e=>e.kind==='swipe'),kitten4 ? [{kind:'swipe',direction:'right'}] : []);
    f.pointer('pointermove',100,40);
    assert.deepEqual(f.input.take().events,[]);
  });
}

test('non-draggable sprites never generate drag events but still allow K4 swipe', t => {
  const f=fixture(t,{sprites:[{id:'actor',x:0,y:0,draggable:false}]}); f.target('actor');
  f.pointer('pointerdown'); f.pointer('pointermove',100,0); f.time(100); f.pointer('pointerup',100,0);
  const events=f.input.take().events;
  assert.deepEqual(events.map(e=>e.kind),['pointer','swipe','pointer','pointer']);
  assert.deepEqual(events[1],{kind:'swipe',direction:'right'});
});

// Supply CSS deltas directly to exercise strict Hammer boundaries without
// introducing stage-to-CSS floating-point round-trip noise.
function cssSwipe(f, dx, dy, elapsed, init = {}) {
  f.time(0); f.pointer('pointerdown',0,0,init);
  const start=f.input.pointer.client;
  f.time(elapsed);
  f.pointer('pointerup',0,0,{...init,clientX:start.x+dx,clientY:start.y+dy});
  return f.input.take().events.filter(e=>e.kind==='swipe');
}

for (const [dx,elapsed,swipe] of [[9.99,10,false],[10,10,false],[10.01,10,true],
  [30,100,false],[29.99,100,false],[30.01,100,true]]) {
  test(`K4 strict CSS swipe thresholds: ${dx}px in ${elapsed}ms`, t => {
    const f=fixture(t);
    assert.deepEqual(cssSwipe(f,dx,0,elapsed),swipe ? [{kind:'swipe',direction:'right'}] : []);
  });
}

for (const [dx,dy,direction] of [[40,0,'right'],[-40,0,'left'],[0,40,'down'],[0,-40,'up'],
  [40,40,null],[-40,-40,null],[40,-40,'right'],[-40,40,'left'],[30,40,'down'],[-40,-30,'left']]) {
  test(`K4 Hammer offset direction (${dx}, ${dy}) is ${direction ?? 'NONE'}`, t => {
    const f=fixture(t);
    assert.deepEqual(cssSwipe(f,dx,dy,50),direction ? [{kind:'swipe',direction}] : []);
  });
}

test('K4 swipe distance is Euclidean but velocity uses the largest axis', t => {
  const f=fixture(t);
  // Both axes are below 10px, but the total distance exceeds the threshold.
  assert.deepEqual(cssSwipe(f,8,-8,10),[{kind:'swipe',direction:'right'}]);
  // Euclidean velocity exceeds .3, but the largest-axis velocity is only .25.
  assert.deepEqual(cssSwipe(f,25,-25,100),[]);
});

test('K4 swipe uses CSS distance and velocity rather than stage units or canvas scale', t => {
  const f=fixture(t);
  for (const width of [120,240,960]) {
    f.canvas.box={left:20,top:30,right:20+width,bottom:30+width*.75,width,height:width*.75};
    assert.deepEqual(cssSwipe(f,40,0,100),[{kind:'swipe',direction:'right'}]);
    assert.deepEqual(cssSwipe(f,10,0,10),[]);
    assert.deepEqual(cssSwipe(f,30,0,100),[]);
  }
});

test('K4 dragging does not suppress a recognised swipe', t => {
  const f=fixture(t,{sprites:[{id:'actor',x:0,y:0,draggable:true}]}); f.target('actor');
  f.pointer('pointerdown'); f.time(50); f.pointer('pointermove',80,0);
  f.time(100); f.pointer('pointerup',80,0);
  const events=f.input.take().events;
  assert.equal(events.some(e=>e.kind==='drag'),true);
  assert.deepEqual(events.filter(e=>e.kind==='swipe'),[{kind:'swipe',direction:'right'}]);
});

test('K4 swipe uses overall velocity, not only a fast final move', t => {
  const f=fixture(t);
  f.pointer('pointerdown'); f.time(999); f.pointer('pointermove');
  f.time(1000); f.pointer('pointerup',80,0);
  assert.deepEqual(f.input.take().events.filter(e=>e.kind==='swipe'),[]);
});

test('K4 rejected second pointer marks maxPointers and prevents swipe even after it leaves', t => {
  const f=fixture(t);
  f.pointer('pointerdown',0,0,{pointerType:'touch'});
  const second=f.pointer('pointerdown',20,0,{pointerId:2,pointerType:'touch',isPrimary:false});
  assert.equal(second.defaultPrevented,false);
  assert.equal(f.input.pointer.id,1);
  assert.equal(f.input.pointer.maxPointers,2);
  f.pointer('pointerup',20,0,{pointerId:2,pointerType:'touch',isPrimary:false});
  f.time(100); f.pointer('pointerup',80,0,{pointerType:'touch'});
  assert.deepEqual(f.input.take().events.filter(e=>e.kind==='swipe'),[]);
  // A new single-pointer gesture must not inherit the old multi-touch mark.
  assert.deepEqual(cssSwipe(f,40,0,100,{pointerType:'touch'}),[{kind:'swipe',direction:'right'}]);
});

test('K4 repeated down for the same pointer does not mark a multi-pointer swipe', t => {
  const f=fixture(t);
  f.pointer('pointerdown'); f.pointer('pointerdown');
  assert.equal(f.input.pointer.maxPointers,1);
  f.time(100); f.pointer('pointerup',80,0);
  assert.deepEqual(f.input.take().events.filter(e=>e.kind==='swipe'),[{kind:'swipe',direction:'right'}]);
});

test('K4 dragging adds pointer deltas to newly rendered sprite positions', t => {
  const f=fixture(t,{sprites:[{id:'actor',x:10,y:20,draggable:true}]}); f.target('actor');
  f.pointer('pointerdown',30,40); f.input.take();
  f.pointer('pointermove',40,50);
  f.pointer('pointermove',50,60);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:20,y:30},{kind:'drag',target:'actor',x:30,y:40}]);
  // Renderer replaces frame sprite objects; a script moved the actor since
  // the last input batch. Do not snap it back to its original grab offset.
  f.renderer.sprites=[{id:'actor',x:100,y:150,draggable:true}];
  f.pointer('pointermove',60,70);
  f.pointer('pointermove',70,80);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:110,y:160},{kind:'drag',target:'actor',x:120,y:170}]);
});

test('K4 dragging observes script coordinate changes on the same sprite object', t => {
  const sprite={id:'actor',x:10,y:20,draggable:true};
  const f=fixture(t,{sprites:[sprite]}); f.target('actor');
  f.pointer('pointerdown',30,40); f.input.take();
  f.pointer('pointermove',40,50);
  f.pointer('pointermove',50,60);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:20,y:30},{kind:'drag',target:'actor',x:30,y:40}]);
  sprite.x=100; sprite.y=150;
  f.pointer('pointermove',60,70);
  f.pointer('pointermove',70,80);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:110,y:160},{kind:'drag',target:'actor',x:120,y:170}]);
  // Each axis must independently invalidate the saved rendered position.
  sprite.x=200;
  f.pointer('pointermove',80,90);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:210,y:160}]);
  sprite.y=-100;
  f.pointer('pointermove',90,100);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:210,y:-90}]);
  assert.equal(f.renderer.sprites[0],sprite);
});

for (const [x,y] of [[-241,0],[241,0],[0,-181],[0,181]]) {
  test(`K4 ignores outside drag (${x}, ${y}) and resumes from the last valid point`, t => {
    const f=fixture(t,{sprites:[{id:'actor',x:10,y:20,draggable:true}]}); f.target('actor');
    f.pointer('pointerdown',30,40); f.input.take();
    f.pointer('pointermove',40,50); f.input.take();
    f.pointer('pointermove',x,y);
    f.pointer('pointermove',x*2,y*2);
    assert.deepEqual(f.input.take().events,[]);
    assertNear(f.input.pointer.last,{x:40,y:50});
    assertNear(f.input.pointer.position,{x:20,y:30});
    assertNear(f.input.mouse,{x:x*2,y:y*2});
    f.pointer('pointermove',60,70);
    assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:40,y:50}]);
  });
}

test('K4 includes all four exact stage edges in dragging', t => {
  const f=fixture(t,{sprites:[{id:'actor',x:0,y:0,draggable:true}]}); f.target('actor');
  f.pointer('pointerdown'); f.input.take();
  for (const [x,y] of [[-240,0],[240,0],[0,-180],[0,180],[-240,-180],[240,180]]) {
    f.pointer('pointermove',x,y);
    assertNear(f.input.take().events,[{kind:'drag',target:'actor',x,y}]);
  }
});

test('K4 re-entry combines last valid pointer delta with same-object script movement outside', t => {
  const sprite={id:'actor',x:10,y:20,draggable:true};
  const f=fixture(t,{sprites:[sprite]}); f.target('actor');
  f.pointer('pointerdown',30,40); f.input.take();
  f.pointer('pointermove',40,50); f.input.take();
  sprite.x=100; sprite.y=150;
  f.pointer('pointermove',300,200);
  assert.deepEqual(f.input.take().events,[]);
  assert.deepEqual(f.input.pointer.rendered,{x:10,y:20});
  f.pointer('pointermove',60,70);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:120,y:170}]);
});

test('KN dragging still follows its grab offset outside stage bounds', t => {
  const f=fixture(t,{kitten4:false,sprites:[{id:'actor',x:10,y:20,draggable:true}]}); f.target('actor');
  f.pointer('pointerdown',30,40); f.input.take();
  f.pointer('pointermove',300,200);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:280,y:180}]);
  f.pointer('pointermove',60,70);
  assertNear(f.input.take().events,[{kind:'drag',target:'actor',x:40,y:50}]);
});

test('reset discards pending events, held keys and pointer capture; take returns snapshots', t => {
  const f=fixture(t);
  f.key('keydown',65); f.pointer('pointerdown',10,20);
  const snapshot=f.input.take();
  f.pointer('pointermove',20,30); f.key('keydown',66);
  assertNear(snapshot.mouse,{x:10,y:20});
  assert.deepEqual(snapshot.pressed,['65']);
  f.input.reset();
  assertNear(f.input.take(),{events:[],pressed:[],mouse:{x:20,y:30}});
  assert.equal(f.input.pointer,null);
  assert.equal(f.canvas.hasPointerCapture(1),false);
  f.key('keyup',65); f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[]);
});

test('KN clicks require matching targets, with no fallback background click', t => {
  const f=fixture(t,{kitten4:false});
  for (const [down,up] of [['actor','other'],['actor',null],[null,'actor']]) {
    f.target(down); f.pointer('pointerdown');
    f.time(50); f.target(up); f.pointer('pointerup');
    assert.deepEqual(f.input.take().events,[pointerEvent('mouse_down',down ?? ''),pointerEvent('',down ?? ''),pointerEvent('mouse_up',up ?? '')]);
  }
  f.target('actor'); f.pointer('pointerdown'); f.pointer('pointerup');
  assert.deepEqual(f.input.take().events,[pointerEvent('mouse_down','actor'),pointerEvent('mouse_up','actor'),pointerEvent('mouse_click','actor')]);
});

test('KN cancel retains compatibility release (official cancel behavior is unverified)', t => {
  const f=fixture(t,{kitten4:false}); f.target('actor');
  f.key('keydown',65);
  f.pointer('pointerdown'); f.input.take();
  f.pointer('pointercancel');
  assert.deepEqual(f.input.take().events,[keyEvent(65,false),pointerEvent('mouse_up','actor')]);
  assert.equal(f.input.pointer,null);
  assert.equal(f.canvas.hasPointerCapture(1),false);
});

for (const [dx,dy,directions] of [[50,0,[]],[50.01,0,['right']],[-50,0,[]],[-50.01,0,['left']],
  [0,50,[]],[0,50.01,['down']],[0,-50,[]],[0,-50.01,['up']],
  [100,-100,['up','right']],[-100,100,['left','down']],
  [100,100,[]],[-100,-100,[]],[60,-100,['up','right']],[-100,60,['left','down']],
  [60,80,['down']],[-60,-80,['up']]]) {
  test(`KN signed swipe gate (${dx}, ${dy}) emits ${directions.join(',') || 'none'}`, t => {
    const f=fixture(t,{kitten4:false});
    assert.deepEqual(cssSwipe(f,dx,dy,100),directions.map(direction=>({kind:'swipe',direction})));
  });
}

test('KN requires Hammer velocity before its 50px gate, including strict .3 boundary', t => {
  const f=fixture(t,{kitten4:false});
  assert.deepEqual(cssSwipe(f,60,0,200),[]);
  assert.deepEqual(cssSwipe(f,60,0,201),[]);
  assert.deepEqual(cssSwipe(f,60,0,199),[{kind:'swipe',direction:'right'}]);
  assert.deepEqual(cssSwipe(f,100,-100,1000),[]);
});

test('KN swipe uses CSS deltas at every canvas scale', t => {
  const f=fixture(t,{kitten4:false});
  for (const width of [120,240,960]) {
    f.canvas.box={left:20,top:30,right:20+width,bottom:30+width*.75,width,height:width*.75};
    assert.deepEqual(cssSwipe(f,50,0,100),[]);
    assert.deepEqual(cssSwipe(f,60,0,100),[{kind:'swipe',direction:'right'}]);
    assert.deepEqual(cssSwipe(f,60,-60,100),[{kind:'swipe',direction:'up'},{kind:'swipe',direction:'right'}]);
  }
});

test('KN draggable sprites permit fast swipe and click together, but slow dragging does not swipe', t => {
  const f=fixture(t,{kitten4:false,sprites:[{id:'actor',x:0,y:0,draggable:true}]}); f.target('actor');
  for (const elapsed of [100,1000]) {
    f.time(0); f.pointer('pointerdown');
    f.time(elapsed/2); f.pointer('pointermove',120,0);
    f.time(elapsed); f.pointer('pointerup',120,0);
    const events=f.input.take().events;
    assert.equal(events.some(e=>e.kind==='drag'),true);
    assert.deepEqual(events.filter(e=>e.kind==='swipe'),elapsed===100 ? [{kind:'swipe',direction:'right'}] : []);
    assert.equal(events.some(e=>e.state==='mouse_click'),elapsed===100);
  }
});

test('KN second-pointer maxPointers blocks even dual-direction swipe and resets next gesture', t => {
  const f=fixture(t,{kitten4:false});
  f.pointer('pointerdown',0,0,{pointerType:'touch'});
  f.pointer('pointerdown',0,0,{pointerId:2,pointerType:'touch',isPrimary:false});
  assert.equal(f.input.pointer.maxPointers,2);
  f.pointer('pointerup',0,0,{pointerId:2,pointerType:'touch',isPrimary:false});
  f.time(100); f.pointer('pointerup',120,120,{pointerType:'touch'});
  assert.deepEqual(f.input.take().events.filter(e=>e.kind==='swipe'),[]);
  assert.deepEqual(cssSwipe(f,60,-60,100,{pointerType:'touch'}),[{kind:'swipe',direction:'up'},{kind:'swipe',direction:'right'}]);
});
