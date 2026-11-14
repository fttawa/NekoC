import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileFile } from "../ts/compile-ts.mjs";

function compile(source, imports = {}) {
  const file = path.resolve("tsstr-main.ts");
  const files = new Map([[file, source], ...Object.entries(imports).map(([name, text]) => [path.resolve(name), text])]);
  return compileFile(file, { readFile: name => files.get(name) });
}

function graph(source, imports) {
  const { blocks, connections } = compile(source, imports).workspaceData;
  const input = (block, name) => blocks[Object.entries(connections[block.id] ?? {}).find(([, edge]) => edge.input_name === name)?.[0]];
  return { blocks: Object.values(blocks), input };
}

const stringCases = [
  ["sequential +=", 'let s = ""; s += 1; s += 2;', 2],
  ["nonempty += zero", 'let s = "x"; s += 0;', 1],
  ["loop +=", 'let s = ""; for (let i = 0; i < 4; i++) s += i;', 1],
  ["braced loop +=", 'let s = ""; for (let i = 0; i < 4; i++) { s += i; }', 1],
  ["nonempty loop +=", 'let s = "x"; for (let i = 0; i < 3; i++) { s += i; }', 1],
  ["multiple declarations +=", 'let a = 1, s = ""; s += a; s += 2;', 2],
  ["typed variable", 'let s: string = g(); setVar("out", s + s);', 1],
  ["function return", 'setVar("out", g() + g());', 1],
  ["tuple slot", 'const t: [number, string] = [1, "a"]; setVar("out", t[1] + t[0]);', 1],
  ["string array", 'const a: string[] = ["x", "y"]; setVar("out", a[0] + a[1]);', 1],
];
for (const [name, body, joins] of stringCases) {
  test(`tsstr ${name} emits text joins, not numeric addition`, () => {
    const { blocks } = graph(`function g(): string { return "a"; } onStart(() => { ${body} });`);
    assert.equal(blocks.filter(b => b.type === "text_join").length, joins);
    assert.equal(blocks.filter(b => b.type === "math_arithmetic" && b.fields.type === "add"
      // Array item offsets intentionally use addition.
      && !["tuple slot", "string array"].includes(name)).length, 0);
  });
}

test("tsstr imported string returns use the same bound ASTs", () => {
  const { blocks } = graph('import { g } from "./tsstr-g"; onStart(() => { setVar("out", g() + g()); });', {
    "tsstr-g.ts": 'export function g(): string { return "a"; }',
  });
  assert.ok(blocks.some(b => b.type === "text_join"));
});

test("tsstr any and declared mixed unions fail explicitly; conversions work", () => {
  for (const body of [
    'let a: any = 1; setVar("out", a + 2);',
    'let a: any = ""; a += 1;',
    'let a: any = ""; setVar("out", (a + 1) + "x");',
    'const a: any[] = ["x"]; setVar("out", a.map(x => x + 1));',
  ]) assert.throws(() => compile(`onStart(() => { ${body} });`), /Cannot determine JavaScript/);
  assert.throws(() => compile('function f(x: string | number) { return x + 1; } onStart(() => { setVar("out", f(1)); });'), /Cannot determine JavaScript/);
  assert.throws(() => compile('function f(x: any) { return x + x; } onStart(() => { setVar("out", f(1)); });'), /Cannot determine JavaScript/);
  assert.doesNotThrow(() => compile('onStart(() => { let a: any = 1; setVar("out", String(a) + 2); let n = 1; setVar("n", Number(n) + 2); });'));
  assert.throws(() => compile('onStart(() => { let a: string | number = "x"; setVar("out", a + 2); });'), /Cannot determine JavaScript/);
});

test("tsstr callback and alias writes cannot invalidate a mixed-union addition decision", () => {
  for (const operator of ["+", "+="]) {
    for (const body of [
      `let x: string | number = 0; x = "1"; [1].forEach(() => { x = 1; }); ${operator === "+" ? 'setVar("out", (x) + 2)' : 'x += 2' };`,
      `const o: {x: string | number} = {x: 0}; o.x = "1"; const alias = o; alias.x = 1; ${operator === "+" ? 'setVar("out", o.x + 2)' : 'o.x += 2'};`,
      `const o: {x: string | number} = {x: 0}; o["x"] = "1"; const alias = o; alias.x = 1; ${operator === "+" ? 'setVar("out", o["x"] + 2)' : 'o["x"] += 2'};`,
    ]) assert.throws(() => compile(`onStart(() => { ${body} });`), /Cannot determine JavaScript/);
  }
});

