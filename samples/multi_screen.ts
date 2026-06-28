screen("menu", {
  backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png",
}, () => {
  sprite("start", {
    costume: "https://creation.bcmcdn.com/922/user-files/d2ViXzIwMDJfMTc5ODgyNTlfMzIwOTgxODA1XzE3ODI2MjI4MDAwMDBfRnR3U0xVSjFuU2lkN29neWstTmlzR1hPeHlNYw==.png",
    x: 0,
    y: 0,
    scale: 120,
    centerX: 64,
    centerY: 64,
  }, () => {
    onStart(() => {
      console.log("menu");
      wait(0.2);
      switchScreen("game");
    });
  });
});

screen("game", {
  backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png",
}, () => {
  sprite("player", {
    costume: "https://creation.bcmcdn.com/922/user-files/d2ViXzIwMDJfMTc5ODgyNTlfMzIwOTgxODA1XzE3ODI2MjI4MDAwMDBfRnR6MnpPdWh0N2FjU3hJOGxydjlKTXpHdUFNbw==.png",
    x: -60,
    y: 0,
    scale: 100,
    centerX: 64,
    centerY: 64,
  }, () => {
    onStart(() => {
      console.log("game");
      forever(() => {
        changeVar("steps", 1);
        moveSteps(5);
        wait(0.1);
      });
    });
  });
});
