# K4 第七轮：剩余物理命令与 ticker 相位

## 范围

只修改物理模块 `src/engine/physics.rs`，没有修改 `src/engine.rs` 公共结构或 scope 总表。
夹具均为仓库原创工作区及内嵌全不透明 20×20 SVG，没有读取第三方作品来生成输入，
没有移植官方或 HateNeko 实现。`physicsMainPathFixtures()` 的旧失败输入原样重放。

原始官方/默认 VM/禁用 JIT trace 与差分在本 worktree 的
`dist/k4partial7/physics/`；可复用官方事实在
`kitten4-partial-physics-7-evidence.json`，绑定夹具 SHA-256、实际资源摘要和全部逐帧变量。
普通回归不依赖外部官方包。

本轮官方 **21件/1320帧**，全部 `errors=[]`、`pageErrors=[]`、末帧 `done=1`。
JS 证据/夹具绑定回归 **2/2通过**。主会话重建后二次差分：默认 VM 和禁用 JIT
各比较1320帧，**17件/1080帧严格逐帧一致**（位置/旋转容差1e-7，变量容差1e-9；
实际最大位置差7.276e-12、变量误差0）。其余4件/240帧为下文明确的接触有界回归，
不算严格一致。旧第六轮 membership 重放和三个持续力case均严格通过。

二次差分：`dist/k4partial7/physics/comparison-current.json`，所用二进制 SHA-256：
`d628cf287e080dd287f28e7b6abeccd57f2dfe858400db883959797da473ce15`。
二进制时间04:05:49早于物理文件最后写入04:07:58，但实测已含两项运行时修复；
最后写入新增单元测试不影响本次trace。主会话随后执行Rust集成：
`kitten4_partial_physics_7` 和 `kitten4_partial_physics_6` 各1 passed、0 failed；
旧第六轮membership的5.01px容差已取消，统一按1e-7核对。模块单元测试纳入全门禁。
子会话没有调用Cargo。

## 修复

1. world ticker 积分之后，actor ticker 才把 `forceable` 作用到底层 static/dynamic
   和 sensor。此前提前切类型导致 disable 少积分一次。保留禁用动态体的速度，
   不把所有 forceable=false 都强制清速。初始化未积分分支仍同步初始类型。
2. 持续力在 actor ticker 排入下一 world tick，不再在同一 world tick 预先施加。
   首批建 world 时持续力回调还需额外等初始化 update；已经运行的 world 不多等。
   单次 `set_force` 仍保留原即时累加/下一积分清除路径。

这些是独立实现的时序修正，不是 LiquidFun 求解器移植。

## 已观测主路径

### 明确建议升级的8项

以下仅升级为指定原创输入、固定60Hz下的 `main-path-verified`，不是完整物理兼容。
软体、复杂轮廓、实体生命周期与跨场景等公共边界仍保留。

| 可升级类型 | 已严格逐帧核验的范围 |
| --- | --- |
| `physics2_enable_force` | 动态禁用/恢复、底层static与adapter不同步的同批速度写入、双false禁用动态体保速；修复旧漏积分 |
| `physics2_set_actor_as` | 动态体collidable true/false切换、sensor自由运动、双false禁用/恢复，不执行旧版额外清速 |
| `self_texture` | origin/iron/wood/elastic四个**旧刚体材质预设**的密度/质量/摩擦/反弹联动及速度保持；elastic在此不是现代soft粒子材质 |
| `self_set_density` | 非负有限2.5/0/.125/1，实际质量重算、两位小数reporter、速度保持；负值与非有限组合不认证 |
| `get_physics_property` | 五个合法菜单，刚体默认/四材质/密度修改/动态与静态质量、运动与零速；复杂轮廓质量与非法属性不认证 |
| `physics2_get_property` | 六个合法菜单，正负幅度/方向/零速、静态质量0、硬体柔软度元数据；不代表软体属性认证 |
| `physics2_set_force_in_time` | 新建world及运行中world，一秒正力和±30°方向；0/负整数阻塞、小数忽略、施力和回调后续接均逐帧一致 |
| `physics2_forbid_bump_with` | 指定右边缘及独立角色禁碰穿越、重新允许调用、自由速度保持；接触恢复冲量/其他方向/克隆组不认证 |

