# K4 第九轮：soft 逐帧负例与重建生命周期（仍 partial）

## 结论

`physics2_set_texture`、`physics2_set_flexibility` **不升级**。本轮取得官方正常 Start
的4件原创输入、420个60Hz update、完整粒子坐标/速度和组身份，证明现有刚体 fallback
不能替代软体。修复范围仅为模式状态、重复材质幂等、scale/造型重建的速度清零时机。
**未实现粒子求解、soft 渲染滤镜或亚像素形变兼容**，没有用记录轨迹驱动运行时。

没有修改 `src/engine.rs` 公共结构或coverage公共表；由主会话整合一个帧尾soft同步调用。
没有复制/移植官方源码、
LiquidFun或第三方求解器。`src/engine/physics_soft.rs` 是原创生命周期状态机，
不是名为soft的刚体模拟完成声明。`physics_soft_snapshot` 显式返回
`model=rigid-fallback`、`deformationImplemented=false`。

## 输入和官方事实

原创160×120锯齿SVG，水平每4px交替12px凹凸；不读取语料。4件 `.bcm` 为旧K4原生
workspace，非`.bcmkn`，不适用Kitten N编辑器检查；官方原生编译、正常Start均完成。
`errors=[]`、`pageErrors=[]`；每次运行有原始资源SHA-256和诊断。

| 输入 | 帧 | 观察 |
| --- | ---: | --- |
| coast | 90 | 初始92粒子，速度200px/s；自由运动亦有内部松弛和小幅角度变化 |
| impact-25 | 120 | flexibility25→strength3.75，底边碰撞，持续形变 |
| impact-90 | 120 | flexibility90→strength.5，同初始几何/重力，明显更大形变 |
| rebuild | 90 | strength、重复soft、scale、hard、soft串联 |

重建链逐帧观察（帧=完成的官方update，不是截图或墙钟）：

| 帧 | 组身份 | 粒子数 | strength | 事实 |
| --- | --- | ---: | ---: | --- |
| 1–10 | 1 | 92 | 2.5 | 初始soft，ticker注册未造成首帧积分 |
| 11–20 | 1 | 92 | .5 | flexibility只改strength，不换组、不清速 |
| 21–30 | 1 | 92 | .5 | 再次soft不换组，帧30平均速度200.00143px/s |
| 31–40 | 2 | 171 | .5 | scale150后重建，帧31平均速度精确0 |
| 41–50 | 无 | 0 | .5 | hard移除组，保留adapter的strength |
| 51–90 | 3 | 171 | .5 | 再soft创建新组 |

帧30→31中心x从93.4839228894到96.8181529541，说明世界仍完成最后一次积分，
然后actor ticker重建并清速，不能在本步积分前清零。新实现依此将清速放在世界积分后。
本地世界ticker在脚本前，因此单靠tick入口signature检查会迟一帧（帧32而非31）。
`synchronize_soft_physics_geometry` 在脚本后的帧尾检查soft geometry，立即清速，
同时保留本帧先前的世界积分。几何collider仍用既有刚体路径；不声称与粒子几何全等。

## 量化形变，而不是只比较中心

对每组首帧粒子为rest，逐帧做二维最小二乘刚性拟合（平移+旋转，无缩放），
输出RMS/最大误差。另外所有粒子对计算
`max(|本帧距离-rest距离|)/2`。由三角不等式，这给出**任何**保距刚体匹配的
最大点位误差下界，不是某种拟合的上界，也不依赖本地求解器。

| 输入 | 刚体最大误差下界最大值(px) | 帧 | 同帧最优RMS / 最大点误差(px) |
| --- | ---: | ---: | ---: |
| coast | .2129422163 | 11 | .0951525546 / .2544543386 |
| impact-25 | **3.3866803356** | 32 | 1.4490682610 / 5.5105718111 |
| impact-90 | **16.3401787314** | 68 | 7.1345064570 / 25.6469072580 |
| rebuild | 1.0602656619 | 26 | .4400128681 / 1.2402087555 |

因此coast中心的亚像素结果不能给整个soft类型升级；两个impact存在不可被刚体
旋转/平移抹掉的多像素形变误差。没有放宽第八轮刚体容差，也没有用“全帧完成”代替一致。

