# K4 partial：旧/新物理开关与速度的时序实测

## 本轮结论

优先核对语料频次最高的 `set_actor_as`（1051）、`physics2_enable_force`（317）、
`set_velocity`（250）、`physics2_set_actor_as`（173）。这些数量是任务提供的优先级，
本轮没有重新扫描第三方作品，也没有修改 coverage 生成器或输出。

修正 `src/engine/physics.rs` 的 **adapter 标志与底层刚体类型混淆**：

- 旧 `set_actor_as(exit)` 会立即改底层 static、清速度；不是新接口的 sensor 开关。
- 新 `physics2_enable_force` 只立即写 forceable；`update_body_state` 在后续 ticker、
  且角色启用时才实际切 static/dynamic。切 static 清速度，恢复 dynamic 不复活旧速度。
- collidable=false、forceable=false（或角色隐藏）时禁用 body，跳过底层类型更新；
  原动态 body 的速度仍可保留。不能用 forceable=false 直接推断底层已经 static。
- `set_velocity` / vector 与 `physics2_set_speed` 根据**底层类型**接受或忽略写入，
  不再使用 adapter forceable 判断，也不再用额外 saved_velocity 冒充底层速度。
- 旧 `self_enable_physics` / `self_disable_physics` 仍即时改变底层类型；旧初始化与克隆
  刚体仍从 static 开始。没有给旧命令加入惰性 world/body 分配。

**不建议将以上物理类型整体去 partial。** 本轮确认的是这些参数与控制时序，不是
Rapier 与 LiquidFun 等价；复杂轮廓、碰撞、隐藏初次创建、软体和拖拽仍有边界。

## 官方只读来源与定位

只读文件（未复制、未修改）：

`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`

SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。

定位采用 webpack factory `toString()` 的 UTF-16 零基字符 offset；只捕获 factory 表，
不执行 factory 来静态读取源码。没有把官方实现片段加入仓库。

| 模块 / offset | 核对项 |
| --- | --- |
| `Tn6a@51080` | 旧 set_actor_as：先 set_collidable；比较 is_enabled；退出时额外 set_dynamic(false) |
| `Tn6a@54897` | 旧速度：严格 finite Number、±10000 幅度、方向角、只取已有 body |
| `Tn6a@68974` | 新 enable_force：惰性 helper，仅写非 elastic adapter 标志 |
| `Tn6a@69246` | 新 set_actor_as：仅写 collidable，不附带旧版 static 行为 |
| `a1xw@89160` | 普通刚体 set_dynamic 委托 Box2D SetType |
| `a1xw@90092` | 普通刚体速度写入委托 Box2D SetLinearVelocity |
| `a1xw@95597` | update_body_state：先启用判断；禁用则 return；启用才改 dynamic/sensor |
| `a1xw@97462` / `@97498` | collidable / forceable setter 只保存标志 |
| `a1xw@257535` | 旧 load_physics_model 的 static 初始化与现代积木抑制条件 |
| `JOUB@2381` | 可选物理库检测：toolbox.physics/physics2 或旧 PHYSICS AST |

实际加载的物理 chunk `2.b8370041782df6e86958.js` SHA-256：
`6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6`。
每个 case 的完整资源哈希、错误、网络阻断诊断均记录在证据 JSON。

## 原创 fixtures 与离线 runOracle

生成器 `tools/compat/k4-physics-partial-fixtures.mjs` 只复用仓库原创基础舞台和内嵌 SVG，
重新构造独立工作区；没有读取、复制或改写第三方语料。
运行器 `tools/compat/k4-physics-partial-oracle.mjs` 使用离线 `runOracle`，由官方编译器
编译真实工作区，然后通过正常 Start 执行积木。不直接调用物理 domain、不给物理模块打补丁。

