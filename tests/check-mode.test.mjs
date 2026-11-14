import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFile, CompileError, compileFile } from "../ts/compile-ts.mjs";

function withSource(source, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-check-"));
  try {
    const file = path.join(dir, "main.ts");
    fs.writeFileSync(file, source);
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("checkFile returns no diagnostics for a valid program and a report", () => {
  withSource(`onStart(() => { console.log("hi"); });`, file => {
    const result = checkFile(file);
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.report);
  });
});

test("compat errors carry a 1-based location and the types pass can be skipped", () => {
  withSource(`onStart(() => {\n  const x = new Map();\n});\n`, file => {
    const result = checkFile(file, { types: false });
    assert.equal(result.ok, false);
    const [diagnostic] = result.diagnostics;
    assert.equal(diagnostic.source, "compat");
    assert.equal(diagnostic.line, 2);
    assert.ok(diagnostic.column >= 1);
  });
});

test("compileFile throws CompileError with a location", () => {
  withSource(`onStart(() => {\n  undefinedThing();\n});\n`, file => {
    assert.throws(() => compileFile(file), error => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.location.line, 2);
      return true;
    });
  });
});

test("self.* calls inside sprites use the same API as the global names", () => {
  withSource(`sprite("cat", {}, (self) => {
    self.onStart(() => { self.nextStyle(); self.changeX(5); self.stop(); });
  });`, file => {
    const result = checkFile(file);
    assert.deepEqual(result.diagnostics, []);
    const types = JSON.stringify(result.report);
    assert.match(types, /self_prev_next_style/);
    assert.match(types, /self_change_coordinate_x/);
  });
});

test("top-level string consts stand in for literal resource URLs", () => {
  withSource(`const URL = "https://example.com/a.png";
  sprite("cat", { costumes: [{ name: "a", url: URL }] }, (self) => {});`, file => {
    const result = checkFile(file);
    assert.deepEqual(result.diagnostics, []);
    assert.match(JSON.stringify(result.report), /https:\/\/example\.com\/a\.png/);
  });
});

test("frontend CLI runs when started through a symlinked directory", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-link-"));
  try {
    // macOS temp dirs are reached through /var -> /private/var; a junction or
    // symlink to ts/ reproduces argv[1] differing from import.meta.url.
    const link = path.join(dir, "frontend");
    fs.symlinkSync(path.resolve("ts"), link, process.platform === "win32" ? "junction" : "dir");
    const file = path.join(dir, "main.ts");
    fs.writeFileSync(file, 'onStart(() => { console.log("hi"); });\n');
    const output = execFileSync(process.execPath, [path.join(link, "compile-ts.mjs"), "--check", "--json", file], { encoding: "utf8" });
    assert.ok(Array.isArray(JSON.parse(output).diagnostics), output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
