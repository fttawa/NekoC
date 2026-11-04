// 方界：无限世界的方块生存游戏。逐像素光线投射，全部为原生积木。
// 屏幕：0 标题 1 游戏 2 暂停 3 背包 4 合成 5 设置 6 死亡 7 帮助
function v(vname: string): number { return getVar(vname) as number; }
function cell(celli: number): number { return listItem("world", "any", celli) as number; }
function fl(flq: number): number { return floor(flq); }

const SIZE = 128;          // 环形缓存边长（8×8 区块）
const HEIGHT = 32;
const BLOCKS = 18;

// ---------- 世界生成 ----------
defineReporter("hash", ["a", "b"], () => {
  setVar("hs", trig("sin", (param("a") * 12.9898 + param("b") * 78.233 + v("seed")) * 57.29578) * 4375.8);
  returnValue(v("hs") - fl(v("hs")));
});
defineReporter("noise", ["x", "z"], () => {
  setVar("nx", fl(param("x")));
  setVar("nz", fl(param("z")));
  setVar("fx", param("x") - v("nx"));
  setVar("fz", param("z") - v("nz"));
  setVar("fx", v("fx") * v("fx") * (3 - 2 * v("fx")));
  setVar("fz", v("fz") * v("fz") * (3 - 2 * v("fz")));
  setVar("n00", callReporter("hash", v("nx"), v("nz")) as number);
  setVar("n10", callReporter("hash", v("nx") + 1, v("nz")) as number);
  setVar("n01", callReporter("hash", v("nx"), v("nz") + 1) as number);
  setVar("n11", callReporter("hash", v("nx") + 1, v("nz") + 1) as number);
  returnValue((v("n00") * (1 - v("fx")) + v("n10") * v("fx")) * (1 - v("fz")) + (v("n01") * (1 - v("fx")) + v("n11") * v("fx")) * v("fz"));
});
defineReporter("terrain", ["x", "z"], () => {
  setVar("t1", callReporter("noise", param("x") / 28, param("z") / 28) as number);
  setVar("t2", callReporter("noise", param("x") / 9 + 50, param("z") / 9) as number);
  setVar("t3", callReporter("noise", param("x") / 70 + 90, param("z") / 70 + 20) as number);
  returnValue(fl(7 + v("t3") * 12 + v("t1") * 9 + v("t2") * 3));
});
function wrap(wrn: number): number { return wrn - floor(wrn / 128) * 128; }
function put(pux: number, puy: number, puz: number, pub: number): void {
  replaceListItem("world", "any", wrap(pux) + wrap(puz) * 128 + puy * 16384 + 1, pub);
}
defineProc("fj14", ["cx", "cz"], () => {
  warp(() => {
    setVar("gx", param("cx") * 16);
    setVar("gz", param("cz") * 16);
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        setVar("wx", v("gx") + i);
        setVar("wz", v("gz") + j);
        setVar("top", callReporter("terrain", v("wx"), v("wz")) as number);
        setVar("base", wrap(v("wx")) + wrap(v("wz")) * 128 + 1);
        for (let y = 0; y < 32; y++) {
          setVar("b", 0);
          if (y === 0) { setVar("b", 17); }
          else if (y < v("top") - 3) {
            setVar("b", 3);
            setVar("cave", trig("sin", (v("wx") * 0.21 + trig("sin", (v("wz") * 0.13) * 57.29578) * 2) * 57.29578) * trig("sin", (y * 0.45 + v("seed")) * 57.29578) * trig("sin", (v("wz") * 0.19 + trig("sin", (v("wx") * 0.11) * 57.29578) * 2) * 57.29578));
            if (v("cave") > 0.52) { setVar("b", 0); }
            else {
              setVar("r", callReporter("hash", v("wx") + y * 37, v("wz") - y * 53) as number);
              if (v("r") < 0.012) setVar("b", 9);
              else if (v("r") < 0.018 && y < 22) setVar("b", 10);
              else if (v("r") < 0.0205 && y < 12) setVar("b", 11);
              else if (v("r") < 0.0218 && y < 8) setVar("b", 12);
            }
          } else if (y < v("top")) { setVar("b", v("top") <= 14 ? 4 : 2); }
          else if (y === v("top")) {
            if (v("top") <= 13) setVar("b", 4);
            else if (v("top") >= 25) setVar("b", 16);
            else setVar("b", 1);
          } else if (y <= 12) { setVar("b", 15); }
          replaceListItem("world", "any", v("base") + y * 16384, v("b"));
        }
      }
    }
    // 树木只放在区块内部，避免依赖相邻区块
    for (let i = 2; i < 14; i++) {
      for (let j = 2; j < 14; j++) {
        setVar("wx", v("gx") + i);
        setVar("wz", v("gz") + j);
        if ((callReporter("hash", v("wx") * 3 + 7, v("wz") * 5 - 3) as number) < 0.018) {
          setVar("top", callReporter("terrain", v("wx"), v("wz")) as number);
          if (v("top") > 13 && v("top") < 24) {
            for (let y = 1; y <= 5; y++) put(v("wx"), v("top") + y, v("wz"), 5);
            for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) for (let y = 4; y <= 6; y++) {
              if (a * a + c * c + (y - 5) * (y - 5) * 2 <= 6 && !(a === 0 && c === 0 && y <= 5)) put(v("wx") + a, v("top") + y, v("wz") + c, 6);
            }
          }
        }
      }
    }
    // 还原玩家对这个区块的修改
    for (let e = 1; e <= (listLength("edit_i") as number); e++) {
      if ((listItem("edit_cx", "any", e) as number) === param("cx") && (listItem("edit_cz", "any", e) as number) === param("cz")) {
        replaceListItem("world", "any", listItem("edit_i", "any", e), listItem("edit_b", "any", e));
      }
    }
    setVar("slot", wrap(param("cx") * 16) / 16 + (wrap(param("cz") * 16) / 16) * 8 + 1);
    replaceListItem("chunk_x", "any", v("slot"), param("cx"));
    replaceListItem("chunk_z", "any", v("slot"), param("cz"));
  });
});
// 由近到远找一个还没加载的区块；每次最多生成一个
defineProc("fj1", [], () => {
  warp(() => {
    setVar("pcx", fl(v("px") / 16));
    setVar("pcz", fl(v("pz") / 16));
    setVar("done", 0);
    for (let radius = 0; radius <= 3; radius++) {
      for (let a = -radius; a <= radius; a++) {
        for (let c = -radius; c <= radius; c++) {
          if (v("done") === 0 && (mathFunc("abs", a) === radius || mathFunc("abs", c) === radius)) {
            setVar("qx", v("pcx") + a);
            setVar("qz", v("pcz") + c);
            setVar("slot", wrap(v("qx") * 16) / 16 + (wrap(v("qz") * 16) / 16) * 8 + 1);
            if ((listItem("chunk_x", "any", v("slot")) as number) !== v("qx") || (listItem("chunk_z", "any", v("slot")) as number) !== v("qz")) {
              callProc("fj14", v("qx"), v("qz"));
              setVar("done", 1);
            }
          }
        }
      }
    }
    setVar("pending", v("done"));
  });
});
defineReporter("block", ["x", "y", "z"], () => {
  if (param("y") < 0 || param("y") >= 32) returnValue(0);
  returnValue(cell(wrap(fl(param("x"))) + wrap(fl(param("z"))) * 128 + fl(param("y")) * 16384 + 1));
});
defineReporter("solid", ["x", "y", "z"], () => {
  setVar("sb", callReporter("block", param("x"), param("y"), param("z")) as number);
  returnValue(v("sb") > 0 && v("sb") !== 15 ? 1 : 0);
});
defineReporter("collide", ["x", "y", "z"], () => {
  setVar("hit", 0);
  for (let h = 0; h < 3; h++) {
    setVar("cy", param("y") + h * 0.85);
    if (callReporter("solid", param("x") - 0.3, v("cy"), param("z") - 0.3) || callReporter("solid", param("x") + 0.3, v("cy"), param("z") - 0.3) || callReporter("solid", param("x") - 0.3, v("cy"), param("z") + 0.3) || callReporter("solid", param("x") + 0.3, v("cy"), param("z") + 0.3)) setVar("hit", 1);
  }
  returnValue(v("hit"));
});

