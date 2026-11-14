import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileFile, checkFile } from "../ts/compile-ts.mjs";

test("frontend entry/imports use only the supplied readFile host", () => {
  const files = new Map([
    [path.resolve("virtual/main.ts"), 'import { add } from "./math"; onStart(() => { console.log(add(1, 2)); });'],
    [path.resolve("virtual/math.ts"), "export function add(a: number, b: number) { return a + b; }"],
  ]);
  const host = { readFile: (name) => files.get(name) };
  assert.equal(compileFile("virtual/main.ts", host).summary.scripts, 1);
  assert.equal(checkFile("virtual/main.ts", { types: false, host }).ok, true);
  assert.equal(checkFile("virtual/absent.ts", { types: false, host }).ok, false);
  files.delete(path.resolve("virtual/math.ts"));
  assert.throws(() => compileFile("virtual/main.ts", host), /Unable to resolve import/);
});
