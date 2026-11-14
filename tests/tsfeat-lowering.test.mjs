import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { lowerTsFeatures } from "../ts/tsfeat-lowering.mjs";
import { lowerTsValues } from "../ts/tsfeat-values.mjs";
import { assertJsLogs } from "./ts-runtime.mjs";

function lower(text) {
  const input = ts.createSourceFile("features.nk.ts", text, ts.ScriptTarget.Latest, true);
  const output = lowerTsFeatures(input);
  return { input, output, text: ts.createPrinter().printFile(output) };
}

function run(text) {
  const result = lower(text);
  const logs = [];
  const javascript = ts.transpileModule(result.text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(javascript, {
    console: { log: (...args) => logs.push(args) },
    onStart: callback => callback(),
  });
  return { ...result, logs };
}

test("preserves top-level names and untouched node positions", () => {
  const { input, output, text } = lower("let score = 2;\nconsole.log(score);\nfunction add(n: number) { return n + score; }");
  assert.equal(output.statements[0], input.statements[0]);
  assert.equal(output.statements[1], input.statements[1]);
  assert.match(text, /function add\(/);
  assert.match(text, /let score = 2/);
  assert.equal(output.statements[0].getStart(output), 0);
});

test("gives lexical blocks, loop bindings, parameters and functions unique names", () => {
  const { logs, text } = run(`
    let value = 1;
    onStart(() => {
      let value = 2;
      { let value = 3; console.log(value); }
      console.log(value);
      for (let value = 0; value < 2; value++) console.log(value);
    });
    console.log(value);
  `);
  assert.deepEqual(logs, [[3], [2], [0], [1], [1]]);
  assert.match(text, /let value = 1/);
  assert.equal((text.match(/let __nekoc_ts_\d+_value/g) ?? []).length, 3);
});

test("lowers nested declarations, hoists calls and forwards immutable captures", () => {
  const { logs, text } = run(`
    function outer(n: number) {
      return helper(3);
      function helper(x: number) { return sibling(x) + n; }
      function sibling(x: number) { return x * 2; }
    }
    console.log(outer(4));
  `);
  assert.deepEqual(logs, [[10]]);
  const ast = ts.createSourceFile("out.ts", text, ts.ScriptTarget.Latest, true);
  let nested = false;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && !ts.isSourceFile(node.parent)) nested = true;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(nested, false);
});

test("function expressions, const aliases and multi-variable arrows become declarations", () => {
  const { logs, text } = run(`
    const twice = function named(n: number) { return n * 2; }, three = (n: number) => n * 3, x = 7;
    const alias = twice;
    console.log(alias(three(x)));
  `);
  assert.deepEqual(logs, [[42]]);
  assert.match(text, /function twice\(/);
  assert.match(text, /function three\(/);
  assert.doesNotMatch(text, /const alias/);
  assert.match(text, /const x = 7/);
});

test("copies assigned parameters without renaming shadowed locals or property keys", () => {
  const { logs, text } = run(`
    function change(n: number) {
      n += 2;
      { let n = 100; console.log(n); }
      n++;
      return { n, fixed: n }.n;
    }
    let n = 3;
    console.log(change(n), n);
  `);
  assert.deepEqual(logs, [[100], [6, 3]]);
  assert.match(text, /mutable_n/);
  assert.match(text, /n: __nekoc_ts_/);
});

test("copies assigned inline API callback parameters", () => {
  const { logs } = run(`
    [1, 2].forEach(n => { n += 2; console.log(n); });
  `);
  assert.deepEqual(logs, [[3], [4]]);
});

test("converts function-expression API callbacks to arrows", () => {
  const { logs, output } = run("onStart(function () { console.log(7); });");
  assert.deepEqual(logs, [[7]]);
  assert.equal(ts.isArrowFunction(output.statements[0].expression.arguments[0]), true);
});

test("uses different generated names in different imported files", () => {
  const text = "onStart(() => { let value = 1; console.log(value); });";
  const source = name => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const first = ts.createPrinter().printFile(lowerTsFeatures(source("first.ts")));
  const second = ts.createPrinter().printFile(lowerTsFeatures(source("second.ts")));
  assert.notEqual(first.match(/__nekoc_ts_\d+_value/)[0], second.match(/__nekoc_ts_\d+_value/)[0]);
});

test("retains export names and export modifiers", () => {
  const { text } = lower("export const value = (n: number) => n + 1; export function print() { let n = 1; console.log(n); }");
  assert.match(text, /export function value\(/);
  assert.match(text, /export function print\(/);
});

test("does not hoist variable-initialized functions across their TDZ", () => {
  assert.throws(() => lower("console.log(value(1)); const value = n => n + 1;"), /before its initializer.*hoisted function declaration/);
});

test("rebinds declarations changed by an earlier checker-backed lowering", () => {
  const input = ts.createSourceFile("features.nk.ts", "function f() { let x = 1; console.log(x); } f(); f();", ts.ScriptTarget.Latest, true);
  const output = lowerTsFeatures(lowerTsValues(input));
  const text = ts.createPrinter().printFile(output);
  assert.doesNotMatch(text, /console\.log\(x\)/);
  const locals = [...text.matchAll(/let (__nekoc_ts_\d+_x)/g)].map(match => match[1]);
  assert.equal(new Set(locals).size, 2);
});

test("clones inline statement call chains to avoid shared declaration registration", () => {
  const { logs, text } = run(`
    function inner(n: number) { n++; console.log(n); }
    function outer(n: number) { inner(n); }
    outer(1); outer(2);
  `);
  assert.deepEqual(logs, [[2], [3]]);
  const locals = [...text.matchAll(/let (__nekoc_ts_\d+_mutable_n)/g)].map(match => match[1]);
  assert.equal(new Set(locals).size, 2);
});

test("specializes static function arguments including forwarding and inline arrows", () => {
  const { logs, text } = run(`
    function apply(fn: (n: number) => number, n: number) { return fn(n); }
    function forward(fn: (n: number) => number, n: number) { return apply(fn, n); }
    function twice(n: number) { return n * 2; }
    console.log(apply(twice, 4));
    console.log(forward(twice, 5));
    console.log(apply(n => n + 1, 8));
    console.log(apply(function (n) { return n - 1; }, 8));
  `);
  assert.deepEqual(logs, [[8], [10], [9], [7]]);
  assert.match(text, /specialized/);
  assert.doesNotMatch(text, /return fn\(/);
});

test("specializations do not share local variable names", () => {
  const { logs, text } = run(`
    function apply(fn: (n: number) => number, n: number) { const value = fn(n); return value; }
    function twice(n: number) { return n * 2; }
    function triple(n: number) { return n * 3; }
    console.log(apply(twice, 4), apply(triple, 4));
  `);
  assert.deepEqual(logs, [[8, 12]]);
  const locals = [...text.matchAll(/const (__nekoc_ts_\d+_value)/g)].map(match => match[1]);
  assert.equal(new Set(locals).size, 2);
});

test("lowers generated IIFEs with global writes and immutable parameter captures", () => {
  const { logs, text } = run(`
    let a = 0;
    function calculate(n: number) { return (function () { a = 2; return a + n; })(); }
    console.log(calculate(3), a);
  `);
  assert.deepEqual(logs, [[5, 2]]);
  assert.doesNotMatch(text, /\(function/);
});

test("keeps array method callbacks, control flow, type declarations and optional parameters", () => {
  const { logs, text } = run(`
    type Fn = (n: number) => number;
    interface Box { value: number }
    function value(n?: number) { if (n === undefined) return 2; return n; }
    console.log([1, 2].map(n => n * 2).join(","), value());
  `);
  assert.deepEqual(logs, [["2,4", 2]]);
  assert.match(text, /\.map\(/);
  assert.match(text, /interface Box/);
  assert.match(text, /type Fn = \(n: number\) => number/);
  assert.match(text, /n\?: number/);
});

test("callback getText reflects renamed references while original ranges survive", () => {
  const { input, output } = lower("onStart(() => { let x = 1; console.log(x); });");
  const oldBody = input.statements[0].expression.arguments[0].body;
  const body = output.statements[0].expression.arguments[0].body;
  assert.match(body.getText(output), /__nekoc_ts_\d+_x/);
  assert.equal(body.pos, oldBody.pos);
  assert.equal(body.end, oldBody.end);
});

test("recursive scalar locals and assigned parameters use tsctrl per-call frames", () => {
  // The backend now stores these locals in each invocation's frame. Verify the
  // lowered JS and the actual VM, including a local read after a recursive call.
  for (const code of [
    "function sum(n: number): number { if (n <= 0) return 0; return n + sum(n - 1); } console.log(sum(4));",
    "function f(n: number): number { let x = n; if (n > 0) return f(n - 1) + x; return x; } console.log(f(4));",
    "function f(n: number): number { n--; if (n > 0) return f(n); return n; } console.log(f(4));",
  ]) {
    run(code);
    assertJsLogs(code);
  }
});

test("recursive captures, function slots and reentrant call cloning reject clearly", () => {
  for (const code of [
    "function outer(n: number) { function f(x: number) { if (x > 0) return f(x-1)+n; return n; } return f(2); }",
    "function f(fn: (n: number) => number, n: number) { n--; if (n > 0) return f(fn,n); return fn(n); }",
    "function f(n: number) { const local = n; if (n > 0) [n-1].forEach(next => f(next)); console.log(local); } f(2);",
  ]) assert.throws(() => lower(code), /Recursive.*iterative loop/);
});

test("rejects unsafe closures, dynamic function values and rest with alternatives", () => {
  for (const [code, message] of [
    ["function f(n: number) { return (() => { n = 2; return n; })(); }", /reassigned outer.*separate statement/],
    ["let fn = () => 1; fn = () => 2;", /Reassigning a function.*instead/],
    ["const fn = () => 1; const alias = fn; console.log(alias);", /runtime value.*instead/],
    ["function f(fn: (n: number) => number) { return fn(1); } f(flag ? a : b);", /statically known.*instead/],
    ["function f() { return () => 1; }", /stored or returned.*instead/],
    ["function f(...args: number[]) { return args.length; } f(1, 2);", /Rest parameters.*pass an array/],
    ["onStart((...args) => {});", /Rest parameters.*pass an array/],
    ["export function apply(fn: (n: number) => number, n: number) { return fn(n); }", /Exported higher-order.*instead/],
    ["function outer(xs: number[]) { return (() => xs[0])(); }", /Captured arrays.*top-level list/],
  ]) {
    assert.throws(() => lower(code), error => {
      assert.match(error.message, message);
      assert.equal(error.name, "CompileError");
      assert.equal(error.code, "NEKOC_TSFEAT");
      assert.equal(error.location.file, "features.nk.ts");
      assert.ok(error.location.line >= 1);
      return true;
    });
  }
});