// ---------- 渲染 ----------
defineProc("fj16", [], () => {
  setVar("sy", trig("sin", v("yaw"))); setVar("cy2", trig("cos", v("yaw")));
  setVar("sp", trig("sin", v("pitch"))); setVar("cp", trig("cos", v("pitch")));
  setVar("fx0", v("sy") * v("cp")); setVar("fy0", v("sp")); setVar("fz0", v("cy2") * v("cp"));
  setVar("rx0", v("cy2")); setVar("rz0", -v("sy"));
  setVar("ux0", -v("sy") * v("sp")); setVar("uy0", v("cp")); setVar("uz0", -v("cy2") * v("sp"));
  setVar("ex", v("px")); setVar("ey", v("py") + 1.62); setVar("ez", v("pz"));
  setVar("dayf", trig("sin", v("clock") * 360) * 0.5 + 0.5);
  setVar("day", 0.22 + 0.78 * v("dayf"));
  setVar("skyv", 12 + 80 * v("dayf"));
  setVar("skys", 58);
  setVar("pix", 900 / v("cols"));
  setVar("vrows", fl(472 / v("pix")));
  setVar("scale", 1.15 * 2 / v("cols"));
  setVar("pq", v("pix") / 4);
  setPenSize(v("pix") / 2 + 1);
});
// 投射一条光线，给出命中方块、面和距离；tex_h 为 -1 的像素透明
defineProc("fj15", [], () => {
  warp(() => {
    callProc("fj16");
    setVar("wex", wrap(fl(v("ex"))));
    setVar("wez", wrap(fl(v("ez"))));
    for (let r = 0; r < v("vrows"); r++) {
      setVar("sv", (v("vrows") / 2 - r - 0.5) * v("scale"));
      setVar("sy0", 281 - (r + 0.5) * v("pix"));
      penUp();
      for (let c = 0; c < v("cols"); c++) {
        setVar("su", (c + 0.5 - v("cols") / 2) * v("scale"));
        setVar("dx", v("fx0") + v("rx0") * v("su") + v("ux0") * v("sv"));
        setVar("dy", v("fy0") + v("uy0") * v("sv"));
        setVar("dz", v("fz0") + v("rz0") * v("su") + v("uz0") * v("sv"));
        setVar("mx", fl(v("ex"))); setVar("my", fl(v("ey"))); setVar("mz", fl(v("ez")));
        setVar("ix", v("wex")); setVar("iz", v("wez"));
        setVar("adx", v("dx") === 0 ? 1e9 : mathFunc("abs", 1 / v("dx")));
        setVar("ady", v("dy") === 0 ? 1e9 : mathFunc("abs", 1 / v("dy")));
        setVar("adz", v("dz") === 0 ? 1e9 : mathFunc("abs", 1 / v("dz")));
        if (v("dx") < 0) { setVar("stx", -1); setVar("tx", (v("ex") - v("mx")) * v("adx")); } else { setVar("stx", 1); setVar("tx", (v("mx") + 1 - v("ex")) * v("adx")); }
        if (v("dy") < 0) { setVar("sty", -1); setVar("ty", (v("ey") - v("my")) * v("ady")); } else { setVar("sty", 1); setVar("ty", (v("my") + 1 - v("ey")) * v("ady")); }
        if (v("dz") < 0) { setVar("stz", -1); setVar("tz", (v("ez") - v("mz")) * v("adz")); } else { setVar("stz", 1); setVar("tz", (v("mz") + 1 - v("ez")) * v("adz")); }
        setVar("hue", -1); setVar("t", 0);
        while (v("t") < v("far")) {
          if (v("tx") < v("ty") && v("tx") < v("tz")) {
            setVar("t", v("tx")); changeVar("tx", v("adx")); setVar("ix", v("ix") + v("stx")); changeVar("mx", v("stx")); setVar("face", 0);
            if (v("ix") === 128) setVar("ix", 0); else if (v("ix") === -1) setVar("ix", 127);
          } else if (v("ty") < v("tz")) {
            setVar("t", v("ty")); changeVar("ty", v("ady")); changeVar("my", v("sty")); setVar("face", 1);
            if (v("my") >= 32 && v("sty") > 0) break;
            if (v("my") < 0) break;
          } else {
            setVar("t", v("tz")); changeVar("tz", v("adz")); setVar("iz", v("iz") + v("stz")); changeVar("mz", v("stz")); setVar("face", 2);
            if (v("iz") === 128) setVar("iz", 0); else if (v("iz") === -1) setVar("iz", 127);
          }
          if (v("my") < 32) {
            setVar("hb", cell(v("ix") + v("iz") * 128 + v("my") * 16384 + 1));
            if (v("hb") > 0) {
              setVar("hx", v("ex") + v("dx") * v("t")); setVar("hy", v("ey") + v("dy") * v("t")); setVar("hz", v("ez") + v("dz") * v("t"));
              if (v("face") === 1) {
                setVar("tu", v("hx") - fl(v("hx"))); setVar("tv", v("hz") - fl(v("hz")));
                setVar("fi", v("sty") < 0 ? 0 : 2);
                setVar("shade", v("sty") < 0 ? 1 : 0.5);
              } else {
                setVar("tu", v("face") === 0 ? v("hz") - fl(v("hz")) : v("hx") - fl(v("hx")));
                setVar("tv", 1 - (v("hy") - fl(v("hy"))));
                setVar("fi", 1);
                setVar("shade", v("face") === 0 ? 0.78 : 0.64);
              }
              setVar("tid", listItem("block_faces", "any", (v("hb") - 1) * 3 + v("fi") + 1) as number);
              setVar("texel", v("tid") * 256 + fl(v("tv") * 16) * 16 + fl(v("tu") * 16) + 1);
              setVar("hue", listItem("tex_h", "any", v("texel")) as number);
              if (v("hue") >= 0) break;
            }
          }
        }
        if (v("hue") >= 0) {
          setVar("sat", listItem("tex_s", "any", v("texel")) as number);
          setVar("val", (listItem("tex_v", "any", v("texel")) as number) * v("shade"));
          // 地下越深越暗，白天只照亮地表附近
          setVar("light", v("my") < 11 ? 0.5 : v("day"));
          setVar("val", v("val") * v("light"));
          if (v("mx") === v("aimx") && v("my") === v("aimy") && v("mz") === v("aimz") && (v("tu") < 0.035 || v("tu") > 0.965 || v("tv") < 0.035 || v("tv") > 0.965)) setVar("val", 12);
          setVar("fog", v("t") / v("far"));
          if (v("fog") > 0.55) {
            setVar("fog", (v("fog") - 0.55) / 0.45);
            setVar("sat", v("sat") + (v("skys") - v("sat")) * v("fog"));
            setVar("val", v("val") + (v("skyv") - v("val")) * v("fog"));
            if (v("fog") > 0.6) setVar("hue", 208);
          }
        } else {
          setVar("hue", 208);
          setVar("sat", v("skys") - v("dy") * 34);
          setVar("val", v("skyv") + v("dy") * 6);
          // 太阳
          setVar("sund", v("dx") * v("sunx") + v("dy") * v("suny"));
          if (v("sund") > 0.975 * mathFunc("sqrt", v("dx") * v("dx") + v("dy") * v("dy") + v("dz") * v("dz"))) { setVar("hue", 50); setVar("sat", 18); setVar("val", 100); }
        }
        setPenEffect("hue", v("hue"));
        setPenEffect("saturation", v("sat"));
        setPenEffect("brightness", v("val"));
        // 每个像素两条细笔画，让圆形笔头接近方形
        setVar("pxl", -450 + c * v("pix"));
        penUp(); moveTo(v("pxl"), v("sy0") + v("pq")); penDown(); setX(v("pxl") + v("pix"));
        penUp(); moveTo(v("pxl"), v("sy0") - v("pq")); penDown(); setX(v("pxl") + v("pix"));
      }
    }
    penUp();
  });
});

