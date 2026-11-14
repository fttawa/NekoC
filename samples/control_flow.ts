// tell targets a named actor in the official editor's actor dropdown.
sprite("receiver", {}, self => {});

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
  tell("receiver", () => {
    setVar("told", 1);
  });
  tellAndWait("receiver", () => {
    setVar("syncTold", 1);
  });
  stop("1");
  restart();
});
