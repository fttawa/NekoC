# Kitten 4 soft：矩形首帧阻塞定位与模型事实

## 结论

已有 `partial-physics-9-rectangle-blocked` 的 0 帧超时，现已定位为 **soft 初始化边界采样的零增量死循环**，不是弹性求解器迭代过多、WebGL shader 编译或虚拟 Date 停滞。

实测环境为 Windows headless Edge，`MAX_FRAGMENT_UNIFORM_VECTORS = 1024`。本次沿用 `k4-oracle.mjs` 的只读外部 `.orig` 播放器与原创输入，不修改官方文件、不替换函数、不伪造 WebGL 能力。CDP 仅暂停、读取 scope/对象字段并恢复；带 `throwOnSideEffect` 的表达式只读本地状态。`.orig` 已有的 DI 暴露与其上游真实性未独立认证，沿用既有 oracle 的这一限定。

## 首帧阻塞的实测证据

`kitten4-soft-blocked-rectangle-evidence.json` 与 `kitten4-soft-blocked-rectangle-real-clock-evidence.json`：

- 两次运行分别启用/关闭诊断虚拟 Date；均 16 秒 watchdog、0 个完成帧、无 page error。
- 每次在约 2/4/6 秒请求 CDP 暂停，三次顶层调用栈均为：
  `generate_position_data → init → set_enabled → set_elastic → physics2_set_texture`。
- 顶层均停在 `.orig` 第 1 行，第 **848981** 列（1-based UTF-16）。
- 暂停时局部状态完全相同：轮廓 `c.length = 40`；缓存 anchors 上限 101；`h.length = 26`；初始内部点 25；内部 anchors 集合 25；新增边界点集合 1；步长 `x = 0`；particle stride 约 1.8。
- 原始矩形输入 SHA-256 与此前失败证据相同：`b2c2b79a5db8efabbac63d41bbc485ed8476e76c9fa24839f7bd10e5ca3aa93e`。
- 齿形原创 coast 对照完成 2 帧，无错误，见 `kitten4-soft-blocked-coast-evidence.json`。

### 原因链（数学描述，非源码移植）

1. 官方 anchors 上限 `M = floor((floor(U / 5) - 1) / 2)`；`U=1024` 得 `M=101`。
2. 初始化将约一半预算留给内部点，边界预算 `K = M - M/2 = 50.5`。
3. 边界遍历增量 `q = floor(N/K)`；当前真实轮廓点数 `N=40`，因此 `q=0`。
4. 当内部 anchors 数小于 `M` 时，进入按 `q` 前进的边界点遍历；索引从 0 开始，0 增量无法前进。第一个边界点可插入一次，之后持续检查同一个点。
5. 外层增大步长/清空重试的逻辑在内层之后，永远没有机会执行。粒子 group 创建和软体 filter 构建也在此之后，尚未抵达。

这解释了“高 uniform 预算反而使简单轮廓阻塞”的现象。一般风险条件为 `0 < N < M/2` 且内部 anchors 数小于 `M`；这一一般化来自源码控制流，**本次只对 1024/40 的矩形组合动态验证**，不是对所有 GPU/轮廓的已测结论。

## 官方源码精确定位

下表均相对于外部只读 `src/player/build/`。坐标为 1-based 行/UTF-16 列，原文件均一行。机器可复核索引及完整文件 SHA-256 在 `kitten4-soft-blocked-source-locations.json`，由工具现读外部文件生成，仅保存坐标和哈希，不保存函数体。

`P = player_v2.2d180c468559fbd29528.js.orig`，SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。

`B = 2.b8370041782df6e86958.js`，SHA-256 `6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6`。

| 事实 / 入口 | 位置 |
|---|---|
| `49df`：单位与步进常量 | P:1:190525 |
| `physics2_set_flexibility` 积木分派 | P:1:650473 |
| strength 参数检查、clamp、映射 | P:1:666104 |
| 默认 body strength 2.5 | P:1:644940 |
| `Xt.get_max_anchors`，真实 WebGL uniform 预算 | P:1:841931 |
| `Xt.init`：elastic 粒子组、soft filter 创建 | P:1:844799 |
| `Xt.on_tick`：参考位置与当前位置的 anchors 配对 | P:1:846937 |
| `generate_position_data`：轮廓、内部点、边界采样、渲染三角化 | P:1:847573 |
| 未设最小值的边界采样增量 | P:1:848901 |
| 实测阻塞的内层遍历 | P:1:848981 |
| adapter strength 及现存 group strength 同步更新 | P:1:854389 |
| world 固定步进（仅传三参） | P:1:863018 |
| ParticleSystemDef radius 1.2 | P:1:863220 |
| `sdMR`：soft filter / GLSL | P:1:1667459 |
| `set_anchors`：目标三角形与逆仿射矩阵 uniforms | P:1:1671959 |
| particle 迭代次数公式 | B:1:227557 |
| group anchor / 相对参考位置初始化 | B:1:228794 |
| 粒子系统默认 elasticStrength 0.25 | B:1:239155 |
| triad strength 回调，动态取所属 groups 最小 strength | B:1:264715 |
| particle 子步循环 | B:1:274459 |
| `SolveElastic`：三元组速度修正 | B:1:285514 |
| `GetParticleStride` | B:1:296976 |
| world Step 默认 particleIterations | B:1:315003 |