// ---------- GUI ----------
function rgb(rgh: number, rgs: number, rgb0: number): void {
  setPenEffect("hue", rgh); setPenEffect("saturation", rgs); setPenEffect("brightness", rgb0);
}
defineProc("fj18", ["x", "y", "w", "h"], () => {
  warp(() => {
    setPenSize(param("h"));
    penUp();
    moveTo(param("x") + param("h") / 2, param("y") - param("h") / 2);
    penDown();
    moveTo(param("x") + param("w") - param("h") / 2, param("y") - param("h") / 2);
    penUp();
  });
});
defineProc("fj11", ["x", "y", "w", "h"], () => {
  warp(() => {
    setPenSize(3.5);
    for (let i = 1; i < param("h"); i += 2) {
      penUp(); moveTo(param("x") + 1, param("y") - i); penDown(); moveTo(param("x") + param("w") - 1, param("y") - i);
    }
    penUp();
  });
});
function text(txs: unknown, txz: number, txx: number, txy: number, txa: "left" | "center" | "right"): void {
  penUp(); moveTo(txx, txy); stampText(txs as string, txz, txa);
}
// 用方块真实材质画图标
defineProc("fj3", ["block", "x", "y", "size"], () => {
  warp(() => {
    setVar("tid", listItem("block_faces", "any", (param("block") - 1) * 3 + 2) as number);
    setVar("cellp", param("size") / 8);
    setPenSize(v("cellp") + 1);
    for (let a = 0; a < 8; a++) {
      penUp(); moveTo(param("x"), param("y") - (a + 0.5) * v("cellp")); penDown();
      for (let b = 0; b < 8; b++) {
        setVar("texel", v("tid") * 256 + a * 2 * 16 + b * 2 + 1);
        setVar("hue", listItem("tex_h", "any", v("texel")) as number);
        if (v("hue") < 0) rgb(0, 0, 30);
        else rgb(v("hue"), listItem("tex_s", "any", v("texel")) as number, listItem("tex_v", "any", v("texel")) as number);
        setX(param("x") + (b + 0.5) * v("cellp"));
      }
    }
    penUp();
  });
});
defineProc("fj7", ["label", "x", "y", "w", "h"], () => {
  warp(() => {
    setVar("over", v("mx0") >= param("x") && v("mx0") <= param("x") + param("w") && v("my0") <= param("y") && v("my0") >= param("y") - param("h") ? 1 : 0);
    rgb(150, 30, v("over") === 1 ? 62 : 38);
    callProc("fj11", param("x"), param("y"), param("w"), param("h"));
    rgb(0, 0, 100);
    text(param("label"), 22, param("x") + param("w") / 2, param("y") - param("h") / 2, "center");
    if (v("over") === 1 && v("clicked") === 1) { setVar("clicked", 0); setVar("action", param("x") * 1000 + param("y")); setVar("hitlabel", param("label")); }
  });
});
defineProc("fj22", ["title"], () => {
  rgb(210, 25, 14); callProc("fj11", -400, 260, 800, 500);
  rgb(150, 45, 90); text(param("title"), 34, 0, 238, "center");
});
defineProc("fj6", [], () => {
  warp(() => {
    rgb(210, 25, 10); callProc("fj11", -450, -191, 900, 90);
    setVar("hbx", -270);
    for (let i = 1; i <= 9; i++) {
      setVar("hb0", listItem("hot", "any", i) as number);
      if (i === v("sel")) { rgb(50, 80, 100); callProc("fj11", v("hbx") - 3, -197, 58, 58); }
      rgb(210, 15, 26); callProc("fj11", v("hbx"), -200, 52, 52);
      if (v("hb0") > 0 && (listItem("inv", "any", v("hb0")) as number) > 0) {
        callProc("fj3", v("hb0"), v("hbx") + 6, -206, 40);
        rgb(0, 0, 100);
        text(listItem("inv", "any", v("hb0")), 13, v("hbx") + 50, -240, "right");
      }
      changeVar("hbx", 60);
    }
    setVar("hudsel", listItem("hot", "any", v("sel")) as number);
    rgb(0, 0, 100);
    text(v("hudsel") > 0 ? listItem("block_names", "any", v("hudsel")) : "空手", 15, 0, -262, "center");
    // 生命值
    for (let i = 0; i < 10; i++) {
      if (i * 2 < v("hp")) rgb(355, 80, 88); else rgb(0, 0, 30);
      penUp(); setPenSize(12); moveTo(-430 + i * 15, -210); penDown(); setX(-429 + i * 15); penUp();
    }
    rgb(0, 0, 90); text("生命", 14, -430, -228, "left");
    text(join("坐标 ", fl(v("px")), " ", fl(v("py")), " ", fl(v("pz"))), 13, 440, -210, "right");
    text(join("时间 ", v("dayf") > 0.25 ? "白天" : "夜晚"), 13, 440, -232, "right");
  });
});
defineProc("fj0", [], () => {
  rgb(0, 0, 100); setPenSize(2);
  setVar("ccy", 281 - v("vrows") * v("pix") / 2);
  penUp(); moveTo(-9, v("ccy")); penDown(); setX(9); penUp(); moveTo(0, v("ccy") - 9); penDown(); moveTo(0, v("ccy") + 9); penUp();
  if (v("mining") > 0) {
    rgb(0, 0, 25); callProc("fj11", -40, v("ccy") - 18, 80, 8);
    rgb(120, 80, 90); callProc("fj11", -40, v("ccy") - 18, 80 * v("mining"), 8);
  }
  rgb(0, 0, 100);
  if (v("notice_t") > 0) text(getVar("notice"), 18, 0, 240, "center");
  text(join(fl(v("fps")), " 帧/秒"), 13, 440, 268, "right");
});
function say(sayt: string): void { setVar("notice", sayt); setVar("notice_t", 3); }

