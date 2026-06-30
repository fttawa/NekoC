onStart(() => {
  setVar("isKeyDown", 0);
  setVar("isMouseDown", 0);
  setVar("timerVal", 0);
  setVar("stageW", 0);
  setVar("stageH", 0);

  setVar("timerVal", timerValue());
  setVar("stageW", stageInfo("width"));
  setVar("stageH", stageInfo("height"));
  setVar("isKeyDown", keyPressed("space", "down"));
  setVar("isMouseDown", mouseTrigger("down"));
});
