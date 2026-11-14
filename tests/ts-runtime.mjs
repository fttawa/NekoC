import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real compiler and VM, then compare with the same source in JS.
// A retained artifact directory lets integration runs check the generated works
// with the official editor and share-player registry afterwards.
export function assertJsLogs(source) {
  const expected = [];
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(javascript, {
    onStart: callback => callback(),
    console: { log: (...args) => expected.push(args.map(String).join(" ")) },
  }, { timeout: 5000 });
  const root = path.resolve(process.env.NEKOC_SEMANTIC_ARTIFACT_DIR ?? "target");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "tsfeat-semantics-"));
  try {
    const input = path.join(dir, "main.ts"), output = path.join(dir, "main.bcmkn");
    writeFileSync(input, source);
    const bin = path.resolve("target/debug", process.platform === "win32" ? "nekoc.exe" : "nekoc");
    const env = { ...process.env, NEKOC_FRONTEND: path.resolve("ts") };
    for (const args of [["build", input, "-o", output], ["run", output, "--ticks", "120"]]) {
      const result = spawnSync(bin, args, { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
      if (args[0] === "run") assert.deepEqual(JSON.parse(result.stdout).logs, expected);
    }
  } finally {
    if (!process.env.NEKOC_SEMANTIC_ARTIFACT_DIR) rmSync(dir, { recursive: true, force: true });
  }
}
