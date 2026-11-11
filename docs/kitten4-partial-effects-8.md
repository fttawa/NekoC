# K4 第八轮：ASCII、滤镜输入面与可解释误差

## 修复与不升级

`web/renderer.js` 独立实现，不移植官方源码、不使用 HateNeko：

- 补 ASCII 的屏幕像素网格、格角取色、预乘亮度档位及5×5字形。
  字形使用独立逐行整数mask，不复制官方float位打包着色器。
- 空间滤镜的输入面不再提前裁到舞台；改用输入面的投影，避免GL clip-space
  先丢掉舞台外的源几何。场景twist保留20px透明padding。
- 输入面采用有上限LRU复用的双缓冲，普通输入按POT分配，恰好舞台大小的
  screen输入保持原尺寸；保留active frame外透明区并裁剪各pass输出。
- 黑白/saturate在ASCII之前执行；KN原shader数值算法不变。
- framebuffer、viewport、scissor恢复，GPU纹理上限显式报错，不静默分配畸形面。

**五个效果setter/change类型仍partial，不升级整类型或整setter主路径。**
独立ASCII、场景/舞台外twist已修，但ripple素材缺失、ASCII组合仍有负例。
不能以常用scope通过代替全部选项通过。

## 官方证据来源

只读外部文件：
`K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
以下为解码JS字符串0-based UTF-16整包offset，仅作定位，不入库官方实现：

| 位置 | offset约 | 可观察事实 |
| --- | ---: | --- |
| effects `jt.get_effect_filter` | 793395 | hue→brightness→pixelate→displacement→twist→saturate→ASCII |
| `jt.update_twist_offset` | 792449 | offset为演员anchor加舞台半宽高 |
| `jt.set_twist` | 795853 | angle=输入×10°，radius为尺寸半对角线 |
| `jt.set_ascii` | 796181 | size限制在1与目标最短边之间 |
| ASCII filter shader | 1596092 | 全局像素网格格角采样、预乘RGB平均亮度、8档5×5字形 |
| twist filter shader | 1593821 | 半径内平方衰减旋转，padding20 |
| PIXI片元精度默认配置 | 1272588 | 桌面mediump；本地仍highp，不能泛称跨GPU逐字节相同 |
| ripple domain resource | 599450 | 外部`kitten/displacement_map_full.png`，不是正弦纹理 |

`k4-partial-effects-8-probe.mjs` 仅包装原生filter apply并调用原方法，记录input frame/
texture尺寸/filterArea/offset，不替换官方计算。例如舞台外演员输入为
`x814,y588,232×184`，不是提前裁成舞台内矩形；场景twist输入为
`x-20,y-20,1000×760`、底层1024×1024面。恰好舞台大小ASCII为960×720面。
`kitten4-partial-effects-8-geometry.json`保留原生观察与资源/夹具身份；
原始诊断完整输出只在本worktree忽略的dist中。

## 像素证据口径

- `kitten4-partial-effects-8-pixels.json`：**真实NekoC VM**对官方VM，沿用
  第七轮24件原创夹具并增加10件ASCII/组合/场景探针，共**34件262对固定帧**全画布960×720，
  白底合成、无mask，同时记录RGB容差 **0、1、8**，其中254对容差8下0超差；
  8对保留ripple/ASCII组合负例。不能把容差8的0超差称字节全等。
- `kitten4-partial-effects-8-baseline.json`：固定`6aaa205` renderer，同样原创输入
  与实际VM；保留基线hash，不改第七轮历史JSON。
- `kitten4-partial-effects-8-renderer.json`：仅shader隔离诊断（官方getter驱动），
  不能替代真实NekoC VM证据。当前renderer由pixels报告hash绑定。
- PNG、请求诊断、state均保存在`dist/partial-effects-8/`，不复制第三方作品或媒体。

旧负例在RGB容差8下：独立ASCII 8/12分别23487/24542超差像素，
舞台外加twist3795，场景加twist86021；本轮这些固定帧均为 **0超差，且单通道误差≤1**。
独立ASCII在原尺寸、137%/小数位置、30°旋转和场景输入均≤1；五个set/change
拼写均通过。无滤镜clear后仍有小量1字节差（SVG预乘/合成量化已有误差），不是本轮算法归零。
颜色/透明/亮度/黑白常用链保持第七轮容差8下0超差，但少量像素超1，不声称已经
证明所有色彩矩阵误差仅1字节；没有为了升级而放宽门限或抹掉这些数字。

## 必须公开的负例与风险

- `all-no-ripple` ASCII阶段仍有703个容差8超差像素；字形边缘与阈值采样会放大
  上游量化/UV舍入。不能将其全解释为单字节误差，具体GPU浮点来源**未验证**。
- `ascii-offstage` 加twist仍有少量超差；单独ASCII阶段通过。
- ripple仍是旧近似；官方外部displacement素材被安全策略阻断，离线包未找到该图片。
  该样本只能证明当前离线观测存在差异，**完整素材条件下行为未验证**，不伪造素材。
- ELASTIC、iOS提示/非WebGL、非60Hz、任意多倍率/多分辨率、极端尺寸、
  转场中的继承alpha/坐标及所有效果任意排列组合仍未验证。
- POT与padding会增加GPU内存/绘制；缓存最多4对/目标32MiB，超大面可独占一对，
  有GPU纹理尺寸硬限制；未做性能基准，不能承诺性能无回退。

## 复现

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
# k4-trace由主会话串行构建；以下不隐式Cargo
node tools/compat/k4-partial-effects-8-fixtures.mjs
node tools/compat/k4-partial-effects-8-visual.mjs --baseline self_set_effect_2-ascii spatial-offstage scene-spatial all-no-ripple
node tools/compat/k4-partial-effects-8-visual.mjs
node tools/compat/k4-partial-effects-7-renderer.mjs --round8 self_set_effect_2-ascii ascii-fractional ascii-rotate spatial-offstage all-no-ripple
node tools/compat/k4-partial-effects-8-probe.mjs ascii scene-spatial spatial-offstage all-no-ripple
$env:K4_EFFECTS8_INTEGRATION='1'
$env:K4_EFFECTS7_BROWSER='1'
node --test tests/k4-partial-effects-8.test.mjs tests/k4-partial-effects-7.test.mjs
```
