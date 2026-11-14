import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { compileFile, checkFile, CompileError, formatDiagnostic } from "../ts/compile-ts.mjs";

const root = path.resolve(import.meta.dirname, "..");
const frontend = path.join(root, "ts/compile-ts.mjs");
const tempRoot = os.tmpdir();
const sourcePath = file => file.replaceAll("\\", "/");
const cases = [
  { name: "unsupported", source: "// heading\nonStart(() => {\n  missingApi();\n});\n", line: 3, column: 3 },
  { name: "syntax", source: "// heading\nonStart(() => {\n  let value = ;\n});\n", line: 3, column: 15 },
  { name: "import", source: '// heading\n  import { absent } from "./missing";\n', line: 2, column: 3 },
  { name: "missing-argument", source: '// heading\n  onStart();\n', line: 2, column: 3 },
  { name: "map-callback", source: '// comment\nonStart(() => {\n const a = [1];\n a.map(x => missingApi(x));\n});\n', line: 4, column: 13 },
  { name: "timer-callback", source: '// comment\nonStart(() => {\n setTimeout(() => {\n  missingApi();\n }, 10);\n});\n', line: 4, column: 3 },
];

function withFiles(files, run) {
  const dir = fs.mkdtempSync(path.join(tempRoot, "nekoc-tsdiag-"));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return run(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const fixture of cases) {
  test(`${fixture.name}: compile, check text and check JSON share 1-based locations and plain messages`, () => {
    withFiles({ "main.ts": fixture.source }, dir => {
      const file = path.join(dir, "main.ts");
      const result = checkFile(file, { types: false });
      assert.equal(result.ok, false);
      const [diagnostic] = result.diagnostics;
      assert.deepEqual([diagnostic.file, diagnostic.line, diagnostic.column], [sourcePath(file), fixture.line, fixture.column]);
      assert.doesNotMatch(diagnostic.message, /at offset|main\.ts:\d+:\d+:/);
      assert.throws(() => compileFile(file), error => {
        assert.ok(error instanceof CompileError);
        assert.equal(error.message, diagnostic.message);
        assert.deepEqual(error.location, { file: sourcePath(file), line: fixture.line, column: fixture.column });
        return true;
      });
      const compile = spawnSync(process.execPath, [frontend, file, path.join(dir, "out.json")], { encoding: "utf8" });
      const check = spawnSync(process.execPath, [frontend, "--check", "--no-types", file], { encoding: "utf8" });
      const json = spawnSync(process.execPath, [frontend, "--check", "--no-types", "--json", file], { encoding: "utf8" });
      assert.equal(compile.status, 1, compile.stderr);
      assert.equal(check.status, 1, check.stderr);
      assert.equal(json.status, 1, json.stderr);
      assert.equal(compile.stderr, check.stderr);
      assert.equal(compile.stderr.trim(), result.diagnostics.map(formatDiagnostic).join("\n"));
      assert.deepEqual(JSON.parse(json.stdout).diagnostics, result.diagnostics);
      assert.equal(fs.existsSync(path.join(dir, "out.json")), false);
    });
  });
}

test("imported files retain their own source locations for compat, parse and resolution errors", () => {
  const imported = [
    { source: "// heading\nexport function helper() {\n  missingApi();\n}\n", line: 3, column: 3 },
    cases[1], cases[2], ...cases.slice(4).map(fixture => ({ ...fixture,
      source: fixture.source.replace("onStart(() => {", "export function helper() {").replace(/\}\);\n$/, "}\n") })),
  ];
  for (const fixture of imported) {
    withFiles({ "main.ts": 'import { helper } from "./lib";\nonStart(() => { helper(); });\n', "lib.ts": fixture.source }, dir => {
      const [diagnostic] = checkFile(path.join(dir, "main.ts"), { types: false }).diagnostics;
      assert.deepEqual([diagnostic.file, diagnostic.line, diagnostic.column], [sourcePath(path.join(dir, "lib.ts")), fixture.line, fixture.column]);
    });
  }
});

