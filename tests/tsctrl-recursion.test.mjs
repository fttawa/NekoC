import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileFile } from "../ts/compile-ts.mjs";

const binary = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");

function execute(source) {
  mkdirSync(path.resolve("target"), { recursive: true });
  const directory = mkdtempSync(path.join(os.tmpdir(), "nekoc-tsctrl-recursion-"));
  try {
    const input = path.join(directory, "main.ts");
    const output = path.join(directory, "main.bcmkn");
    writeFileSync(input, source);
    const build = spawnSync(binary, ["build", input, "-o", output], { encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binary, ["run", output, "--ticks", "120"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout).variables;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("recursive functions preserve numeric locals after returning from child calls", () => {
  const variables = execute(`let result = 0;
function sum(n: number) {
  let saved = n;
  if (n <= 0) return 0;
  let child = sum(n - 1);
  return saved + child;
}
onStart(() => { result = sum(4); });`);
  assert.equal(variables["kn-var-result"], 10);
});

test("mutual recursion preserves list locals, lazy helper updates, and real globals", () => {
  const variables = execute(`let result = 0; let calls = 0;
function left(n: number) {
  let saved = [n];
  calls++;
  if (n <= 0) return 0;
  let child = right(n - 1);
  let answer = saved[0];
  return (true ? answer++ : 100) + answer + child;
}
function right(n: number) {
  let saved = n;
  calls++;
  if (n <= 0) return 0;
  let child = left(n - 1);
  return saved + child;
}
onStart(() => { result = left(3); });`);
  assert.equal(variables["kn-var-result"], 12);
  assert.equal(variables["kn-var-calls"], 4);
});

test("function implementation and captured helper parameter ids remain self-contained", () => {
  const report = compileFile("virtual/frames.ts", { readFile: () => `
function sum(n: number) { let saved = n; if (n <= 0) return saved; sum(n - 1); return true ? saved++ : saved; }
console.log(sum(4));` });
  assert.ok(report.procedures.some((procedure) => procedure.id.endsWith("-impl")));
  for (const procedure of report.procedures) {
    const blocks = Object.values(procedure.workspaceData.blocks);
    for (const parameter of procedure.params.filter((parameter) => parameter.type === "String")) {
      assert.equal(procedure.workspaceData.blocks[parameter.id].type, "procedures_2_stable_parameter");
    }
    for (const block of blocks.filter((block) => block.type === "procedures_2_parameter")) {
      assert.ok(procedure.params.some((parameter) => block.mutation.includes(`id="${parameter.id}"`)));
    }
    assert.ok(!blocks.some((block) => ["variables_get", "variables_set"].includes(block.type)
      && block.fields?.variable === "saved"));
  }
});

test("named-variable APIs inside procedures remain project globals", () => {
  const variables = execute(`let result = 0;
function recurse(n:number) {
  let saved=n;
  setVar("explicitGlobal", n);
  if(n<=0)return 0;
  let child=recurse(n-1);
  return saved+child;
}
onStart(()=>{result=recurse(3);});`);
  assert.equal(variables["kn-var-result"], 6);
  assert.equal(variables["kn-var-explicitGlobal"], 0);
});

test("inline loop callback locals belong to their enclosing invocation frame", () => {
  const variables = execute(`let result=0;
function f(n:number) {
  if(n===0)return 0;
  let total=0;
  repeatTimes(1,()=>{let saved=n; let child=f(n-1); total=saved+child;});
  return total;
}
onStart(()=>{result=f(4);});`);
  assert.equal(variables["kn-var-result"], 10);
});

test("for-of preserves known array procedure parameters", () => {
  const variables = execute(`let result=0;
function total(a:number[]) { let s=0; for(const x of a) s+=x; return s; }
onStart(()=>{result=total([1,2,3]);});`);
  assert.equal(variables["kn-var-result"], 6);
});

test("procedure string metadata cannot contaminate outer or sibling numeric bindings", () => {
  const variables = execute(`let result=0; let saved=10;
function unused(n:number) { let saved="hello"; if(n===0)return saved; return saved; }
function text(n:number) { let a="x"; if(n===0)return a; return a; }
function sum(n:number) { let a=n; if(n===0)return a; return a+sum(n-1); }
onStart(()=>{result=(saved+1)*100+sum(4);});`);
  assert.equal(variables["kn-var-result"], 1110);
});

test("numeric procedure locals clear shadowed outer string and array metadata", () => {
  const variables = execute(`let result=0; let saved="outside";
function f(n:number) { let saved=n; if(n===0)return saved+1; return saved+1; }
onStart(()=>{result=f(2);});`);
  assert.equal(variables["kn-var-result"], 3);
});

test("named variable APIs with lexical local collisions keep project-global identity", () => {
  const variables = execute(`let result=0; let saved=90; let read=0;
function f(n:number) {
  let saved=n;
  read=getVar("saved");
  setVar("saved",50);
  changeVar("saved",5);
  if(n===0)return saved;
  return true ? saved : 999;
}
onStart(()=>{result=f(2)*100+saved;});`);
  assert.equal(variables["kn-var-result"], 255);
  assert.equal(variables["kn-var-saved"], 55);
  assert.equal(variables["kn-var-read"], 90);
});

test("named handle APIs and lazy helpers preserve globals despite local collisions", () => {
  const variables = execute(`let result=0; let saved=90;
function f(n:number) {
  let saved=n;
  self.var("saved").set(40);
  self.var("saved").change(5);
  if(n===0)return saved;
  return saved*100+(true ? getVar("saved") : 0);
}
onStart(()=>{result=f(2);});`);
  assert.equal(variables["kn-var-result"], 245);
  assert.equal(variables["kn-var-saved"], 45);
});
