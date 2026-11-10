# K4 四项修复：采样时钟、timer、初始鼠标与弹窗截图

本页记录 `oc/k4fix` 处理的四个像素对比遗留问题。官方依据均出自只读离线内核
`src/player/build/player_v2.2d180c468559fbd29528.js.orig`；探针由
`tools/compat/k4-fix-fixtures.mjs` 从仓库自制基础作品生成，官方逐帧变量、角色尺寸与弹窗记录在
[kitten4-fix-evidence.json](kitten4-fix-evidence.json)。

## 官方源码位置与证据边界

主内核 SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
以下为该单行压缩文件的 **JS 字符偏移（从 0 开始，不是 UTF-8 字节偏移）**，可配合符号查找：

| 位置 | 官方实现 |
|---|---|
| 576212，`s(t)` | 先比较原始字符串相等，再逐段 Number() 比较；缺失/非三段版本按新路径处理；非规范但数字等价字符串有特殊旧路径行为 |
| 617221，`get_timer` | `s("4.1.1")` 选 RuntimeManager，否则选组件 `a.get_time()` |
| 616904 附近，`set_timer_state` | start/stop 操作组件；reset 先清零再 start，不调用 RuntimeManager.reset_timer |
| 1179360 附近，`RuntimeManager.run`；1184892，`get_timer_elapsed_s` | 开始时保存 Date，读出毫秒差 / 1000 |
| 998209 附近，`or` | `time_elapsed_in_sec` 初始为 0；start 每 16 ms 采样；stop 不补采样；get_time 用 toFixed(2) |
| 1009664，`vr.mouse_data` | `{x:NaN,y:NaN}`；舞台指针事件才调用 set_mouse_data |
| 637851 / 638029，`Ht` 的 set_fill_style / set_pen_path | 调用 brush.set_fill_color / set_fill_start / draw_fill_pattern |
| 812148 / 812521，`Rt` | 填充记录角色路径；结束时 Canvas closePath + fill；本轮不改此算法 |
| 897769，`tn` | 官方介绍弹窗是 PIXI 图元，而非 DOM；布局与阻塞证据另见 kitten4-layer-dialog.md |

这里的“官方”仅指该离线包（含既有 DI 暴露点），**未验证**它与当前线上发布物完全相同。
没有参考或移植 HateNeko；没有复制官方内核或第三方作品到跟踪路径。

## 1. timer 语义（已对齐）

官方 `get_timer` 按作品版本分两条路径：

| 版本 | 官方实现 | 语义 |
|---|---|---|
| < 4.1.1 | `RuntimeManager.get_timer_elapsed_s()`：`(Date.now() - timer_block_date) / 1000`，`timer_block_date` 只在 `run()` 时设置 | 运行开始后经过的整毫秒；计时器积木（启动/停止/重置）**不影响**它 |
| ≥ 4.1.1 | 舞台计时器组件 `or`：`start` 用 16 ms `setInterval` 采样 `Date.now()`；`stop` 清掉定时器；`reset` 归零后立即重新 `start`；`get_time()` 返回 `parseFloat(toFixed(2))` | 初始为 0，**直到计时器积木启动才开始走**；两位小数；停止后冻结 |

NekoC 原先对两种版本都用“从开始就按 dt 累加、不取整”的 KN 语义，与两条官方路径都不一致。
现在 `Program` 按 `application_version` 选择 `src/engine/k4_clock.rs` 的 `K4Timer::RunClock` 或 `K4Timer::Widget`：

- 每次 update 开始时取 `clock_ms = floor(已模拟时间 × 1000)`，对应官方脚本在本次 update 中读到的 `Date.now()`。
- 组件计时器在运行时每帧采样一次（对应 16 ms 定时器在每帧前触发一次），读出时按 JS `toFixed(2)` 取两位。
- KN 作品的 timer 行为不变。

官方实测（虚拟 Date，12 帧，同一脚本：读→wait 0→读→停止→wait 0→读→重置→读→wait 0→读→启动→wait 0→读→wait 0→读）：

