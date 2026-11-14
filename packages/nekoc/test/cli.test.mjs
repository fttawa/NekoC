import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = new URL("../../../target/wasm-cli/", import.meta.url);
const cli = "packages/nekoc/bin/nekoc.mjs";
function run(...args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" }); }

test("Node-only CLI builds, checks errors and prints player logs", () => {
  fs.mkdirSync(dir, { recursive: true });
  const input = fileURLToPath(new URL("main.ts", dir));
  const output = fileURLToPath(new URL("main.bcmkn", dir));
  fs.writeFileSync(input, 'onStart(() => { console.log("cli-wasm"); });');
  let result = run("check", input, "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  result = run("build", input, "-o", output);
  assert.equal(result.status, 0, result.stderr);
  result = run("run", output, "--frames", "3");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "cli-wasm");
  fs.writeFileSync(input, "onStart(() => { const = ; });");
  result = run("check", input, "--json");
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
