import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { CompileError, checkFile, compileFile } from "../ts/compile-ts.mjs";

const entry = path.resolve("virtual/knobject-review-codegen/main.ts");
const hostFor = source => ({ readFile: name => name === entry ? source : undefined });
const compileSource = source => compileFile(entry, hostFor(source));

function workspaces(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (value.blocks && value.connections) found.push(value);
  for (const child of Object.values(value)) workspaces(child, found);
  return found;
}

function input(workspace, id, name) {
  const child = Object.entries(workspace.connections[id] ?? {})
    .find(([, connection]) => connection.type === "input" && connection.input_name === name);
  return child ? workspace.blocks[child[0]] : undefined;
}

function assertRejected(source, message, line) {
  assert.throws(() => compileSource(source), error => {
    assert.ok(error instanceof CompileError);
    assert.match(error.message, message);
    assert.doesNotMatch(error.message, /Unknown identifier|Maximum call stack/i);
    assert.equal(path.resolve(error.location.file), entry);
    assert.equal(error.location.line, line);
    assert.ok(error.location.column >= 1);
    return true;
  });
  const checked = checkFile(entry, { types: false, host: hostFor(source) });
  assert.equal(checked.ok, false);
  assert.match(checked.diagnostics[0].message, message);
  assert.equal(checked.diagnostics[0].line, line);
}

const stringConcats = [
  ["dot access", `const o = {s: "a"}; console.log(o.s + 2);`],
  ["literal element access", `const o = {s: "a"}; console.log(o["s"] + 2);`],
  ["string function return", `const o = {s: "a"}; function read(a: {s: string}): string { return a.s; } console.log(read(o) + 2);`],
  ["function parameter property", `function show(o: {s: string}) { console.log(o.s + 2); } show({s: "a"});`],
  ["typed callback property", `const items = [{s: "a"}]; items.forEach((item: {s: string}) => { console.log(item.s + 2); });`],
  ["left-associated chain", `const o = {s: "a"}; console.log(o.s + 2 + 3);`],
];
for (const [name, source] of stringConcats) {
  test(`review 1: string concat terminates and uses text_join for ${name}`, () => {
    const report = compileSource(source);
    assert.ok(workspaces(report).some(workspace => Object.values(workspace.blocks).some(block => block.type === "text_join")));
    assert.equal(checkFile(entry, { types: false, host: hostFor(source) }).ok, true);
  });
}

test("review 1: concat preserves numeric subexpressions and flattens only string additions", () => {
  const report = compileSource(`const o = {s: "a"}; console.log((2 + 3) + o.s + (4 + 5));`);
  const workspace = report.workspaceData;
  const join = Object.values(workspace.blocks).find(block => block.type === "text_join");
  assert.match(join.mutation, /items="3"/);
  assert.equal(input(workspace, join.id, "ADD0").fields.NUM, "5");
  assert.equal(input(workspace, join.id, "ADD1").type, "list_item");
  assert.equal(input(workspace, join.id, "ADD2").fields.NUM, "9");
});

// The emitted block's socket shape matters, not the expression's TS type.
// Include all Boolean-only shapes currently emitted by the frontend; some DSL
// APIs are intentionally absent from the host-only object type checker.
const booleanReporters = [
  ["divisibleBy(4, 2)", "divisible_by"],
  ['numberProperty(4, "EVEN")', "math_number_property"],
  ['keyPressed("space")', "check_key"],
  ['mouseTrigger("down", "--screen")', "mouse_down"],
  ['touching("--self", "--edge")', "bump_into"],
  ['touchingColor("--self", "#ffb029")', "bump_into_color"],
  ['outOfBoundary("0")', "out_of_boundary"],
  ['touchingBodyPart("--self", "nose")', "bump_into_body_part"],
  ["true", "logic_boolean"],
  ["1 === 2", "logic_compare"],
  ["true && false", "logic_operation"],
  ["!true", "logic_negate"],
  ['contains("abc", "b")', "text_contain"],
  ['listContains("items", 1)', "list_is_exist"],
];

function assertBoxedReporter(report, type) {
  let count = 0;
  for (const workspace of workspaces(report)) {
    for (const reporter of Object.values(workspace.blocks).filter(block => block.type === type)) {
      const parents = Object.entries(workspace.connections).flatMap(([id, children]) =>
        children[reporter.id] ? [[workspace.blocks[id], children[reporter.id]]] : []);
      const [box, connection] = parents.find(([parent]) => parent.type === "logic_ternary") ?? [];
      assert.ok(box, `${type} must connect to an any-shaped ternary, never directly to a procedure socket`);
      assert.equal(connection.input_name, "condition");
      assert.equal(reporter.parent_id, box.id, "block parent and connection owner must agree");
      for (const [name, expected] of [["ifTrue", true], ["ifFalse", false]]) {
        const branch = input(workspace, box.id, name);
        assert.equal(branch.type, "variables_get");
        assert.equal(report.initialValues[branch.fields.variable], expected, "boxing preserves boolean values, not strings");
      }
      assert.ok(Object.entries(workspace.connections).some(([id, children]) => children[box.id]
        && /^procedures_2_call/.test(workspace.blocks[id].type)), "procedure must consume the box");
      count++;
    }
  }
  assert.equal(count, 1, "the reporter must be evaluated exactly once");
}

