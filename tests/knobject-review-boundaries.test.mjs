import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileFile, checkFile, CompileError } from "../ts/compile-ts.mjs";

const entry = path.resolve("virtual/knobject-review/main.ts");
function compile(source, files = {}) {
  const all = new Map([[entry, source], ...Object.entries(files).map(([name, text]) => [path.resolve(path.dirname(entry), name), text])]);
  const host = {readFile: name => all.get(path.resolve(name))};
  return {host, result: () => compileFile(entry, host)};
}
const cases = [
  [4, "concurrent starts", `function f(n:number){const box={x:n};wait(.05);console.log(box.x);}onStart(()=>f(1));onStart(()=>f(2));`, /local state.*yield/],
  [4, "event indirect yield", `const seed={x:1};function pause(){wait(.05);}function f(){const box={x:1};pause();console.log(box.x);}onKeyPress("a",()=>f());`, /local state.*yield/],
  [4, "timer callback yield", `function f(){const box={x:1};[1].forEach(()=>{wait(.05);});console.log(box.x);}setInterval(()=>f(),20);`, /local state.*yield/],
  [4, "timed member API", `function f(){const box={x:1};self.glideChangeX(.05,1);console.log(box.x);}onStart(()=>f());`, /local state.*yield/],
  [5, "array alias", `const a=[{x:7}];const b:unknown[]=a;console.log(String(b[0]));`, /shape.*recursively/],
  [5, "nested alias", `const a={child:{x:7}};const b:{child:unknown}=a;console.log(String(b.child));`, /shape.*recursively/],
  [5, "context arrow", `const make:()=>unknown=()=>({x:7});console.log(String(make()));`, /shape.*recursively/],
  [5, "context block arrow", `const make:()=>unknown=()=>{return {x:7};};console.log(String(make()));`, /shape.*recursively/],
  [5, "array push", `const a:unknown[]=[];a.push({x:7});console.log(String(a[0]));`, /shape.*recursively/],
  [5, "nested assertion", `const a={child:{x:7}};const b=a as {child:unknown};console.log(String(b.child));`, /shape.*recursively/],
  [5, "generic erasure", `function erase<T>(v:T):unknown{return v;}console.log(String(erase({x:7})));`, /shape|[Gg]eneric/],
  [5, "generic array coercion", `function show<T>(v:T[]){return v.join(",");}console.log(show([{x:7}]));`, /shape|[Gg]eneric/],
  [5, "callback parameter erasure", `const a=[{x:7}];a.forEach((v:unknown)=>console.log(String(v)));`, /shape.*recursively/],
  [6, "pop typed string", `const a=[{s:"a"}];const b=a.pop();b.s+=2;console.log(b.s);`, /pop.*missing/],
  [6, "shift", `const a=[{x:1}];console.log(a.shift().x);`, /missing/],
  [6, "find missing", `const a=[{x:1}];console.log(a.find((v:{x:number})=>false).x);`, /missing/],
  [6, "map coercion", `const a=[{x:7}];console.log(String(a.map((v:{x:number})=>v)[0]));`, /coercion/],
  [6, "filter missing field", `const a=[{x:7}];console.log(a.filter((v:{x:number})=>true)[0].missing);`, /present|initialized/],
  [7, "forged read", `const fake=1 as unknown as {x:number};const real={x:7};console.log(fake.x);`, /shape.*recursively/],
  [7, "forged write", `const fake=1 as unknown as {x:number};const real={x:7};fake.x=9;`, /shape.*recursively/],
  [7, "generic forge", `function cast<T>(v:T){return v as {x:number};}const real={x:7};console.log(cast(1).x);`, /shape.*recursively/],
  [7, "uninitialized", `let a:{x:number};const real={x:7};console.log(a.x);`, /initialized at declaration|Reading a null\/undefined variable/],
  [7, "missing return", `function get():{x:number}{if(false)return {x:1};}const real={x:7};console.log(get().x);`, /every path/],
  [7, "throw initialization", `function fail(){throw 1;return 2;}try{const a={x:fail()};}catch(e){}const b={x:7};console.log(b.x);`, /Throw.*explicit scalar status/],
  [8, "String array", `const a=[{x:7}];console.log(String(a));`, /coercion/],
  [8, "log nested array", `const a=[[{x:7}]];console.log(a);`, /coercion/],
  [8, "template array", 'const a=[{x:7}];console.log(`${a}`);', /coercion/],
  [10, "typed reduce", `const a=[{x:1}];const b=a.reduce((acc:{x:number},item:{x:number})=>{acc.x+=item.x;return acc;},{x:0});console.log(b.x);`, /reduce.*explicit for loop/],
];
for (const [item, name, source, message] of cases) test(`review ${item}: ${name} rejected at user source`, () => {
  const {host, result} = compile(source);
  assert.throws(result, error => {
    assert.ok(error instanceof CompileError);
    assert.match(error.message, message);
    assert.equal(path.resolve(error.location.file), entry);
    return true;
  });
  const checked = checkFile(entry, {host, types: false});
  assert.equal(checked.ok, false);
  assert.match(checked.diagnostics[0].message, message);
});

test("review 4: imported yielding call graph rejects shared locals", () => {
  const {result} = compile(`import {pause} from "./helper";function f(){const a={x:1};pause();console.log(a.x);}onStart(()=>f());`, {"helper.ts":"export function pause(){wait(.05);}"});
  assert.throws(result, /local state.*yield/);
});

test("review 6: typed map/filter/slice preserve initialized scalar properties", () => {
  const {result} = compile(`const a=[{s:"a",x:1}];const b=a.map((v:{s:string,x:number})=>v).filter((v:{s:string,x:number})=>true).slice();b[0].s+=2;console.log(b[0].s);console.log(b[0]===a[0]);`);
  assert.ok(result());
});
