onStart(() => {
  clearDrawing();
  penDown();
  setPenColor("#00ff88");
  setPenSize(6);
  changePenSize(-2);
  setPenEffect("hue", 50);
  changePenEffect("alpha", -10);
  stampText("hello", 20, "center");
  imageStamp();
  setPenLayer("peak", "bottom");
  penUp();
});
