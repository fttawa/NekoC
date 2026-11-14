// This fixture deliberately uses only synchronous JavaScript plus erasable TS
// types. Run it through node:module stripTypeScriptTypes for the JS oracle;
// no onStart shim, timers, object serialization or object-valued logs are needed.
type Cell = { value: number; text: string };

const VALUE_KEY = "value";
let allocations = 0;
let argumentCalls = 0;
let targetCalls = 0;
let rhsCalls = 0;
let indexCalls = 0;
let initializerCalls = 0;

function initialValue(): number {
  initializerCalls += 1;
  return 10;
}

const root = { value: initialValue(), text: "a" };
const alias = root;
alias[VALUE_KEY] += 2;
console.log("alias");
console.log(root.value);
console.log(initializerCalls);
console.log(alias === root);

function makeCell(value: number): Cell {
  allocations += 1;
  return { value: value, text: "cell" };
}

function makeArgument(): Cell {
  argumentCalls += 1;
  return makeCell(5);
}

function readTwice(cell: Cell): number {
  return cell.value + cell.value;
}

function mutateAndReturn(cell: Cell, amount: number): Cell {
  cell.value += amount;
  return cell;
}

const first = makeCell(3);
const second = makeCell(3);
first.value = 8;
console.log("fresh objects and arguments");
console.log(first.value);
console.log(second.value);
console.log(first === second);
console.log(readTwice(makeArgument()));
console.log(argumentCalls);
console.log(allocations);
const returned = mutateAndReturn(first, 4);
returned.value += 1;
console.log(first.value);
console.log(returned === first);
const returnedArgument = mutateAndReturn(makeArgument(), 2);
console.log(returnedArgument.value);
console.log(argumentCalls);
console.log(allocations);

const nested = { child: root, own: { value: 7 }, label: "outer" };
const childAlias = nested.child;
childAlias.value = 20;
nested.own.value += 3;
console.log("nested");
console.log(root.value);
console.log(nested.child.value);
console.log(nested.own.value);
nested.child = second;
nested.child.value += 1;
console.log(second.value);
console.log(root.value);

const cells = [root, first];
cells[0].value += 2;
cells.push(second);
cells[2].value += 3;
const fromArray = cells[1];
fromArray.value += 1;
console.log("array members");
console.log(root.value);
console.log(first.value);
console.log(second.value);
console.log(cells.length);
const holder = { cells: cells };
holder.cells[0].value += 1;
console.log(root.value);

function target(): Cell {
  targetCalls += 1;
  return root;
}

function rhs(): number {
  rhsCalls += 1;
  // Compound assignment reads the old value before evaluating its RHS.
  root.value = 100;
  return 2;
}

function index(): number {
  indexCalls += 1;
  return 0;
}

root.value = 10;
target().value += rhs();
console.log("reference evaluated once");
console.log(root.value);
console.log(targetCalls);
console.log(rhsCalls);
cells[index()].value += 1;
console.log(root.value);
console.log(indexCalls);
target().value++;
++target().value;
target().value--;
--target().value;
console.log(root.value);
console.log(targetCalls);

// All six arithmetic compound assignments, then string concatenation. Log each
// result so an incorrect operator cannot be hidden by a later overwrite.
const arithmetic = { value: 10, text: "a" };
console.log("compound assignments");
arithmetic.value += 5;
console.log(arithmetic.value);
arithmetic.value -= 3;
console.log(arithmetic.value);
arithmetic.value *= 2;
console.log(arithmetic.value);
arithmetic.value /= 4;
console.log(arithmetic.value);
arithmetic.value %= 4;
console.log(arithmetic.value);
arithmetic.value **= 3;
console.log(arithmetic.value);
arithmetic.text += "b";
console.log(arithmetic.text);
arithmetic.text += 2;
console.log(arithmetic.text);
arithmetic.value++;
console.log(arithmetic.value);
++arithmetic.value;
console.log(arithmetic.value);
arithmetic.value--;
console.log(arithmetic.value);
--arithmetic.value;
console.log(arithmetic.value);

const shorthand = 9;
const unusualKeys = { shorthand, "display-name": "ok", 2: 6, length: 4 };
console.log("static keys");
console.log(unusualKeys.shorthand);
console.log(unusualKeys["display-name"]);
console.log(unusualKeys[2]);
console.log(unusualKeys.length);
