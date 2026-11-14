import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { CompileError, compileFile } from "../ts/compile-ts.mjs";

const fixture = readFileSync(new URL("./fixtures/ts-share-objects.ts", import.meta.url), "utf8");

// Kept literal and independent of the compiler. Rust CLI integration can build
// tests/fixtures/ts-share-objects.ts, run it with --ticks 120, and compare the
// report's logs to this same sequence (see tests/cli_run.rs for that pattern).
const expectedLogs = [
  "alias", "12", "1", "true",
  "fresh objects and arguments", "8", "3", "false", "10", "1", "3",
  "13", "true", "7", "2", "4",
  "nested", "20", "20", "10", "4", "20",
  "array members", "22", "14", "7", "3", "23",
  "reference evaluated once", "12", "1", "1", "13", "1", "13", "5",
  "compound assignments", "15", "12", "24", "6", "2", "8", "ab", "ab2",
  "9", "10", "9", "8",
  "static keys", "9", "ok", "6", "4",
];

function compileSource(source, modules = {}) {
  const entry = path.resolve("virtual/ts-share-objects/main.ts");
  const files = new Map([[entry, source]]);
  for (const [name, text] of Object.entries(modules)) {
    files.set(path.resolve(path.dirname(entry), name), text);
  }
  const reads = [];
  const report = compileFile(entry, {
    readFile(name) {
      reads.push(name);
      return files.get(name);
    },
  });
  assert.equal(reads[0], entry);
  return report;
}

