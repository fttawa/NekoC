let trace = "";
const base = [1, 2];
let numbers = base.map(x => x * 2);
const point = {x: 1, nested: {n: 3}, length: 7};
point.x += 4;
trace += numbers.join(",");
point.nested.n = 8;
const alias = point;
alias["x"] = 9;
let ticks = 0;
const interval = setInterval(() => {
  ticks += 1;
  if (ticks >= 3) clearInterval(interval);
}, 20);
const canceled = setTimeout(() => { trace += "bad"; }, 50);
clearTimeout(canceled);
setTimeout(() => { trace += "timer"; }, 10);
onStart(() => {
  trace += "start";
  console.log(trace);
});
onStart(() => { trace += "second"; });
let sign = Math.sign(-4);
let cube = Math.cbrt(-27);
let logarithm = Math.log2(8);
let hypotenuse = Math.hypot(3, 4);
let integer = Number.isInteger(3.5);
let angle = Math.atan2(1, -1);
let generated = Array.from({length: 4}, (_, i) => i * 3);
let filled = Array(3).fill(7);
let repeated = 0;
function scheduleTwice() {
  return setTimeout(() => { repeated += 1; }, 30);
}
const firstTimer = scheduleTwice();
const secondTimer = scheduleTwice();
clearInterval(firstTimer);
let zeroTimer = 0;
setTimeout(() => { zeroTimer = 1; });
let compound = {n: 2};
let keyCalls = 0;
// Share-player object keys must be compile-time constants.
const compoundKey = "n";
keyCalls += 1;
compound[compoundKey] *= 3;
compound.n++;
let signs = [Math.sign(0), Math.sign(8)];
let angles = [Math.atan2(1, 0), Math.atan2(-1, 0), Math.atan2(-1, -1), Math.atan2(1, 1), Math.atan2(0, 0)];
let zeroHypot = Math.hypot();
let validInteger = Number.isInteger(4);
let generatedFraction = Array.from({length: 2.9}, (_, i) => i);
let filledObjects = new Array(2).fill({n: 1});
filledObjects[0].n = 5;
// Scalar observations: source-level objects are opaque handles in snapshots.
const pointX = point.x;
const pointNestedN = point.nested.n;
const pointLength = point.length;
const compoundN = compound.n;
const filledObjectN = filledObjects[1].n;
