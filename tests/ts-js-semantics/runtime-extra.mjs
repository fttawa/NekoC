// Additional matches for the declaration/default-argument fixes. Kept separate
// from the unmodified 245 original probes and their historical main baseline.
const c = (name, top, body) => ({ cat: "declaration fixes", name, top, body, status: "match" });
export const cases = [
  c("default omitted", "function b1(x = 7) { return x; }", "out = b1();"),
  c("default explicit undefined", "function b1(x = 7) { return x; }", "out = b1(undefined);"),
  c("default zero", "function b1(x = 7) { return x; }", "out = b1(0);"),
  c("default previous parameter", "function f(a: number, b = a + 2) { return b; }", "out = f(3);"),
  c("chained defaults", "function f(a = 1, b = a + 2, c = b + 3) { return c; }", "out = f();"),
  c("parenthesized undefined", "function f(a = 7) { return a; }", "out = f((undefined));"),
  c("parenthesized string default", 'function f(a = ("ok")) { return a; }', "out = f();"),
  c("recursive default", "function f(n: number, step = 2): number { return n <= 0 ? 0 : step + f(n - 1); }", "out = f(4);"),
  c("local type", "", "type N = number; const n: N = 3; out = n;"),
  c("local interface", "", "interface P { x: number } out = 4;"),
  c("local declare", "", "declare const unused: number; out = 5;"),
  c("type namespace", "namespace Types { export interface P { x: number } export type N = number; }", "out = 6;"),
  c("overload", "function f(x: number): number; function f(x: number) { return x + 1; }", "out = f(7);"),
];
