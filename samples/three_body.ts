stage({
  name: "Three Body Demo",
  backdrop: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 562 900'%3E%3Crect width='562' height='900' fill='%23070b1f'/%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='80' cy='90' r='2'/%3E%3Ccircle cx='230' cy='160' r='1.5'/%3E%3Ccircle cx='490' cy='120' r='2'/%3E%3Ccircle cx='160' cy='330' r='1.5'/%3E%3Ccircle cx='430' cy='390' r='2'/%3E%3Ccircle cx='95' cy='620' r='2'/%3E%3Ccircle cx='330' cy='710' r='1.5'/%3E%3Ccircle cx='505' cy='800' r='2'/%3E%3C/g%3E%3C/svg%3E",
});

sprite("body-a", {
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='44' fill='%23ffd166'/%3E%3Ccircle cx='44' cy='42' r='13' fill='%23fff3b0' opacity='.8'/%3E%3C/svg%3E",
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
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='40' fill='%2356ccf2'/%3E%3Cellipse cx='64' cy='62' rx='52' ry='15' fill='none' stroke='%23c7f9ff' stroke-width='8'/%3E%3C/svg%3E",
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
  costume: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='38' fill='%23ef476f'/%3E%3Ccircle cx='75' cy='45' r='10' fill='%23ff9fb2' opacity='.75'/%3E%3Ccircle cx='42' cy='76' r='7' fill='%239d174d' opacity='.45'/%3E%3C/svg%3E",
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
