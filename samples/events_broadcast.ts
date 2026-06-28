onStart(() => {
  setVar("status", "start");
  broadcast("ready");
});

onClick(() => {
  setVar("status", "clicked");
  broadcastAndWait("clicked");
});

onKey("81", "up", () => {
  setVar("key", "q");
});

onMessage("ready", () => {
  setVar("heardReady", 1);
});

onMessage("clicked", () => {
  setVar("heardClick", 1);
});

when(eq(getVar("heardReady"), 1), () => {
  setVar("condition", "met");
});
