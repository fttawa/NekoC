onStart(() => {
  setVar("bool", bool(true));
  setVar("pow", pow(2, 8));
  setVar("random", randInt(1, 10));
  setVar("divisible", divisibleBy(10, 2));
  setVar("even", numberProperty(4, "EVEN"));
  setVar("sqrt", mathFunc("0", 16));
  setVar("sin", trig("sin", 90));
  setVar("num", toNumber("42"));
  setVar("truth", toBoolean("true"));
  setVar("joined", join("a", "b", "c"));
  setVar("slice", selectText("abcdef", 2, 4));
  setVar("tail", selectText("abcdef", 2));
  setVar("split", splitText("a,b,c", ","));
});
