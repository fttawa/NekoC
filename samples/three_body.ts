stage({
  name: "Three Body Demo",
  backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png",
});

sprite("body-a", {
  costume: "https://cdn.jsdelivr.net/gh/fttawa/NekoC@main/samples/assets/three_body_body_a.png",
  x: 70,
  y: 0,
  scale: 110,
  visible: true,
  centerX: 64,
  centerY: 64,
}, () => {
  onStart(() => {
    setVar("phaseA", 0);
    forever(() => {
      changeVar("phaseA", 3);
      setX(mul(90, trig("cos", getVar("phaseA"))));
      setY(mul(55, trig("sin", getVar("phaseA"))));
      wait(0.03);
    });
  });
});

sprite("body-b", {
  costume: "https://cdn.jsdelivr.net/gh/fttawa/NekoC@main/samples/assets/three_body_body_b.png",
  x: -45,
  y: 45,
  scale: 100,
  visible: true,
  centerX: 64,
  centerY: 64,
}, () => {
  onStart(() => {
    setVar("phaseB", 120);
    forever(() => {
      changeVar("phaseB", 2);
      setX(mul(75, trig("cos", add(getVar("phaseB"), 120))));
      setY(mul(70, trig("sin", add(getVar("phaseB"), 120))));
      wait(0.03);
    });
  });
});

sprite("body-c", {
  costume: "https://cdn.jsdelivr.net/gh/fttawa/NekoC@main/samples/assets/three_body_body_c.png",
  x: -35,
  y: -55,
  scale: 95,
  visible: true,
  centerX: 64,
  centerY: 64,
}, () => {
  onStart(() => {
    setVar("phaseC", 240);
    forever(() => {
      changeVar("phaseC", -4);
      setX(mul(60, trig("cos", sub(getVar("phaseC"), 80))));
      setY(mul(85, trig("sin", sub(getVar("phaseC"), 80))));
      wait(0.03);
    });
  });
});
