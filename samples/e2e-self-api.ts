onStart(() => {
  setVar("x", 0);
  setVar("y", 0);
  setVar("scale", 100);
  setVar("effectSet", 0);
  setVar("penDown", 0);
  setVar("styleIdx", 0);
  setVar("visible", 1);
  setVar("draggable", 0);

  moveSteps(10);
  turn(45);
  setX(100);
  setY(200);
  changeX(10);
  changeY(-20);
  setVar("x", 100);
  setVar("y", 200);

  show();
  setScale(150);
  changeScale(-50);
  setVar("scale", 100);

  setEffect("color", 80);
  changeEffect("color", -20);
  clearEffects();
  setVar("effectSet", 1);

  penDown();
  setPenSize(5);
  changePenSize(-2);
  penUp();
  clearDrawing();
  setVar("penDown", 1);

  nextStyle();
  prevStyle();
  setVar("styleIdx", 1);

  hide();
  setVar("visible", 0);

  setDraggable("1");
  setVar("draggable", 1);
});
