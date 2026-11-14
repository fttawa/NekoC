import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileFile, checkFile } from "../ts/compile-ts.mjs";

const entry = path.resolve("virtual/tsdiag.ts");
function compile(source, files = {}) {
  return compileFile(entry, { readFile: name => name === entry ? source : files[name] });
}
function numbers(report) {
  return Object.values(report.workspaceData.blocks).filter(block => block.type === "math_number")
    .map(block => Number(block.fields.NUM));
}

test("type-only declarations erase at top level and inside functions", () => {
  const declarations = `interface I { n: number }; type T = I | number;
    declare const ambient: number; declare function unused(x: number): number;
    declare class C { x: number }
    namespace Types { export interface V { a: number }; export type U = V }
    namespace Nested.More { export type V = number }
    declare namespace External { const value: number }`;
  const report = compile(`${declarations}
    function f(x: number) { ${declarations} return x + 1; }
    onStart(() => { ${declarations} console.log(f(2)); });`);
  assert.equal(report.summary.procedures, 0);
  assert.ok(numbers(report).includes(3));
  assert.ok(!Object.values(report.workspaceData.blocks).some(block => block.fields?.variable === "ambient"));
});

test("overload signatures erase and implementation remains callable", () => {
  const report = compile(`function f(x: number): number;
    function f(x: string): string;
    function f(x: any): any { return x; }
    onStart(() => { console.log(f(7)); });`);
  assert.ok(numbers(report).includes(7));
  assert.throws(() => compile("function orphan(x: number): number;"), /following implementation/);
});

test("overloads in imported functions erase", () => {
  const report = compile('import { f } from "./lib"; onStart(() => { console.log(f(8)); });', {
    [path.resolve("virtual/lib.ts")]: `export interface TypeOnly { x: number }
      export function f(x: number): number;
      export function f(x: number) { return x; }`,
  });
  assert.ok(numbers(report).includes(8));
});

test("type-only imports need no runtime module", () => {
  const report = compile('import type { T } from "not-installed"; onStart(() => { console.log(1); });');
  assert.equal(report.summary.scripts, 1);
});

test("mixed imports erase only type bindings", () => {
  const report = compile('import { type T, f } from "./lib"; onStart(() => { console.log(f()); });', {
    [path.resolve("virtual/lib.ts")]: 'export type T = number; export function f() { return 9; }',
  });
  assert.ok(numbers(report).includes(9));
});

for (const body of ["export const k = 4;", "export function f() { return 1; }", "namespace Inner { export enum E { A } }", "export declare const x: number;", "export declare namespace Inner { const x: number; }"]) {
  test(`value namespace rejects clearly: ${body}`, () => {
    assert.throws(() => compile(`namespace NS { ${body} }`), /Namespaces containing runtime values/);
    assert.throws(() => compile(`onStart(() => { namespace NS { ${body} } });`), /Namespaces containing runtime values/);
  });
}

test("default parameters handle omission, explicit undefined, and zero", () => {
  const report = compile(`function f(a: number, b = 1) { return a + b; }
    onStart(() => { console.log(f(2)); console.log(f(2, undefined)); console.log(f(2, 0)); });`);
  assert.deepEqual(numbers(report), [3, 3, 2]);
});

test("default parameters can use earlier constant arguments", () => {
  const report = compile(`function f(a: number, b = a + 1) { return b; }
    onStart(() => { console.log(f(2)); });`);
  assert.ok(numbers(report).includes(3));
});

test("side-effecting or scope-dependent defaults reject instead of replaying", () => {
  assert.throws(() => compile(`let n = 0;
    function bump() { n += 1; return n; }
    function f(b = bump()) { return b + b; }
    onStart(() => { console.log(f()); });`), /side-effecting defaults are not supported/);
  assert.throws(() => compile(`let a = 5; function f(b = a) { return b; }
    onStart(() => { console.log(f()); });`), /requires a literal or constant numeric expression/);
  for (const value of ['0 || 7', '0 ?? 7', '"a" + 1']) {
    assert.throws(() => compile(`function f(b = ${value}) { return b; }
      onStart(() => { console.log(f()); });`), /requires a literal or constant numeric expression/);
  }
});

test("unused optional arguments may be omitted, observed undefined rejects clearly", () => {
  assert.ok(numbers(compile(`function f(a: number, b?: number) { return a; }
    onStart(() => { console.log(f(4)); });`)).includes(4));
  for (const expression of ["b", "b === undefined", "b ?? 1"]) {
    const source = `function f(b?: number) { return ${expression}; }
      onStart(() => { console.log(f()); });`;
    const result = checkFile(entry, { types: false, host: { readFile: () => source } });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /Omitted optional parameter b.*use a default parameter/);
  }
});

test("inline caller names cannot be captured by default or optional bindings", () => {
  for (const parameter of ["b = 1", "b?: number"]) {
    assert.throws(() => compile(`let b = 10; function f(a: number, ${parameter}) { return a; }
      onStart(() => { console.log(f(b)); });`), /Inline parameter binding cycle or capture/);
  }
  assert.throws(() => compile(`let b = 10; function f(a: number, b = 1) { return a; }
    function g(x: number) { return f(x); }
    onStart(() => { console.log(g(b)); });`), /Inline parameter binding cycle or capture/);
  assert.throws(() => compile(`let x = 10; function f(a: number, b = 1) { const x = 1; return a; }
    onStart(() => { console.log(f(x)); });`), /Inline parameter binding cycle or capture/);
});

test("omitted optional parameters read by later defaults reject instead of becoming zero", () => {
  for (const body of ["return b;", "if (b > 0) return b; return 0;"]) {
    assert.throws(() => compile(`function f(a?: number, b = a + 1) { ${body} }
      onStart(() => { console.log(f()); });`), /Omitted optional parameter a.*use a default parameter/);
  }
});

test("erased types do not observe optional parameter values", () => {
  const report = compile(`function f(x?: number) { type T = typeof x; return 1; }
    onStart(() => { console.log(f()); });`);
  assert.ok(numbers(report).includes(1));
});
