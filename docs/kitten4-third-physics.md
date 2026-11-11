# 第三轮物理补齐：旧物理、硬体柔软度边界

## 结论与真实边界

- 补齐旧物理 `self_texture`、`set_force`、`set_force_by_vector`、`set_gravity`、`set_gravity_by_orientation`、`set_velocity_by_vector` 的刚体执行路径。
- `physics2_set_flexibility` 实现官方硬体 adapter 的 strength 和 reporter：**这只是 partial，不是软体模拟**。刚体无粒子组时不会产生形变，不改变 restitution/friction。`soft` 仍退回刚体，LiquidFun 粒子、形变滤镜、弹性碰撞未实现。
- 方向重力提供 `Engine::set_physics_device_orientation(beta, gamma, portrait)` 事件输入。无真实事件时保持执行积木时的零重力，不生成虚假传感器数据。尚未给浏览器 viewer 接入设备事件，因此对真实设备端到端支持仍是 **partial**。
- 不把“脚本继续运行”或“reporter 有数字”当作软体完成；覆盖表继续将这些边界标记为 partial。

## 官方只读定位

外部文件（未修改、未入库）：

`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`

SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。

以下 offset 都是 `tools/compat/k4-block-catalog.mjs` 的 `webpackModules` 返回 factory 的 `toString()` **UTF-16 零基字符 offset**，不是整包字节 offset。只捕获 webpack 工厂表，不运行任何官方模块 factory；未复制官方实现入库。

| 模块 / offset | 定位 | 语义证据 |
| --- | --- | --- |
| `Tn6a@10231` | 单位常量 | density 比例 `.1`，速度/力/重力比例 `10` |
| `Tn6a@50092` | `Bt`、局部重力 helper | 方向缩放 `.05`；重力遍历所有 scene 的已有 world；不创建 world |
| `Tn6a@51768` | `set_gravity` | 先取消方向 listener；finite Number；actor 不可为 scene；幅度限 ±10000 |
| `Tn6a@52040` | `set_gravity_by_orientation` | 不查 actor；finite Number 后清零所有 world；portrait `(gamma,-beta)`，landscape `(-beta,-gamma)`；零 beta/gamma 不重置已有值 |
| `Tn6a@53815` | `self_texture` | elastic/iron/wood/default 三属性联动，仅已有 body |
| `Tn6a@55282` | `set_velocity_by_vector` | 两轴严格 finite，各限 ±10000 后乘 10；仅已有 body |
| `Tn6a@55684` | `set_force` | 严格 finite；极坐标幅度限 ±10000；调用 apply_force，不是设速度 |
| `Tn6a@56058` | `set_force_by_vector` | 两轴严格 finite、分别限幅；apply_force |
| `Tn6a@72865` | flexibility reporter | `100-round(strength/5*100)` 后限 1..100 |
| `Tn6a@74470` | flexibility setter | 受平台弹性能力检测控制；可用时惰性创建 body、设置 strength |
| `Tn6a@89491` / `@90200` | 属性 setter / strength | 拒绝非 Number/NaN；1..100 变换到 `(100-value)/100*5`，允许 Infinity 被限幅 |
| `a1xw@92028` / `@92200` | adapter strength setter/getter | 保存 group_strength；只在已有 elastic particle_group 上写 m_strength；因此硬体 reporter 也会变化 |
| `a1xw@90092` | 普通 body 速度 | 委托底层刚体；静态刚体速度设置没有运动效果 |
| `a1xw@95400` 后 | `update_body_state` | 由 visible、forceable、collidable 决定 enable/dynamic/sensor |
| `a1xw@99087` | timed force | 每 tick 施力，计数结束才回调；现有时长行为保留 |
| `fhSb@3050` | player 弹性检测 | 实际依赖 WebGL uniform 限制；不能据“player”推断始终支持或始终不支持 |

### 材质预设

| texture_type | restitution | friction | density（reporter 单位） |
| --- | ---: | ---: | ---: |
| elastic | 1 | .1 | 1 |
| iron | .1 | .2 | 8 |
| wood | .2 | .4 | .8 |
| 其他 | .5 | .1 | 1 |

