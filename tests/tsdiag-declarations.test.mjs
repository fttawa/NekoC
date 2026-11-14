import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileFile, checkFile } from "../ts/compile-ts.mjs";
import { assertJsLogs } from "./ts-runtime.mjs";

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

// Defaults are expanded at the call site and evaluated once there (see the
// tsctrl execution test), so they are accepted only when their names mean
// the same at the call. Parameter reads remain unsafe; tsfeat unique names
// keep caller locals from shadowing the default's file-level bindings.
test("parameter-reading defaults reject and uniquely named caller locals preserve defaults", () => {
  assert.throws(() => compile(`let n = 0;
    function bump() { n += 1; return n; }
    function f(a: number, b = a + bump()) { return b + b; }
    onStart(() => { console.log(f(n++)); });`), /reads parameters or a name shadowed at the call site/);
  assertJsLogs(`function bump() { return 1; }
    function f(b = bump()) { return b; }
    onStart(() => { const bump = 2; console.log(f()); });`);
  for (const value of ["bump()", "n", "0 || 7", "0 ?? 7", '"a" + 1']) {
    assert.doesNotThrow(() => compile(`let n = 0; function bump() { n += 1; return n; }
      function f(b = ${value}) { return b; }
      onStart(() => { console.log(f()); });`), value);
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
    assert.match(result.diagnostics[0].message, /Omitted optional parameter b.*use a default parameter|null\/undefined values are supported only in static comparisons/);
  }
});

test("uniquely named default, optional and local bindings preserve caller values", () => {
  // tsfeat unique naming removes the former inline binding capture.
  for (const parameter of ["b = 1", "b?: number"]) {
    assertJsLogs(`let b = 10; function f(a: number, ${parameter}) { return a; }
      onStart(() => { console.log(f(b)); });`);
  }
  assertJsLogs(`let b = 10; function f(a: number, b = 1) { return a; }
    function g(x: number) { return f(x); }
    onStart(() => { console.log(g(b)); });`);
  assertJsLogs(`let x = 10; function f(a: number, b = 1) { const x = 1; return a; }
    onStart(() => { console.log(f(x)); });`);
});

test("omitted optional parameters read by later defaults reject instead of becoming zero", () => {
  for (const body of ["return b;", "if (b > 0) return b; return 0;"]) {
    assert.throws(() => compile(`function f(a?: number, b = a + 1) { ${body} }
      onStart(() => { console.log(f()); });`), /Omitted optional parameter a.*use a default parameter|Cannot determine JavaScript \+ \/ \+= semantics/);
  }
  // Without the + type ambiguity, the omitted read itself is reported.
  assert.throws(() => compile(`function f(a?: number, b = a) { return b; }
    onStart(() => { console.log(f()); });`), /Omitted optional parameter a.*use a default parameter|Default parameter b requires/);
});

test("erased types do not observe optional parameter values", () => {
  const report = compile(`function f(x?: number) { type T = typeof x; return 1; }
    onStart(() => { console.log(f()); });`);
  assert.ok(numbers(report).includes(1));
});

test("resource callbacks erase type declarations before checking runtime statements", () => {
  const types = `interface I { x: number }; type N = number; declare const unused: number;
    namespace Types { export type T = number; }`;
  const report = compile(`screen("main", {}, () => { ${types}
    sprite("s", {}, () => { ${types} onStart(() => { console.log(1); }); });
  });`);
  assert.equal(report.resources.screens[0].sprites[0].summary.scripts, 1);
  for (const wrapper of [body => `sprite("s", {}, () => { ${body} });`,
    body => `screen("main", {}, () => { ${body} });`]) {
    assert.throws(() => compile(wrapper("namespace Values { export const x = 1; }")), /Namespaces containing runtime values/);
  }
});

test("property names are not lexical reads but shorthand and computed keys remain reads", () => {
  assert.doesNotThrow(() => compile(`let obj = {x: 2}; function f(x: number) { return x + 1; }
    onStart(() => { console.log(f(obj.x)); });`));
  assert.doesNotThrow(() => compile(`function f(x: {x: number}) { return x.x; }
    onStart(() => { console.log(f({x: 2})); });`));
  assert.doesNotThrow(() => compile(`function f(b?: number) { return ({b: 1}).b; }
    onStart(() => { console.log(f()); });`));
  assert.throws(() => compile(`function f(b?: number) { return ({b}).b; }
    onStart(() => { console.log(f()); });`), /Omitted optional parameter b/);
  // The share-object lowering rejects a runtime key before the call is expanded.
  assert.throws(() => compile(`function f(b?: number) { return ({x: 1})[b]; }
    onStart(() => { console.log(f()); });`), /Dynamic object keys are not supported/);
  for (const expression of ["({x})", "obj[x]"]) {
    assert.throws(() => compile(`let x = 1; let obj = {a: 2}; function f(x: any) { return x; }
      onStart(() => { console.log(f(${expression})); });`), /Inline parameter binding cycle or capture|Object shapes must preserve initialized references|Dynamic object keys are not supported/);
  }
});

