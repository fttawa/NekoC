onStart(() => {
  setVar("received", 0);
  setVar("paramVal", 0);
  broadcast("msg1");
});

onMessage("msg1", () => {
  changeVar("received", 1);
  broadcast("msg2", 42);
});

onMessage("msg2", (val) => {
  setVar("paramVal", val);
});
