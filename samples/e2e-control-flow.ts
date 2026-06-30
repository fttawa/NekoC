onStart(() => {
  setVar("sum", 0);
  setVar("i", 0);

  forRange("i", 1, 10, 1, () => {
    setVar("sum", getVar("sum") + rangeValue("i"));
  });

  setVar("whileResult", 0);
  setVar("w", 0);
  while (getVar("w") < 5) {
    setVar("whileResult", getVar("whileResult") + 1);
    setVar("w", getVar("w") + 1);
  }

  setVar("ifResult", 0);
  if (getVar("sum") > 40) {
    setVar("ifResult", 1);
  } else {
    setVar("ifResult", 2);
  }

  setVar("breakResult", 0);
  forever(() => {
    setVar("breakResult", getVar("breakResult") + 1);
    if (getVar("breakResult") >= 3) {
      breakLoop();
    }
  });
});
