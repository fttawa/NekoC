import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { lowerTsValues } from "../ts/tsfeat-values.mjs";
import { lowerTsSequences } from "../ts/tsfeat-sequences.mjs";
import { compileFile, checkFile } from "../ts/compile-ts.mjs";
import path from "node:path";

const parse = source => ts.createSourceFile("values.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const print = source => ts.createPrinter().printFile(source);
const run = source => new Function(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)();

for (const [name, source] of [
  ["null comparison", "let a = null; return String(a === null);"],
  ["undefined initialization", "let a; return String(a === undefined);"],
  ["null versus undefined", "let a = null; return [a === undefined, a == undefined, a !== undefined].join(',');"],
  ["null versus concrete", "let a = null; return [a === 0, a == 0, a != '', a === 'null'].join(',');"],
  ["typeof primitive", "let a = 1; return typeof a;"],
  ["typeof missing binding", "return typeof missing;"],
  ["typeof nullish", "let a; let b = null; return typeof a + ',' + typeof b;"],
]) test(`tsfeat values: ${name}`, () => {
  assert.equal(run(print(lowerTsValues(parse(source)))), run(source));
});

for (const source of [
  "let a = null; console.log(a);", "let a; console.log(a);", "let a; a = 3; console.log(a);",
  "let a = 1; a = 's'; console.log(typeof a);", "const a = [1, 2]; delete a[0];",
  "const p = { x: 1 }; console.log(delete p.x);",
]) test(`tsfeat values: explicit rejection ${source}`, () => {
  assert.throws(() => lowerTsValues(parse(source)), /flag|initialize|splice/);
});

for (const source of [
  "let a=0,b=0; a=b=3; return a+b;",
  "let a=0; let b=(a=2,a+3); return b;",
  "let a=0; function inc(){a+=1;return a;} let b=(inc()+inc(), a+3); return a*10+b;",
  "let a=0,b=0; const c=(a=b=3); return a+b+c;",
]) test(`tsfeat sequence JS semantics: ${source}`, () => {
  assert.equal(run(print(lowerTsSequences(parse(source)))), run(source));
  assert.ok(compileFile("values.ts", { readFile: () => source.replace(/return ([^;]+);$/, "console.log($1);") }).summary.blocks > 0);
});

test("tsfeat imported wrappers retain lifted module-private helpers", () => {
  const files = new Map([
    [path.resolve("main.ts"), 'import { f } from "./module"; console.log(f("abcdef"));'],
    [path.resolve("module.ts"), 'export function f(s: string) { function tail(t: string) { return t.slice(-3, -1); } return tail(s); }'],
  ]);
  assert.ok(compileFile("main.ts", { readFile: name => files.get(name) }).summary.blocks > 0);
});

test("undefined call arguments remain omitted through transparent wrappers", () => {
  for (const argument of ["undefined", "(undefined)", "((undefined))", "undefined as number", "undefined!", "undefined satisfies undefined"]) {
    const source = `function f(a = 7) { return a; } console.log(f(${argument}));`;
    assert.ok(compileFile("values.ts", { readFile: () => source }).summary.blocks > 0, argument);
  }
  assert.throws(() => lowerTsValues(parse("console.log((undefined) + 1);")), /null\/undefined values/);
});

test("tsfeat variable bitwise and rest arguments remain actionable diagnostics", () => {
  for (const [source, pattern] of [
    ["let n=3; console.log(n & 1);", /constant operands|bounded arithmetic/],
    ["let n=3; console.log(~n);", /constant operands|bounded arithmetic/],
    ["function sum(...args) { return args.length; } console.log(sum(1,2));", /pass an array/],
    ["let a=[1,2]; delete a[0];", /hole.*splice/],
    ["let a=1; let b=(a++,a);", /split the update/],
  ]) {
    const result = checkFile("values.ts", { types: false, host: { readFile: () => source } });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, pattern);
  }
});

test("tsfeat review: conditional initialization and specialized recursive locals fail closed", () => {
  for (const [source, pattern] of [
    ['function f(flag) { if(flag) { var x=1; } console.log(typeof x); } f(false);', /typeof requires/],
    // Untyped parameters are any, so + is rejected before recursion is planned;
    // typed specialized recursion keeps per-call locals (tsctrl frames).
    ['function apply(fn,n) { const x=n; if(n>0) return fn(n-1)+x; return x; } function f(n) { return apply(f,n); } console.log(f(3));', /Cannot determine JavaScript +/],
    ['function outer(n) { const x=n; const inner=(y=x)=>y; console.log(inner()); } outer(7);', /pass that value explicitly/],
  ]) assert.throws(() => compileFile("review.ts", { readFile: () => source }), pattern);
});

test("tsfeat review: nested return does not disable statement-call cloning", () => {
  const source = 'function outer(n) { const x=n; function inner(){return x;} console.log(inner()); } outer(1); outer(2);';
  assert.ok(compileFile("review.ts", { readFile: () => source }).summary.blocks > 0);
});

test("tsfeat review: string slice helpers are unique across imports", () => {
  const files = new Map([
    [path.resolve("main.ts"), 'import { a } from "./a"; import { b } from "./b"; console.log(a("abc")); console.log(b("abc"));'],
    [path.resolve("a.ts"), 'export function a(s: string) { return s.slice(-1); }'],
    [path.resolve("b.ts"), 'export function b(s: string) { return s.slice(-2); }'],
  ]);
  assert.ok(compileFile("main.ts", { readFile: name => files.get(name) }).summary.blocks > 0);
});
