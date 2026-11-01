import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function displayHarness() {
  const vars = {}, lists = {}, strokes = [], waits = [];
  let time = 0, position = [0, 0], down = false, size = 1;
  const hsv = {};
  const globals = {
    getVar: name => vars[name] ?? 0,
    setVar: (name, value) => { vars[name] = value; },
    changeVar: (name, value) => { vars[name] = (vars[name] ?? 0) + value; },
    listItem: (name, mode, index) => {
      assert.ok(index >= 1 && index <= lists[name].length, `Out-of-bounds read: ${name}[${index}]`);
      return lists[name][index - 1];
    },
    listLength: name => lists[name]?.length ?? 0,
    appendList: (name, value) => (lists[name] ??= []).push(value),
    replaceListItem: (name, mode, index, value) => { assert.ok(index >= 1 && index <= lists[name].length); lists[name][index - 1] = value; },
    deleteListItem: (name, mode) => { if (mode === "all") lists[name] = []; else lists[name].pop(); },
    floor: Math.floor,
    mathFunc: (type, value) => { assert.equal(type, "abs"); return Math.abs(value); },
    penUp: () => { down = false; }, penDown: () => { down = true; },
    setPenSize: value => { size = value; }, setPenColor: () => {},
    setPenEffect: (name, value) => { hsv[name] = value; },
    moveTo: (x, y) => { if (down) strokes.push({ from: position, to: [x, y], hsv: {...hsv}, size }); position = [x, y]; },
    clearDrawing: () => { strokes.length = 0; }, hide: () => {},
    timerStart: () => {}, timerValue: () => time,
    wait: seconds => { waits.push(seconds); time += seconds; },
    warp: body => body(),
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(code, {...globals, exports, require: name => load(path.resolve(path.dirname(file), name + ".ts"))}, {filename:file});
    return exports;
  }
  return {
    ...load(path.join(root, "modules/pen-display/display.ts")),
    ...load(path.join(root, "modules/pen-display/framebuffer.ts")),
    ...load(path.join(root, "modules/pen-display/state.ts")),
    ...load(path.join(root, "modules/pen-display/fast.ts")),
    ...load(path.join(root, "modules/pen-display/config.ts")),
    ...load(path.join(root, "modules/pen-display/stats.ts")),
    ...load(path.join(root, "modules/pen-display/direct.ts")),
    ...load(path.join(root, "modules/pen-display/raster.ts")),
    vars, lists, strokes, waits, advance: seconds => { time += seconds; },
  };
}

test("RGB888, clipping, double buffers, dirty runs and black erasure", () => {
  const d = displayHarness();
  d.displayInit(4, 2, 2, -4, 2, 30);
  d.displayPixel(0, 0, d.rgb(255, 0, 0));
  d.displayFillRect(1, 0, 2, 1, d.rgb(0, 255, 0));
  d.displayPixel(3, 0, d.rgb(0, 0, 255));
  d.displayPixel(-1, 0, 123);
  d.displayPixel(4, 0, 123);
  assert.equal(d.rgb(-12, 999, 1.9), 65281);
  assert.equal(d.strokes.length, 0);
  assert.deepEqual(d.lists.__pd_front, Array(8).fill(-1));
  d.displayPresent();
  assert.deepEqual(d.lists.__pd_front, d.lists.__pd_back);
  assert.equal(d.vars.__pd_runs, 4);
  assert.equal(d.strokes.length, 8);
  assert.equal(d.strokes[0].hsv.hue, 0);
  assert.equal(d.strokes[2].hsv.hue, 120);
  assert.equal(d.strokes[4].hsv.hue, 240);
  assert.equal(d.strokes[6].hsv.brightness, 0);
  d.displayPresent();
  assert.equal(d.vars.__pd_runs, 0);
  assert.equal(d.strokes.length, 8);
  d.displayPixel(0, 0, 0);
  d.displayPresent();
  assert.equal(d.vars.__pd_runs, 1);
  assert.equal(d.strokes.at(-1).hsv.brightness, 0);
  assert.equal(d.displayGetPixel(0, 0), 0);
});

