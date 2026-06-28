onStart(() => {
  setVar("score", 42);
  broadcast("score:update", getVar("score"));
});

onMessage("score:update", "payload", () => {
  setVar("lastScore", messageValue("payload"));
  setVar("status", join("score=", toString(messageValue("payload"))));
});