test("all parse errors remain separate structured diagnostics without embedded formatting", () => {
  withFiles({ "main.ts": "let a = ;\nlet b = ;\n" }, dir => {
    const result = checkFile(path.join(dir, "main.ts"), { types: false });
    assert.equal(result.diagnostics.length, 2);
    assert.deepEqual(result.diagnostics.map(d => [d.source, d.code, d.line, d.column, d.message]), [
      ["syntax", "TS1109", 1, 9, "Expression expected."],
      ["syntax", "TS1109", 2, 9, "Expression expected."],
    ]);
  });
});

test("helper synthesis in imported and entry files shares helper definitions", () => {
  withFiles({ "main.ts": 'import { helper } from "./lib"; onStart(() => { console.log(helper() + Math.sign(2)); console.log([1].reverse()); });',
    "lib.ts": 'export function helper() { console.log([2].reverse()); return Math.sign(1); }' }, dir => {
    assert.doesNotThrow(() => compileFile(path.join(dir, "main.ts")));
  });
});

test("missing callback locations do not retain the previous callback statement", () => {
  for (const prefix of ["", "let n = 1;\n"]) {
    const source = `${prefix}onStart(() => {\n  console.log(1);\n});\nonStart();\n`;
    withFiles({ "main.ts": source }, dir => {
      const [diagnostic] = checkFile(path.join(dir, "main.ts"), { types: false }).diagnostics;
      assert.equal(diagnostic.line, prefix ? 5 : 4);
      assert.equal(diagnostic.column, 1);
      assert.match(diagnostic.message, /Expected a block arrow callback/);
    });
  }
});

test("type checking does not duplicate identical parser diagnostics", () => {
  withFiles({ "main.ts": "let a = ;\nlet b = ;\n" }, dir => {
    const file = path.join(dir, "main.ts");
    for (const entry of [file, path.relative(root, file)]) {
      for (const types of [true, false]) {
        const result = checkFile(entry, { types });
        assert.equal(result.diagnostics.length, 2, JSON.stringify(result.diagnostics));
        assert.deepEqual(result.diagnostics.map(d => d.line), [1, 2]);
      }
    }
  });
});

test("diagnostics without source coordinates do not fabricate a location", () => {
  assert.equal(formatDiagnostic({ severity: "error", code: "NEKOC", message: "failed" }), "error NEKOC: failed");
  withFiles({}, dir => {
    const file = path.join(dir, "missing.ts");
    const [diagnostic] = checkFile(file, { types: false }).diagnostics;
    assert.equal(diagnostic.file, file);
    assert.equal(diagnostic.line, undefined);
    assert.equal(diagnostic.column, undefined);
    assert.match(formatDiagnostic(diagnostic), /missing\.ts: error NEKOC:/);
  });
});

