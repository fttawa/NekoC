onStart(() => {
  setVar("cloneCount", 0);
  setVar("cloneIdx", 0);

  createClone();
  createClone();

  setVar("cloneCount", cloneCount("--self"));
  setVar("cloneIdx", currentCloneIndex());
});