- `k4fix-timer-new`（4.11.19）：`[0,0,0,0,0.03,0.07,0.1]`
- `k4fix-timer-boundary`（恰好 4.1.1）：与 timer-new 完全相同。
- `k4fix-timer-noncanonical`（4.1.01）：官方先比较原始字符串，再逐段 Number；数值等价但字符串不同，实际走旧路径，结果与 timer-legacy 相同。Rust 保留此行为，不把版本归一化后猜测。
- `k4fix-timer-legacy`（4.1.0）：`[0,0.033,0.066,0.066,0.1,0.133,0.166]`
- `k4fix-timer-resume`：启动→停止→恢复→重置，最终 `[0.03,0.03,0.07,0,0.03]`。

`Date.now()` 与 `new Date().valueOf()` 在虚拟模式均为整毫秒（原进度只截断了后者，现已补齐）。
Rust 与 JS 各自测试精确二进制平局（0.125 → 0.13）及非精确十进制近似（1.005 → 1、2.675 → 2.67）。

`k4-oracle.mjs --virtual-time` 现在也让 16 ms 定时器在每次 update 前恰好触发一次，否则组件计时器在离线驱动下永远是 0（runerr2 曾记录到的“官方旧路径为 0”即此原因）。这仍是**诊断用的时间替换**，不是官方原生墙钟行为。

## 2. 初始鼠标位置（331465353 按钮尺寸的根因）

官方 `mouse_data` 初始为 `{x: NaN, y: NaN}`，只有舞台收到指针事件后才更新；因此在没有输入时，“碰到鼠标”为 false，鼠标坐标为 NaN。NekoC 原先把鼠标放在 (0,0)：331465353 的“对战”按钮正好盖住舞台中心，每帧执行“碰到鼠标就放大到 120”，所以 NekoC 画得更大。

修复：K4 作品启动时鼠标为 NaN，直到第一次 `set_mouse`；KN 不变。探针 `k4fix-mouse` 官方实测 12 帧 `log=0`、坐标 `[null,null]`（JSON 中 NaN 记为 null）。

331465353 第 60 帧配对差异：16.16% → 1.79%（剩余主要位于文字边缘；未证明所有残差均为抗锯齿）。

## 3. 335017543 的“填充画笔”

调查结论：**本例未发现填充画笔算法错误**，黑帧差异来自采样时钟和 timer 语义。该作品用 `get_timer × 标定fps` 决定播放到第几帧；k4-trace 用虚拟时钟，而旧的 k4-visual 官方一侧用真实墙钟，两边截到的是动画的不同时刻。结论不扩大到所有画笔功能。

- `k4-visual` 的官方一侧现在也使用 `virtualTime`，两侧在同一脚本时间采样。
- 自制夹具 `k4fix-fill`（白色填充闭合路径，每帧 `clear_drawing` 后重画；画笔颜色设为黑色但不落笔）与官方逐像素一致：第 1/30/60 帧差异均为 0%。
- 335017543 第 60 帧：接手时记录 43.38% → 1.81%；本次重新构建基线实测 32.68% → 1.81%。旧基线受墙钟影响，数值不可重复；统一时钟后双方处于开场黑帧。剩余差异是官方画在画布里的初始变量监视框；VM 没有输出这些初始监视框，NekoC 一侧没有画出。
- 原进度在 150 帧遇到 JSON 字符串过长。现在 `k4-trace --render-only` 只省略重复的完整变量快照，保留真实 Frame/画笔增量；oracle 的变量过滤只缩小诊断输出，不改作品状态，允许检查后续白色路径。
- 补测真实轮廓：第 100/150 帧均已出现白色填充，像素差异为 **1.9051% / 1.9066%**，形状与官方相同；残差主要是左上变量框。完整图见 `dist/k4fix/final-contour/335017543.bcm/`。作品帧索引前 34 项相同（空画面），所以不能要求统一虚拟时钟后的第 60 update 已出现轮廓。

## 4. 介绍弹窗进入截图对比