defineProc("fj10", [], () => {
  warp(() => {
    rgb(205, 60, 30); callProc("fj11", -450, 281, 900, 562);
    for (let i = 0; i < 8; i++) callProc("fj3", 1 + (i * 2) % 13, -440 + i * 112, -180, 96);
    rgb(0, 0, 100); text("方 界", 84, 0, 190, "center");
    rgb(50, 60, 100); text("无限世界 · 原创材质 · 全部由积木运行", 20, 0, 118, "center");
    callProc("fj7", v("started") === 1 ? "继续游戏" : "开始新世界", -150, 90, 300, 54);
    callProc("fj7", "设置", -150, 26, 300, 54);
    callProc("fj7", "操作说明", -150, -38, 300, 54);
  });
});
defineProc("fj9", [], () => {
  warp(() => {
    callProc("fj22", "游戏暂停");
    callProc("fj7", "继续游戏", -150, 170, 300, 54);
    callProc("fj7", "背包", -150, 106, 300, 54);
    callProc("fj7", "合成", -150, 42, 300, 54);
    callProc("fj7", "设置", -150, -22, 300, 54);
    callProc("fj7", "操作说明", -150, -86, 300, 54);
    callProc("fj7", "回到标题", -150, -150, 300, 54);
  });
});
defineProc("fj19", [], () => {
  warp(() => {
    callProc("fj22", "背包");
    rgb(0, 0, 85); text("点击方块，放进当前选中的快捷栏格子", 16, 0, 205, "center");
    for (let i = 1; i <= 16; i++) {
      setVar("gx0", -360 + ((i - 1) % 6) * 120);
      setVar("gy0", 180 - fl((i - 1) / 6) * 120);
      setVar("slotb", i === 15 ? 16 : i === 16 ? 18 : i);
      setVar("over", v("mx0") >= v("gx0") && v("mx0") <= v("gx0") + 96 && v("my0") <= v("gy0") && v("my0") >= v("gy0") - 96 ? 1 : 0);
      rgb(210, 15, v("over") === 1 ? 45 : 26); callProc("fj11", v("gx0"), v("gy0"), 96, 96);
      callProc("fj3", v("slotb"), v("gx0") + 12, v("gy0") - 6, 72);
      rgb(0, 0, 100);
      text(listItem("block_names", "any", v("slotb")), 13, v("gx0") + 48, v("gy0") - 80, "center");
      text(listItem("inv", "any", v("slotb")), 13, v("gx0") + 92, v("gy0") - 62, "right");
      if (v("over") === 1 && v("clicked") === 1) {
        setVar("clicked", 0);
        replaceListItem("hot", "any", v("sel"), v("slotb"));
        say("已放入快捷栏");
        setVar("gui_dirty", 1);
      }
    }
    callProc("fj7", "返回", -100, -200, 200, 46);
  });
});
// 配方：产物、产量、原料 1、数量、原料 2、数量（原料 2 为 0 表示没有）
defineProc("fj2", [], () => {
  warp(() => {
    callProc("fj22", "合成");
    for (let i = 0; i < 6; i++) {
      setVar("ry", 200 - i * 58);
      setVar("r0", i * 6);
      setVar("rb", listItem("recipes", "any", v("r0") + 1) as number);
      setVar("rn", listItem("recipes", "any", v("r0") + 2) as number);
      setVar("a1", listItem("recipes", "any", v("r0") + 3) as number);
      setVar("n1", listItem("recipes", "any", v("r0") + 4) as number);
      setVar("a2", listItem("recipes", "any", v("r0") + 5) as number);
      setVar("n2", listItem("recipes", "any", v("r0") + 6) as number);
      setVar("can", (listItem("inv", "any", v("a1")) as number) >= v("n1") && (v("a2") === 0 || (listItem("inv", "any", v("a2")) as number) >= v("n2")) ? 1 : 0);
      setVar("over", v("mx0") >= -370 && v("mx0") <= 370 && v("my0") <= v("ry") && v("my0") >= v("ry") - 52 ? 1 : 0);
      if (v("can") === 1) rgb(120, 35, v("over") === 1 ? 50 : 34); else rgb(0, 0, 22);
      callProc("fj11", -370, v("ry"), 740, 52);
      callProc("fj3", v("rb"), -360, v("ry") - 6, 40);
      rgb(0, 0, v("can") === 1 ? 100 : 55);
      text(join(listItem("block_names", "any", v("rb")), " ×", v("rn")), 18, -305, v("ry") - 18, "left");
      text(join("需要 ", listItem("block_names", "any", v("a1")), " ×", v("n1"), v("a2") > 0 ? join(" + ", listItem("block_names", "any", v("a2")), " ×", v("n2")) : ""), 15, 360, v("ry") - 18, "right");
      if (v("over") === 1 && v("clicked") === 1) {
        setVar("clicked", 0);
        setVar("gui_dirty", 1);
        if (v("can") === 1) {
          replaceListItem("inv", "any", v("a1"), (listItem("inv", "any", v("a1")) as number) - v("n1"));
          if (v("a2") > 0) replaceListItem("inv", "any", v("a2"), (listItem("inv", "any", v("a2")) as number) - v("n2"));
          replaceListItem("inv", "any", v("rb"), (listItem("inv", "any", v("rb")) as number) + v("rn"));
          say("合成成功");
        } else say("材料不够");
      }
    }
    callProc("fj7", "返回", -100, -214, 200, 44);
  });
});
defineProc("fj21", [], () => {
  warp(() => {
    callProc("fj22", "设置");
    callProc("fj7", join("画面精度：", v("cols") === 80 ? "流畅" : v("cols") === 120 ? "均衡" : "精细"), -200, 150, 400, 60);
    callProc("fj7", join("视野距离：", v("far"), " 格"), -200, 70, 400, 60);
    callProc("fj7", join("鼠标视角：", v("mouselook") === 1 ? "开" : "关"), -200, -10, 400, 60);
    callProc("fj7", "返回", -200, -120, 400, 54);
  });
});
defineProc("fj5", [], () => {
  warp(() => {
    callProc("fj22", "操作说明");
    rgb(0, 0, 100);
    setVar("hy0", 180);
    for (let i = 1; i <= 9; i++) { text(listItem("help", "any", i), 20, -340, v("hy0"), "left"); changeVar("hy0", -38); }
    callProc("fj7", "返回", -100, -190, 200, 46);
  });
});
defineProc("fj12", [], () => {
  warp(() => {
    rgb(0, 70, 25); callProc("fj11", -450, 281, 900, 562);
    rgb(0, 0, 100); text("你倒下了", 60, 0, 110, "center");
    callProc("fj7", "重生", -150, 30, 300, 60);
    callProc("fj7", "回到标题", -150, -50, 300, 60);
  });
});

