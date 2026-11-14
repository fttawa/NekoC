import test from "node:test";
import assert from "node:assert/strict";
import { compileFile, checkFile, CompileError } from "../ts/compile-ts.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const compile = source => compileFile("tsarray.ts", { readFile: () => source });
const blocks = report => [...Object.values(report.workspaceData.blocks),
  ...report.procedures.flatMap(procedure => Object.values(procedure.workspaceData.blocks))];

const cases = [
  ["same-name array argument", "function add1(a: number[]) { a.push(1); } onStart(() => { const a = [5]; add1(a); });"],
  ["default sort", "onStart(() => { const a = [10,9,1]; console.log(a.sort().join(',')); });"],
  ["reverse expression", "onStart(() => { const a = [1,2,3]; const b = a.reverse(); console.log(a.join('')); console.log(b.join('')); });"],
  ["out-of-bounds", "onStart(() => { const a = [1]; console.log(a[7]); });"],
  ["rest destructuring", "onStart(() => { const [h,...t] = [1,2,3]; console.log(h + t.length); });"],
  ["flat", "onStart(() => { const a = [[1],[2,3]]; console.log(a.flat().join(',')); });"],
  ["clear", "onStart(() => { const a = [1,2]; a.length = 0; console.log(a.length); });"],
  ["compound assignments", "onStart(() => { const a = [10]; let i = 0; a[i] += 2; a[i] -= 1; a[i] *= 2; a[i] /= 2; a[i] %= 3; a[i] **= 2; console.log(a[0]); });"],
  ["callback capture", "onStart(() => { let lim = 4; const a = [1,5,6]; console.log(a.filter(x => x > lim).join(',')); });"],
  ["negative at", "onStart(() => { const a = [1,2,3]; console.log(a.at(-1)); });"],
  ["isArray", "onStart(() => { const a = [1]; console.log(Array.isArray(a)); console.log(Array.isArray(3)); });"],
  ["reduce without initial", "onStart(() => { const a = [1,2,3]; console.log(a.reduce((acc,x) => acc+x)); });"],
  ["reverse alias identity", "onStart(() => { const a = [1,2,3]; const b = a.reverse(); b[0] = 9; console.log(a[0]); a.length = 0; console.log(b.length); });"],
  ["compound evaluates index once", "let calls = 0; function index() { calls += 1; return 0; } onStart(() => { const a = [3]; a[index()] += 2; console.log(calls); console.log(a[0]); });"],
  ["fractional and missing at", "onStart(() => { const a = [1,2,3]; console.log(a.at(-1.9)); console.log(String(a.at(8))); });"],
  ["reduce starts index at one", "onStart(() => { const a = [5,6,7]; console.log(a.reduce((acc,x,i) => acc+i)); });"],
  ["at NaN uses zero", "onStart(() => { const a = [7,8]; console.log(a.at(0/0)); });"],
  ["destructuring declaration chain", "onStart(() => { const [h,...t] = [2,4], z = 3; console.log(h); console.log(t.join(',')); console.log(z); });"],
  ["default parameter uses earlier formal", "function f(x: number, y = x+1) { return y; } onStart(() => { const n = 2; console.log(f(n)); });"],
  ["callback captures array alias", "onStart(() => { const a = [1,2]; const b = a; console.log([0].map(x => b.join(',')).join(';')); });"],
  ["string element adds number", "onStart(() => { const a = ['2']; a[0] += 3; console.log(a[0]); });"],
  ["number element adds string", "onStart(() => { const a = [2]; a[0] += '3'; console.log(a[0]); });"],
  ["string element alias adds number", "onStart(() => { const a = ['2']; const b = a; b[0] += 3; console.log(a[0]); });"],
  ["callback captures string", "onStart(() => { const prefix = 'item:'; const values = [1,2]; console.log(values.map(x => prefix+x).join(',')); });"],
  ["property name is not a capture", "function size() { const length = 123; return [1,2].map(x => [x].length).join(','); } onStart(() => { console.log(size()); });"],
  ["callback local is not a capture", "function f() { const limit = 9; return [1,2].map(x => { const limit = 3; return x+limit; }).join(','); } onStart(() => { console.log(f()); });"],
  ["parenthesized reduce", "onStart(() => { console.log(([1,2,3]).reduce((a,b) => a+b)); });"],
  ["asserted reduce initializer", "onStart(() => { const a = ([1,2,3] as number[]); console.log((a as number[]).reduce((x,y) => x+y)); });"],
  ["parenthesized flat", "onStart(() => { console.log(([[1],[2,3]]).flat().join(',')); });"],
  ["bounded loop writes", "onStart(() => { const a = [1,2]; for (let i=0; i<a.length; i++) { a[i] += 1; } console.log(a.join(',')); });"],
  ["number element adds string alias", "onStart(() => { const a = [2]; const s = '3'; a[0] += s; console.log(a[0]); });"],
  ["length read does not invalidate writes", "onStart(() => { const a = [10]; console.log(a.length); a[0] += 2; console.log(a[0]); });"],
  ["callback parameter shadows captured string", "onStart(() => { const prefix = 'p'; console.log([1].map(x => prefix+x).join(',')); console.log([2].map(prefix => prefix+1).join(',')); });"],
  ["callback local shadows captured string", "onStart(() => { const prefix = 'p'; console.log([1].map(x => prefix+x).join(',')); console.log([2].map(x => { const prefix = 3; return prefix+x; }).join(',')); });"],
  ["for of local is not a capture", "function f() { const limit = 9; return [1].map(x => { let y = 0; for (const limit of [3]) { y += limit; } return y; }).join(','); } onStart(() => { console.log(f()); });"],
  ["numeric element update", "onStart(() => { const a = [2]; a[0]++; console.log(a[0]); });"],
  ["asserted flat initializer", "onStart(() => { const a = ([[1],[2,3]] as number[][]); console.log((a as number[][]).flat().join(',')); });"],
  ["asserted reduce literal", "onStart(() => { console.log(([1,2,3] as number[]).reduce((a,b) => a+b)); });"],
  ["callback captures string alias", "onStart(() => { const base = 'item:'; const prefix = base; console.log([1,2].map(x => prefix+x).join(',')); });"],
];