预设修改 collider 的真实密度并重新计算质量，不仅写 reporter；不动原速度。旧命令保持非惰性：没有 body 就无效果，不能调用现代 helper 偷建 body。旧 force/vector velocity 在非法参数时先忽略，再做 scene 检查。

## 文件及引擎接线

物理实现位于 `src/engine/physics.rs`，回归位于 `tests/kitten4_third_physics.rs`。

共享文件接线：

1. `src/kitten4.rs`：六个旧块 lower 到 `kitten4_legacy_{kind}`；从 `is_stub` 删除 `physics2_set_flexibility`，保留公开 partial 的说明。
2. `src/engine.rs`：新增 `Op::LegacyPhysicsVector(physics::Command, usize, usize)`；compiler 对 `set_force/set_gravity` 读 `value,dir`，对 `*_by_vector` 读 `x_axis,y_axis`，用 `self.value` 而不是强制转换的 `expr`。运行时两输入只接受 `Cell::Number`，其他值传 NaN，调用已有 `physics_command`。JIT 保持物理 side-exit。
3. `self_texture` 继续使用单输入 `LegacyPhysics`（无输入时零占位），`Command::parse_legacy` 已解析菜单。
4. 通用 legacy 单输入查找列表加 `value` 给方向重力；`LegacyPhysics` 的 strict Number 判断应含 `LegacyMass | LegacyGravityOrientation | Flexibility`。
5. `physics2_set_flexibility` 在通用 `physics2_*` compiler 前特判成 `Op::LegacyPhysics(Command::Flexibility, self.value(input(b,"value")?)?)`，避免字符串数字冒充 Number。

顺带修正：形状/尺寸重建后显式 recompute mass/inertia；现代 gravity/speed 非法输入在 scene 检查后、惰性分配前忽略。仍未声称与官方轮廓分解或 Rapier/Box2D 数值相同。

## 自写逐积木回归

`tests/kitten4_third_physics.rs` 使用独立手写 published AST，不读取任何第三方作品，也不需要官方包。全部执行原生往返、解释器/JIT 双路径：

- texture 四个预设的三属性；
- polar/vector force 单 tick 后得到质量相关速度，等待后不继续加速；
- vector velocity 3/4 分量得到速率 5，拒绝字符串数字；
- gravity + orientation 无事件清零，脚本继续；
- 硬体 flexibility 限幅、舍入、拒绝字符串，不伪造 restitution。

`src/engine/physics.rs::legacy_tests` 另外精确覆盖不分配 body、finite/scene 检查顺序、每轴限幅、静态忽略速度、force 一 tick 累加后清除、预设质量重算、多 world 重力、portrait/landscape/零事件、手动重力取消监听、重启清理、克隆复制 strength（包括官方构造器 `strength || 1` 导致零强度源克隆柔软度变为 80 的边界）。

统一按 debug/test 无调试信息、无 incremental、单 Cargo job 验证；最终结果见根目录交付报告。

新回归是源码语义的 Rust 断言，不是官方运行时观测。本轮没有新增官方浏览器实跑记录。旧文档 `docs/kitten4-physics.md` 中“柔软度始终报错/始终 stub”等历史文字以本文明确边界为准。

## 未完成与风险

- LiquidFun 粒子、软体变形和相关平台检测未移植；flexibility 仅硬体 adapter 边界。
- orientation API 未接 viewer；portrait 参数应由宿主捕获，而非每次事件猜测。无事件 headless 与有真实传感器的设备不可等同。
- 继续使用 Rapier，轮廓矩形/不透明游程与官方凸分组有差异；复杂枢轴和高速碰撞仍未补齐。
- 保留已有固定步进时钟和 timed-force 线程唤醒实现；场景暂停、隐藏期间持续力未新做官方运行时核验。
- 官方负密度路径可能交到底层报错，当前仍忽略负密度，不把它改成可能引发求解器非法状态的值。