test("tsstr transparent wrappers and derived expressions preserve declared union uncertainty", () => {
  const variants = value => [
    `(${value} satisfies string | number)`,
    `(((${value})! satisfies string | number)!)`,
    `((${value} satisfies string | number) satisfies string | number)`,
    `(true ? ${value} : ${value})`,
    `(${value} || ${value})`, `(${value} && ${value})`, `(${value} ?? ${value})`,
    `(true ? (${value} satisfies string | number) : ${value})`,
  ];
  for (const [setup, value] of [
    ['let x: string | number = 0; x = "1"; [1].forEach(() => { x = 1; });', "x"],
    ['const o: {x: string | number} = {x: 0}; o.x = "1"; const alias = o; alias.x = 1;', "o.x"],
  ]) {
    for (const expression of variants(value)) {
      assert.throws(() => compile(`onStart(() => { ${setup} setVar("out", ${expression} + 2); });`), /Cannot determine JavaScript/, expression);
    }
    assert.doesNotThrow(() => compile(`onStart(() => { ${setup} setVar("out", String(${value}) + 2); });`));
  }
  for (const expression of ['("a" satisfies string)', '(true ? "a" : "b")']) {
    assert.doesNotThrow(() => compile(`onStart(() => { setVar("out", ${expression} + 2); });`));
  }
});

test("tsstr Number.isInteger keeps non-numeric argument evaluation exactly once", () => {
  for (const returnType of ["string", "boolean"]) {
    const report = compile(`let called = 0; function f(): ${returnType} { called += 1; return ${returnType === "string" ? '"x"' : 'true'}; }
      onStart(() => { setVar("result", Number.isInteger(f())); setVar("out", called); });`);
    const all = Object.values(report.workspaceData.blocks);
    assert.equal(all.filter(b => b.type === "procedures_2_callreturn" && b.fields.NAME === "kn-proc-fn-f").length, 1);
  }
  assert.throws(() => compile('onStart(() => { const o = { get value() { return "x"; } }; setVar("out", Number.isInteger(o.value)); });'), /Object methods, accessors and spread are not supported/);
});

test("tsstr negative-zero numeric parsing/conversion results fail explicitly", () => {
  for (const value of ['parseInt("-0px")', 'parseInt("-0")', 'parseFloat("-0")', 'Number("-0")', '+"-0"', 'parseInt("-0.9")', 'parseFloat("-1e-9999")']) {
    assert.throws(() => compile(`onStart(() => { setVar("out", "" + 1 / ${value}); });`), /Negative zero from numeric conversion\/parsing/);
  }
});

test("tsstr concatenation preserves numeric grouping and nested string grouping", () => {
  const { blocks, input } = graph('onStart(() => { setVar("out", 1 + 2 + "x"); setVar("other", "x" + (1 + 2)); });');
  const joins = blocks.filter(b => b.type === "text_join");
  assert.equal(joins.length, 2);
  assert.equal(input(joins[0], "ADD0").type, "math_number");
  assert.equal(input(joins[1], "ADD1").type, "math_number");
});

test("tsstr loose string/number equality converts operands but strict equality does not", () => {
  const { blocks, input } = graph('onStart(() => { setVar("a", "5" == 5); setVar("b", "5" === 5); setVar("c", "5" != 5); });');
  const comparisons = blocks.filter(b => b.type === "logic_compare");
  assert.equal(comparisons.length, 3);
  assert.equal(input(comparisons[0], "A").type, "convert_type");
  assert.equal(input(comparisons[0], "B").type, "convert_type");
  assert.equal(input(comparisons[1], "A").type, "text");
  assert.equal(input(comparisons[2], "A").type, "convert_type");
  assert.throws(() => compile('onStart(() => { let s = "bad"; setVar("out", s == 5); });'), /Loose string equality/);
  assert.throws(() => compile('onStart(() => { setVar("out", "bad" == 5); });'), /Loose string equality/);
  assert.throws(() => compile('onStart(() => { let a: any = "5"; setVar("out", a == 5); });'), /Cannot determine JavaScript loose equality/);
  assert.throws(() => compile('function f(x: string | number) { return x == 5; } onStart(() => { setVar("out", f("5")); });'), /Cannot determine JavaScript loose equality/);
});

