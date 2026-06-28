onStart(() => {
  setVar("score", 0);
  wait(0.5);
  forever(() => {
    changeVar("score", 1);
  });
});