test("custom procedure string defaults reject when binding types cannot be specialized", () => {
  assert.throws(() => compile(`function f(a = "abc") { if (a.length > 0) return a.length; return 0; }
    onStart(() => { console.log(f(undefined)); });`), /String default parameter a requires an inline function|Unsupported property operation/);
});

test("indexed string results retain text lowering through operations and aliases", () => {
  for (const [body, expected] of [
    ["return a[0] + 1;", "text_join"],
    ["return a[0].length;", "text_length"],
    ["const x = a[0]; return x + 1;", "text_join"],
  ]) {
    const report = compile(`let out: any = 0; function f(a = "42") { ${body} }
      onStart(() => { out = f(undefined); });`);
    const types = Object.values(report.workspaceData.blocks).map(block => block.type);
    assert.ok(types.includes(expected), types.join(","));
    assert.ok(types.includes("text_select"));
    assert.ok(!types.includes("_object_get"));
  }
});

test("possibly undefined string bracket reads reject instead of becoming empty text", () => {
  for (const body of ["return a[2] + 1;", "return a[-1];", "return a[0.5];",
    "return a[0 / 0];", "return a[1 / 0];", "return a[2].length;",
    "const x = a[2]; return x + 1;", "return Number.isInteger(a[2]);"]) {
    assert.throws(() => compile(`function f(a = "42") { ${body} }
      onStart(() => { console.log(f()); });`), /String index must be a provably in-bounds integer/);
  }
  for (const top of ['let text = "42"; let i = 0;', 'const text = "42"; let i = 0;']) {
    assert.throws(() => compile(`${top} onStart(() => { console.log(text[i] + 1); });`),
      /String index must be a provably in-bounds integer/);
  }
  assert.doesNotThrow(() => compile('const text = "42"; onStart(() => { console.log(text[0] + 1); });'));
});

test("Number.isInteger resolves string defaults and indexed aliases before numeric helpers", () => {
  for (const body of ["return Number.isInteger(a);", "return Number.isInteger(a[0]);",
    "const x = a[0]; return Number.isInteger(x);"]) {
    const report = compile(`function f(a = "42") { ${body} }
      onStart(() => { console.log(f(undefined)); });`);
    // Evaluated inline locals move the check into a reporter procedure, which
    // lives in its own workspace; inspect every workspace.
    const found = [];
    (function collect(value) {
      if (!value || typeof value !== "object") return;
      if (value.blocks && value.connections) found.push(value);
      for (const child of Object.values(value)) collect(child);
    })(report);
    const types = found.flatMap(workspace => Object.values(workspace.blocks)).map(block => block.type);
    assert.ok(!types.includes("math_round"), types.join(","));
    assert.ok(types.includes("logic_boolean"));
  }
});

test("isolated surrogate bracket reads fail at compile time for both UTF-16 halves", () => {
  for (const index of [0, 1]) {
    for (const body of [`return a[${index}];`, `return a[${index}].length;`,
      `return a[${index}] + "x";`, `const x = a[${index}]; return x + "x";`,
      `return Number.isInteger(a[${index}]);`]) {
      assert.throws(() => compile(`function f(a = "😀") { ${body} }
        onStart(() => { console.log(f(undefined)); });`), error => {
        assert.match(error.message, /String index produces an isolated UTF-16 surrogate/);
        assert.equal(path.resolve(error.location.file), entry);
        assert.equal(error.location.line, 1);
        return true;
      });
    }
  }
  for (const index of [0, 3]) {
    assert.doesNotThrow(() => compile(`function f(a = "猫😀狗") { return a[${index}] + a[${index}].length; }
      onStart(() => { console.log(f()); });`));
  }
});

test("Number.isInteger resolves boolean defaults and local aliases without math_round", () => {
  for (const value of ["true", "false"]) {
    for (const argument of ["", "undefined"]) {
      for (const body of ["return Number.isInteger(a);", "const x = a; const y = x; return Number.isInteger(y);"]) {
        const report = compile(`function f(a = ${value}) { ${body} }
          onStart(() => { console.log(f(${argument})); });`);
        const types = Object.values(report.workspaceData.blocks).map(block => block.type);
        assert.ok(!types.includes("math_round"), types.join(","));
        assert.ok(types.includes("logic_boolean"));
      }
    }
  }
});