// ---------- 游戏逻辑 ----------
defineProc("fj17", [], () => {
  warp(() => {
    callProc("fj16");
    setVar("aimx", -9999); setVar("aimok", 0);
    setVar("lastx", fl(v("ex"))); setVar("lasty", fl(v("ey"))); setVar("lastz", fl(v("ez")));
    for (let i = 1; i <= 50; i++) {
      if (v("aimok") === 0) {
      setVar("ax", fl(v("ex") + v("fx0") * i * 0.1));
      setVar("ay", fl(v("ey") + v("fy0") * i * 0.1));
      setVar("az", fl(v("ez") + v("fz0") * i * 0.1));
      setVar("ab", callReporter("block", v("ax"), v("ay"), v("az")) as number);
      if (v("ab") > 0 && v("ab") !== 15 && v("ay") >= 0) {
        setVar("aimok", 1); setVar("aimx", v("ax")); setVar("aimy", v("ay")); setVar("aimz", v("az"));
      } else { setVar("lastx", v("ax")); setVar("lasty", v("ay")); setVar("lastz", v("az")); }
      }
    }
  });
});
function setBlock(sbx: number, sby: number, sbz: number, sbb: number): void {
  setVar("ei", wrap(sbx) + wrap(sbz) * 128 + sby * 16384 + 1);
  replaceListItem("world", "any", v("ei"), sbb);
  appendList("edit_i", v("ei")); appendList("edit_b", sbb);
  appendList("edit_cx", floor(sbx / 16)); appendList("edit_cz", floor(sbz / 16));
}
defineProc("fj13", [], () => {
  warp(() => {
    setVar("dt", timerValue() as number - v("last"));
    changeVar("last", v("dt"));
    if (v("dt") > 0.1) setVar("dt", 0.1);
    if (v("dt") > 0) { setVar("fps", v("fps") * 0.9 + 0.1 / v("dt")); }
    changeVar("clock", v("dt") / 300);
    if (v("notice_t") > 0) changeVar("notice_t", -v("dt"));
    // 视角
    if (keyPressed("37")) changeVar("yaw", -110 * v("dt"));
    if (keyPressed("39")) changeVar("yaw", 110 * v("dt"));
    if (keyPressed("38")) changeVar("pitch", 80 * v("dt"));
    if (keyPressed("40")) changeVar("pitch", -80 * v("dt"));
    if (v("mouselook") === 1) {
      changeVar("yaw", (v("mx0") - v("lastmx")) * 0.35);
      changeVar("pitch", (v("my0") - v("lastmy")) * 0.3);
    }
    setVar("lastmx", v("mx0")); setVar("lastmy", v("my0"));
    if (v("pitch") > 88) setVar("pitch", 88);
    if (v("pitch") < -88) setVar("pitch", -88);
    // 移动
    setVar("mf", 0); setVar("ms", 0);
    if (keyPressed("87")) changeVar("mf", 1);
    if (keyPressed("83")) changeVar("mf", -1);
    if (keyPressed("68")) changeVar("ms", 1);
    if (keyPressed("65")) changeVar("ms", -1);
    setVar("speed", keyPressed("82") ? 7 : 4.5);
    setVar("nxp", v("px") + (trig("sin", v("yaw")) * v("mf") + trig("cos", v("yaw")) * v("ms")) * v("speed") * v("dt"));
    setVar("nzp", v("pz") + (trig("cos", v("yaw")) * v("mf") - trig("sin", v("yaw")) * v("ms")) * v("speed") * v("dt"));
    if (!callReporter("collide", v("nxp"), v("py"), v("pz"))) setVar("px", v("nxp"));
    if (!callReporter("collide", v("px"), v("py"), v("nzp"))) setVar("pz", v("nzp"));
    setVar("inwater", (callReporter("block", v("px"), v("py") + 0.5, v("pz")) as number) === 15 ? 1 : 0);
    if (v("inwater") === 1) {
      setVar("vy", keyPressed("32") ? 3 : -1.5);
      setVar("fallfrom", v("py"));
    } else {
      changeVar("vy", -22 * v("dt"));
      if (v("vy") < -40) setVar("vy", -40);
    }
    setVar("nyp", v("py") + v("vy") * v("dt"));
    if (callReporter("collide", v("px"), v("nyp"), v("pz"))) {
      if (v("vy") < 0) {
        setVar("py", fl(v("nyp")) + 1);
        setVar("drop", v("fallfrom") - v("py"));
        if (v("drop") > 4) { changeVar("hp", -fl(v("drop") - 3)); say("摔伤了"); setVar("hud_dirty", 1); }
        setVar("fallfrom", v("py"));
        setVar("ground", 1);
        if (keyPressed("32")) { setVar("vy", 7.6); setVar("ground", 0); } else setVar("vy", 0);
      } else setVar("vy", 0);
    } else {
      setVar("py", v("nyp")); setVar("ground", 0);
      if (v("py") > v("fallfrom")) setVar("fallfrom", v("py"));
    }
    if (v("py") < -8) setVar("hp", 0);
    if (v("hp") <= 0) { setVar("hp", 0); setVar("screen", 6); setVar("gui_dirty", 1); }
    setVar("regen", v("regen") + v("dt"));
    if (v("regen") > 6) { setVar("regen", 0); if (v("hp") < 20) { changeVar("hp", 1); setVar("hud_dirty", 1); } }
    // 挖与放
    callProc("fj17");
    if ((keyPressed("70") || v("mousedown") === 1) && v("aimok") === 1) {
      setVar("mb", callReporter("block", v("aimx"), v("aimy"), v("aimz")) as number);
      if (v("mb") !== 17) {
        if (v("aimx") !== v("minex") || v("aimy") !== v("miney") || v("aimz") !== v("minez")) { setVar("mining", 0); setVar("minex", v("aimx")); setVar("miney", v("aimy")); setVar("minez", v("aimz")); }
        changeVar("mining", v("dt") / (listItem("hardness", "any", v("mb")) as number));
        if (v("mining") >= 1) {
          setVar("mining", 0);
          setBlock(v("aimx"), v("aimy"), v("aimz"), 0);
          setVar("got", v("mb") === 3 ? 8 : v("mb") === 1 ? 2 : v("mb"));
          replaceListItem("inv", "any", v("got"), (listItem("inv", "any", v("got")) as number) + 1);
          setVar("hud_dirty", 1);
        }
      }
    } else setVar("mining", 0);
    if (v("place_req") === 1) {
      setVar("place_req", 0);
      setVar("pb", listItem("hot", "any", v("sel")) as number);
      if (v("aimok") === 1 && v("pb") > 0 && (listItem("inv", "any", v("pb")) as number) > 0 && v("lasty") >= 0 && v("lasty") < 32) {
        setBlock(v("lastx"), v("lasty"), v("lastz"), v("pb"));
        if (callReporter("collide", v("px"), v("py"), v("pz"))) { setBlock(v("lastx"), v("lasty"), v("lastz"), 0); }
        else { replaceListItem("inv", "any", v("pb"), (listItem("inv", "any", v("pb")) as number) - 1); setVar("hud_dirty", 1); }
      }
    }
    callProc("fj1");
  });
});
defineProc("fj4", [], () => {
  if (v("action") !== 0) {
  setVar("action", 0);
  setVar("gui_dirty", 1);
  setVar("lab", getVar("hitlabel"));
  if (getVar("lab") === "开始新世界") { callProc("fj8"); setVar("screen", 1); setVar("hud_dirty", 1); }
  else if (getVar("lab") === "继续游戏") { setVar("screen", 1); setVar("hud_dirty", 1); setVar("last", timerValue()); }
  else if (getVar("lab") === "背包") setVar("screen", 3);
  else if (getVar("lab") === "合成") setVar("screen", 4);
  else if (getVar("lab") === "设置") { setVar("back", v("screen")); setVar("screen", 5); }
  else if (getVar("lab") === "操作说明") { setVar("back", v("screen")); setVar("screen", 7); }
  else if (getVar("lab") === "回到标题") setVar("screen", 0);
  else if (getVar("lab") === "重生") { setVar("hp", 20); setVar("py", 30); setVar("vy", 0); setVar("fallfrom", 30); setVar("screen", 1); setVar("hud_dirty", 1); }
  else if (getVar("lab") === "返回") {
    if (v("screen") === 5 || v("screen") === 7) setVar("screen", v("back"));
    else { setVar("screen", 1); setVar("hud_dirty", 1); setVar("last", timerValue()); }
  }
  }
});
defineProc("fj20", [], () => {
  if (v("screen") === 5 && v("clicked") === 1) {
  if (v("my0") <= 150 && v("my0") >= 90 && mathFunc("abs", v("mx0")) <= 200) { setVar("cols", v("cols") === 80 ? 120 : v("cols") === 120 ? 160 : 80); setVar("clicked", 0); setVar("gui_dirty", 1); }
  if (v("my0") <= 70 && v("my0") >= 10 && mathFunc("abs", v("mx0")) <= 200) { setVar("far", v("far") === 32 ? 44 : v("far") === 44 ? 20 : 32); setVar("clicked", 0); setVar("gui_dirty", 1); }
  if (v("my0") <= -10 && v("my0") >= -70 && mathFunc("abs", v("mx0")) <= 200) { setVar("mouselook", 1 - v("mouselook")); setVar("clicked", 0); setVar("gui_dirty", 1); }
  }
});
defineProc("fj8", [], () => {
  warp(() => {
    setVar("seed", (timeNow("second") as number) * 7.31 + (timerValue() as number) * 101);
    setVar("started", 1);
    deleteListItem("edit_i", "all", 1); deleteListItem("edit_b", "all", 1);
    deleteListItem("edit_cx", "all", 1); deleteListItem("edit_cz", "all", 1);
    for (let i = 1; i <= 64; i++) { replaceListItem("chunk_x", "any", i, 99999); replaceListItem("chunk_z", "any", i, 99999); }
    for (let i = 1; i <= 18; i++) replaceListItem("inv", "any", i, 0);
    setVar("px", 8.5); setVar("pz", 8.5); setVar("yaw", 30); setVar("pitch", -8); setVar("vy", 0); setVar("hp", 20);
    setVar("clock", 0.08); setVar("sel", 1); setVar("mining", 0);
    setVar("pending", 1);
    while (v("pending") === 1) callProc("fj1");
    setVar("py", (callReporter("terrain", 8, 8) as number) + 2);
    if (v("py") < 14) setVar("py", 14);
    setVar("fallfrom", v("py"));
    setVar("last", timerValue());
    say("按 E 打开背包，按 F 挖方块，按 G 放方块");
  });
});

