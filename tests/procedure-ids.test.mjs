import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function compile(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-procedure-ids-"));
  try {
    fs.writeFileSync(path.join(dir, "main.ts"), source);
    const out = path.join(dir, "out.json");
    const result = spawnSync(process.execPath, [path.resolve("ts/compile-ts.mjs"), path.join(dir, "main.ts"), out], { encoding: "utf8" });
    return { result, output: result.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8")) : null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Chinese procedure names of equal length stay separate procedures", () => {
  const { result, output } = compile(`
    defineProc("生成区块", ["甲"], () => { setVar("a", param("甲")); });
    defineProc("标题界面", ["乙"], () => { setVar("b", param("乙")); });
    onStart(() => { callProc("生成区块", 1); callProc("标题界面", 2); });
  `);
  assert.equal(result.status, 0, result.stderr);
  const text = JSON.stringify(output);
  const ids = new Set(text.match(/kn-proc-u[0-9a-f-]+/g));
  assert.equal(ids.size, 2);
  const params = new Set(text.match(/kn-param-u[0-9a-f-]+/g));
  assert.equal(params.size, 2);
});

test("ASCII procedure ids are unchanged", () => {
  const { output } = compile(`defineProc("lm key", [], () => {}); onStart(() => { callProc("lm key"); });`);
  assert.match(JSON.stringify(output), /kn-proc-lm-key/);
});

test("names that still collide are a compile error", () => {
  const { result } = compile(`defineProc("a b", [], () => {}); defineProc("a-b", [], () => {}); onStart(() => {});`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same id/);
});
