import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const bin = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");
function run(args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("ordinary JS startup, objects, timers and numeric globals execute in the VM", () => {
  const dir = mkdtempSync(path.resolve("target/nekoc-js-"));
  try {
    const project = path.join(dir, "test.bcmkn");
    const snapshot = path.join(dir, "snapshot.json");
    run(["compile-ts-bcmkn", "samples/js_compat.ts", "--template", "samples/kitten-n-0.27.4.bcmkn", "--out", project]);
    run(["run", project, "--ticks", "120", "--out", snapshot]);
    const { variables: v } = JSON.parse(readFileSync(snapshot, "utf8"));
    assert.equal(v["kn-var-trace"], "2,4startsecondtimer");
    assert.equal(v["kn-var-ticks"], 3);
    assert.equal(v["kn-var-pointX"], 9);
    assert.equal(v["kn-var-pointNestedN"], 8);
    assert.equal(v["kn-var-pointLength"], 7);
    assert.deepEqual(v["kn-var-numbers"], [2, 4]);
    assert.equal(v["kn-var-sign"], -1);
    assert.ok(Math.abs(v["kn-var-cube"] + 3) < 1e-10);
    assert.ok(Math.abs(v["kn-var-logarithm"] - 3) < 1e-10);
    assert.equal(v["kn-var-hypotenuse"], 5);
    assert.equal(v["kn-var-integer"], false);
    assert.ok(Math.abs(v["kn-var-angle"] - Math.PI * 0.75) < 1e-10);
    assert.deepEqual(v["kn-var-generated"], [0, 3, 6, 9]);
    assert.deepEqual(v["kn-var-filled"], [7, 7, 7]);
    assert.equal(v["kn-var-repeated"], 1);
    assert.equal(v["kn-var-zeroTimer"], 1);
    assert.equal(v["kn-var-keyCalls"], 1);
    assert.equal(v["kn-var-compoundN"], 7);
    assert.deepEqual(v["kn-var-signs"], [0, 1]);
    for (const [i, expected] of [Math.PI / 2, -Math.PI / 2, -Math.PI * 0.75, Math.PI / 4, 0].entries()) {
      assert.ok(Math.abs(v["kn-var-angles"][i] - expected) < 1e-10);
    }
    assert.equal(v["kn-var-zeroHypot"], 0);
    assert.equal(v["kn-var-validInteger"], true);
    assert.deepEqual(v["kn-var-generatedFraction"], [0, 1]);
    assert.equal(v["kn-var-filledObjects"][0], v["kn-var-filledObjects"][1]);
    assert.equal(v["kn-var-filledObjectN"], 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unsupported object features retain actionable compile diagnostics", () => {
  const dir = mkdtempSync(path.resolve("target/nekoc-js-errors-"));
  try {
    for (const [source, message] of [
      ["const p = { method() {} };", /Object methods/],
      ["onStart(() => { const {x} = {x: 1}; });", /Object destructuring/],
      ["let key = \"n\"; const p = {n: 1}; console.log(p[key]);", /Dynamic object keys/],
      ["const p = {n: 1}; p.n?.toString();", /Unsupported|Optional/],
      ["console.log(JSON.stringify({n: 1}));", /not supported/],
      ["console.log(String.fromCharCode(65));", /Unsupported/],
      ["const a = Array(-1).fill(0);", /Array length/],
      ["function f(n: number) { setTimeout(() => console.log(n), 1); } f(3);", /cannot capture function parameter/],
    ]) {
      const file = path.join(dir, "input.ts");
      writeFileSync(file, source);
      const result = spawnSync(process.execPath, ["ts/compile-ts.mjs", "--check", file], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("explicit onStart handlers stay concurrent after top-level initialization", () => {
  const dir = mkdtempSync(path.resolve("target/nekoc-js-start-"));
  try {
    const source = path.join(dir, "main.ts");
    writeFileSync(source, `let base = [1, 2].length;
let spins = 0;
let seen = -1;
onStart(() => { forever(() => { spins += 1; wait(0); }); });
onStart(() => { seen = base; console.log("second"); });
`);
    const project = path.join(dir, "main.bcmkn");
    const snapshot = path.join(dir, "snapshot.json");
    run(["build", source, "-o", project]);
    run(["run", project, "--ticks", "10", "--out", snapshot]);
    const result = JSON.parse(readFileSync(snapshot, "utf8"));
    assert.deepEqual(result.logs, ["second"]);
    assert.equal(result.variables["kn-var-seen"], 2, "initialization finished before the handler read it");
    assert.ok(result.variables["kn-var-spins"] > 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