test("tsstr numeric parsing folds JS prefixes and rejects dynamic parsing", () => {
  const { blocks } = graph('onStart(() => { setVar("a", Number("12")); setVar("b", parseInt("42px")); setVar("c", parseFloat("3.5em")); });');
  assert.deepEqual(blocks.filter(b => b.type === "math_number").map(b => b.fields.NUM), ["12", "42", "3.5"]);
  for (const source of [
    'let s = "42px"; setVar("out", parseInt(s));',
    'let s = "3.5em"; setVar("out", parseFloat(s));',
    'let radix = 16; setVar("out", parseInt("ff", radix));',
    'setVar("out", parseInt("42", 10, g()));',
  ]) assert.throws(() => compile(`onStart(() => { ${source} });`), /literal primitive arguments/);
  assert.throws(() => compile('onStart(() => { let s = "bad"; setVar("out", Number(s)); });'), /dynamic string\/any conversion/);
  assert.doesNotThrow(() => compile('onStart(() => { let b = true; setVar("out", Number(b)); });'));
  assert.throws(() => compile('onStart(() => { let s = "42"; setVar("out", Number(+s) === 42); });'), /dynamic string\/any conversion/);
  assert.doesNotThrow(() => compile('onStart(() => { setVar("out", Number(+"42") === 42); });'));
});

test("tsstr object property += preserves the original string type", () => {
  const { blocks, input } = graph('onStart(() => { const o = {s: "10"}; o.s += 1; setVar("out", o.s); });');
  const assignment = blocks.find(b => b.type === "_object_set");
  assert.equal(input(assignment, "value").type, "text_join");
  for (const update of ["o.s++", "++o.s", "o.s--", "--o.s"]) {
    const g = graph(`onStart(() => { const o = {s: 10}; ${update}; setVar("out", o.s); });`);
    const set = g.blocks.find(b => b.type === "_object_set");
    assert.equal(g.input(set, "value").type, "math_arithmetic");
    assert.throws(() => compile(`onStart(() => { const o: {s: any} = {s: "10"}; ${update}; });`), /Property updates support statically numeric/);
    assert.throws(() => compile(`onStart(() => { const o = {s: "10"}; ${update}; });`), /Property updates support statically numeric/);
  }
});

test("tsstr independent compilers do not share string variable classifications", () => {
  compile('onStart(() => { let x = "a"; setVar("out", x + 1); });');
  const { blocks } = graph('onStart(() => { let x = 1; setVar("out", x + 1); });');
  assert.equal(blocks.filter(b => b.type === "text_join").length, 0);
});

test("tsstr constant numeric evaluation never mistakes shadowed builtins for JS globals", () => {
  assert.throws(() => compile('function parseInt(s: string) { return 7; } onStart(() => { setVar("out", parseInt("42px")); });'), /Shadowing the builtin parseInt/);
});

test("tsstr synthesized callbacks preserve original string parameter and return types", () => {
  for (const source of [
    'onStart(() => { const a: string[] = ["x"]; setVar("out", a.map(x => x + x)); });',
    'function g(): string { return "a"; } onStart(() => { setTimeout(() => { setVar("out", g() + g()); }, 1); });',
    'function g(): string { return "a"; } onStart(() => { setTimeout(() => setVar("out", g() + g()), 1); });',
    'onStart(() => { setVar("out", Array.from({length: 1}, () => { const t: [number,string] = [1,"a"]; return t[1] + t[0]; })); });',
  ]) {
    const report = compile(source);
    const all = [...Object.values(report.workspaceData.blocks), ...report.procedures.flatMap(p => Object.values(p.workspaceData.blocks))];
    assert.ok(all.some(b => b.type === "text_join"));
  }
});
