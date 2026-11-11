# K4 第八轮：单刚体舞台边缘接触，亚像素有界验证

## 结果和范围

物理运行时仅修改 `src/engine/physics.rs`，不修改 `src/engine.rs` 公共结构。
总会话另行整合滤镜、shake及catalog/scope，完整门禁后统一提交。
所有新增工作区及其内嵌 20×20 SVG 都是仓库原创，旧失败输入原样重放。
未读取 corpus 来构造夹具，未使用 HateNeko，未复制或移植第三方求解器实现。

官方 `.orig` 正常 Start、virtualTime、60Hz 共 **22件/2520帧**，
`errors=[]`、`pageErrors=[]`。默认 VM 与禁用 JIT 各比较2520帧：
位置最大差 **0.118503308290px**，旋转差0，全部采样变量差0。
回归断言为每帧每坐标 **<0.15px**，不是严格逐帧全等，更不是完整物理兼容。

| 输入 | 每种 VM 最大位置差(px) |
| --- | ---: |
| 原第三轮 bounce 原样重放，60帧 | 0.001562500000 |
| 原第三轮 friction 原样重放，60帧 | 0.001562500000 |
| 原第七轮四个 legacy/modern 右边缘接触输入，各60帧 | 0.001562500000 |
| bottom：bounce / inelastic / oblique，各120帧 | 0.006250 / 0.006250 / 0.005875 |
| top：bounce / inelastic / oblique，各120帧 | 0.000390625 / 0.000390625 / **0.118503308290** |
| left：bounce / inelastic / oblique，各120帧 | 0.006250 / 0.006250 / 0.006250 |
| right：bounce / inelastic / oblique，各120帧 | 0.006250 / 0.006250 / 0.005775 |
| 四边 below-threshold 低速输入，各180帧 | ≤2.246e-16 |

斜入射为 .4 restitution、.8 friction、相对法向45°；正面弹跳为 restitution1，
非弹性为0。低速为 .05 积木速度（底层.5），重力0，用于验证低于反弹阈值不反弹。
旧 bounce 原最大差约2.797px、friction约.704px；第七轮右边缘约1.815px。
未通过放宽旧容差冒充精确：新增独立回归直接要求<.15px。

## 独立实现

只对**世界中仅有一个、启用的动态、锁旋转、非sensor、非compound刚体**启用
舞台边缘的解析平面路径，其余继续 Rapier。沿用现有原创轮廓和矩形 fallback；
没有把20×20官方观察顶点硬编码入新求解路径。

1. 保留已有一次重力/外力积分及ticker时序。
2. 使用当前轮廓AABB与舞台长边计算面间距；读边界真实面位置，不硬编码640/360。
3. 沿最早平面交点拆分本步位移，先完成碰前切向移动，再施加法向反弹与库仑摩擦。
4. 摩擦系数仍为几何平均，弹性仍为角色与边界最大值（边界0），速度阈值1。
5. 近接触位置误差与速度独立消除，防止把去穿透速度误当反弹能量。
6. 在 Rapier hook 中只过滤此路径负责的 actor/edge 对，避免双重施加冲量；
   解析接触集同时提供 touching 查询。旋转、sensor和多体排除有单元测试。
7. 已睡眠刚体不进入解析路径；pipeline本步进入睡眠时保留其清速/位置结果，
   不用解析值覆盖。深穿透、外侧及扫掠越过有限边界面端点也回退Rapier。
   这三种保护另有单元测试，不拿正常接触夹具推导这些分支等价。

参数来自官方配置事实：polygon radius每侧.01、linear slop .005、
平衡间隙`.02-.005=.015`、扫掠目标间隙`.02-3*.005=.005`。
未复刻官方 TOI 的迭代细节；直接投影到平衡间隙与官方有限次位置修正不同，
所以旧第一接触仍差.0015625px，某些高/低阈值相位仍有差异。
不为抹除残差拟合某个夹具的固定位置，也没有把此差异算为1e-7精确一致。

## 官方只读调查

外部只读目录：
`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/`。

| 文件 | SHA-256 |
| --- | --- |
| `player_v2.2d180c468559fbd29528.js.orig` | `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160` |
| `2.b8370041782df6e86958.js` | `6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6` |

