// 一个文件里同时写舞台和逻辑：nekoc build samples/stage_demo.nk.ts
// 舞台、角色、造型、初始坐标都由下面的声明生成，不需要模板作品。

const CAT_A = "https://creation.bcmcdn.com/922/user-files/d2ViXzIwMDJfMTc5ODgyNTlfMzIwOTgxODA1XzE3ODI2MjI4MDAwMDBfRnR3U0xVSjFuU2lkN29neWstTmlzR1hPeHlNYw==.png";
const CAT_B = "https://creation.bcmcdn.com/922/user-files/d2ViXzIwMDJfMTc5ODgyNTlfMzIwOTgxODA1XzE3ODI2MjI4MDAwMDBfRnR6MnpPdWh0N2FjU3hJOGxydjlKTXpHdUFNbw==.png";

stage({ name: "stage demo", backdrop: "https://static.codemao.cn/neko/img_stage_defult_portrait.png" });

sprite("cat", {
  costumes: [
    { name: "idle", url: CAT_A, centerX: 64, centerY: 64 },
    { name: "walk", url: CAT_B, centerX: 64, centerY: 64 },
  ],
  x: -120,
  y: 0,
  scale: 80,
}, (self) => {
  self.onStart(() => {
    for (let step = 0; step < 6; step++) {
      self.nextStyle();
      self.changeX(40);
      self.wait(0.1);
    }
    console.log("cat done");
  });
});

sprite("dog", { costume: CAT_B, x: 120, y: 60, rotation: 90, centerX: 64, centerY: 64 }, (self) => {
  self.onStart(() => {
    self.say("hi");
    console.log("dog ready");
  });
});
