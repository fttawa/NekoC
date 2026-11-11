# K4 partial 7：高频效果真实算法修复（五项仍 partial）

## 结论

负责 `self_set_effect_2`、`self_change_effect_3`、legacy `self_set_effect`、
`self_change_effect`、`self_change_effect_2`。**五项均继续 partial，不申请整类型或严格主路径升级。**
没有修改总 scope 表、Rust/engine.rs；未运行 Cargo、未提交、未清理 target。

真实 NekoC VM deltas 对官方 VM：**24 份原创可编辑夹具、190 对固定帧完整画布，
178 帧零超差，12 帧保留已知差异**。零超差指 RGB 单通道容差8，不是字节全等。
每帧960×720、691200像素、白底合成、无mask；MAE计算全部RGB通道。

## 修复内容

只修改 `web/renderer.js` 滤镜局部，独立实现，没有移植官方源码。

1. K4 world alpha 在滤镜输入栅格化时生效，之后才进行颜色矩阵，而不是所有矩阵后
   再乘 actor opacity。新棋盘夹具包含半透明格与高饱和色，揭出旧条纹未覆盖的
   颜色→透明→亮度→黑白组合误差。保留 premultiplied RGBA8 的中间量化。
2. Pixelate 改为先栅格化变换后的 actor，再在屏幕像素网格量化、采样格角，
   不再用原 KN 的 `value/10+1` 纹理格大小；旋转角色也保持屏幕网格，格原点与舞台一致。
3. Twist 改为屏幕空间逆采样、10×输入角度、径向平方衰减、对角线半径与20px padding；
   使用 actor anchor 而非 costume 中心，修复自定义 pivot。
4. 顺序为 hue→brightness→pixelate→twist→saturate。
   **不声称包含 ripple/ASCII 的组合正确**，这两项仍为主要算法缺口。

KN shader 数值算法不变，新增 dispatch 仅在 `kitten4` 且 pixelate/twist 有值时进入。
现有 WebGL2、premultiplied blend、非 preserved drawing buffer 契约不变。
双缓冲只分配舞台裁剪后的 actor 包围框；按尺寸复用有上限LRU（最多4对、目标32MiB，
单个超大尺寸允许独占一对），不是每角色一套全屏面。`stats.k4FilterBytes` 单独暴露纹理字节。
加载新工程清理缓存，分配异常清理半成品并恢复 framebuffer/viewport；正常通路也恢复二者。
空间滤镜比旧单pass增加绘制与双RGBA8面，**没有做性能基准，不承诺性能无回退**。
舞台滤镜本身需要舞台大小的面；多个尺寸连续变化可能淘汰/重建，不宣称解决全部动态缩放抖动。

## 官方来源与证据分层

