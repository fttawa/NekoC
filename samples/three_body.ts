stage({
  name: "Three Body Demo",
  backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png",
});

sprite("body-a", {
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='44' fill='%23ffd166'/%3E%3Ccircle cx='44' cy='42' r='13' fill='%23fff3b0' opacity='.8'/%3E%3C/svg%3E",
  x: 70,
  y: 0,
  scale: 110,
  visible: true,
  centerX: 60,
  centerY: 60,
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
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='40' fill='%2356ccf2'/%3E%3Cellipse cx='64' cy='62' rx='52' ry='15' fill='none' stroke='%23c7f9ff' stroke-width='8'/%3E%3C/svg%3E",
  x: -45,
  y: 45,
  scale: 100,
  visible: true,
  centerX: 60,
  centerY: 60,
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
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='38' fill='%23ef476f'/%3E%3Ccircle cx='75' cy='45' r='10' fill='%23ff9fb2' opacity='.75'/%3E%3Ccircle cx='42' cy='76' r='7' fill='%239d174d' opacity='.45'/%3E%3C/svg%3E",
  x: -35,
  y: -55,
  scale: 95,
  visible: true,
  centerX: 60,
  centerY: 60,
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