本地双VM比较通过 `k4-partial-physics-9-compare.mjs` 执行真实 `k4-trace`，不构建Cargo。
CLI mask边长限128，故160×120 SVG通过Canvas解码为128×120 alpha mask；这项
geometry输入限制明确保留，不能把其误差单独归因于软体求解。原始粒子形变下界不受此限制。
baseline二进制身份及逐case指标见 `kitten4-partial-physics-9-comparison-baseline.json`：
coast中心最大.02284803px、impact25为6.65454846px、impact90为11.21737814px、
rebuild为196.54277284px。baseline尚未含本轮重建清速；最终比较应单独保存，不覆盖旧负例。
仅入口检测的中间实现见 `kitten4-partial-physics-9-comparison-delayed-rebuild.json`：
rebuild最大3.21369685px，帧31generation仍1、帧32才2；这是真实失败，不计回归通过。
严格Rust期望仍固定官方帧31，帧尾hook用于修复其根因而非调整容差/采样相位。

## 官方只读源码定位

只读根 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/`。
主包 `player_v2.2d180c468559fbd29528.js.orig` SHA-256
`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
物理chunk `2.b8370041782df6e86958.js` SHA-256
`6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6`。
以下为主包UTF-16零基字符定位，a1xw factory起点762360；只用于事实定位，没有存储函数体：

| factory offset | absolute offset | 事实 |
| ---: | ---: | --- |
| 79175 | 841535 | elastic adapter持有particle_system/group和soft_filter |
| 85212 | 847572 | 从轮廓生成粒子，受WebGL uniform/anchor预算影响 |
| 91697 | 854057 | texture/scale/pivot change触发init；禁用时延期 |
| 92028 | 854388 | strength同步写现有group.m_strength，不重建 |
| 98226 | 860586 | 同elastic状态早退；切换保存旋转/位置/速度，normal重新init |
| 100859 | 863219 | ParticleSystemDef radius1.2；实测stride1.8物理单位 |

另主包644976/645248：现代enable_force、set_actor_as对elastic不写标志。
本轮生命周期修复**尚未覆盖这些soft专属flag差异**，仍列未完成，不据只读源码定位宣称验证。

## 官方首帧阻塞负例

80×60纯矩形SVG在该环境`MAX_FRAGMENT_UNIFORM_VECTORS=1024`、正常Start中，
45s试跑及独立10s watchdog重放均未产生有效update。证据：
`kitten4-partial-physics-9-blocked-evidence.json`，状态`unverified-timeout`、帧0，
不是官方运行错误也不是本地兼容通过。源码静态定位提示边界点数较少时边界采样步长可能为0，
但没有修改官方实现、伪造硬件能力或用手动Step绕过；因此具体hang根因仍属静态推断。
原创锯齿输入规避该输入阻塞后正常采样，不拿它替代矩形负例。

## 证据、测试与复现

- `kitten4-partial-physics-9-evidence.json`：420帧中心、粒子sentinel、组身份、形变指标、资源hash。
- 同文件包含最坏帧全部rest/变形点作为见证，JS测试从这些点独立重算下界；
  不是只断言一份无法复核的预计算数字。完整粒子观察文件另有SHA-256绑定。
- `dist/k4partial9/physics/*.particles.json`：逐帧完整粒子位置/速度/rest-relative观察。
- `tests/k4-partial-physics-9.test.mjs`：原创输入hash绑定、420帧、重建链、非亚像素下界。
- `tests/kitten4_partial_physics_9.rs`：双VM生命周期和scale后停止回归，**不是形变一致性测试**。
- `physics_soft.rs`单元测试：同模式幂等、禁用时延期、再次启用重建。

专项JS测试 **4 passed、0 failed**，包括矩形零帧超时负例。
主会话整合帧尾hook后，全库 `cargo test --all-targets` 通过，包含双VM生命周期回归
及同帧重建单元测试；`cargo fmt --check`、全目标clippy -D warnings通过。
最终真实二进制差分保存在 `kitten4-partial-physics-9-comparison-final.json`：
rebuild中心最大误差降为 **0.1552821731px**，不再晚一帧；coast .0228480328px、
impact25 **6.6545484643px**、impact90 **11.2173781428px**。两VM相同，
这不代表形变亚像素，明确保留后两项多像素负例。工作始终在当前worktree；官方目录只读。

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-physics-9-oracle.mjs
node tools/compat/k4-partial-physics-9-blocked.mjs
node --test tests/k4-partial-physics-9.test.mjs
node tools/compat/k4-partial-physics-9-compare.mjs final
# 仅主会话串行Cargo：cargo test --test kitten4_partial_physics_9
```

未完成：真实粒子/triad弹性、碰撞压力/粘性/阻尼、渲染锚点形变、任意alpha/孔洞/凹轮廓、
mass/friction/forceable在soft模式的独立语义、隐藏/显示/换造型/枢轴的官方逐帧验证、
clone与跨场景/删除、不同硬件anchor预算和非60Hz。
