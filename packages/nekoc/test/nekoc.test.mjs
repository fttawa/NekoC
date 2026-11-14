import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compile, check, createPlayer, importProject, validate } from "../index.mjs";
import { decodeFrame } from "../frame.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outputDir = path.join(root, "target/wasm-tests");
fs.mkdirSync(outputDir, { recursive: true });
function cargo(args) {
  const result = spawnSync("cargo", args, { cwd: root, encoding: "utf8", env: {
    ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_INCREMENTAL: "0",
  } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("memory files, relative imports and standard-library type checking", () => {
  const files = {
    "/main.ts": 'import { double } from "./lib"; onStart(() => { console.log(double(21)); });',
    "/lib/index.ts": "export function double(n: number): number { return n * 2; }",
  };
  assert.deepEqual(check("/main.ts", { files }), { ok: true, diagnostics: [] });
  assert.equal(check("main.ts", { files: new Map(Object.entries(files)) }).ok, true);
  const { bcmkn } = compile("/main.ts", { files });
  assert.equal(validate(bcmkn).ok, true);
  const player = createPlayer(importProject(bcmkn).project);
  try {
    assert.equal(JSON.parse(player.ready()).ready, true);
    const logs = [];
    for (let n = 0; n < 30; n++) logs.push(...decodeFrame(player.handle({ dt: 1 / 60, budget_ms: 16 })).logs);
    assert.deepEqual(logs, ["42"]);
    assert.equal(typeof player.handle({ debug_snapshot: true }), "string");
    assert.throws(() => player.handle("{"));
  } finally { player.free(); }
  const bad = check("/bad.ts", { files: { "/bad.ts": 'const n: number = "bad"; onStart(() => console.log(n));' } });
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.code === "TS2322"));
  assert.equal(check("/missing.ts", { files: {} }).ok, false);
  assert.throws(() => player.ready(), /freed/);
  player.free(); // idempotent wrapper disposal
});

for (const name of ["variables", "custom_procedures", "control_flow"]) {
  test(`wasm/native exact project and player log parity: ${name}`, () => {
    const input = `samples/${name}.ts`;
    const source = fs.readFileSync(path.join(root, input), "utf8");
    const { bcmkn } = compile(`/${input}`, { files: { [`/${input}`]: source } });
    const nativeOutput = path.join(outputDir, `${name}.native.bcmkn`);
    const wasmOutput = path.join(outputDir, `${name}.wasm.bcmkn`);
    fs.writeFileSync(wasmOutput, JSON.stringify(bcmkn));
    cargo(["run", "--quiet", "--bin", "nekoc", "--", "compile-ts-bcmkn", input, "--template", "samples/kitten-n-0.27.4.bcmkn", "--out", nativeOutput]);
    assert.deepEqual(bcmkn, JSON.parse(fs.readFileSync(nativeOutput, "utf8")));
    const nativeLogs = cargo(["run", "--quiet", "--example", "headless_player", "--", nativeOutput, "30"])
      .trim().split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\[\d+\] /, ""));
    const player = createPlayer(importProject(bcmkn).project);
    const logs = [];
    try {
      for (let n = 0; n < 30; n++) logs.push(...decodeFrame(player.handle({ dt: 1 / 60, budget_ms: 16 })).logs);
    } finally { player.free(); }
    assert.deepEqual(logs, nativeLogs);
  });
}

test("check matches nekoc check --json, including project diagnostics", () => {
  const cases = {
    "stage_demo.nk.ts": fs.readFileSync(path.join(root, "samples/stage_demo.nk.ts"), "utf8"),
    "typed.ts": 'onStart(() => {\n  const n: number = "x";\n  say(n);\n});\n',
    "compat.ts": "onStart(() => {\n  const m = new Map();\n});\n",
  };
  const shape = d => ({ severity: d.severity, source: d.source, code: d.code, line: d.line, column: d.column });
  for (const [name, source] of Object.entries(cases)) {
    const file = path.join(outputDir, name);
    fs.writeFileSync(file, source);
    const native = spawnSync("cargo", ["run", "--quiet", "--bin", "nekoc", "--", "check", "--json", file], {
      cwd: root, encoding: "utf8", env: { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_INCREMENTAL: "0" },
    });
    const expected = JSON.parse(native.stdout);
    const actual = check(`/${name}`, { files: { [`/${name}`]: source } });
    assert.equal(actual.ok, expected.ok, name);
    assert.deepEqual(actual.diagnostics.map(shape), expected.diagnostics.map(shape), name);
  }
});
