import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compileFile, CompileError } from "../../ts/compile-ts.mjs";
import { cases as core } from "./cases.mjs";
import { cases as extra } from "./cases-extra.mjs";
import { cases as runtimeExtra } from "./runtime-extra.mjs";
import { baseline } from "./baseline.mjs";

export const originalCases = [
  ...core.map((c, i) => ({ ...c, id: `core-${String(i + 1).padStart(3, "0")}`, ...baseline("core", i + 1) })),
  ...extra.map((c, i) => ({ ...c, id: `extra-${String(i + 1).padStart(3, "0")}`, ...baseline("extra", i + 1) })),
];
export const allCases = [...originalCases,
  ...runtimeExtra.map((c, i) => ({ ...c, id: `runtime-${String(i + 1).padStart(3, "0")}` })),
];

export function source(c) {
  return `let out: any = 0;\n${c.top}\nonStart(() => {\n${c.body}\n});\n`;
}

export function nodeExpected(c) {
  // Register all start handlers before running any. The sole original wait
  // case has no competing writes; synchronous wait is a final-state oracle,
  // not a claim to reproduce the VM scheduler or general async semantics.
  const context = vm.createContext({
    console: { log() {} }, setTimeout() {},
    __callbacks: [],
    wait() {},
  });
  vm.runInContext("function onStart(f) { __callbacks.push(f); }", context);
  // The supplied probes evaluate top/body in one JS scope. Preserve that
  // oracle contract (including functions that capture body declarations).
  const body = `${c.top}\nlet out: any = 0;\n${c.body}`;
  const js = ts.transpileModule(`${body}\nfor (const f of __callbacks) f();\nglobalThis.__out = String(out);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(js, context, { timeout: 5000 });
  return context.__out;
}

// Public preparation API: callers can pass additional {id,top,body,status,...}
// cases. All compilation happens in one Node process; no .bcmkn is persisted.
export function prepareCases(cases = allCases) {
  return cases.map(c => {
    const result = { id: c.id, name: `${c.cat}/${c.name}`, status: c.status,
      expectedError: c.error, expectedVm: c.value, baselineNode: c.node };
    try { result.node = nodeExpected(c); }
    catch (error) { result.nodeError = error.message; }
    try {
      const filename = path.resolve(`tests/ts-js-semantics/${c.id}.ts`);
      result.report = compileFile(filename, { readFile: p => path.resolve(p) === filename ? source(c) : undefined });
    } catch (error) {
      // A JS crash (RangeError/TypeError) is not an intentional diagnostic.
      if (!(error instanceof CompileError)) throw error;
      result.compileError = error.message;
    }
    return result;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(process.argv[2], JSON.stringify(prepareCases()));
}
