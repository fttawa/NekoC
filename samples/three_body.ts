stage({
  name: "Three Body Demo",
  backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png",
});

sprite("body-a", {
  costume: "https://creation.codemao.cn/922/user-files/FpZTQai33dLfZe_5ZNsK0itcbgEf.svg",
  x: 120,
  y: 0,
  scale: 70,
  visible: true,
}, () => {
  onStart(() => {
    setVar("phaseA", 0);
    forever(() => {
      changeVar("phaseA", 3);
      setX(mul(130, trig("cos", getVar("phaseA"))));
      setY(mul(70, trig("sin", getVar("phaseA"))));
      wait(0.03);
    });
  });
});

sprite("body-b", {
  costume: "https://creation.codemao.cn/922/user-files/Fh8dduNJ2I_2peuEXB3VA_Lslj_s.svg",
  x: -80,
  y: 70,
  scale: 60,
  visible: true,
}, () => {
  onStart(() => {
    setVar("phaseB", 120);
    forever(() => {
      changeVar("phaseB", 2);
      setX(mul(105, trig("cos", add(getVar("phaseB"), 120))));
      setY(mul(95, trig("sin", add(getVar("phaseB"), 120))));
      wait(0.03);
    });
  });
});

sprite("body-c", {
  costume: "https://creation.codemao.cn/922/user-files/FiaHZ0GoaDI_YP25jVdoCvb0Io2-.svg",
  x: -40,
  y: -90,
  scale: 55,
  visible: true,
}, () => {
  onStart(() => {
    setVar("phaseC", 240);
    forever(() => {
      changeVar("phaseC", -4);
      setX(mul(85, trig("cos", sub(getVar("phaseC"), 80))));
      setY(mul(120, trig("sin", sub(getVar("phaseC"), 80))));
      wait(0.03);
    });
  });
});
