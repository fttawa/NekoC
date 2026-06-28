onStart(() => {
  broadcast("ready");
  ifThen(receivedBroadcast("ready"), () => {
    setVar("received", 1);
  });
});

onBumpActor("start", "--self", "actor", () => {
  setVar("bumpedX", bumpActorValue("actor", "x"));
});
