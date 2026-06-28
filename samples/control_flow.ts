onStart(() => {
  setVar("i", 0);
  repeatTimes(3, () => {
    changeVar("i", 1);
    consoleLog(join("loop=", toString(getVar("i"))));
    ifThen(gt(getVar("i"), 1), () => {
      breakLoop();
    });
  });
  waitUntil(receivedBroadcast("ready"));
  forRange("n", 1, 5, 1, () => {
    setVar("lastRange", rangeValue("n"));
  });
  warp(() => {
    setVar("fast", 1);
  });
  tell("--self", () => {
    setVar("told", 1);
  });
  tellAndWait("--self", () => {
    setVar("syncTold", 1);
  });
  stop("1");
  restart();
});
