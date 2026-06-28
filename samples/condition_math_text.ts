onStart(() => {
  setVar("x", add(2, mul(3, 4)));
  ifElse(and(gte(getVar("x"), 10), not(contains("hello", "z"))), () => {
    setVar("result", join("len=", toString(length("hello"))));
  }, () => {
    setVar("result", "small");
  });
  ifThen(or(lt(getVar("x"), 20), neq(getVar("x"), 14)), () => {
    setVar("rounded", ceil(sub(getVar("x"), 0.2)));
  });
});