for (const [name, source] of cases) test(`tsarray: compiles ${name}`, () => {
  const report = compile(source);
  assert.ok(report.summary.scripts >= 1);
  assert.ok(blocks(report).length > 1);
});

test("tsarray: array reads retain JS undefined and nested values", () => {
  assert.ok(blocks(compile(cases[3][1])).some(block => block.type === "_object_get"));
});

test("tsarray: length zero emits list clear, not property assignment", () => {
  const generated = blocks(compile(cases[6][1]));
  assert.ok(generated.some(block => block.type === "delete_list_item" && block.fields.item === "all"));
  assert.ok(!generated.some(block => block.type === "_object_set"));
});

for (const source of [
  "onStart(() => { const a = []; a.reduce((a,b) => a+b); });",
  "onStart(() => { const a = [1]; a.length = 2; });",
  "onStart(() => { const a = [[1]]; console.log(a.flat(2)); });",
  "onStart(() => { const a = [1]; a.pop(); console.log(a.reduce((a,b) => a+b)); });",
  "onStart(() => { const a = [1]; const b = a; b.length = 0; console.log(a.reduce((a,b) => a+b)); });",
  "onStart(() => { const a = [[1]]; a[0] = 2; console.log(a.flat()); });",
  "onStart(() => { const a = [[1]]; const b = a; console.log(a.flat()); });",
  "onStart(() => { const a = [1]; a.length--; console.log(a.reduce((a,b) => a+b)); });",
  "onStart(() => { const a = [[1]]; a.length--; console.log(a.flat()); });",
  "onStart(() => { console.log(Array.isArray([Math.random()])); });",
  "onStart(() => { let a: any = [1]; a = 3; console.log(Array.isArray(a)); });",
  "function f(p: number) { const lim = p; return [1,5,6].filter(x => x > lim).join(','); } onStart(() => { console.log(f(4)); });",
  "onStart(() => { const a = ['2',3]; a[0] += 3; });",
  "onStart(() => { const a = [10]; a[-1] += 2; });",
  "onStart(() => { const a = [10,20]; a[0.5] += 2; });",
  "onStart(() => { const a = [10]; a[1] += 2; });",
  "onStart(() => { const a = [1]; a[3] = 5; });",
  "onStart(() => { const a = [1]; let i = 0; i += 3; a[i] += 2; });",
  "onStart(() => { const a = [1]; a.pop(); a[0] = 3; });",
  "onStart(() => { const a = [1]; const i = Math.random(); a[i] += 2; });",
  "onStart(() => { const a = [1]; a[-1] = 3; });",
  "onStart(() => { const a = [1]; a[0.5] = 3; });",
  "onStart(() => { const a = [10,20]; [0].forEach(x => { a[0.5] += 2; }); });",
  "onStart(() => { const a = [10,20]; a[0.5]++; });",
  "onStart(() => { const a = ['2']; a[0]++; });",
  "onStart(() => { const a = [10]; (a).pop(); a[0] += 2; });",
  "onStart(() => { const a = [10,20]; for (let i=0; i<2; i++) { a[i] += 2; a.pop(); } });",
  "onStart(() => { const a = [10,20]; const b = [1]; b.push(2,3,4); a[b.length-1] += 2; });",
  "const a = [10]; function index() { a.pop(); return 0; } onStart(() => { a[index()] += 2; });",
  "onStart(() => { const a: any[] = ['2']; a.unshift(3); a[0] += 4; });",
  "onStart(() => { const a = [2]; let s: any = '3'; s = 4; a[0] += s; });",
  "onStart(() => { const a = [10,20]; for (let i=0; i<2; i++) { i += 5; a[i] = 1; } });",
  "onStart(() => { const a = [10]; [1,2].forEach(x => { a[0] = 1; a.pop(); }); });",
  "onStart(() => { let prefix: any = 'p'; prefix = 3; console.log([1].map(x => prefix+x).join(',')); });",
  "onStart(() => { const a = [10,20]; for (let i=0; i<2; i++) { for (let j=0; j<1; j++) { a[j] = 1; } a.pop(); } });",
  "onStart(() => { const a = [10]; a[0] += a.pop(); });",
]) test(`tsarray: unsupported shape has a located diagnostic: ${source}`, () => {
  assert.throws(() => compile(source), error => error instanceof CompileError && error.location?.line > 0);
});