NekoC 用 DOM（`web/overlay.js`）画气泡、监视框和介绍弹窗；官方画进 PIXI 画布。`k4-visual` 现在把真实的 `web/overlay.js` 挂到 NekoC 页面，凡是浮层里有可见元素的帧，就对舞台容器做 1:1 元素截图，然后再与官方像素对比。帧记录里的 `overlay: true` 标出这种截图方式。

- 319595457 第 1/30/60 帧：6.61/6.94/7.05% → 1.99/2.53/3.12%。两侧弹窗状态逐帧相同（同一段已打印文字，`printing` 均为 true）。剩余差异是字体渲染，以及按钮文案不同：NekoC 打印中显示“显示全部 ▷”，官方显示“点击继续”。
- 自制 `k4fix-dialog` 夹具复用仓库原创层序弹窗探针，不来自语料；无输入时尾部变量 after 始终为 0，另一线程 other 为 1。官方前 12 帧弹窗可见且打印中，文本见 evidence 的 dialogs。

## 复验

```powershell
$env:K4_PLAYER_DIR='只读官方播放器 app 路径'
$env:NEKOC_NODE_MODULES='外部 Playwright node_modules 路径'
node tools/compat/k4-fix-fixtures.mjs --record
$env:K4_ORACLE_INTEGRATION='1'; $env:K4_VISUAL_INTEGRATION='1'
node --test tests/k4-fix.test.mjs
cargo test --test kitten4_fixes
# 基线源码来自本 worktree 的 git archive 0036124（解包在 dist/k4fix/baseline-src），
# 用独立 target/k4fix-baseline 构建；绝不借用或改动其它 worktree。
node tools/compat/k4-fix-visual.mjs E:/nekoc/dist/kitten4-corpus
```

本次重跑结果摘要见 [kitten4-fix-pixels.json](kitten4-fix-pixels.json)，完整像素指标、PNG 与状态在
`dist/k4fix/final-before-after.json`、`final-before/`、`final-after/`。同 seed=1、RGB 容差=8：

|作品|帧 1 前→后|帧 30 前→后|帧 60 前→后|
|---|---|---|---|
|335017543|2.6156% → 2.6156%|1.8127% → 1.8141%|32.6823% → 1.8129%|
|331465353|9.5068% → 1.7933%|16.1600% → 1.7933%|16.1600% → 1.7933%|
|319595457|6.6071% → 1.9861%|6.9400% → 2.5255%|7.0515% → 3.1221%|

这是**完整旧流水线与新流水线**的对照，含时钟与 DOM 捕获修正，不能冒称纯渲染器优化；
335017543 的旧墙钟基线不确定，尤其不能把不同动画时刻的高差异当填充算法错误。

## 未完成与限制

- VM 未输出作品加载时自带的初始变量监视框，所以这类作品 NekoC 一侧缺少这部分像素（335017543 剩余约 1.8%）；脚本显式显示且 Frame 输出的监视框仍由真实 StageOverlay 绘制。
- 弹窗按钮文案、字体与官方不同；打印速度只对齐到本例可见的文字进度，没有逐字验证。
- 正常播放器的 timer 也改为整毫秒、两位小数和“需先启动”的语义（与官方一致）；墙钟模式下 timer 仍按 dt 推进，不读系统时钟。
- 第三方作品只用于诊断，产物在 ignored 的 `dist/k4fix/`。
- interval 的真实 16 ms 相位、后台节流、不同刷新率与不同 dt 的逐采样一致性**未验证**；虚拟驱动选择“每 update 前采样一次”，不是完整浏览器定时器模拟。
- 浮层截图用 canonical stageSize、CSS 1:1 与 scale:css；空监视容器不触发截图，气泡/弹窗/实际监视行才触发。字体像素及原生 UI 布局仍非完全一致。
- 每次截图及返回 captured 之前均检查 renderer.onError 的记录；加载后渲染错误用注入回调的专项测试验证返回 unverified，不能吞错进入像素统计。
- 官方逐帧探针在 JIT 开启/关闭配置下均测试，但只有 12 帧，**未验证这些探针实际达到 500 次热阈值并进入原生 JIT**；不以配置开关冒称热 JIT 证据。