test("npm API and CLI preserve compile locations and format check diagnostics", async () => {
  // Exercise the shipped JS entrypoints without building wasm: invalid programs
  // must fail in the frontend, before any wasm assembly or project validation.
  const dir = fs.mkdtempSync(path.join(tempRoot, "nekoc-tsdiag-package-"));
  try {
    fs.mkdirSync(path.join(dir, "dist/frontend"), { recursive: true });
    fs.mkdirSync(path.join(dir, "bin"));
    fs.copyFileSync(path.join(root, "packages/nekoc/api.mjs"), path.join(dir, "api.mjs"));
    fs.copyFileSync(path.join(root, "packages/nekoc/bin/nekoc.mjs"), path.join(dir, "bin/nekoc.mjs"));
    fs.writeFileSync(path.join(dir, "dist/frontend/compile-ts.mjs"), `export * from ${JSON.stringify(pathToFileURL(frontend).href)};`);
    fs.writeFileSync(path.join(dir, "dist/frontend/portable-path.mjs"), `export * from ${JSON.stringify(pathToFileURL(path.join(root, "ts/portable-path.mjs")).href)};`);
    const lib = path.join(root, "node_modules/typescript/lib");
    const resources = Object.fromEntries(fs.readdirSync(lib).filter(name => /^lib\..*\.d\.ts$/.test(name)).map(name => [name, fs.readFileSync(path.join(lib, name), "utf8")]));
    resources["nekoc.d.ts"] = fs.readFileSync(path.join(root, "ts/nekoc.d.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "dist/resources.mjs"), `export default ${JSON.stringify(resources)};`);
    fs.writeFileSync(path.join(dir, "index.mjs"), 'import { api } from "./api.mjs"; export const { compile, check, createPlayer, importProject } = api({});');
    fs.writeFileSync(path.join(dir, "frame.mjs"), 'export const decodeFrame = () => { throw new Error("unexpected player call"); };');
    const { compile, check } = await import(pathToFileURL(path.join(dir, "index.mjs")).href);
    for (const fixture of cases) {
      const entry = `/diagnostic-${fixture.name}.ts`;
      const files = { [entry]: fixture.source };
      const result = check(entry, { files, types: false });
      const [diagnostic] = result.diagnostics;
      assert.deepEqual([diagnostic.file, diagnostic.line, diagnostic.column], [entry, fixture.line, fixture.column]);
      assert.throws(() => compile(entry, { files }), error => {
        assert.deepEqual(error.location, { file: entry, line: fixture.line, column: fixture.column });
        assert.equal(error.message, diagnostic.message);
        return true;
      });
      const file = path.join(dir, `diagnostic-${fixture.name}.ts`);
      fs.writeFileSync(file, fixture.source);
      const cli = (...args) => spawnSync(process.execPath, [path.join(dir, "bin/nekoc.mjs"), ...args], { encoding: "utf8" });
      const build = cli("build", file);
      assert.equal(build.status, 1, build.stderr);
      assert.ok(build.stderr.includes(`${sourcePath(file)}:${fixture.line}:${fixture.column}: error ${diagnostic.code}:`), build.stderr);
      assert.doesNotMatch(build.stderr, /at offset/);
      const json = cli("check", file, "--json");
      assert.equal(json.status, 1, json.stderr);
      const checked = JSON.parse(json.stdout);
      const text = cli("check", file);
      assert.equal(text.status, 1, text.stderr);
      assert.equal(text.stdout.trim(), checked.diagnostics.map(formatDiagnostic).join("\n"));
      assert.ok(checked.diagnostics.some(d => d.line === fixture.line && d.column === fixture.column && d.code === diagnostic.code), JSON.stringify(checked));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("site compile catch preserves diagnostic code/location and clickable 1-based source positions", async () => {
  const elements = new Map();
  function element() {
    const children = new Map();
    return { value: "", textContent: "", rows: [], addEventListener() {}, append(row) { this.rows.push(row); },
      replaceChildren() { this.rows = []; }, querySelector(key) { if (!children.has(key)) children.set(key, element()); return children.get(key); },
      focus() {}, setSelectionRange(start, end) { this.selection = [start, end]; } };
  }
  const document = { querySelector(key) { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); }, createElement: element };
  const source = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
  const setup = new (Object.getPrototypeOf(async function() {}).constructor)("document", "fetch", "localStorage", "addEventListener",
    source.slice(0, source.lastIndexOf("await busy(")) + "\nreturn { busy, showDiagnostics };\n");
  const site = await setup(document, async () => ({ json: async () => [] }), { getItem: () => JSON.stringify({ code: cases[0].source }) }, () => {});
  for (const fixture of cases) {
    document.querySelector("#code").value = fixture.source;
    await site.busy(async () => compileFile("/main.ts", { readFile: name => name === path.resolve("/main.ts") ? fixture.source : undefined }));
    const [row] = document.querySelector("#diagnostics").rows;
    assert.equal(row.querySelector("b").textContent, `/main.ts:${fixture.line}:${fixture.column}`);
    assert.notEqual(row.querySelector("code").textContent, "internal");
    assert.doesNotMatch(row.querySelector("span").textContent, /at offset|main\.ts:\d+:\d+:/);
    row.onclick();
    const offset = fixture.source.split("\n").slice(0, fixture.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + fixture.column - 1;
    assert.deepEqual(document.querySelector("#code").selection, [offset, offset]);
  }
});
