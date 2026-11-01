let clicks = 0;
defineProc("report", ["value"], () => {
  consoleLog(param("value"));
});
onStart(() => {
  setEffect("color", 25);
  changeEffect("ghost", 10);
  setVar("hue", effectOf("--self", "color"));
  broadcast("ready");
});
onClick(() => {
  clicks += 1;
  callProc("report", clicks);
});
onKey("space", () => {
  setVar("pressed", keyPressed("space", "down"));
});
onMessage("ready", () => {
  consoleLog("Kitten N 0.27.4");
});