证据：`docs/kitten4-physics-partial-evidence.json`。
原始 30 帧 trace：忽略目录 `dist/k4-physics-partial/*.official.json`。
七个 case 都有 30 帧、done=1、errors=[]、pageErrors=[]；Rust 双模式比对所有采样变量，
容差 .011（reporter 的两位小数）。**没有宣称完整位置逐帧相同**。

| fixture 后缀 | 官方实际 reporter 结果 |
| --- | --- |
| legacy-flags | 原速度2；exit立即0；再attend仍0；static写3忽略；旧enable后写4，等待后仍4 |
| legacy-hidden | 写2、隐藏、旧attend后仍2；显示、旧enable、写3，等待后3 |
| velocity-validation | 速度2；字符串value和dir都忽略；负幅度-3得到速率3；20000限为10000；零为0 |
| legacy-no-world | 没有旧enable或新接口，不创建world；exit、速度写入、attend后reporter均0 |
| modern-flags | 速度2；forceable=false后立即仍2；同批次写3有效；ticker后static为0；static写4忽略；新enable后同批次写5仍忽略；sensor写6及等待后均6 |
| modern-disable-both | 两标志false后立即2、ticker后仍2；禁用但底层动态时写3有效；恢复collidable后ticker切static变0；恢复forceable不复活速度 |
| modern-speed | 新speed设置2；disable后同批次新speed写3有效；ticker后0；static/刚恢复enable时写入忽略；dynamic下一ticker写6有效 |

旧 `get_physics_property` 没有 speed_dir 分支，未知属性返回0；因此没有用该属性伪造方向验证。
方向/分量本轮只核对源码，完整角度、无穷大、NaN、超过单 tick 位移上限的推进不在此证据范围。

### 探针调试中发现的失败与陷阱

1. 首批不完整的手写发布 AST 在 project-assets 阶段加载失败，没有执行积木。
   改为 schema 默认值工作区后通过。失败不计为行为一致，证据保留 initialAttempt 说明。
2. 新接口夹具原先未带 toolbox.physics2，离线播放器未加载可选物理 chunk；这会产生
   “脚本走完但全为0”的假通过。最终新接口夹具明确设置真实编辑器使用的 toolbox.physics2，
   资源清单确认加载物理 chunk，且非零初速度/传感器速度断言通过。
3. physics2 block 会抑制旧预分配扫描；所以无 world 的旧速度块不能靠旧 enable 被偷偷初始化。

## 复验命令与实际结果

```powershell
$env:K4_PLAYER_DIR = 'E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-physics-partial-oracle.mjs
node --test tests/k4-physics-partial-fixtures.test.mjs

$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
cargo test --lib engine::physics:: -- --nocapture
cargo test --test kitten4_physics_partial --test kitten4_third_physics --test kitten4_physics -- --nocapture
```

- JS fixture/哈希绑定检查：1 passed。
- 物理模块单元测试：15 passed（包含新增旧exit/隐藏attend回归）。
- 现有物理集成测试：4 passed；第三轮物理集成测试：6 passed。
- 本轮新增测试：七个 fixtures 原生往返，默认 JIT / disable_jit 全变量比对。
- 没有运行全量 cargo、全量 coverage、release 构建或第三方作品。

## 交接与保留边界

只修改物理实现、新专项工具、fixtures、test、docs；不需要 `src/engine.rs` 或
`src/kitten4.rs` 接线补丁。所有物理 command 继续走已有 JIT side-exit。
现有 `docs/kitten4-physics.md` 是历史线上实测；本轮补充而非替换其旧证据。
其“静态保持速度”说法需区分 collidable=false 的禁用动态体与 collidable=true 的静态体，
以本轮离线夹具的明确条件为准。

仍未验证/未完成：LiquidFun 粒子与软体、准确纹理凸分解、拖拽关节、复杂枢轴/高速接触、
首次在隐藏状态惰性建body、所有枚举/非法值与实体生命周期组合、多场景ticker暂停、
设备方向事件端到端接入、跨求解器逐帧位置/碰撞等价。保留 partial 是有意且必要的。
