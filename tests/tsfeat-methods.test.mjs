import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import { compileFile } from "../ts/compile-ts.mjs";
import { lowerTsMethods } from "../ts/tsfeat-methods.mjs";

function lower(source) {
  const result = lowerTsMethods(ts.createSourceFile("methods.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  assert.deepEqual(result.parseDiagnostics, []);
  return result;
}

function compile(source) {
  const result = lower(source);
  const report = compileFile("methods.ts", {
    readFile: name => name === path.resolve("methods.ts") ? result.text : undefined,
  });
  return { result, report };
}

function run(source) {
  const { result } = compile(source);
  const logs = [];
  // Mirror KN's 1-based, inclusive, reversing text_select, not JS slice.
  const selectText = (text, start, end) => {
    start = Math.floor(start); end = Math.floor(end);
    return start <= end - 1 ? text.slice(Math.max(0, start - 1), end)
      : text.slice(Math.max(0, end - 1), start).split("").reverse().join("");
  };
  const js = ts.transpileModule(result.text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { console: { log: (...values) => logs.push(...values) }, onStart: fn => fn(), selectText, length: text => text.length });
  return logs;
}

test("no-op lowering preserves SourceFile identity and changed calls preserve unrelated lines", () => {
  const original = ts.createSourceFile("methods.ts", "onStart(() => {\n  console.log(unknownName);\n});", ts.ScriptTarget.Latest, true);
  assert.equal(lowerTsMethods(original), original);
  const changed = lower('console.log((2).toFixed(1));\nconsole.log(unknownName);');
  assert.equal(changed.getLineAndCharacterOfPosition(changed.text.indexOf("unknownName")).line, 1);
  const helper = lower('function f(s: string) { return s.slice(-1); }\nconsole.log(unknownName);');
  assert.equal(helper.getLineAndCharacterOfPosition(helper.text.indexOf("unknownName")).line, 1);
  assert.ok(helper.text.indexOf("function __tsfeatMethods") > helper.text.indexOf("unknownName"));
  const multiline = lower('console.log((2).toFixed(\n  1\n));\nconsole.log(unknownName);');
  assert.equal(multiline.getLineAndCharacterOfPosition(multiline.text.indexOf("unknownName")).line, 3);
});

test("method lowering folds JS formatting, numeric radices and rounding edge cases exactly", () => {
  const source = `onStart(() => {
    console.log((1.005).toFixed(2));
    console.log((2.675).toFixed(2));
    console.log((-0).toFixed(3));
    console.log((1e21).toFixed(2));
    console.log((255).toString(16));
    console.log((10.5).toString(2));
    console.log((NaN).toFixed(2));
    console.log((Infinity).toString());
  });`;
  assert.deepEqual(run(source), ["1.00", "2.67", "0.000", "1e+21", "ff", "1010.1", "NaN", "Infinity"]);
  const { report } = compile(source);
  assert.ok(Object.values(report.workspaceData.blocks).some(block => block.type === "text" && block.fields.TEXT === "1.00"));
});

test("typed specialized recursion keeps per-call locals", () => {
  assert.deepEqual(run(`function apply(fn: (n: number) => number, n: number): number { const x = n; if (n > 0) return fn(n - 1) + x; return x; }
    function f(n: number): number { return apply(f, n); }
    onStart(() => { console.log(f(3)); });`), [6]);
});

test("dynamic numeric decimal toString compiles through convert_type and evaluates its receiver once", () => {
  const source = `let count = 0;
    function next(): number { count++; return count; }
    function format(n: number): string { return n.toString(10); }
    onStart(() => { console.log(format(next())); console.log(count); });`;
  assert.deepEqual(run(source), ["1", 1]);
  const report = compile(source).report;
  assert.ok([report.workspaceData, ...report.procedures.map(procedure => procedure.workspaceData)]
    .some(workspace => Object.values(workspace.blocks).some(block => block.type === "convert_type" && block.fields.type === "string")));
});

test("isNaN and Number.isNaN constant folding keeps coercing and noncoercing semantics distinct", () => {
  assert.deepEqual(run(`onStart(() => {
    console.log(isNaN("no")); console.log(Number.isNaN("no"));
    console.log(isNaN("")); console.log(isNaN(true));
    console.log(isNaN(["x"])); console.log(Number.isNaN(["x"]));
    console.log(isNaN()); console.log(Number.isNaN());
    console.log(isNaN(undefined)); console.log(Number.isNaN(NaN));
  });`), [true, false, false, false, true, false, true, false, true, true]);
});

test("UTF-16 constants fold code units, wrapping, surrogate pairs and empty constructors", () => {
  assert.deepEqual(run(`onStart(() => {
    console.log("😀".charCodeAt(0)); console.log("😀".charCodeAt(1));
    console.log("AB".charCodeAt()); console.log("AB".charCodeAt(1.9));
    console.log("".charCodeAt(0));
    console.log(String.fromCharCode(65, 65536 + 66, -1));
    console.log(String.fromCharCode(0xd83d, 0xde00)); console.log(String.fromCharCode());
  });`), [0xd83d, 0xde00, 65, 66, NaN, "AB\uffff", "😀", ""]);
});

test("constant string at and slice follow JS negative, fractional and reversed-index behavior", () => {
  assert.deepEqual(run(`onStart(() => {
    console.log("abc".at(-1)); console.log("abc".at(-2.9));
    console.log("abcdef".slice(-4, -1)); console.log("abc".slice(2, 1));
    console.log("abc".slice(-99)); console.log("abc".slice(NaN, Infinity));
  });`), ["c", "b", "cde", "", "abc", "abc"]);
});

test("dynamic strings with constant slice bounds normalize, clamp and guard empty ranges", () => {
  const variants = ["slice(-3)", "slice(-4, -1)", "slice(2, 1)", "slice(-99, 99)",
    "slice(1.9, 3.9)", "slice(NaN, Infinity)", "slice(-Infinity, -1)", "slice()", "slice(undefined, -1)"];
  for (const method of variants) {
    const source = `function cut(s: string): string { return s.${method}; }
      onStart(() => { console.log(cut("abcdef")); console.log(cut("a")); console.log(cut("")); });`;
    const expected = ["abcdef", "a", ""].map(text => vm.runInNewContext(`text.${method}`, { text }));
    assert.deepEqual(run(source), expected, method);
    const report = compile(source).report;
    assert.ok([report, ...report.procedures].flatMap(item => Object.values(item.workspaceData.blocks)).some(block => block.type === "text_select"));
  }
});

test("JSON.stringify folds constant primitive and nested array literals with JSON escaping", () => {
  assert.deepEqual(run(`onStart(() => {
    console.log(JSON.stringify(12.5)); console.log(JSON.stringify(-0));
    console.log(JSON.stringify("a\\\"\\n\\t\\\\b"));
    console.log(JSON.stringify([1, "x", [2, "中"], NaN, Infinity, undefined, null, true]));
    console.log(JSON.stringify("\\ud800"));
  });`), ["12.5", "0", JSON.stringify('a"\n\t\\b'), '[1,"x",[2,"中"],null,null,null,null,true]', '"\\ud800"']);
});

test("primitive const bindings fold with lexical identity; mutable bindings are not frozen", () => {
  assert.deepEqual(run(`const digits = 2; const n = 1.005;
    function inner() { const n = 2.675; return n.toFixed(digits); }
    onStart(() => { console.log(n.toFixed(digits)); console.log(inner()); });`), ["1.00", "2.67"]);
  assert.throws(() => lower(`let n = 1.005; console.log(n.toFixed(2));`), /Dynamic toFixed.*alternative:/);
  const mutable = lower(`const data = [1]; data.push(2); console.log(JSON.stringify(data));`);
  assert.match(mutable.text, /JSON.stringify\(data\)/);
});

test("dynamic JSON serialization reaches the share-player compile diagnostic", () => {
  for (const source of [
    "function num(n: number) { return JSON.stringify(n); }",
    "function str(s: string) { return JSON.stringify(s); }",
    "function arr(a: number[]) { return JSON.stringify(a); }",
    "const a = [1]; a.push(2); console.log(JSON.stringify(a));",
  ]) {
    assert.match(lower(source).text, /JSON.stringify/);
    assert.throws(() => compile(source), /JSON.stringify is not (?:available in the Kitten N share player|supported for share-player objects)/);
  }
});

test("unsupported methods fail explicitly with actionable alternatives and original locations", () => {
  const cases = [
    ['function f(n: number) { return n.toFixed(2); }', /Dynamic toFixed/],
    ['function f(n: number) { return n.toString(16); }', /nondecimal/],
    ['function f(n: number, radix: number) { return n.toString(radix); }', /dynamic radices/],
    ['function f(n: number) { return isNaN(n); }', /Dynamic isNaN/],
    ['function f(n: number) { return Number.isNaN(n); }', /Dynamic isNaN/],
    ['function f(s: string) { return s.charCodeAt(0); }', /UTF-16 code-unit reporter/],
    ['function f(n: number) { return String.fromCharCode(n); }', /UTF-16 code-unit constructor/],
    ['function f(s: string) { return s.at(-1); }', /unrepresentable undefined/],
    ['function f(s: string, i: number) { return s.slice(i); }', /indices must be numeric constants/],
    ['console.log(JSON.stringify(undefined));', /returns undefined/],
    ['console.log("".at(-1));', /undefined/],
    ['console.log("😀".at(0));', /isolated UTF-16 surrogate/],
    ['console.log(String.fromCharCode(0xd800));', /isolated UTF-16 surrogate/],
    ['console.log((2).toFixed(101));', /RangeError/],
    ['console.log((2).toString(1));', /RangeError/],
    ['console.log(JSON.stringify(1, null, 2));', /non-spread argument/],
    ['function f(s: string | null) { return s?.slice(-1); }', /Optional method calls/],
    ['function f(Number: any) { return "".charCodeAt(0); }', /Number is shadowed/],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(() => lower(source), error => {
      assert.match(error.message, pattern);
      assert.match(error.message, /alternative:/);
      assert.equal(error.code, "NEKOC_TS_METHOD");
      assert.equal(error.name, "CompileError");
      assert.equal(error.location.file, "methods.ts");
      assert.equal(error.location.line, 1);
      assert.ok(error.location.column > 0);
      return true;
    }, source);
  }
});

test("global shadowing is respected and generated helper identifiers do not collide", () => {
  const result = lower(`function f(Number: any, JSON: any, String: any, isNaN: any) {
    console.log(Number.isNaN("x")); console.log(JSON.stringify(1));
    console.log(String.fromCharCode(65)); console.log(isNaN("x"));
  }`);
  assert.match(result.text, /Number.isNaN\("x"\)/);
  assert.match(result.text, /JSON.stringify\(1\)/);
  assert.match(result.text, /String.fromCharCode\(65\)/);
  assert.match(result.text, /isNaN\("x"\)/);
  const arrays = lower(`const a = [1, 2]; function f(b: number[]) { return b.at(-1); }
    console.log(a.at(-1)); console.log(a.slice(-1));`);
  assert.match(arrays.text, /a.at\(-1\)/);
  assert.match(arrays.text, /a.slice\(-1\)/);
  assert.match(arrays.text, /b.at\(-1\)/);
  assert.deepEqual(run(`let __tsfeatMethods1 = "reserved";
    function f(s: string): string { return s.slice(-2); }
    onStart(() => { console.log(f("abc")); console.log(__tsfeatMethods1); });`), ["bc", "reserved"]);
});
