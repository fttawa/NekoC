import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { evaluateStaticNumericCall } from "../ts/tsstr-numeric.mjs";

function expression(source) {
  const file = ts.createSourceFile("numeric.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, source);
  return file.statements[0].expression;
}

function check(source, expected) {
  const result = evaluateStaticNumericCall(expression(source));
  assert.notEqual(result, null, source);
  assert.equal(typeof result.value, "number", source);
  assert.ok(Object.is(result.value, expected), `${source}: expected ${String(expected)}, got ${String(result.value)}`);
}

test("Number follows JS whole-string conversion, not parseFloat prefix parsing", () => {
  const cases = [
    ["", 0], [" ", 0], ["\t\r\n\u00a0\ufeff", 0],
    ["42", 42], ["42px", NaN], ["+42", 42], ["-42", -42],
    ["  -42  ", -42], ["+ 42", NaN], ["--42", NaN],
    ["1.5", 1.5], [".5", 0.5], ["1.", 1], ["1e3", 1000],
    ["1e-3", 0.001], ["1e", NaN], ["1e+", NaN],
    ["0x2a", 42], ["0X2A", 42], ["0b101", 5], ["0o52", 42],
    ["-0x2a", NaN], ["+0x2a", NaN], ["0x", NaN], ["0b2", NaN],
    ["012", 12], ["1_000", NaN], ["1,000", NaN],
    ["Infinity", Infinity], ["+Infinity", Infinity], ["-Infinity", -Infinity],
    ["Infinitypx", NaN], ["infinity", NaN], ["NaN", NaN],
    ["1e309", Infinity], ["-1e309", -Infinity], ["-0", -0],
    ["-0.0", -0], ["-1e-9999", -0], ["\u200b42", NaN],
  ];
  for (const [input, expected] of cases) check(`Number(${JSON.stringify(input)})`, expected);
  check("Number()", 0);
  check("Number(true)", 1);
  check("Number(false)", 0);
  check("Number(null)", 0);
  check("Number(-0)", -0);
  check("Number(1e309)", Infinity);
  check("Number(1_000)", 1000);
  check("Number(0x2a)", 42);
  check("Number(0b101)", 5);
  check("Number(0o52)", 42);
});

test("parseInt handles signs, prefixes, truncation, and negative zero", () => {
  const cases = [
    ['"42px"', 42], ['"  +42px"', 42], ['"\u00a0\ufeff-42px"', -42],
    ['"- 42"', NaN], ['"++42"', NaN], ['""', NaN], ['" "', NaN],
    ['"0x2a"', 42], ['"-0X2A"', -42], ['"+0x2a"', 42],
    ['"0x"', NaN], ['"0xz"', NaN], ['"0x2ag"', 42],
    ['"0b11"', 0], ['"0o77"', 0], ['"077"', 77],
    ['"1e3"', 1], ['"-1.9"', -1], ['".5"', NaN],
    ['"Infinity"', NaN], ['"NaN"', NaN], ['"-0"', -0],
    ['"-0px"', -0], ['"-0.9"', -0], ['"-0x0"', -0],
    ['"42px", 10', 42], ['"0x2a", 16', 42], ['"0x2a", 10', 0],
    ['"0x2a", 36', 42850], ['"11xyz", 2', 3], ['"z!", 36', 35],
    ['"2", 2', NaN], ['"08", 8', 0], ['"0b11", 2', 0],
    ['"42", 0', 42], ['"0x2a", 0', 42], ['"42", -0', 42],
    ['"42", 1', NaN], ['"42", 37', NaN], ['"42", -2', NaN],
    ['"11", 2.9', 3], ['"42", 0.9', 42], ['"42", -0.9', 42],
    ['"11", 4294967298', 3], ['"11", -4294967294', 3],
    ['"42", 4294967296', 42], ['"11", 2147483650', NaN],
    ['"11", "2"', 3], ['"11", "2px"', 11], ['"0x2a", ""', 42],
    ['"0x2a", null', 42], ['"11", true', NaN], ['"11", false', 11],
    ['"0x2a", 1e309', 42], ['"0x2a", -1e309', 42],
    ['"0x2a", +"NaN"', 42], ['true', NaN], ['null', NaN],
    ['42.9', 42], ['1e21', 1], ['1e-7', 1], ['-0', 0],
  ];
  for (const [args, expected] of cases) check(`parseInt(${args})`, expected);
  check("parseInt()", NaN);
});

test("parseFloat accepts the longest decimal prefix, exponents and Infinity", () => {
  const cases = [
    ['"42px"', 42], ['" \\t\\n-42.5px"', -42.5], ['"+42"', 42],
    ['"+ 42"', NaN], ['"--42"', NaN], ['""', NaN], ['" "', NaN],
    ['".5px"', 0.5], ['"1.px"', 1], ['".px"', NaN],
    ['"1e3px"', 1000], ['"1e-3px"', 0.001], ['"1e+3px"', 1000],
    ['"1e"', 1], ['"1e+"', 1], ['"1e-"', 1], ['"1e++2"', 1],
    ['"0x2a"', 0], ['"0b11"', 0], ['"0o77"', 0], ['"1_000"', 1],
    ['"Infinity"', Infinity], ['"+Infinitypx"', Infinity], ['"-Infinity!"', -Infinity],
    ['"infinity"', NaN], ['"NaN"', NaN], ['"1e309"', Infinity],
    ['"-0"', -0], ['"-0.0px"', -0], ['"-1e-9999"', -0],
    ['"\ufeff\u00a0.5"', 0.5], ['"\u200b42"', NaN],
    ['true', NaN], ['false', NaN], ['null', NaN], ['42.5', 42.5],
    ['1e309', Infinity], ['-0', 0],
  ];
  for (const [args, expected] of cases) check(`parseFloat(${args})`, expected);
  check("parseFloat()", NaN);
});

test("parentheses and TS-only wrappers preserve the actual primitive value", () => {
  check('Number((("42")))', 42);
  check('Number("42px" as unknown as number)', NaN);
  check('parseInt(("42px" as number)!)', 42);
  check('parseFloat(<number><unknown>"42.5px")', 42.5);
  check('Number(("42" satisfies string))', 42);
  check('Number(`42`)', 42);
  check('Number("\\x34\\u0032")', 42);
  check('Number(-(+"42"))', -42);
  check('parseInt("11", +"2")', 3);
  check('Number(!false)', 1);
  check('Number(~0)', -1);
  check('Number(-true)', -1);
  check('Number(-null)', -0);
  check('(Number)("42")', 42);
  check('Number("42", "ignored", false)', 42);
  check('parseFloat("42px", 16)', 42);
  check('parseInt("11", 2, "ignored")', 3);
});

test("unsupported or potentially effectful syntax returns null without execution", () => {
  for (const source of [
    'Number(value)', 'parseInt("11", radix)', 'parseFloat(read())',
    'Number("42", effect())', 'parseInt("11", 2, effect())',
    'parseFloat("42px", effect())', 'Number((value as number)!)',
    'Number(NaN)', 'Number(Infinity)', 'Number(undefined)',
    'Number(-value)', 'Number(++value)', 'Number(value++)',
    'Number(void 0)', 'Number({})', 'Number([])', 'Number(42n)',
    'Number("4" + "2")', 'Number(true ? "42" : "0")',
    'Number(`4${2}`)', 'Number(...["42"])', 'Number(Number("42"))',
    'globalThis.Number("42")', 'Number.parseInt("42")', 'other("42")',
    'constructor("42")', 'toString("42")', 'Number', '42',
  ]) {
    assert.equal(evaluateStaticNumericCall(expression(source)), null, source);
  }
  assert.equal(evaluateStaticNumericCall(null), null);
  assert.equal(evaluateStaticNumericCall(undefined), null);
});

test("radix coercions match the JS built-in across primitive inputs", () => {
  const inputs = ["42px", "-0", "0x2a", "101010", "zz", "1e3", "", "  +11!", "-Infinity"];
  const radices = [
    ["0", 0], ["-0", -0], ["1", 1], ["2", 2], ["16", 16], ["36", 36],
    ["37", 37], ["-2", -2], ["2.9", 2.9], ["-2.9", -2.9],
    ["4294967296", 4294967296], ["4294967298", 4294967298],
    ["-4294967294", -4294967294], ["2147483648", 2147483648],
    ["1e100", 1e100], ["1e309", Infinity], ["-1e309", -Infinity],
    ['+"NaN"', NaN], ['"0x10"', "0x10"], ['"2px"', "2px"],
    ['""', ""], ["true", true], ["false", false], ["null", null],
  ];
  for (const input of inputs) {
    for (const [radixSource, radix] of radices) {
      check(`parseInt(${JSON.stringify(input)}, ${radixSource})`, parseInt(input, radix));
    }
  }
});