### boundary只做控制主路径认证

`self_set_boundary`、`physics2_set_boundary`：四种菜单对**右边界是否存在**的控制、
移除边界后继续推进均有证据；新惰性world/旧预分配world分别测试。
已记录“控制主路径实测，接触有界”，**两项仍保持partial**，不计入12项升级，
不能标成严格轨迹全等。
该水平探针不单独认证上/下/左边缘接触几何和摩擦。

### 保持partial

- `physics2_set_flexibility`：硬体adapter元数据虽严格通过，主要软体形变仍未实现，**保持partial，不计入上述8项**。
- `physics2_set_texture`：hard→hard虽严格通过，soft与软→硬重建未实现，**保持partial**。

### 全部采样观察

| 类型 | 原创输入与可核对观察 |
| --- | --- |
| `physics2_enable_force` | 原第六轮失败重放、新禁用/恢复、static 同批速度写入忽略、双 false 保速 |
| `physics2_set_actor_as` | sensor/free-motion/恢复 collidable，不附带旧版清速 |
| `self_texture` | origin/iron/wood/elastic 四预设；质量、密度、摩擦、反弹同步，速度不变 |
| `self_set_density` | 2.5→0→.125→1；真实质量更新、reporter 两位舍入，匀速保持 |
| `physics2_set_flexibility` | **仅硬体 adapter**：27.4→27、负数→1、100/200→100、49.5→49；不伪造形变 |
| `get_physics_property` | 全部五个编辑器菜单 speed/density/mass/friction/restitution，static mass=0 |
| `physics2_get_property` | 全部六个菜单，包括正负方向/零速/柔软度/static 质量；两位小数 |
| `physics2_set_force_in_time` | 一秒非零力、延后调用、0/负整数阻塞、小数忽略；逐帧施力与完成续接 |
| `physics2_forbid_bump_with` | 指定 right edge/独立角色禁碰后穿越，再允许；不声称接触恢复冲量数值一致 |
| `self_set_boundary` | 四菜单的右边界存在/缺省，移除边界后续推进；接触数值单列 |
| `physics2_set_boundary` | 同上；新 API 惰性 world，旧 API 依赖 Start 预分配 |

`physics2_set_texture` 的 **hard→hard** 保质量/摩擦/弹性/柔软度/速度，也有逐帧证据；
**不据此升级整个类型**：soft 粒子分组、软→硬重建未实现，不能把 hard 的通过包装为完整纹理支持。

## 接触差异与证据诚实边界

边界夹具初始 x=625，以速度2向右。无边界/bottom-only 在采样点 x=675；
all/left-right-bottom 在官方为 x=629.85。Rapier 正确阻挡，但第一接触的最大瞬时位置差
**1.815104166666856px**，采样 reporter 差约 **.21px**。
Rust 接触回归明确使用 1.82px/.22px 有界断言；这些 case 绝不计入“逐帧精确一致”。
过滤掉右边界后自由穿越可用 1e-7 的严格位置容差，和接触结果分开。

以下继续保留为未完成/未验证：LiquidFun 软体粒子和形变、软→硬纹理重建、复杂 alpha/
凹形/孔洞轮廓、接触冲量/旋转、堆叠/休眠/TOI、持续力期间隐藏/跨场景/克隆删除、
负密度与非有限输入全组合、设备拖拽、非60Hz。沿用第六轮精确60Hz等待截止点的
浮点相位风险；新增控制等待仍用 .04/.24，不暗中修改公共 scheduler。

## 复现（Cargo 由主会话统一执行）

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-physics-7-oracle.mjs
node --test tests/k4-partial-physics-7.test.mjs
node tools/compat/k4-partial-physics-7-compare.mjs current
# 主会话：cargo test --test kitten4_partial_physics_7
```

修改运行时代码后，运行 compare 前需要主会话重建 `target/debug/k4-trace.exe`。
`comparison-baseline.json` 保留旧二进制的已知失败，不能拿基线结果当修复通过。
