onStart(() => {
  setVar("received", 0);
  broadcast("msg1");
});

onMessage("msg1", () => {
  setVar("received", 1);
});
