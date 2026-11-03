onStart(() => {
  warp(() => {
    setVar("zr", 1);
    repeatTimes(listLength("ZSRC"), () => {
      copyList(splitText(listItem("ZSRC", "any", getVar("zr")), "SEPCHAR"), "ztok");
      setVar("zo", "");
      setVar("zj", 1);
      repeatTimes(listLength("ztok"), () => {
        setVar("zt", listItem("ztok", "any", getVar("zj")));
        if (selectText(getVar("zt"), 1, 1) == "!") {
          copyList(splitText(selectText(getVar("zt"), 2, length(getVar("zt"))), ","), "zref");
          setVar("zs", listItem("zref", "any", 2));
          setVar("zo", join(getVar("zo"), selectText(listItem("ZDST", "any", getVar("zr") - listItem("zref", "any", 1)), getVar("zs"), getVar("zs") + listItem("zref", "any", 3) - 1)));
        } else {
          setVar("zo", join(getVar("zo"), selectText(getVar("zt"), 2, length(getVar("zt")))));
        }
        changeVar("zj", 1);
      });
      appendList("ZDST", getVar("zo"));
      changeVar("zr", 1);
    });
  });
  setVar("zready", 1);
});
onStart(() => {
  if (getVar("zready") != 1) {
    waitUntil(getVar("zready") == 1);
  }
});