onStart(() => {
  hide();
  timerStart();
  warp(() => {
    setVar("screen", 0); setVar("started", 0); setVar("gui_dirty", 1); setVar("hud_dirty", 1); setVar("action", 0); setVar("clicked", 0);
    setVar("cols", 120); setVar("far", 32); setVar("mouselook", 0); setVar("sel", 1); setVar("fps", 30);
    setVar("sunx", 0.7); setVar("suny", 0.7); setVar("aimx", -9999);setVar("aimy", 0);setVar("aimz", 0);setVar("notice_t", 0); setVar("notice", ""); setVar("back", 0); setVar("last", 0);
    setVar("mx0", 0); setVar("my0", 0); setVar("lastmx", 0); setVar("lastmy", 0); setVar("mining", 0); setVar("place_req", 0); setVar("mousedown", 0); setVar("wasdown", 0);
    setVar("hp", 20); setVar("px", 8); setVar("py", 30); setVar("pz", 8); setVar("yaw", 0); setVar("pitch", 0); setVar("clock", 0.08); setVar("seed", 1); setVar("minex", 0); setVar("miney", 0); setVar("minez", 0);
    for (let i = 0; i < 524288; i++) appendList("world", 0);
    for (let i = 0; i < 64; i++) { appendList("chunk_x", 99999); appendList("chunk_z", 99999); }
    for (let i = 0; i < 18; i++) appendList("inv", 0);
    for (let i = 1; i <= 9; i++) appendList("hot", 0);
    replaceListItem("hot", "any", 1, 2); replaceListItem("hot", "any", 2, 3); replaceListItem("hot", "any", 3, 5); replaceListItem("hot", "any", 4, 7);
    replaceListItem("hot", "any", 5, 8); replaceListItem("hot", "any", 6, 13); replaceListItem("hot", "any", 7, 14); replaceListItem("hot", "any", 8, 4); replaceListItem("hot", "any", 9, 18);
  });
  forever(() => {
    setVar("mx0", mouseX()); setVar("my0", mouseY());
    setVar("mousedown", mouseTrigger("down") ? 1 : 0);
    if (v("mousedown") === 1 && v("wasdown") === 0) { setVar("clicked", 1); setVar("gui_dirty", 1); } else setVar("clicked", 0);
    setVar("wasdown", v("mousedown"));
    if (v("screen") === 1) {
      callProc("fj13");
      if (v("screen") === 1) {
        callProc("fj15");
        if (v("hud_dirty") === 1 || v("hudtick") <= 0) { callProc("fj6"); setVar("hud_dirty", 0); setVar("hudtick", 1); }
        changeVar("hudtick", -v("dt"));
        callProc("fj0");
        changeVar("frames", 1);
      }
    } else {
      callProc("fj20");
      if (v("gui_dirty") === 1 || v("mx0") !== v("guimx") || v("my0") !== v("guimy")) {
        setVar("gui_dirty", 0); setVar("guimx", v("mx0")); setVar("guimy", v("my0"));
        if (v("screen") === 0) callProc("fj10");
        else if (v("screen") === 2) callProc("fj9");
        else if (v("screen") === 3) callProc("fj19");
        else if (v("screen") === 4) callProc("fj2");
        else if (v("screen") === 5) callProc("fj21");
        else if (v("screen") === 6) callProc("fj12");
        else if (v("screen") === 7) callProc("fj5");
        callProc("fj4");
      }
    }
  });
});
onKey("69", "up", () => { if (v("screen") === 1) { setVar("screen", 3); setVar("gui_dirty", 1); } else if (v("screen") === 3) { setVar("screen", 1); setVar("hud_dirty", 1); setVar("last", timerValue()); } });
onKey("67", "up", () => { if (v("screen") === 1) { setVar("screen", 4); setVar("gui_dirty", 1); } else if (v("screen") === 4) { setVar("screen", 1); setVar("hud_dirty", 1); setVar("last", timerValue()); } });
onKey("80", "up", () => { if (v("screen") === 1) { setVar("screen", 2); setVar("gui_dirty", 1); } else if (v("screen") === 2) { setVar("screen", 1); setVar("hud_dirty", 1); setVar("last", timerValue()); } });
onKey("71", "up", () => { setVar("place_req", 1); });
onKey("49", "up", () => { setVar("sel", 1); setVar("hud_dirty", 1); });
onKey("50", "up", () => { setVar("sel", 2); setVar("hud_dirty", 1); });
onKey("51", "up", () => { setVar("sel", 3); setVar("hud_dirty", 1); });
onKey("52", "up", () => { setVar("sel", 4); setVar("hud_dirty", 1); });
onKey("53", "up", () => { setVar("sel", 5); setVar("hud_dirty", 1); });
onKey("54", "up", () => { setVar("sel", 6); setVar("hud_dirty", 1); });
onKey("55", "up", () => { setVar("sel", 7); setVar("hud_dirty", 1); });
onKey("56", "up", () => { setVar("sel", 8); setVar("hud_dirty", 1); });
onKey("57", "up", () => { setVar("sel", 9); setVar("hud_dirty", 1); });
