onStart(() => {
  setVar("heading", 60);
  setVar("turnBy", 45);
  clearDrawing();
  penUp();
  moveTo(0, 0);
  setPenColor("#2563eb");
  setPenSize(4);
  pointTowards((getVar("heading") as number) + 30);
  penDown();
  moveSteps(40);
  turn(getVar("turnBy") * 2);
  moveSteps(30);
  penUp();
});
