type Item = {s: string; x: number};
const o = {s: "a", x: 1, flag: divisibleBy(4, 2)};
console.log(o.s + 2);
function get(): Item { return o; }
console.log(get().s + 3);
const a = [o];
const selected = a.map((v: Item) => v).filter((v: Item) => v.x === 1).slice();
selected.forEach((v: Item) => { console.log(v.s + 4); v.s += 5; });
console.log(o.s);
console.log(selected[0] === o);
console.log(o.flag);
function flag(value: boolean) { console.log(value); }
flag(divisibleBy(4, 2));
const acc = {x: 0};
for (const item of a) acc.x += item.x;
console.log(acc.x);
