import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [inputPath] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatValue(value) {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createExpect(actual) {
  return {
    toBe(expected) {
      assert(Object.is(actual, expected), `Expected ${formatValue(actual)} to be ${formatValue(expected)}`);
    },
    toEqual(expected) {
      assert(deepEqual(actual, expected), `Expected ${formatValue(actual)} to equal ${formatValue(expected)}`);
    },
    toBeTruthy() {
      assert(Boolean(actual), `Expected ${formatValue(actual)} to be truthy`);
    },
    toBeFalsy() {
      assert(!actual, `Expected ${formatValue(actual)} to be falsy`);
    },
    toContain(expected) {
      assert(actual?.includes?.(expected), `Expected ${formatValue(actual)} to contain ${formatValue(expected)}`);
    },
  };
}

class TypeScriptTestRunner {
  constructor(entryPath) {
    this.entryPath = path.resolve(entryPath);
    this.entryDir = path.dirname(this.entryPath);
    this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nekoc-test-"));
    this.compiled = new Set();
    this.tests = [];
  }

  async run() {
    const entryOut = this.compileModule(this.entryPath, true);
    globalThis.__nekocTest = (name, body) => {
      this.tests.push({ name, body });
    };
    globalThis.__nekocExpect = createExpect;

    await import(pathToFileURL(entryOut).href);

    let failures = 0;
    for (const testCase of this.tests) {
      try {
        await testCase.body();
        console.log(`ok ${testCase.name}`);
      } catch (error) {
        failures += 1;
        console.error(`fail ${testCase.name}`);
        console.error(error?.message ?? String(error));
      }
    }

    if (this.tests.length === 0) {
      console.log("0 tests");
      return;
    }

    if (failures > 0) {
      fail(`${failures} failed, ${this.tests.length - failures} passed`);
    }
    console.log(`${this.tests.length} passed`);
  }

  compileModule(sourcePath, isEntry) {
    const resolved = path.resolve(sourcePath);
    if (this.compiled.has(resolved)) {
      return this.outputPathFor(resolved);
    }
    this.compiled.add(resolved);

    const sourceText = fs.readFileSync(resolved, "utf8");
    const sourceFile = ts.createSourceFile(
      resolved,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    sourceFile.statements.forEach((statement) => {
      if (!ts.isImportDeclaration(statement) && !isExportDeclarationWithModule(statement)) {
        return;
      }
      const specifier = importModuleSpecifier(statement);
      if (specifier?.startsWith(".")) {
        const imported = this.resolveImportPath(resolved, specifier);
        this.compileModule(imported, false);
      }
    });

    const rewritten = rewriteRelativeImports(sourceText, (specifier) => {
      const imported = this.resolveImportPath(resolved, specifier);
      return relativeImportSpecifier(path.dirname(this.outputPathFor(resolved)), this.outputPathFor(imported));
    });
    const prelude = isEntry ? testPrelude() : "";
    const transpiled = ts.transpileModule(`${prelude}${rewritten}`, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: resolved,
    });

    const outputPath = this.outputPathFor(resolved);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, transpiled.outputText, "utf8");
    return outputPath;
  }

  resolveImportPath(fromPath, modulePath) {
    const basePath = path.resolve(path.dirname(fromPath), modulePath);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      path.join(basePath, "index.ts"),
    ];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) {
      fail(`Unable to resolve import ${modulePath} from ${fromPath}`);
    }
    return resolved;
  }

  outputPathFor(sourcePath) {
    const relative = path.relative(this.entryDir, sourcePath);
    const safeRelative = relative.startsWith("..") ? path.basename(sourcePath) : relative;
    return path.join(this.outDir, safeRelative).replace(/\.ts$/, ".mjs");
  }
}

function importModuleSpecifier(statement) {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    return statement.moduleSpecifier.text;
  }
  if (isExportDeclarationWithModule(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    return statement.moduleSpecifier.text;
  }
  return null;
}

function isExportDeclarationWithModule(statement) {
  return ts.isExportDeclaration(statement) && statement.moduleSpecifier;
}

function rewriteRelativeImports(sourceText, rewrite) {
  return sourceText.replace(
    /((?:import|export)\s+(?:[^'"]*?\s+from\s+)?|import\s*\(\s*)(["'])(\.[^"']+)\2/g,
    (match, prefix, quote, specifier) => `${prefix}${quote}${rewrite(specifier)}${quote}`,
  );
}

function relativeImportSpecifier(fromDir, toPath) {
  let relative = path.relative(fromDir, toPath).replaceAll(path.sep, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

function testPrelude() {
  const dslNames = [
    "stage",
    "screen",
    "sprite",
    "onStart",
    "onClick",
    "onKey",
    "onMessage",
    "when",
    "wait",
    "waitUntil",
    "forever",
    "repeatTimes",
    "repeatUntil",
    "ifThen",
    "ifElse",
    "broadcast",
    "broadcastAndWait",
    "setVar",
    "changeVar",
    "getVar",
    "showVariable",
    "hideVariable",
    "appendList",
    "insertList",
    "replaceListItem",
    "deleteListItem",
    "copyList",
    "showList",
    "hideList",
    "getList",
    "listItem",
    "listLength",
    "listIndexOf",
    "listContains",
    "tempList",
  ];
  const dslStubs = dslNames.map((name) => `const ${name}=()=>undefined;`).join("");
  return `const test=globalThis.__nekocTest;const expect=globalThis.__nekocExpect;${dslStubs}\n`;
}

function main() {
  if (!inputPath) {
    fail("usage: node test-ts.mjs <input.ts>");
  }
  const runner = new TypeScriptTestRunner(inputPath);
  runner.run().catch((error) => {
    fail(error?.stack ?? error?.message ?? String(error));
  });
}

main();
