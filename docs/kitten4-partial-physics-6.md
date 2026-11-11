# K4 第六轮：硬体命令主路径，不等同求解器全集

## 结果

新增10份仓库原创工作区，官方正常Start、原生编译后各执行40个update，共400帧。
`docs/kitten4-partial-physics-6-evidence.json`保存逐帧位置、旋转、全部变量、夹具SHA-256、
官方资源摘要和错误诊断。默认VM与禁用JIT各比较400帧。没有读取语料来构造夹具，
没有移植官方或HateNeko源码。

本轮为**主路径验证**增加独立`main-path-verified`分类；不沿用旧文档中“任一求解器
边界就把所有控制积木留partial”的整体口径，也不反过来宣称完整物理兼容。

## 实际修复

仅修改`src/engine/physics.rs`，未改`src/engine.rs`公共结构：

1. 静态刚体质量reporter返回0。Rapier保留局部质量，而官方Box2D静态GetMass为0。
   `legacy-membership`的exit/disabled和`modern-membership`的static采样均直接证明。
2. 旧世界在Start预分配后，首次update不能提前消耗ticker初始化门槛；官方旧速度/
   重力/外力的首个运动帧是第3帧。现代运行时惰性创建路径保持不变。

## 逐项主路径与结果

| 原创夹具 | 类型（去重计数） | 逐帧结果 |
| --- | --- | --- |
| legacy-membership | set_actor_as、self_enable_physics、self_disable_physics、set_velocity | exit即时static清速、旧enable恢复、disable清速，位置/旋转/全部变量一致 |
| legacy-material | self_set_friction、self_set_restitution | .7/.8及越界clamp为0/1，与自由匀速推进一致 |
| modern-membership | physics2_enable_force、physics2_set_actor_as、physics2_set_speed | **保留差异**：forceable=false少一次积分；位置仅有界回归，不算逐帧一致；全部采样变量相同 |
| modern-material | physics2_set_roughness、physics2_set_resilience | .65/.35及clamp1/0、自由推进逐帧一致 |
| modern-force | physics2_set_force、physics2_set_mass | mass=2、横向力12、再纵向力6，位置及变量逐帧一致 |
| modern-gravity | physics2_set_gravity | 下向2→横向1→清重力/清速，位置及变量逐帧一致 |
| legacy-gravity | set_gravity、set_velocity_by_vector | 下向重力与向量(1,-2)、清速逐帧一致 |
| legacy-force | set_force、set_force_by_vector、self_set_mass | mass=2，两个方向外力逐帧一致 |
| legacy-rotate | allow_rotate | 自由硬体开关允许/禁止旋转、线速度不变逐帧一致；未验证接触角冲量 |
| modern-rotate | physics2_allow_rotate | 同上，现代字段true/false逐帧一致；不是碰撞旋转认证 |

**9件360帧逐帧一致**：坐标/角度容差`1e-7`，数值变量容差`1e-9`，非数值保持类型。
有解码的原创20×20全不透明mask，默认质量.33，不拿无mask矩形质量.4冒充官方结果。
modern-membership的40帧以5.01px上界保留回归（覆盖本次速度3时一帧5px）；
`physics2_enable_force`、`physics2_set_actor_as`**不升级**。
`physics2_set_speed`另有第三轮coast/diagonal、第二轮严格参数证据，主路径升级不依赖该有界比较。

19项升级清单由`tools/compat/k4-partial-6-scope.mjs::physicsMainPaths`精确列出。
没有把边界碰撞、过滤器、软体、纹理重建或持续力仅凭自由体通过而升级。
旧/新property reporter仍保留partial：本轮修了静态质量，但没补齐所有类型/轮廓组合。

## 官方证据位置

只读`$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
每个case诊断还绑定实际加载的物理chunk摘要。
与在线发布物的关系见[现有取证](compatibility/k4-online-vs-offline.md)。

沿用[第二轮](kitten4-physics-partial.md)与[第三轮](kitten4-physics-trajectory-3.md)
只读定位：`Tn6a@51080/@54897/@68974/@69246`（控制/速度），
`a1xw@89160/@95597/@100663`（body类型/同步/ticker），
`Pcni`物理chunk的静态质量与积分规则。offset为factory起算UTF-16零基字符，
未把函数体复制进仓库。升级依据是本轮实际工作区执行，不是重新实现官方源码。

## 失败探针和明确未验证

- 首次变量比较把JSON整数0和浮点0.0当成类型差异；修为数值比较，不放宽实际误差。
- 首次运行未开启virtualTime，wait读墙钟导致不同续接帧；最终证据明确开启virtualTime，
  没有把墙钟结果算作一致。
- .05秒与.1秒恰逢60Hz截止点的组合仍有浮点续接相位差，本轮控制夹具固定.04秒，
  单独列为**未验证边界/已观察差异**，不修改公共调度或放宽坐标容差。
- modern-membership中停用ticker时序依然有一帧积分差，相关开关继续partial。
- 已知接触误差仍有效：第三轮bounce最大2.797382832px、friction最大0.703993056px。
  Rapier不等同LiquidFun；软体粒子、凹形/孔洞/复杂alpha轮廓、接触休眠/TOI、
  堆叠、拖拽关节、角冲量、纹理重建、多场景、非60Hz、首次隐藏建体均未验证。
- 不把默认JIT开启等同每个物理helper都编译成native；这些命令仍可走side-exit。

## 复现

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
node tools/compat/k4-partial-physics-6-oracle.mjs
node --test tests/k4-partial-physics-6.test.mjs
cargo test --test kitten4_partial_physics_6
```

普通回归只读原创夹具与事实JSON，不依赖外部官方包。完整门禁见未提交的根目录报告。
