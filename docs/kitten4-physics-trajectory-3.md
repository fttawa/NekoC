# K4 partial 第三轮：固定帧刚体轨迹

## 结果

新增 11 份仓库原创工作区，每份由离线官方 `.orig` 正常 Start 执行 60 次 update，
共 660 帧。`kitten4-physics-trajectory-3-evidence.json` 保存逐帧角色位置、变量、
fixture SHA-256 和资源诊断。未读取第三方作品来生成夹具，也未移植 HateNeko。

修正 `src/engine/physics.rs`：

- 新世界首次同步初始化，不在新 ticker 的首次同步批次立即积分。原来匀速运动提前一帧。
  并非每帧延迟显示：stop 夹具证明清重力/清速度后不能再补上“上一帧位移”。
- 外力/重力在每个 1/60 步前一次积分，再交给 Rapier 处理接触与位置。
  避免其默认四个 solver 子步把自由落体变成不同的积分曲线。
- 速度向量模限制为每步 2 物理单位（20px），角速度限制为每步 pi/2。
  旧速度 setter 的 ±10000 仍保持：其立即 reporter 很大，真正 step 后才限速。
- 边界 friction 改为 Box2D FixtureDef 默认 .2；角色仍是域函数显式的 .1。
  原来将边界误用为 .1 是摩擦曲线误差的一个来源。
- 新独立模块 `src/engine/physics_shape.rs` 对**全不透明矩形纹理**复现 .7 缩图、
  marching squares、5px 简化容差与坐标 floor。非全不透明 mask 仍走旧复合游程 fallback，
  不用凸包冒充凹形分解；没有 mask 仍走矩形 fallback。

全部物理类型继续保留 partial，不能据此称 Rapier 等于 LiquidFun。

## 官方证据定位

只读 `$K4_PLAYER_DIR/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，
SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
offset 为 webpack factory `toString()` 零基字符位置：

| 模块/offset | 依据 |
|---|---|
| `49df@0` | 像素 /10、反向 ×10、固定 1/60，速度/位置迭代 8/3 |
| `a1xw@88829` 附近 | Jt 普通体构建为 disabled static，density/friction/restitution |
| `a1xw@92900` 附近、`@95597` | actor handler 同步位置、更新启用/类型；新 body 需先启用 |
| `a1xw@100663` | world ticker 固定 Step，按 PIXI ticker 注册次序执行 |
| `a1xw@103400` 附近 | 边界 CreateFixture(shape,density)，使用库默认摩擦 |
| `JfQ3@0` | .7 缩图尺寸与坐标反变换 floor |
| `a1xw@9546`、`@15961` | alpha 扫描从 packed index3 开始、轮廓与5px简化、凸分组 |

物理 chunk `2.b8370041782df6e86958.js` SHA-256
`6ed56cf80a197b1dad00403ef2d55f9f4c357cb000cc52b5b0ba32c3989730d6`：

- `Pcni@16522` 附近：maxTranslation=2、maxRotation=pi/2。
- `Pcni@162167` / `@164308`：积分后按向量模限制位移，回写线速度。
- `Pcni@102765`：FixtureDef friction=.2、restitution=0。
- `Pcni@119956`：friction 几何平均、restitution 最大值；后两项既有适配保持。

源码仅只读定位，未把函数体或官方素材入库。此离线包带 DI 暴露点，未独立认证等同线上所有版本。

## 逐帧比较

`tests/kitten4_physics_trajectory_3.rs` 每份回归默认 JIT 开关/禁用 JIT，
并分别在无解码 mask / 注入原创 20×20 全不透明 mask 下运行：

| 夹具 | 结果 |
|---|---|
| coast、fall、default-gravity、diagonal | 60 帧 x/y 每帧容差 1e-7 通过 |
| legacy-limit、legacy-diagonal-limit | 第3帧开始每 tick 向量模20px，60帧容差1e-7通过 |
| force | 质量2、单次力12，60帧容差1e-7通过 |
| material、stop | 静止/清速度后停止，60帧容差1e-7通过 |
| bounce | 最大位置误差 **2.797382832px**；仅断言误差 <3px，不宣称相等 |
| friction | 最大位置误差 **0.703993056px**；仅断言误差 <1px，不宣称相等 |

无 mask 默认质量 .4；解码后轮廓面积为3.33、density=.1，质量 .333，reporter=.33，
与官方相同。单独只读 shape probe 记录实际 loaded texture=20×20、缩图14×14，
组顶点 `(13,0),(2,0),(1,14),(14,13)`，Box2D 最终顶点
`(1,.8),(-.9,1),(-.8,-1),(.8,-1)`（y向下）。
见 `kitten4-physics-trajectory-3-shape-evidence.json`，不是把官方轮廓硬编码进求解器。

复验：

```powershell
node tools/compat/k4-physics-trajectory-3-oracle.mjs
node tools/compat/k4-physics-trajectory-3-shape-probe.mjs
node --test tests/k4-physics-trajectory-3.test.mjs
cargo test --test kitten4_physics_trajectory_3 -- --nocapture
cargo test --lib engine::physics:: -- --nocapture
```

## 未验证与风险

- 仍非 Box2D 求解器；接触 slop、restitution threshold、休眠/唤醒、高速碰撞后限速顺序、
  TOI、旋转碰撞、多物体堆叠都未逐项对齐。预积分限速发生在 Rapier 接触求解之前，
  与官方接触求解后限速不能泛称等价。
- 只有全不透明矩形使用新轮廓；Canvas alpha 重采样、凹形/孔洞/断开组件、复杂枢轴、
  纹理重建后质量与惯性等仍未全面验证；递归/像素数有防护上限，会 fallback。
- 软体仍刚体 fallback，不提供粒子变形；多场景、首次隐藏创建、克隆、拖拽关节未完成。
- 运行 dt 仍累积固定子步，非60Hz viewer与官方每ticker一步并不全等。
- 本轮初次曾误判为“所有帧延迟发布”，stop夹具推翻该假设，已改为首次世界初始化门槛；
  不以旧回归放宽容差掩盖该问题。
