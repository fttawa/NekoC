// Compile: nekoc compile-ts-kitten4 samples/kitten4-demo.ts --out samples/kitten4-demo.bcm
// Start draws an 80-step square: right, down, left, up. Arrow keys move by 10;
// Space draws a 10-step line, and C clears the drawing.
// Probe after start: sides = 4, ready = 1, keyCount = 0, cursor = (-40, -40).
// Uses global variables and repeat; no Kitten N-only range loops or script locals.

onStart(() => {
  setVar("edge", 80);
  setVar("step", 10);
  setVar("sides", 0);
  setVar("ready", 0);
  setVar("keyCount", 0);
  clearDrawing();
  penUp();
  setPenColor("#2563eb");
  setPenSize(4);
  moveTo(-40, -40);
  pointTowards(90);
  penDown();
  repeatTimes(4, () => {
    moveSteps(getVar("edge"));
    turn(90);
    changeVar("sides", 1);
  });
  penUp();
  if (getVar("sides") === 4) {
    setVar("ready", 1);
    setPenColor("#16a34a");
  }
});

onKey("ArrowRight", () => {
  changeX(10);
  changeVar("keyCount", 1);
});

onKey("ArrowLeft", () => {
  changeX(-10);
  changeVar("keyCount", 1);
});

onKey("ArrowUp", () => {
  changeY(10);
  changeVar("keyCount", 1);
});

onKey("ArrowDown", () => {
  changeY(-10);
  changeVar("keyCount", 1);
});

onKey("Space", () => {
  penDown();
  moveSteps(getVar("step"));
  penUp();
  changeVar("keyCount", 1);
});

onKey("C", () => {
  clearDrawing();
  changeVar("keyCount", 1);
});
