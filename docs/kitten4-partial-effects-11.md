# K4 第十一轮：slide/distort 滤镜继承

基线 `da8dc9c5c414a4b32c9239c33df437d6d8322cf1`，任务开始时与 `oc/integrate` 一致。
“官方”限定为只读离线包，身份及定位见
[`kitten4-partial-effects-11-source.json`](kitten4-partial-effects-11-source.json)。
没有移植官方源码、shader、资源或第三方作品，没有移植 HateNeko。

## 行为与独立修复

1. **slide 使用真实场景树，不截图。** 两个场景同时 QUAD 移动；子对象的 world
   坐标先继承父容器位移，再进入滤镜。twist offset 由子对象自身坐标决定，不随父场景移动。
   指定包覆盖后的 filter manager 对输入 bounds 加最大 padding，然后 fit 到当前
   sourceFrame 的同中心两倍宽高范围；完整舞台目标即 `[-W/2, -H/2, 2W, 2H]`。
   本地此前保留了无限 offstage 输入，导致滑动后期 active rectangle/UV 不同。
   修复裁剪后，原 `slide-filters` 的最大4293个 tol8 超差像素归零。
2. **distort 先截图，后附加截图自身的 twist。** 先令离场场景可见、入场隐藏，渲染整个
   stage 到透明 RenderTexture；反转可见性再取入场截图。两张截图依次加到 stage，
   并非加入场景容器；真实目标场景仍在下面。离场及入场各有独立 twist，padding=10，
   半径为舞台短边，offset 为舞台中心，入场延迟100ms。
3. **截图的滤镜最后一遍使用离屏投影。** 官方屏幕目标 Y scale 为负、RenderTexture 为正；
   legacy quad 不自行翻转 UV。本地统一向下坐标的场景面不能直接复用向屏幕投影的
   ASCII 栅格，否则 glyph 精确格线在截图时改变。新增仅属于本次过渡的临时输出面，
   按离屏方向栅格化最后一遍 ASCII，再翻转拷贝回本地场景面。没有改全局精度、加 epsilon、
   增大容差或跳过像素。过渡清理同时释放该面。
4. **同一 update 设置滤镜后切场。** 官方在切场函数内同步截图；本地帧原来只发送目标场景，
   导致 renderer 保存的离场滤镜落后一帧。K4 过渡现在附带切场边界的离场 sprites/order/
   pen_layer 快照，renderer 用它覆盖上次呈现状态。快照逻辑集中在 `src/engine/k4_drawing.rs`；
   KN 帧不新增该数据，调度和表达式编译不变。

## 官方证据

源码定位为 UTF-8 解码后的 **0-based UTF-16 offset**，不是字节位置；只保存窗口 hash，
不保存函数体：

| 位置 | offset | 事实 |
| --- | ---: | --- |
| Et.set_slide_transition | 789066 | 同时移动两个真实场景容器 |
| Et.set_distort_transition | 789964 | 两次 stage 截图、截图滤镜与目标场景 |
| 覆盖版 Bn.prototype.push | 1598609 | 最大 padding、两倍 sourceFrame fit、roundFrame、POT |
| roundFrame | 1386850 | 目标投影下取整 |
| legacy quad map / applyFilter | 1380071 / 1385192 | active rectangle、UV 和最终目标绑定 |
| projectionCalculate / renderTextureProjectionUpdate | 1427880 / 1428897 | 屏幕与离屏目标 Y 方向相反 |

`kitten4-partial-transition-11-*.json` 逐件保存连续65帧官方 VM/ticker 与独立 renderer 输入
的完整画布比较；这是渲染隔离证据，**不是 NekoC VM 证据**。沿用第十轮原创夹具的字节与 hash，
不改输入以消除负例。distort 另保存扭曲前两张原始 RGBA 截图的比较（校正两种 API 的读回方向），
两张均0个 tol8 超差通道；离场最大通道差1，入场字节全等。

真实 VM 对比使用 `k4-effects-11-visual.mjs`，不预喂造假的离场/入场 frame。
两端 `performance`/ticker 显式控制为60Hz，逐帧完整画布，RGB容差8，未遮罩；
不把这种诊断时钟等同于浏览器真实墙钟。

## 已知边界与覆盖判定

**ripple 例外**：指定离线包缺失/阻断 displacement 位移素材，完整资源条件未验证。
不得用近似正弦位移或伪造资源把它算作通过。

多GPU、多倍率、所有实数参数/滤镜排列、真实时钟相位、竞争/中断切场、动态离场树、
同帧画笔增量、视频与浮层参与 stage 截图仍未验证。切场快照只解决 sprites 的边界状态，
不宣称已解决画笔命令在切场之前丢弃的问题。

本轮隔离过渡夹具的 slide/distort 原有负例均达到 tol8 全0；但真实 NekoC VM 的同帧
setter/changer 夹具仍有最大629个超差像素，且部分隔离夹具发生上下文关闭或身份变更，
不能据此升级五个滤镜写入积木。扩展到 slide up/down 还保留方向性负例（最大19254），
所以 `set_scene_transition` 及五种 effect writer 继续保持 `partial`；本轮只升级已证实的
renderer/过渡输入处理，不把隔离证据外推成完整 VM 兼容。

## 复验

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-effects-11-source.mjs
node tools/compat/k4-partial-transition-11.mjs --record --diagnose
node tools/compat/k4-effects-11-visual.mjs
node tools/compat/k4-effects-11-visual.mjs --original slide-filters distrot-filters
node --test tests/k4-partial-transition-11.test.mjs
cargo test --test kitten4_effects_11
```

`.bcm` 均为仓库原创工作区和内联 SVG，由官方 oracle 原生编译/加载；不是 KN `.bcmkn`，
不声称 KN 专用 editor-compat 检查通过。所有第三方语料仅在外部路径只读，完整诊断 PNG/轨迹留在忽略的 `dist/k4effects11/`。