- 只读 `K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
  SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
  所有外部请求依照既有 oracle 安全策略阻断；未复制语料或官方媒体。
- `tools/compat/k4-partial-effects-7-fixtures.mjs`：原创96×72不对称棋盘SVG、
  半透明格、窄条、缺口；scene 是新写的960×720矩形背景。
- `kitten4-partial-effects-7-pixels.json`：**真实 NekoC VM** vs 官方 VM 的190帧结果，
  保存 fixture/renderer/executable SHA-256 和官方资源哈希。
  PNG、完整pageErrors/请求/状态诊断在本worktree忽略的 `dist/partial-effects-7/visual/`。
- `kitten4-partial-effects-7-baseline.json`：只读 `git show <起始HEAD>:web/renderer.js`
  保存至dist后运行同样的真实VM对照，不修改工作renderer。记录基线commit与renderer哈希。
- `kitten4-partial-effects-7-renderer.json`：补充 **shader隔离** 诊断，原生getter驱动
  NekoC renderer，因此不能代替VM证明。原生 `get_effect_filter/apply` 包装只记录参数并调用原方法，
  保留每帧 getter、实际 block events、filterFrame/angle/radius/offset、errors与请求。
  scene仅走真实VM验证；隔离工具明确跳过scene。

## 前后固定帧结果

|原创夹具|旧renderer超差像素|新renderer超差像素|
|---|---|---|
|self_set_effect_2|帧5/6各1319，7/8各5429；其余0|10帧均0，最大MAE0.036675|
|self_set_effect_2-pixelate|帧1/2各10602，3/4各8126；clear后0|6帧均0，最大MAE0.000589|
|twist|帧1/2各27811，3/4各23700；clear后0|6帧均0，最大MAE0.000540|

五个拼写各有颜色/透明/亮度/黑白链和pixelate链：共80帧全部零超差。
另 pixelate 的1/7.5/72、小数位置/137%缩放、30°旋转；twist 20/25/65/100、
小数位置/137%、30°旋转、pivot(11,-7)；颜色+透明+亮度+pixelate+twist+黑白组合；
现代change decrease链和scene常用滤镜链均零超差。
这只认证这些具体输入/夹具，不是任意数值或排列组合认证。

## 必须保留的主要选项差异与边界

|夹具/选项|真实VM像素结果|判定|
|---|---|---|
|ASCII 8→12|帧1/2各23487，3/4各24542；clear后0|ASCII shader仍未实现；主要选项，非罕见宿主边界|
|ripple 65→20|帧1–4为17287/13335/12557/13064；clear后0|仍近似算法；外部displacement map被阻断，完整素材条件未验证|
|spatial-offstage|pixelate帧1/2为0；加twist后帧3/4各3795；clear后0|舞台外滤镜裁剪/纹理边界不等价|
|scene-spatial|pixelate帧1/2为0；加twist后帧3/4各86021；clear后0|场景twist仍不等价，不能从actor通过推导scene通过|

ELASTIC、iOS ASCII提示、特殊实体错误分支、非WebGL、极端纹理尺寸、多分辨率、
转场期间效果坐标/继承alpha、ripple+空间滤镜、所有scope任意组合/输入仍未完整验证。
前两轮的严格数值/legacy强制increase状态证据仍有效；本轮不以其代替像素证据。

## 复现（不触发 Cargo）

执行前查实际进程：

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
# target/debug/k4-trace.exe 由主会话统一构建
node tools/compat/k4-partial-effects-7-fixtures.mjs
node tools/compat/k4-partial-effects-7-visual.mjs --baseline self_set_effect_2 self_set_effect_2-pixelate twist
node tools/compat/k4-partial-effects-7-visual.mjs
node tools/compat/k4-partial-effects-7-renderer.mjs
node --test tests/k4-partial-effects-7.test.mjs
$env:K4_EFFECTS7_BROWSER='1'
node --test tests/k4-partial-effects-7.test.mjs
$env:K4_EFFECTS7_INTEGRATION='1'
node --test tests/k4-partial-effects-7.test.mjs
```

baseline命令取**当前HEAD**；后续合并/提交后若要复原本轮基线，应使用证据JSON中的
`baselineCommit`，不能把新HEAD误称修复前。

## 与历史门禁的关系

`tests/k4-partial-effects-6.test.mjs` 第55行硬绑定旧renderer哈希，且第66行要求旧
pixelate/twist失败。这是第六轮**历史快照证据**，本轮没有改写旧JSON来伪造历史。
主会话已把该测试的当前renderer硬绑定改为第七轮baseline历史身份，当前源码由第七轮证据绑定。
实时第六轮回归仍严格检查clear后；clear前的ripple+ASCII+空间组合单列已知失败，
不继续使用旧算法的超差数量当上限（原23320、本轮23419），也不宣称该帧改善。
不可简单重录第六轮JSON却继续断言旧算法失败。

本轮曾连跑新测试、transition-3及旧visual-effects，11通过/1失败/3跳过；失败是启用
`K4_VISUAL_BROWSER` 后旧测试HTTP宿主未提供现有 `pen-k4.js`，导致renderer动态import失败。
新浏览器测试正确提供模块，已实测 framebuffer/viewport恢复、LRU复用/上限、KN无滤镜分配、
load清理和GL无错误。本轮不修改其他专项的旧测试宿主。

最终专项启用 `K4_EFFECTS7_BROWSER=1`、`K4_EFFECTS7_INTEGRATION=1` 后 **7/7通过、0跳过**，
其中实时重跑9份夹具各3帧，共27对官方/NekoC真实VM画布全部零超差；不是只读JSON测试。
不启用integration而启用browser时6通过/1跳过。四份新增JS的 `node --check` 和
`git diff --check -- web/renderer.js` 均通过。没有执行全套门禁或任何Cargo命令。
