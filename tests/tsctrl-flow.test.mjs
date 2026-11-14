import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileFile } from "../ts/compile-ts.mjs";
import { assertJsLogs } from "./ts-runtime.mjs";

const bin = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");
const compile = source => compileFile("virtual/tsctrl-flow.ts", { readFile: () => source });
function execute(source) {
  mkdirSync(path.resolve("target"), { recursive: true });
  const dir = mkdtempSync(path.resolve("target/tsctrl-flow-"));
  try {
    const input = path.join(dir, "main.ts"), output = path.join(dir, "main.bcmkn");
    writeFileSync(input, source);
    const env = { ...process.env, NEKOC_FRONTEND: path.resolve("ts") };
    const build = spawnSync(bin, ["build", input, "-o", output], { encoding: "utf8", env });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(bin, ["run", output, "--ticks", "600"], { encoding: "utf8", env });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout).variables;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const vm = (name, source, expected) => test(name, { skip: !existsSync(bin) }, () => {
  const values = execute(source);
  for (const [name, value] of Object.entries(expected)) assert.deepEqual(values[`kn-var-${name}`], value, name);
});

test("tsctrl-flow: generic for shapes use live while conditions, not integer ranges", () => {
  for (const loop of [
    "for(let i=0; i<limit; i++) { limit--; }",
    "for(let i=0.25; i<1; i+=0.25) {}",
    "for(let i=0,j=3; i<j; i++,j--) {}",
    "for(; external<3; external+=2) {}",
    "for(;;) { break; }",
    "for(let i=0; i<3; i++) { i+=1; }",
    "for(let i=0; i<3; i+=step) {}",
  ]) {
    const blocks = Object.values(compile(`let limit=3; let external=0; let step=2; onStart(()=>{${loop}});`).workspaceData.blocks);
    assert.ok(blocks.some(b => ["repeat_forever_until", "repeat_forever"].includes(b.type)), loop);
    assert.ok(!blocks.some(b => b.type === "traverse_number"), loop);
  }
  const blocks = Object.values(compile("onStart(()=>{for(let i=0;i<3;i++)console.log(i);});").workspaceData.blocks);
  assert.ok(blocks.some(b => b.type === "traverse_number_value"));
});

vm("tsctrl-flow: dynamic bounds, fractional/multi-variable steps, mutable and external induction variables", `
let dynamic=0; let fractional=0; let multi=0; let mutable=0; let external=0; let endless=0; let limit=5; let step=0.25;
onStart(()=>{
  for(let d=0; d<limit; d++) { dynamic+=d; limit--; }
  for(let f=0.25; f<1; f+=step) fractional+=f;
  for(let m=0,n=5; m<n; m++,n-=2) multi+=m+n;
  for(let q=0; q<5; q++) { mutable+=q; q++; }
  for(external=1; external<4; external+=1.5) {}
  for(;;) { endless++; if(endless===3) break; }
});`, { dynamic: 3, fractional: 1.5, multi: 9, mutable: 6, external: 4, endless: 3 });

vm("tsctrl-flow: nested continue runs for increments and do/while tests", `
let total=0; let after=0; let count=0; let checks=0;
onStart(()=>{
  for(let i=0;i<5;i++) {
    if(i<4) { if(i===2) { continue; } total+=i; }
    after++;
  }
  do { count++; if(count<3) { if(count>0) continue; } checks++; } while(count<3);
});`, { total: 4, after: 4, count: 3, checks: 1 });

vm("tsctrl-flow: labeled break and continue unwind nested loops without stopping following code", `
let hits=0; let done=0; let continued=0;
onStart(()=>{
  outer: for(let i=0;i<4;i++) {
    for(let j=0;j<4;j++) { hits++; if(j===1) break outer; }
    hits+=100;
  }
  next: for(let a=0;a<3;a++) {
    for(let b=0;b<3;b++) { continued++; if(b===0) continue next; }
    continued+=100;
  }
  block: { done++; { break block; } done+=100; }
  done++;
});`, { hits: 2, done: 2, continued: 3 });

vm("tsctrl-flow: switch fallthrough, middle default, conditional break and loop continue", `
let trace=""; let calls=0; let end=0;
function pick() { calls++; return 2; }
onStart(()=>{
  switch(pick()) { case 1: trace+="bad"; default: trace+="D"; case 2: trace+="B"; case 3: trace+="C"; if(calls===1) break; trace+="bad"; }
  switch(9) { case 1: trace+="bad"; default: trace+="X"; case 2: trace+="Y"; }
  for(let i=0;i<3;i++) { switch(i) { case 0: continue; case 1: break; default: end+=10; } end++; }
});`, { trace: "BCXY", calls: 1, end: 12 });

vm("tsctrl-flow: array for-of evaluates once, supports nested continue and break", `
let trace=0; let sum=0; let a=[1,2,3];
onStart(()=>{
  for(const x of [1,2,3,4]) { if(x<3) { if(x===2) continue; } trace=trace*10+x; if(x===3) break; }
  for(const y of a) { sum+=y; }
});`, { trace: 13, sum: 6 });

test("tsctrl-flow: for-in keys and Unicode string iteration are never silently array iteration", () => {
  for (const source of [
    "onStart(()=>{for(const k in [10,20])console.log(k);});",
    'let s="abc"; onStart(()=>{for(const c of s)console.log(c);});',
  ]) assert.throws(() => compile(source), /for\.\.\.in|strings|known array/);
});

vm("tsctrl-flow: literal string for-of yields Unicode code points", `
let out="";
onStart(()=>{for(const ch of "a😀b") out=ch+out;});`, { out: "b😀a" });

vm("tsctrl-flow: multiplicative steps and nonlinear conditions use general for", `
let product=0; let nonlinear=0; let fractions=0;
onStart(()=>{
  for(let p=1;p<10;p*=2) product+=p;
  for(let q=0;q*q<50;q++) nonlinear+=q;
  for(let r=0.5;r<3;r++) fractions+=r;
});`, { product: 15, nonlinear: 28, fractions: 4.5 });

test("tsctrl-flow: uniquely named loop bindings preserve shadowed parameters and ranges", () => {
  // tsfeat unique names remove the old runtime-name collisions.
  for (const source of [
    "function f(n:number) { if(n<0)return 0; for(let n=0;n<3;n++)console.log(n); return n; } console.log(f(1));",
    "function f(n:number) { if(n<0)return 0; for(const n of [1,2])console.log(n); return n; } console.log(f(1));",
    "onStart(()=>{for(let i=0;i<3;i++){for(const i of [1,2])console.log(i);}});",
    "let limit=3; onStart(()=>{for(let i=0;i<limit;i++){let i=7;console.log(i);}});",
    "let limit=3; onStart(()=>{for(let i=0;i<limit;i++){for(let i=0;i<limit;i++)console.log(i);}});",
  ]) assertJsLogs(source);
});

test("tsctrl-flow: comma for headers execute in order and continue runs every increment", () => {
  assertJsLogs(`let i=0; let j=0; let trace="";
    onStart(()=>{for(i=1,j=5;i<j;i++,j-=2){trace+=i+":"+j+";";continue;}console.log(trace);console.log(i);console.log(j);});`);
  // A test comma needs repeated evaluation; it must never be hoisted once.
  assert.throws(() => compile("let i=0; onStart(()=>{for(;(i++,i<3);)console.log(i);});"), /Comma expressions.*repeated evaluation/);
});

vm("tsctrl-flow: disjoint general loops and repeated inline calls have distinct storage", `
let out=0; let limit=3;
function accumulate() { for(let i=0;i<limit;i++) out+=i; }
onStart(()=>{
  accumulate(); accumulate();
  for(let i=0;i<limit;i++) out+=i*10;
  for(let i=0;i<limit;i++) out+=i*100;
});`, { out: 336 });

vm("tsctrl-flow: renamed loop references retain preprocessed callback helpers", `
let out=0; let limit=2;
onStart(()=>{
  for(let i=0;i<limit;i++) {
    let values=[1,2].map(x=>x*2);
    out+=values[0]+i;
  }
});`, { out: 5 });

vm("tsctrl-flow: general loop renaming preserves object property keys", `
let out=0; let limit=3;
onStart(()=>{
  for(let i=0;i<limit;i++) {
    let named={i:i}; let shorthand={i};
    out+=named.i+shorthand.i;
  }
});`, { out: 6 });

vm("tsctrl-flow: switch exits and try completion preserve their surrounding loops", `
let total=0; let loops=0; let after=0;
onStart(()=>{
  for(let i=0;i<4;i++) {
    try { if(i===1)continue; if(i===3)break; total+=i; } catch(e) { total+=100; }
    after++;
  }
  switch(2) {
    case 1: total+=100; break;
    case 2: for(let j=0;j<3;j++){loops++;if(j===1)break;} total+=3; break;
    default: total+=100;
  }
  after++;
});`, { total: 5, loops: 2, after: 3 });

vm("tsctrl-flow: nested loop throw reaches local catch and skips all remaining try statements", `
let caught=0; let tail=0; let finished=0;
onStart(()=>{
  try { for(let i=0;i<3;i++) { while(true) { if(i===0) throw 7; tail+=100; } tail+=100; } tail+=100; }
  catch(e) { caught=e; }
  // Catch bindings are any; + on them needs a declared numeric type.
  try { try { throw 2; } catch(inner) { throw (inner as number)+3; } tail+=100; } catch(outer) { caught+=outer as number; }
  finished++;
});`, { caught: 12, tail: 0, finished: 1 });

test("tsctrl-flow: unsupported exception completion emits a diagnostic, never stop", () => {
  assert.throws(() => compile("onStart(()=>{throw 9;});"), /throw requires.*try\/catch/);
  assert.throws(() => compile("onStart(()=>{try{throw 9;}finally{console.log(1);}});"), /try\/finally/);
  const report = compile("onStart(()=>{try{while(true){throw 9;}}catch(e){console.log(e);}});");
  assert.ok(!Object.values(report.workspaceData.blocks).some(b => b.type === "stop"));
});

vm("tsctrl-flow: callback loops retain loopDepth/range helper compatibility", `
let total=0; let count=0;
onStart(()=>{
  repeatTimes(4,()=>{ count++; if(count===2) { continue; } total+=count; });
  forRange("r",1,3,1,()=>{ total+=1; });
  forever(()=>{ count++; break; });
});`, { total: 11, count: 5 });