test("fast rectangle geometry covers tiny and large bounds, stays inside, and erases completely", () => {
  const d = displayHarness();
  for (const [w, h] of [[1,1],[1,9],[9,1],[2,2],[2,9],[9,2],[3,3],[3,9],[9,3],[5,8],[8,5],[28,28],[28,168],[168,28],[168,168]]) {
    d.displayInit(w, h, 1, 0, h, 60);
    d.displayFastInit();
    d.displayQueueRect(0, 0, w, h, d.rgb(255, 0, 0));
    d.displayPresentFast();
    const queued = JSON.stringify(d.strokes);
    for (const s of d.strokes) {
      for (const [x,y] of [s.from, s.to]) {
        assert.ok(x-s.size/2 >= 0 && x+s.size/2 <= w && y-s.size/2 >= 0 && y+s.size/2 <= h, `${w}x${h}: stroke outside bounds`);
      }
    }
    const covers = (s,x,y) => {
      const [ax,ay]=s.from, [bx,by]=s.to;
      const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2 || 1)));
      return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay)) < s.size/2;
    };
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      assert.ok(d.strokes.some(s=>covers(s,x+.5,y+.5)), `${w}x${h}: hole at ${x},${y}`);
    }
    if (w === 28 || h === 28) {
      // Subpixel samples detect gaps between the capsule and nested borders.
      for(let y=.5;y<h;y+=.5) for(let x=.5;x<w;x+=.5) {
        assert.ok(d.strokes.some(s=>covers(s,x,y)), `${w}x${h}: subpixel hole at ${x},${y}`);
      }
    }
    d.strokes.length=0;
    d.displayQueueRect(0,0,w,h,d.rgb(255,0,0));
    d.displayPresentFast();
    assert.equal(JSON.stringify(d.strokes),queued, "repeated drawing must agree");
    d.displayQueueRect(0,0,w,h,0);
    d.displayPresentFast();
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      assert.equal(d.strokes.findLast(s=>covers(s,x+.5,y+.5)).hsv.brightness,0,`${w}x${h}: erasure trail`);
    }
  }
});

test("resolution changes reset both buffers; flat-color runs merge per row", () => {
  const d = displayHarness();
  for (const [width, height] of [[32, 18], [64, 36], [128, 72]]) {
    d.displayInit(width, height, 1, 0, 0, 60);
    d.displayClear(d.rgb(32, 64, 128));
    d.displayPresent();
    assert.equal(d.lists.__pd_front.length, width * height);
    assert.equal(d.vars.__pd_runs, height);
    assert.equal(d.vars.__pd_changed, width * height);
    assert.equal(d.strokes.length, height);
    assert.ok(Math.abs(d.strokes[0].hsv.hue - 220) < 1e-9);
    assert.equal(d.strokes[0].hsv.saturation, 75);
  }
});

test("15/30/60 Hz deadlines include drawing time and do not catch up late frames", () => {
  const d = displayHarness();
  d.displayInit(1, 1, 1, 0, 0, 30);
  for (const fps of [15, 30, 60]) {
    d.displaySetRefreshRate(fps);
    d.displayWaitFrame();
    d.advance(0.004);
    d.displayWaitFrame();
    assert.ok(Math.abs(d.waits.at(-1) - (1 / fps - 0.004)) < 1e-9);
    d.advance(1);
    const count = d.waits.length;
    d.displayWaitFrame();
    assert.equal(d.waits.length, count);
  }
  d.displaySetRefreshRate(0);
  assert.equal(d.vars.__pd_fps, 1);
  d.displaySetRefreshRate(120);
  assert.equal(d.vars.__pd_fps, 60);
});

test("fast queue clips and preserves paint order, covers odd/even rectangles and drains once", () => {
  const d = displayHarness();
  d.displayInit(7, 6, 1, 0, 6, 60);
  d.displayFastInit();
  d.displayQueueRect(-1, -1, 4, 6, d.rgb(255, 0, 0));
  d.displayQueueRect(1, 1, 6, 2, d.rgb(0, 0, 255));
  d.displayQueueRect(4, 4, -2, 1, 123);
  assert.equal(d.strokes.length, 0);
  d.displayPresentFast();
  assert.equal(d.vars.__pd_runs, 2);
  assert.equal(d.lists.__pf_commands.length, 0);
  const sampled = (x, y) => {
    let hue = null;
    for (const s of d.strokes) {
      const [ax, ay] = s.from, [bx, by] = s.to;
      const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay)) / ((bx-ax)**2+(by-ay)**2 || 1)));
      if (Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay)) < s.size / 2 - 0.001) hue = s.hsv.hue;
    }
    return hue;
  };
  for (let y=0;y<6;y++) for(let x=0;x<7;x++) {
    const expected = x>=1 && y>=1 && y<3 ? 240 : x<3 && y<5 ? 0 : null;
    assert.equal(sampled(x+0.5, 6-y-0.5), expected, `pixel ${x},${y}`);
  }
  const count = d.strokes.length;
  d.displayPresentFast();
  assert.equal(d.strokes.length, count);
  assert.equal(d.vars.__pd_runs, 0);
});

test("fast setup allocates no framebuffer and FPS averages a quantized one-second window", () => {
  const d=displayHarness();
  d.displayConfigure(32,20,28,-448,280,60);
  d.displayFastInit();
  assert.equal(d.lists.__pd_back,undefined);
  assert.equal(d.lists.__pd_front,undefined);
  for(let tick=0;tick<20;tick++) {
    d.advance(.05);
    d.pdFrameFinished();
    if(tick%2===0)d.pdFrameFinished(); // 30 frames, repeated timer samples
  }
  assert.ok(Math.abs(d.vars.__pd_actual_fps-30)<1e-9);
  for(let tick=0;tick<20;tick++) { d.advance(.05); d.pdFrameFinished(); }
  assert.ok(Math.abs(d.vars.__pd_actual_fps-20)<1e-9);
});
