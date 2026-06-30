onStart(() => {
  setVar("score", 0);
  setVar("combo", 0);
  setVar("maxCombo", 0);
  setVar("gameOver", 0);
  setVar("timer", 0);
  penDown();
  setPenColor("#ff0000");
  setPenSize(3);

  forRange("i", 0, 360, 10, () => {
    moveSteps(5);
    turn(10);
  });

  penUp();
  clearDrawing();
  setVar("score", 100);
  broadcast("reset");
});

onClick(() => {
  setVar("combo", getVar("combo") + 1);
  setVar("score", getVar("score") + getVar("combo") * 10);
  if (getVar("combo") > getVar("maxCombo")) {
    setVar("maxCombo", getVar("combo"));
  }
  say("Score: " + getVar("score"));
});

onKey("space", "down", () => {
  setVar("combo", 0);
  setVar("score", 0);
  clearEffects();
  setPenColor("#00ff00");
  setPenSize(1);
});

onMessage("reset", () => {
  setVar("gameOver", 0);
  setVar("timer", 0);
});
