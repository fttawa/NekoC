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
    ["let a = [1]; console.log(a[0]++);", /Value-producing/],
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