// Walk the *entire* report, not just report.workspaceData.blocks: procedure
// definitions and sprites/screens own isolated workspaces too.
function reportBlocks(value, location = "report", found = []) {
  if (!value || typeof value !== "object") return found;
  if (value.blocks && typeof value.blocks === "object") {
    for (const [id, block] of Object.entries(value.blocks)) {
      found.push({ block, location: `${location}.blocks[${id}]` });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    reportBlocks(child, `${location}.${key}`, found);
  }
  return found;
}

function assertOfficialObjectLowering(report) {
  const blocks = reportBlocks(report);
  assert.ok(blocks.length > 0, "must inspect actual workspace blocks");
  for (const { block, location } of blocks) {
    assert.equal(typeof block.type, "string", location);
    assert.ok(!block.type.startsWith("_object_"), `${location}: private ${block.type} is not editor-compatible`);
  }
  // Do not prescribe internal heap names, the number of backing lists, or the
  // exact allocation strategy. Require actual official list reads and writes.
  const types = new Set(blocks.map(({ block }) => block.type));
  assert.ok(types.has("list_item"), "object properties must read from the global list heap");
  assert.ok([...types].some(type => /^list_(?:append|insert|replace|set)/.test(type)),
    "object properties must allocate/update the global list heap");
  return blocks;
}

function assertRejected(source, message) {
  assert.throws(() => compileSource(source), error => {
    assert.ok(error instanceof CompileError, "unsupported objects must produce a frontend CompileError");
    assert.match(error.message, message);
    assert.ok(error.location, "diagnostic must point to source, not fail internally");
    assert.ok(error.location.line >= 1);
    assert.ok(error.location.column >= 1);
    assert.equal(path.resolve(error.location.file), path.resolve("virtual/ts-share-objects/main.ts"));
    return true;
  });
}

test("shared-object fixture has an independent scalar-only JavaScript oracle", () => {
  const logs = [];
  vm.runInNewContext(stripTypeScriptTypes(fixture), {
    console: {
      log(value) {
        assert.ok(["number", "string", "boolean"].includes(typeof value), "log scalars, never serialized handles");
        logs.push(String(value));
      },
    },
  }, { filename: "ts-share-objects.js", timeout: 10_000 });
  assert.deepEqual(logs, expectedLogs);
});

test("literal, alias, nested, array, function and compound/update fixture uses only official blocks", () => {
  assertOfficialObjectLowering(compileSource(fixture));
});

const positives = [
  ["initialized properties and later static writes", `
    const object = { value: 0 };
    const alias = object;
    alias.value = 3;
    console.log(object.value);
  `],
  ["literal and constant string/numeric keys", `
    const KEY = "value";
    const INDEX = 2;
    const object = { value: 1, "display-name": "a", 2: 4 };
    object[KEY] += 2;
    object[INDEX] *= 3;
    object["display-name"] += "b";
    console.log(object.value);
    console.log(object[2]);
  `],
  ["nested literals and aliases surviving parent replacement", `
    const parent = { child: { value: 1 } };
    const oldChild = parent.child;
    parent.child = { value: 5 };
    oldChild.value += 2;
    console.log(parent.child.value);
    console.log(oldChild.value);
  `],
  ["object-valued arguments, fresh returns and reference equality", `
    let calls = 0;
    function make() { calls += 1; return { value: 2 }; }
    function mutate(object: { value: number }) { object.value += 3; return object; }
    const a = mutate(make());
    const b = mutate(make());
    console.log(a.value);
    console.log(a === b);
    console.log(calls);
  `],
  ["objects in arrays and arrays in objects", `
    const item = { value: 1 };
    const container = { items: [item] };
    const items = [item];
    items.push({ value: 2 });
    items[0].value++;
    container.items[0].value += 3;
    console.log(item.value);
  `],
  ["prefix/postfix updates as statements", `
    const object = { value: 1 };
    object.value++;
    ++object.value;
    object.value--;
    --object.value;
    console.log(object.value);
  `],
];

for (const [name, source] of positives) {
  test(`shared objects compile: ${name}`, () => {
    assertOfficialObjectLowering(compileSource(source));
  });
}

for (const operator of ["+=", "-=", "*=", "/=", "%=", "**="]) {
  test(`object compound assignment compiles independently: ${operator}`, () => {
    assertOfficialObjectLowering(compileSource(`
      const object = { value: 8 };
      object.value ${operator} 2;
      console.log(object.value);
    `));
  });
}

test("string-valued object += is concatenation rather than numeric handle arithmetic", () => {
  const report = compileSource(`
    const object = { text: "a" };
    object.text += "b";
    object.text += 2;
    console.log(object.text);
  `);
  const blocks = assertOfficialObjectLowering(report);
  assert.ok(blocks.some(({ block }) => /^text_(?:join|append)/.test(block.type)), "use string concatenation blocks");
});

test("object lowering is also applied inside custom procedures, sprites and screens", () => {
  const report = compileSource(`
    const shared = { value: 1 };
    defineProc("mutate", [], () => { shared.value += 1; });
    defineReporter("read", [], () => { return shared.value; });
    sprite("cat", {}, () => {
      onStart(() => { const local = { value: 3 }; shared.value += local.value; console.log(shared.value); });
    });
    screen("other", {}, () => {
      sprite("dog", {}, () => {
        onStart(() => { const otherLocal = { value: 4 }; otherLocal.value++; console.log(otherLocal.value); });
      });
    });
    onStart(() => { shared.value++; });
  `);
  const blocks = assertOfficialObjectLowering(report);
  assert.ok(blocks.some(({ location }) => location.startsWith("report.procedures.")), "inspect procedure blocks");
  assert.ok(blocks.some(({ location }) => location.includes("resources.sprites.")), "inspect root sprite blocks");
  assert.ok(blocks.some(({ location }) => location.includes("resources.screens.")), "inspect screen sprite blocks");
});

test("shared object arguments and returns across memory-host imports use the same heap", () => {
  const report = compileSource(`
    import { make, mutate } from "./objects";
    const original = make(2);
    const alias = mutate(original);
    alias.value += 1;
    console.log(original.value);
  `, {
    "objects.ts": `
      export function make(value: number) { return { value: value }; }
      export function mutate(object: { value: number }) { object.value += 3; return object; }
    `,
  });
  assertOfficialObjectLowering(report);
});

test("root timer callbacks share object handles without private object blocks", () => {
  const report = compileSource(`
    const state = { value: 1, nested: { value: 2 } };
    const alias = state;
    const timeout = setTimeout(() => { alias.value += 3; console.log(state.value); }, 0);
    const interval = setInterval(() => { state.nested.value++; console.log(alias.nested.value); }, 20);
    setTimeout(() => { clearInterval(interval); }, 100);
  `);
  const blocks = assertOfficialObjectLowering(report);
  assert.ok(blocks.some(({ block }) => block.type === "console_log"), "compile callback bodies, not just timer setup");
});

const keyDiagnostic = /(?:static|constant|dynamic|computed)[\s\S]*(?:key|propert)|(?:key|propert)[\s\S]*(?:static|constant|dynamic|computed)/i;
const dynamicKeys = [
  ["read", `let key = "value"; const object = { value: 1 }; console.log(object[key]);`],
  ["write", `let key = "value"; const object = { value: 1 }; object[key] = 2;`],
  ["compound write", `let key = "value"; const object = { value: 1 }; object[key] += 2;`],
  ["update", `let key = "value"; const object = { value: 1 }; object[key]++;`],
  ["function argument key", `function read(key: string) { const object = { value: 1 }; return object[key]; } console.log(read("value"));`],
  ["side-effecting key", `let calls = 0; function key() { calls += 1; return "value"; } const object = { value: 1 }; console.log(object[key()]);`],
  ["computed literal", `let key = "value"; const object = { [key]: 1 }; console.log(object.value);`],
];
// object[key] += 2 has an index-signature (any) type, so the shared + / +=
// type check rejects it first; that diagnostic is equally actionable.
const additionDiagnostic = /Cannot determine JavaScript \+ \/ \+= semantics/;
for (const [name, source] of dynamicKeys) {
  test(`dynamic object key rejected with a useful diagnostic: ${name}`, () =>
    assertRejected(source, name === "compound write" ? new RegExp(`${keyDiagnostic.source}|${additionDiagnostic.source}`, "i") : keyDiagnostic));
}

const unsupported = [
  ["unknown alias", `const object = {x: 7}; const alias: unknown = object; console.log(String(alias));`, /shape|unknown/i],
  ["unknown cast", `const object = {x: 7}; console.log(Number(object as unknown));`, /shape|unknown/i],
  ["unknown assignment", `const object = {x: 7}; let alias: unknown = 0; alias = object;`, /shape|unknown/i],
  ["unknown return", `function make(): unknown { return {x: 7}; } console.log(String(make()));`, /shape|unknown/i],
  ["unknown arrow return", `const make = (): unknown => ({x: 7}); console.log(String(make()));`, /shape|unknown/i],
  ["unknown property initializer", `const box: {payload: unknown} = {payload: {x: 7}}; console.log(String(box.payload));`, /shape|unknown/i],
  ["unknown array initializer", `const items: unknown[] = [{x: 7}]; console.log(String(items[0]));`, /shape|unknown/i],
  ["asserted missing property", `const seed = {x: 1}; const object = {} as {x: number}; console.log(object.x);`, /initializ|shape/i],
  ["unknown parameter coercion", `function show(value: unknown) { console.log(String(value)); } show({x: 7});`, /shape|unknown/i],
  ["any parameter coercion", `function show(value: any) { console.log(value); } show({x: 7});`, /shape|any/i],
  ["self text coercion", `const object = {x: 7}; self.say(object);`, /coercion|scalar/i],
  ["union optional property", `function make(n: number): {x: number} | {x?: number} { if (n) return {x: 1}; return {}; } console.log(make(0).x);`, /union|shape/i],
  ["union object array join", `const items: ({x: number} | number)[] = [{x: 1}, 2]; console.log(items.join(","));`, /coercion|scalar/i],
  ["text API coercion", `const object = {x: 7}; say(object);`, /coercion|scalar/i],
  ["object logical selection", `const a = {x: 1}; const b = {x: 2}; const selected = a || b; console.log(selected.x);`, /coercion|scalar/i],
  ["callback optional property", `const items = [{}]; const unused = {x: 1}; items.forEach((item: {x?: number}) => console.log(item.x));`, /present|optional/i],
  ["recursive callback locals", `function f(n: number) { const local = {value: n}; if (n > 0) [n - 1].forEach((next: number) => f(next)); console.log(local.value); } f(2);`, /recursive|iterative/i],
  ["recursive property update", `const state = {value: 0}; function f(n: number) { state.value++; if (n > 0) f(n - 1); } f(2);`, /recursive|iterative/i],
  ["object cast to any", `const object = { value: 1 }; console.log(String(object as any));`, /any|shape/i],
  ["untyped parameter", `function f(object) { return object.value; } console.log(f({ value: 1 }));`, /annotat|shape/i],
  ["optional property", `function f(object: { value?: number }) { return object.value; } console.log(f({ value: 1 }));`, /present|optional/i],
  ["object/scalar equality", `const object = { value: 1 }; console.log(object === 1);`, /compar|scalar/i],
  ["object array join", `const objects = [{value:1}]; console.log(objects.join(","));`, /coercion|scalar/i],
  ["object conditional", `const object = true ? {value:1} : {value:2};`, /if\/else|conditional/i],
  ["missing property", `const object = { value: 1 }; console.log(object.missing);`, /present|initializ|missing/i],
  ["adding property", `const object = {}; object.value = 1;`, /present|initializ|missing/i],
  ["JSON serialization", `const object = { value: 1 }; console.log(JSON.stringify(object));`, /JSON|serializ/i],
  ["JSON parsing", `const object = JSON.parse('{"value":1}'); console.log(object.value);`, /JSON|serializ/i],
  ["direct object logging", `const object = { value: 1 }; console.log(object);`, /object|coerci|scalar|log/i],
  ["String coercion", `const object = { value: 1 }; console.log(String(object));`, /object|coerci|String/i],
  ["Number coercion", `const object = { value: 1 }; console.log(Number(object));`, /object|coerci|Number/i],
  ["template coercion", 'const object = { value: 1 }; console.log(`${object}`);', /object|coerci|template/i],
  ["string addition coercion", `const object = { value: 1 }; console.log("value=" + object);`, /object|coerci|string/i],
  ["unary numeric coercion", `const object = { value: 1 }; console.log(+object);`, /object|coerci|number|numeric/i],
  ["numeric arithmetic coercion", `const object = { value: 1 }; console.log(object * 2);`, /object|coerci|number|numeric/i],
  ["delete", `const object = { value: 1 }; delete object.value;`, /delete/i],
  ["spread", `const original = { value: 1 }; const object = { ...original };`, /spread|data propert/i],
  ["method", `const object = { value() { return 1; } };`, /method|data propert/i],
  ["getter", `const object = { get value() { return 1; } };`, /accessor|getter|data propert/i],
  ["setter", `const object = { set value(value: number) {} };`, /accessor|setter|data propert/i],
];
for (const [name, source, message] of unsupported) {
  test(`unsupported object operation rejected: ${name}`, () => assertRejected(source, message));
}

test("typed object callbacks preserve string concatenation instead of handle arithmetic", () => {
  const report = compileSource(`const items = [{text: "a"}]; items.forEach((item: {text: string}) => { item.text += 2; console.log(item.text); });`);
  const blocks = assertOfficialObjectLowering(report);
  assert.ok(blocks.some(({ block }) => block.type === "text_join"));
});

test("object callbacks retain module-local type aliases across helper synthesis", () => {
  const report = compileSource(`import {value} from "./helper"; type Item = {text: string}; const items = [{text: "a"}]; items.forEach((item: Item) => { item.text += 2; }); console.log(items[0].text);`, {
    "helper.ts": "export function value() { return 1; }",
  });
  assert.ok(assertOfficialObjectLowering(report).some(({block}) => block.type === "text_join"));
});

test("object type queries do not change scalar nested-array helper inference", () => {
  const report = compileSource(`const g = [0, 1, 2].map((r) => [r, r * 2]); console.log(g[2][1]);`);
  assert.ok(reportBlocks(report).some(({block}) => block.type === "list_item"));
});

const valuedUpdates = [
  ["postfix initialization", `const object = { value: 1 }; const result = object.value++; console.log(result);`],
  ["prefix initialization", `const object = { value: 1 }; const result = ++object.value; console.log(result);`],
  ["postfix decrement argument", `const object = { value: 1 }; console.log(object.value--);`],
  ["prefix decrement argument", `const object = { value: 1 }; console.log(--object.value);`],
  ["nested arithmetic", `const object = { value: 1 }; console.log(2 + object.value++);`],
  ["function return", `function next(object: { value: number }) { return object.value++; } console.log(next({ value: 1 }));`],
];
for (const [name, source] of valuedUpdates) {
  test(`value-producing object update rejected with statement guidance: ${name}`, () => {
    assertRejected(source, /(?:\+\+|--|update|increment|decrement)[\s\S]*(?:statement|separate)|(?:statement|separate)[\s\S]*(?:\+\+|--|update|increment|decrement)/i);
  });
}
