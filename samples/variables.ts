onStart(() => {
  scriptVars("localScore", "localName");
  setVar("score", 1);
  changeVar("score", -2);
  setVar("copy", getVar("score"));
  setVar("localCopy", scriptVar("localScore"));
  showVariable("score");
  hideVariable("score");
});
