# K4 soft：粒子形变进展，仍为 partial

## 认证结论

`physics2_set_texture` 与 `physics2_set_flexibility` **不升级**。本次从刚体
fallback 前进到可运行的独立粒子近似和三角纹理绘制，但尚未复现官方轮廓扩张、
Voronoi 物理 triad、压力/阻尼/solid 深度等全部求解。粒子数量/拓扑本身不同，
不能把点集最近距离称为同一粒子逐帧误差，也不能宣称亚像素完成。

官方模型与矩形阻塞的动态证据见
[专项取证](kitten4-soft-blocked-investigation.md)。
该文档及其 source-locations JSON 只包含只读官方文件的哈希/坐标和事实描述，
没有复制官方源码或第三方求解器。没有参考或移植 HateNeko。

## 本地实现范围

- `src/engine/physics_soft.rs`：从已解码 alpha mask 生成有界规则粒子格，
  固定 rest 三角网格；三点 corotated shape matching、短程分离、重力与速度积分。
  这是原创位置投影近似，不是官方速度式弹性约束的移植。
- flexibility 沿用已验证的 adapter 映射 `5*(100-clamp(flex,1,100))/100`；
  本地 strength→投影系数映射 **未验证**，4 个数值子步也不是官方迭代次数。
- `src/engine/physics.rs`：与 Rapier 真实 collider 做球粒子单向接触，支持既有
  exclusion 过滤；代理刚体切为 sensor，避免刚体碰撞再次把整组推动。
  没有双向刚体反作用或 soft/soft 跨组碰撞，力的质量映射仍近似。
- 保留既有模式幂等、帧尾重建清速与禁用延期状态机。缺 mask、空形状或超过
  1024 个候选格点时明确保留 `rigid-fallback`，不是静默声称粒子求解。
  flip、非正尺寸、非零pivot及非自由旋转当前也显式回退，避免造型/alpha映射错位。
- `physics_soft_snapshot` 区分 `particle-approximation` / `rigid-fallback`，
  前者显式 `certification=partial`，完整点/速度只用于诊断。
- `SoftMesh` 使用世界像素顶点与 top-left UV；帧只传当前真实求解的网格。
  Web Canvas2D 逐三角仿射纹理映射，Wry/Android 复用该路径。
  点击检测也跟随变形三角而非旧四边形。
- Studio 原生预览对 K4 使用同一个 Engine，局部 detached `NativeSprite` 快照
  通过 worker channel 传世界网格，用 egui textured Mesh 绘制；从原生
  `ColorImage`/SVG 加载结果生成alpha mask后才启用粒子。非K4保留旧预览路径。
  原生窗口截图、滤镜/音频与官方像素仍未验证，不改变公共 RuntimeSnapshot schema。

## 逐帧证据与指标口径

`tools/compat/k4-soft-compare.mjs` 重新执行第九轮 4 件原创输入、总计420个官方
完成 update，读取官方位置/速度缓冲并与真实 `k4-trace --soft` 比较，两种 VM
分别运行。不会从证据或录制轨迹生成求解结果。

每件证据单独保存，文件小于300 KB：
`kitten4-soft-{coast,impact-25,impact-90,rebuild}-evidence.json`。
保存每帧中心误差、点集 Hausdorff 距离、点数和抽样点见证；完整轨迹只在忽略的
`dist/k4soft/`。两套粒子拓扑不同的帧，`indexedMaxPx=null`，并明确
`sameParticleCorrespondence=false`。Hausdorff 是不同点集的几何距离，不是逐粒子兼容误差。

实测最终数值见上述 JSON；没有达成亚像素目标，不以中心小误差替代形变误差。
第九轮既有刚体误差/负例文件保持不变，方便复核前后差异。

| 原创输入 | 完成update | 最大中心误差(px) | 最大点集Hausdorff(px) |
|---|---:|---:|---:|
| coast | 90 | 0.023673 | 22.894940 |
| impact-25 | 120 | 6.500001 | 27.644659 |
| impact-90 | 120 | 19.034363 | 48.947375 |
| rebuild | 90 | 0.162536 | 31.791745 |

两VM逐帧指标相同。**impact-90中心误差比第九轮刚体fallback的11.217px更大**；
本次进展是实际非刚性形变与渲染链路、可重放诊断和官方阻塞根因，而非精度改善承诺。
初始点数/布局误差在碰撞前已存在，不能将表中点集距离全归因于弹性参数。
四件输入初始均为官方92粒子、本地59粒子；即使 coast 中心只有0.024px误差，
也不能据此声称92个官方粒子得到正确模拟。

## 矩形负例

原创80×60矩形在指定官方包/Edge/1024 uniform环境，边界轮廓40点，预算101 anchors，
边界步长 `floor(40/50.5)=0`。两种时钟各三次 CDP 暂停，顶层均位于官方
`generate_position_data` 的同一循环，0个完成帧。这是官方本身初始化无进展，
不是 NekoC 运行错误；本地不刻意复现无限循环。该输入保留为官方阻塞负例，
不纳入正常逐帧一致率。暂停扰动墙钟，16秒watchdog不能当性能数据。

## 测试与复现

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
# 构建前确认没有其他jit-corpus/perf-bench正在构建或运行。
cargo build --bins
node tools/compat/k4-soft-compare.mjs
node --test tests/k4-soft.test.mjs tests/renderer-soft-mesh.test.mjs tools/compat/k4-soft-blocked.test.mjs
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
cargo test --features studio --lib studio::
npm run -s test:tools
node tools/compat/k4-run-error-corpus.mjs E:/nekoc/dist/kitten4-corpus
target/debug/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --out dist/k4soft/jit-corpus.json
```

Rust 原创单元测试覆盖自由平移、非刚性碰撞、strength响应和有界分配；
集成测试覆盖两VM相同粒子诊断/网格与边界不穿透，**不是官方一致性断言**。
JS测试绑定输入hash/420帧证据/partial状态，并测试手写网格渲染、点击、退化输入。

本轮标准门禁：fmt/clippy通过，Rust全目标893通过、0失败、1忽略；工具600通过、
0失败、60项可选集成跳过。额外Studio feature专项9通过，带Studio的全目标clippy通过。
新renderer下额外重跑第九轮9件效果夹具，既有65像素/1像素负例保持，没有伪改证据hash。
这些是有限输入的回归结果，不扩展为所有soft或所有像素的官方兼容声明。

## 仍未完成与风险

- 官方粒子布局、物理/渲染独立三角化、solver完整复现；任意凹轮廓/孔洞、边界外扩纹理。
- 规则网格边缘可能裁掉部分造型，Canvas三角公共边存在抗锯齿缝隙；像素一致性未验证。
- 多组粒子接触、连续碰撞/高速薄壁、双向刚体冲量、质量/摩擦/弹性/隐藏的soft独立语义。
- 原生设备、复杂滤镜、非60Hz、克隆、不同GPU预算和所有scale/flip/pivot组合未验证。
- 当前粒子自接触为有界O(n²)近似；1024候选点限制避免恶意scale无界分配，不等于官方上限。
- 不放宽既有官方证据容差，不升级覆盖表，不将本地解释器/JIT相等当作官方相等。