## soft 模型 / strength / 求解次数 / 渲染事实

### 模型

- 官方并不是单一刚体旋转缩放的假软体：使用 Box2D/LiquidFun 风格粒子系统、elastic particle 标志、solid particle group，以及 Voronoi 生成的 particle triads。
- `Xt.init` 传入明确的 positionData；模型参考位置储存在 group 的 anchor-relative positions 中。group anchor 是粒子索引区间的中间点；它不是质心。
- `SolveElastic` 对每个 elastic triad 用当前点及速度预测子步位置，消去三点均值，从与参考三角形的点积/叉积估计共同旋转，再对三粒子速度施加趋向旋转后参考形状的修正。这是三角形形状匹配型速度约束，不是通用有限元求解，也不是仅对成对距离的弹簧。
- 默认 `elasticStrength = 0.25`；修正系数还乘子步 `inv_dt` 和 triad 的 strength。triad strength 是动态读取三个所属 groups strength 最小值的回调，所以既有 group 改强度不需要重建 triads。

### strength

- 积木 flexibility 只接受官方判定为 number 且非 NaN 的值；先 clamp 到 `[1,100]`，再映射为 `5 × (100 - flexibility) / 100`。
- 例如 25→3.75，90→0.5，100→0；默认 body strength 为 2.5。不能把 flexibility 直接当 solver strength，也不能遗漏系统级 0.25 系数。
- adapter 的 `set_strength` 同步写自身与已缓存 elastic group 的 `m_strength`。本次 3 帧只读探针实测 default/25/90 分别为 2.5/3.75/0.5；100 边界及异常参数只读源码确认，未在本次动态执行。

### 求解次数

- 固定 physics dt 为 1/60 秒；world 调用参数 `8,3` 分别是刚体 velocity/position iterations，**不能解释为 soft 必定求解 8 次或 3 次**。
- world 没传 particleIterations，因此由 `clamp(ceil(sqrt(|gravity|/(0.01 × minRadius)) × dt), 1, 8)` 计算；没有粒子系统时返回 1。
- particle system 每个子步先更新 contacts/weights 等，然后调用 pressure、damping、elastic 等相应 solver，最后根据速度积分位置。elastic 每 particle 子步调用一次。
- 本次只读对照 probe 在真正首次 physics tick 的采样中，gravity=0 或约20、radius=1.2、dt=1/60 都得到 `particleIterations = 1`；particle timestamp 从0变1、iterationIndex=1。
- 注意 oracle “完成更新帧”不等于已经发生 physics ticker step。本次 frame1/2 的 world 静态 Step 结构仍为全零，filter uniforms 也为空；frame3 才出现首次 physics 步与 uniforms。证据保留这一区别，不将首个采样强说成首个 solver step。

### 渲染

- 官方将 actor filters 替换为 soft filter，缓存此前 filters，清理 soft 时恢复；不是直接改 Pixi sprite 网格顶点。
- 每 tick 将经整体旋转的参考粒子位置与当前粒子位置配对，再转成画布像素坐标。
- `sdMR` 使用当前三角形覆盖测试，按目标→参考的逆仿射映射采样原始纹理。每个三角形有6个三角坐标数值和6个仿射矩阵数值；目标顶点与映射后的源坐标有向下取整。
- 渲染使用的 triangles 与物理 triads **不是同一计数/同一拓扑承诺**。本次齿形对照：92 粒子、152 physics triads、65 render triangles；首次实际 tick 后两个 uniform 数组各390个数值。
- 本次未进行截图像素比对；已验证 filter 存在且启用、triangles/arrays 的尺寸与更新，不据此宣称像素级渲染一致性。

## 工具、复跑与测试

设置：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-soft-blocked-debug.mjs rectangle
node tools/compat/k4-soft-blocked-debug.mjs rectangle-real-clock
node tools/compat/k4-soft-blocked-debug.mjs coast
node tools/compat/k4-soft-blocked-model-probe.mjs
node tools/compat/k4-soft-blocked-source-facts.mjs
node --test tools/compat/k4-soft-blocked.test.mjs
```

`k4-soft-blocked.test.mjs` 的原创测试只对已捕获证据与零进度算术作回归断言，不移植官方采样器/求解器。第三项区分刚体 iterations、particle 子步和 render triangles。

## 限定与未验证边界

- 不修改先前 `kitten4-partial-physics-9-blocked-evidence.json` 的历史 `unverified-timeout`：新证据是在其基础上进一步定位，不应伪装旧运行已测得调用栈。
- 只验证上述外部二进制哈希、Edge 环境、原创矩形与齿形输入；不声称所有 Kitten4 版本均同样。
- 未替换 GPU uniform 值；未测试低 uniform 平台、移动设备、所有轮廓点数阈值、空轮廓、多个粒子系统/多 group 的行为。
- CDP 暂停会影响墙钟耗时，因此16秒不是可信性能测量；零增量和重复栈才是无限进度缺陷的证据。
- 本任务没有复制/落盘官方函数体、导入第三方作品、改官方目录、构建、执行 cargo 测试或提交；未编辑 `physics_soft.rs`、`engine.rs`、`web/renderer.js`。