沿用第三轮 `49df@0` 的1/60步长、8/3速度/位置迭代定位。
物理chunk中 `Pcni` factory 起算16406为配置常量（完整chunk字符串16464），
`FixtureDef`约102765为默认摩擦.2、restitution0、restitutionThreshold1。
offset为UTF-16零基字符，仅定位参考；以资源hash与运行时观察为准。

`tools/compat/k4-partial-physics-8-probe.mjs` 使用官方公开导出和 body/fixture
只读查询，记录 linearSlop=.005、polygonRadius=.01、baumgarte=.2、
toiBaumgarte=.75、maxLinearCorrection=.2、maxTranslation=2、
timeToSleep=.5、linearSleepTolerance=.01、fixture threshold=1。
旧bounce/friction在帧21、旧右边缘在帧4的 contact toiCount=1，
直接说明当前误差不仅是静态摩擦系数，而有帧内连续碰撞影响。
本轮没有调用官方 Step 驱动本地运行时；正常执行中的原始事实落盘，不存函数体。

## 证据与测试

- `kitten4-partial-physics-8-evidence.json`：全部2520帧、原创fixture hash、实际资源hash和诊断。
- `kitten4-partial-physics-8-config-evidence.json`：三件配置/接触探针摘要和资源身份。
- `dist/k4partial8/physics/`：完整官方trace、VM双模式trace、比较JSON、原始contact probe。
- `tests/k4-partial-physics-8.test.mjs`：夹具/证据绑定、四边覆盖、配置来源事实。
- `tests/kitten4_partial_physics_8.rs`：decoded mask、默认/禁用JIT每帧<.15px，旋转<1e-7，采样变量<1e-9。

最终差分 `dist/k4partial8/physics/comparison-final.json`：22件、每模式2520帧，
44个case/mode的`withinRegressionBound=true`。
所用 `target/debug/k4-trace.exe` SHA-256：
`dd1ef194e81b8dfcbb976f5413c939a2aa552004cf48293f77780b322bf06583`。

本轮新夹具为旧K4 `.bcm` 原生格式，不是 `.bcmkn`，不适用 Kitten N
`editor-compat.mjs` 的 `scenes.scenesDict` 输入；通过官方正常Start与原生编译执行验证。

已执行：第三/六/七/八轮集成各 **1 passed、0 failed**；
`cargo test --lib engine::physics::` 初始19通过，收紧睡眠/有限面保护后 **22 passed、0 failed**。
既有`kitten4_physics` **4 passed**、`kitten4_physics_partial` **1 passed**、
`kitten4_third_physics` **6 passed**，补变量断言后的第八轮复验 **1 passed**；
JS第三/六/七/八轮共 **7 passed、0 failed**。最终完整门禁：`cargo fmt --check`、
`cargo clippy --all-targets -- -D warnings`通过；`cargo test --all-targets`
98个结果汇总 **864 passed、0 failed、1 ignored**。
所有Cargo运行前检查未有jit-corpus/perf-bench/Cargo进程；均设置
`CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0`，不并行Cargo；
测试期间不清target，交付前统一清理构建产物。

## 未验证或明确不升级

物理总体不是完整一致。总表仅将boundary两项升级为指定输入60Hz的
单锁旋转刚体舞台边缘主路径认证（main-path-verified）；下述未验证边界仍独立公开。
尚未认证：旋转角冲量、actor/actor碰撞、多体堆叠、休眠岛一致性、复杂alpha/
凹形/孔洞/compound、软体与软→硬、角落同时接触、从舞台外侧撞回、极远边界箱角、
高速接触后限速顺序、多场景/克隆/删除在接触中发生、非60Hz。
单刚体解析路径的 touching 集是本步法向接触标记，不宣称等同官方全部 manifold 生命周期。
top-oblique的.118503px残差在后续弱反弹附近，仍是观察差异，不宣称求解器严格相同。

## 复现

```powershell
Get-Process jit-corpus,perf-bench,cargo -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-partial-physics-8-oracle.mjs
node tools/compat/k4-partial-physics-8-probe.mjs
node --test tests/k4-partial-physics-8.test.mjs
node tools/compat/k4-partial-physics-8-compare.mjs final
# 与主会话协调后，按指定profile串行Cargo：
# cargo build --bin k4-trace
# cargo test --test kitten4_partial_physics_8 -- --nocapture
# cargo test --lib engine::physics:: -- --nocapture
```