for (const [expression, type] of booleanReporters) {
  test(`review 2: object initializer boxes the actual ${type} output shape`, () => {
    assertBoxedReporter(compileSource(`const object = {flag: ${expression}}; console.log(object.flag);`), type);
  });
  test(`review 2: ordinary procedure argument boxes the actual ${type} output shape`, () => {
    assertBoxedReporter(compileSource(`function echo(value: boolean): boolean { if (value) return value; return value; } console.log(echo(${expression}));`), type);
  });
}

test("review 2: scalar-shaped boolean conversion is not boxed based on its TS return type", () => {
  const report = compileSource(`const object = {flag: toBoolean(1)}; console.log(object.flag);`);
  const workspace = report.workspaceData;
  const conversion = Object.values(workspace.blocks).find(block => block.type === "convert_type");
  assert.ok(conversion);
  assert.ok(Object.entries(workspace.connections).some(([id, children]) => children[conversion.id]
    && workspace.blocks[id].type === "procedures_2_callreturn"));
  assert.ok(!Object.values(workspace.blocks).some(block => block.type === "logic_ternary"));
});

test("review 2: boxing an effectful Boolean API keeps a single reporter/argument evaluation", () => {
  const report = compileSource(`let calls = 0;
function next() { calls += 1; return 4; }
const object = {flag: divisibleBy(next(), 2)};
console.log(object.flag);`);
  assertBoxedReporter(report, "divisible_by");
  const nextCalls = workspaces(report).flatMap(workspace => Object.values(workspace.blocks))
    .filter(block => block.type === "procedures_2_callreturn" && block.fields.NAME === "kn-proc-fn-next");
  assert.equal(nextCalls.length, 1);
});

for (const [name, operation] of [
  ["read", "console.log(object[key()]);"],
  ["write", "object[key()] = 2;"],
  ["compound assignment", "object[key()] += 2;"],
  ["update", "object[key()]++;"],
  ["assertion wrapper", 'console.log(object[(key() as "x")]);'],
]) {
  test(`review 3: literal-typed effectful key is rejected for ${name}`, () => {
    assertRejected(`let calls = 0;
function key(): "x" { calls += 1; return "x"; }
const object = {x: 1};
${operation}`, /keys.*side-effect-free.*const identifier/i, 4);
  });
}

test("review 3: indexed literal-typed key cannot erase index() side effects", () => {
  assertRejected(`const keys: "x"[] = ["x"];
function index() { return 0; }
const object = {x: 1};
console.log(object[keys[index()]]);`, /keys.*side-effect-free/i, 4);
});

test("review 3: mutable literal-typed keys are rejected rather than assumed constant", () => {
  assertRejected(`let key: "x" = "x";
const object = {x: 1};
console.log(object[key]);`, /keys.*side-effect-free/i, 3);
});

test("review 3: const identifier initialized by an effectful call is read, not reevaluated", () => {
  const report = compileSource(`let calls = 0;
function key(): "x" { calls += 1; return "x"; }
const KEY = key();
const object = {x: 1};
console.log(object[(KEY as "x")]);`);
  const calls = Object.values(report.workspaceData.blocks).filter(block => block.type === "procedures_2_callreturn"
    && block.fields.NAME === "kn-proc-fn-key");
  assert.equal(calls.length, 1, "the const initializer still executes exactly once");
});

// Defaults are expanded at the call site and must stay constant after earlier
// arguments are substituted (shared rule with tsdiag); object reads are not.
const parameterDefaults = [
  ["object property", `const object = {x: 3};
function read(a: {x: number}, b: number = a.x) { return b; }
console.log(read(object));`, 3],
  ["arrow parameter", `const object = {x: 3};
const read = (a: {x: number}, b: number = a.x) => b;
console.log(read(object));`, 3],
];
for (const [name, source, line] of parameterDefaults) {
  test(`review 9: omitted default depending on ${name} gives actionable call-site diagnostic`, () => {
    assertRejected(source, /Default parameter b requires a literal or constant numeric expression/, line);
  });
}

for (const [name, source] of [
  ["scalar parameter in object program", `const unused = {x: 1};
function read(a: number, b: number = a + 1) { return b; }
console.log(read(3));`],
  ["scalar parameter in object-free procedure", `function read(a: number, b: number = a + 1) { if (a) return b; return 0; }
console.log(read(3));`],
]) {
  test(`review 9: constant ${name} default expands at the call site`, () => {
    compileSource(source);
  });
}

test("review 9: explicitly supplied argument bypasses a parameter-dependent default", () => {
  compileSource(`const object = {x: 3}; function read(a: {x: number}, b: number = a.x) { return b; } console.log(read(object, object.x));`);
});

test("review 9: non-constant object defaults reject instead of reading in the caller scope", () => {
  assertRejected(`const fallback = {a: 3}; function read(a: number, b: number = fallback.a) { return b; } console.log(read(1));`,
    /Default parameter b requires a literal or constant numeric expression/, 1);
});

test("review 9: scalar inline defaults keep their existing callee binding behavior", () => {
  compileSource(`function read(a: number, b: number = a + 1) { return b; } console.log(read(3));`);
});