test("tsarray: internal exceptions become located compile diagnostics", () => {
  // Deep expressions exercise the public boundary rather than leaking a Node stack.
  assert.throws(() => compile(`onStart(() => console.log(${'('.repeat(15000)}1${')'.repeat(15000)}));`),
    error => error instanceof CompileError && error.location?.line > 0);
});

test("tsarray: check mode also catches parser/type-checker internal errors", () => {
  const result = checkFile("tsarray.ts", { host: { readFile: () => `let a = ${'('.repeat(15000)}1${')'.repeat(15000)};` } });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "NEKOC_INTERNAL");
  assert.equal(result.diagnostics[0].line, 1);
});

test("tsarray: inline locals keep their same-scope dependencies", () => {
  assert.doesNotThrow(() => compile("function f(x: number) { const y = x+1; const z = y*2; return z; } onStart(() => { console.log(f(3)); });"));
});

test("tsarray: task cases execute with JS results", () => {
  const dir = path.resolve("dist/tsarray-regression");
  mkdirSync(dir, { recursive: true });
  const bin = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");
  const run = args => {
    const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const expected = [["5,1"], ["1,10,9"], ["321", "321"], ["undefined"], ["3"], ["1,2,3"], ["0"], ["4"], ["5,6"], ["3"], ["true", "false"], ["6"], ["9", "0"], ["1", "5"], ["3", "undefined"], ["8"], ["7"], ["2", "4", "3"], ["3"], ["1,2"], ["23"], ["23"], ["23"], ["item:1,item:2"], ["1,1"], ["4,5"], ["6"], ["6"], ["1,2,3"], ["2,3"], ["23"]];
  expected.push(["1", "12"], ["p1", "3"], ["p1", "5"], ["3"], ["3"], ["1,2,3"], ["6"], ["item:1,item:2"]);
  assert.equal(expected.length, cases.length);
  for (const [i, [name, source]] of cases.entries()) {
    const input = path.join(dir, `${i}.ts`);
    const output = path.join(dir, `${i}.bcmkn`);
    writeFileSync(input, i === 0 ? source.replace("add1(a);", "add1(a); console.log(a.join(','));") : source);
    run(["build", input, "-o", output]);
    const snapshot = JSON.parse(run(["run", output, "--ticks", "60"]));
    assert.deepEqual(snapshot.logs, expected[i], name);
    assert.ok(readFileSync(output).length > 0);
  }
});
