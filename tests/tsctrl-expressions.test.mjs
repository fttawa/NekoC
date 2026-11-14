import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileFile } from "../ts/compile-ts.mjs";

const bin = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");
function execute(source) {
  mkdirSync(path.resolve("target"), { recursive: true });
  const dir = mkdtempSync(path.resolve("target/tsctrl-expr-"));
  try {
    const input = path.join(dir, "main.ts");
    const output = path.join(dir, "main.bcmkn");
    writeFileSync(input, source);
    for (const args of [["build", input, "-o", output], ["run", output, "--ticks", "120"]]) {
      const result = spawnSync(bin, args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      if (args[0] === "run") return JSON.parse(result.stdout).variables;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("tsctrl: &&, || and ternary select exactly one lazy operand and preserve its value", () => {
  const v = execute(`let calls = 0;
function bump(x: number) { calls += x; return x; }
let a = 0; let b = 0; let c = 0; let d = 0; let e = 0;
onStart(() => {
  a = 0 && bump(1);
  b = 3 || bump(2);
  c = true ? bump(5) : bump(10);
  d = 1 && (false ? bump(20) : bump(7));
  e = false || bump(4);
});`);
  for (const [name, expected] of Object.entries({ a: 0, b: 3, c: 5, d: 7, e: 4, calls: 16 })) {
    assert.equal(v[`kn-var-${name}`], expected, name);
  }
});

test("tsctrl: prefix/postfix updates are reporter procedures, not statement blocks in value slots", () => {
  const v = execute(`let a = 1; let postfix = 0; let prefix = 0; let order = 0; let down = 0;
onStart(() => { postfix = a++; prefix = ++a; order = a++ * 10 + ++a; down = a-- * 10 + --a; });`);
  for (const [name, expected] of Object.entries({ a: 3, postfix: 1, prefix: 3, order: 35, down: 53 })) {
    assert.equal(v[`kn-var-${name}`], expected, name);
  }
});

test("tsctrl: lazy branches retain procedure parameters and read mutable state only when selected", () => {
  const v = execute(`let n = 1; let result = 0;
function choose(x: number) { if (x < 0) return 0; return x && (true ? n++ + x : 100); }
onStart(() => { result = choose(3); });`);
  assert.equal(v["kn-var-result"], 4);
  assert.equal(v["kn-var-n"], 2);
});

test("tsctrl: nullish coalescing does not treat zero, false or empty string as nullish", () => {
  const v = execute('let a = 0; let b = true; let c = "x"; onStart(() => { a = 0 ?? 7; b = false ?? true; c = "" ?? "bad"; });');
  assert.equal(v["kn-var-a"], 0);
  assert.equal(v["kn-var-b"], false);
  assert.equal(v["kn-var-c"], "");
});

test("tsctrl: unsupported nullable operands and property update values fail at compile time", () => {
  for (const [source, error] of [
    ["let a = [1]; console.log(a[8] ?? 7);", /nullable values are not supported/],
    ["let a = 0; a = unknown(); console.log(a ?? 7);", /Unsupported|nullable values/],
    // Element updates hit the shared object/element ++/-- diagnostic first.
    ["let a = [1]; console.log(a[0]++);", /Value-producing|Object\/element \+\+\/-- update values are not supported/],
    ["function f(n: number) { return n++; } console.log(f(2));", /Value-producing/],
  ]) {
    assert.throws(() => compileFile("virtual/tsctrl.ts", { readFile: () => source }), error);
  }
});

test("tsctrl: nullish coalescing proves primitive variable assignments without truthiness", () => {
  const v = execute('let out=1; onStart(()=>{let a=0; a=0; out=a ?? 7;});');
  assert.equal(v["kn-var-out"], 0);
  assert.throws(() => compileFile("virtual/nullable.ts", { readFile: () =>
    'let a=0; onStart(()=>{a=[1][9]; console.log(a ?? 7);});' }), /nullable values/);
});

test("tsctrl: generated expression helpers have editor-compatible parameter identities", () => {
  const report = compileFile("virtual/tsctrl.ts", { readFile: () => "let a = 1; console.log(a++ || (a ? 2 : 3));" });
  assert.ok(report.procedures.length >= 2);
  for (const proc of report.procedures) {
    const blocks = Object.values(proc.workspaceData.blocks);
    for (const param of proc.params.filter((p) => p.type === "String")) {
      assert.equal(proc.workspaceData.blocks[param.id].type, "procedures_2_stable_parameter");
    }
    for (const block of blocks.filter((b) => b.type === "procedures_2_parameter")) {
      assert.ok(proc.params.some((p) => block.mutation.includes(`id="${p.id}"`)));
    }
    assert.ok(blocks.some((b) => b.type === "procedures_2_return_value" && b.mutation.includes('items="1"')));
  }
});

test("tsctrl: inline arguments evaluate once before lazy bodies, including unused parameters", () => {
  const v = execute(`let repeated=0; let unused=0; let short=0; let order=0; let state=0;
function twice(x:number) { return x && x; }
function ignored(x:number) { return 7; }
function right(x:number) { return 0 && x; }
function pair(x:number,y:number) { return x*10+y; }
onStart(()=>{
  let a=1; repeated=twice(a++)*10+a;
  let b=0; unused=ignored(b++)*10+b;
  let c=0; short=right(c++)*10+c;
  let d=1; order=pair(d++,d++)*10+d;
});`);
  assert.equal(v["kn-var-repeated"], 12);
  assert.equal(v["kn-var-unused"], 71);
  assert.equal(v["kn-var-short"], 1);
  assert.equal(v["kn-var-order"], 123);
});

test("tsctrl: effectful inline local initializers execute once even if unused", () => {
  const v = execute(`let result=0; let hits=0;
function next() { hits++; return hits; }
function f(x:number) { let unused=next(); let saved=next(); return saved+saved+x; }
onStart(()=>{result=f(1);});`);
  assert.equal(v["kn-var-result"], 5);
  assert.equal(v["kn-var-hits"], 2);
});

test("tsctrl: inline arguments snapshot reads before a body mutates their source", () => {
  const v = execute(`let result=0; let a=1;
function bump(){a++;return 10;}
function f(x:number){let saved=x;return bump()+saved+x;}
onStart(()=>{result=f(a);});`);
  assert.equal(v["kn-var-result"], 12);
  assert.equal(v["kn-var-a"], 2);
});

test("tsctrl: statement calls evaluate explicit and default effectful arguments once", () => {
  for (const argument of ["a++", "next()", ""]) {
    const v = execute(`let a=0; let result=0;
function next(){a++;return a;}
function f(x:number=next()){result=x*10+x;}
onStart(()=>{f(${argument});});`);
    assert.equal(v["kn-var-result"], argument === "a++" ? 0 : 11);
    assert.equal(v["kn-var-a"], 1);
  }
});

test("tsctrl: statement arguments snapshot reads and execute unused array methods in order", () => {
  const v = execute(`let a=[1,2,3]; let source=1; let repeated=0; let snapshot=0; let order=0;
function twice(x:number){repeated=x*10+x;}
function ignored(x:number){source++;}
function read(x:number){source++;snapshot=x;}
function pair(x:number,y:number){order=x*10+y;}
onStart(()=>{twice(a.pop());ignored(a.pop());read(source);pair(source++,source++);});`);
  assert.equal(v["kn-var-repeated"], 33);
  assert.equal(v["kn-var-snapshot"], 2);
  assert.equal(v["kn-var-order"], 34);
  assert.equal(v["kn-var-source"], 5);
  assert.deepEqual(v["kn-var-a"], [1]);
});

test("tsctrl: Math.max/min/trunc and boolean-to-number evaluate operands once without logic_ternary", () => {
  const source = `let n=0; let b=true; let r1=0; let r2=0; let r3=0; let r4=0; let r5=0;
function next(){n++;return n;}
onStart(()=>{r1=Math.max(next(),3,next()); r2=Math.min(4,next(),5); r3=Math.trunc(-2.5-next()); r4=Number(b)+1; r5=Math.trunc(7.9);});`;
  const report = compileFile("virtual/tsctrl-choice.ts", { readFile: () => source });
  const blocks = [report.workspaceData, ...report.procedures.map(p => p.workspaceData)]
    .flatMap(workspace => Object.values(workspace.blocks));
  assert.ok(!blocks.some(block => block.type === "logic_ternary"));
  const v = execute(source);
  assert.deepEqual([v["kn-var-r1"], v["kn-var-r2"], v["kn-var-r3"], v["kn-var-r4"], v["kn-var-r5"], v["kn-var-n"]], [3, 3, -6, 2, 7, 4]);
});

test("tsctrl: caller-safe defaults keep JS values and evaluate once", () => {
  const v = execute(`let n=0; let a=5; let r1=0; let r2=0; let r3=0; let r4=0; let r5="";
function bump(){n+=1;return n;}
function f(b:number=bump()){return b+b;}
function g(b:number=a){return b;}
function h(b:number=0||7){return b;}
function k(b:number=0??7){return b;}
function s(b:string="a"+1){return b;}
onStart(()=>{r1=f(); r2=g(); r3=h(); r4=k(); r5=s();});`);
  assert.equal(v["kn-var-r1"], 2);
  assert.equal(v["kn-var-n"], 1);
  assert.equal(v["kn-var-r2"], 5);
  assert.equal(v["kn-var-r3"], 7);
  assert.equal(v["kn-var-r4"], 0);
  assert.equal(v["kn-var-r5"], "a1");
});

test("tsctrl: nested statement wrappers freeze method and default arguments", () => {
  const v = execute(`let a=[1,2]; let result=0;
function next(){return a.pop();}
function f(x:number=next()){result=x*10+x;}
function outer(y:number){f(y);}
function empty(x:number){}
onStart(()=>{outer(next());f();a.push(3);empty(next());});`);
  assert.equal(v["kn-var-result"], 11);
  assert.deepEqual(v["kn-var-a"], []);
});

test("tsctrl: evaluated inline locals preserve literal names without dropping other effects", () => {
  const v = execute(`let result=0; let hits=0;
function next(){hits++;return hits;}
function f(){let unused=next();let name="named";let alias=name;return getVar(alias);}
onStart(()=>{setVar("named",42);result=f();});`);
  assert.equal(v["kn-var-result"], 42);
  assert.equal(v["kn-var-hits"], 1);
  assert.doesNotThrow(() => compileFile("virtual/local-name.ts", { readFile: () =>
    'function f(){let name="named";return getVar(name);} onStart(()=>{console.log(f());});' }));
  const list = execute(`let result=0;
function f(){let name="values";return listItem(name,"any",1);}
onStart(()=>{appendList("values",42);result=f();});`);
  assert.equal(list["kn-var-result"], 42);
});

test("tsctrl: evaluated inline calls retain literal names through outer parameter bindings", () => {
  const v = execute(`let result=0;
function read(name:string){return getVar(name);}
function outer(name:string){result=read(name);}
onStart(()=>{setVar("named",42);outer("named");});`);
  assert.equal(v["kn-var-result"], 42);
});
