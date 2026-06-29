function double(x: number) {
  return x * 2;
}

function binaryDigits(value: number) {
  return value.toString(2);
}

test("double", () => {
  expect(double(21)).toBe(42);
});

test("binary digits", () => {
  expect(binaryDigits(13)).toBe("1101");
  expect([1, 2, 3]).toContain(2);
});
