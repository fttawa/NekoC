# Kitten 4 物理：官方证据与 Rust 刚体适配

## 范围与结论

本次不是完整 LiquidFun 移植。实现 `physics2_*` 刚体积木；**软体材质和柔软度设置仍未实现**，执行时明确报错，不再静默空操作。不能据此宣称 12 个作品已完全兼容。

## 语料清单

语料只在被忽略的 `dist/kitten4-corpus` 中，本次没有把作品或资产加入被跟踪路径。
在该目录运行 `node vals.mjs physics2_allow_rotate physics2_enable_force physics2_forbid_bump_with physics2_get_property physics2_set_actor_as physics2_set_boundary physics2_set_flexibility physics2_set_force physics2_set_force_in_time physics2_set_gravity physics2_set_mass physics2_set_resilience physics2_set_roughness physics2_set_speed physics2_set_texture`。
进一步读取参数子块的 `params.NUM`，得到：

| 积木 | 数量 / 作品数 | 语料实际参数 |
| --- | --- | --- |
| `physics2_enable_force` | 317 / 12 | `is_enable=false,true` |
| `physics2_set_actor_as` | 173 / 11 | `attend_physics_world,exit_physics_world` |
| `physics2_forbid_bump_with` | 33 / 7 | `is_bump=false,true`，21 个角色 UUID；不是数值表达式 |
| `physics2_allow_rotate` | 18 / 3 | `is_allow=true,false` |
| `physics2_set_boundary` | 67 / 7 | `all_bounds,not_bound,left_right_bottom_bounds` |
| `physics2_set_texture` | 103 / 3 | `hard,soft` |
| `physics2_set_flexibility` | 3 / 1 | `value=1` |
| `physics2_set_resilience` | 27 / 3 | `restitution=1,0.5,0.7` |
| `physics2_set_roughness` | 20 / 4 | `friction=1,0.7` |
| `physics2_set_force` | 43 / 5 | `value=500,200,100,30,360,150,5,25,12,50,78,300`；`dir=90,180,0,-90` 或 `random` |
| `physics2_set_gravity` | 14 / 2 | `value=25,12,10`；`dir=-90,90` |
| `physics2_set_force_in_time` | 2 / 1 | `time=1,value=10,dir=90` |
| `physics2_set_speed` | 77 / 5 | `value=10000,9.05,6.5,5,8,10,6`；`dir=-90,90` |

共 13 种；语料没有 `physics2_set_mass`、`physics2_get_property`，但实现它们用于核实受力及属性。socket 与下拉选项来自 `docs/kitten4-block-schema.json` 的对应条目，不猜字段名称。

## 官方引擎定位

官方入口 <https://kitten4.codemao.cn/>，本次观察的应用版本 `4.11.20`。

- 主包：`https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js`
- vendor：`https://creation.codemao.cn/kitten/build/vendors.5035cd22e77914a9f363.js`
- 按需物理包：`https://creation.codemao.cn/kitten/build/6.be5157efbeb0ba432d5f.js`
- webpack `Pcni` 导出 `World`、`BodyDef`、`BodyType.b2_dynamicBody`、`ParticleSystemDef`、`ParticleGroup` 等，`HP1x` 的 `ot.init()` 通过 `require.e(6)` 加载 `Pcni`。这是 **Box2D/LiquidFun API 的 JS 实现**，不是 Matter 或 Planck；精确上游仓库及版本号**未验证**。
- `HP1x`：`rt` 管理 world，`tt` 为普通刚体，`et` 为粒子软体，`nt` 将角色属性和物理对象绑定，`ot` 管理各屏幕 world。
- `49df`：像素→物理单位 `o(e)=e/10`，反向 `n(e)=10*e`；固定步长 `f=1/60`，速度迭代 `l=8`、位置迭代 `j=3`。这只能证明单位换算，不能证明“物理单位就是 SI 米”。
- `Tn6a` 的 `Ae` 是 `physics2_*` 实际执行函数；惰性 `create_world(scene,100)`、`create_body({collidable:true,forceable:true,density:.1,strength:2.5})`。
- `HP1x.tt` 构造器及 `49df` 给出摩擦默认 `.1`、弹性默认 `0`、默认锁定旋转。`Tn6a.Ae` 将密度覆盖为 `.1`，不是 `49df.b=1`。
- `HP1x.tt.create_fixture` 读取 `get_texture_convex_groups(texture)`，将纹理轮廓凸分组变成多个 `PolygonShape`，以纹理中心为局部原点，再应用角色 scale。不是始终用整张图片矩形。轮廓提取的采样细节**未验证**；本次 20×20 SVG 的官方默认质量约 `.33`，Rust 矩形为 `.4`，说明轮廓存在实际差异。
- `HP1x.rt.update` 每 ticker 调用固定一次 `world.Step(1/60,8,3)`，不按墙钟 delta 积分。无头 Edge ticker 更快；等待积木用时间，物理用 tick，不能要求墙钟轨迹相同。
- `HP1x.et` 使用粒子组和渲染滤镜实现软体；仅修改 Rapier restitution 不能替代它。

运行 `node tools/physics-kitten4.mjs --case speed --inspect --out dist/physics/source-check.json` 会把只读模块源码存入忽略目录 `dist/physics/modules.json`。不替换官方模块，不直接调用域函数来冒充运行积木。

## 积木语义

由 `Tn6a.Ae` / `HP1x.nt` 核对：

- 每种物理积木都可能惰性创建角色刚体。`set_actor_as(exit)` 仅关闭碰撞；保持 forceable 时是动态 sensor，不是退出 world。
- `enable_force(false)` 切静态；collidable 仍可作为障碍物。两个标志都 false 或不可见时禁用物理对象。官方禁用后仍能报告原速度，不等于把速度设零。
- 重力 `value` 截断到 ±10000，方向是从右侧起逆时针的角度，向量乘 10；速度截断到 ±12 后乘 10。反向像素换算再乘 10，因此速度积木的 1 对应约 100 px/物理秒。
- `set_force` 调用 `ApplyForceToCenter`，**不是直接冲量 API**；它对下次固定步施力，之后清除。对质量 2、力 12，单次速度增量约 `.1`（积木报告单位）。
- 持续施力只接受整数 time；计数 `round(time/(1/60))` tick，并以线程锁阻塞后续积木直至完成。小数 `.5` 忽略且不阻塞。time=1、力=1、质量=2，完成速度 `.5`。
- 弹性/摩擦 clamp 到 0..1；正质量 clamp 到 10000；柔软度 1..100 转为 `strength=(100-value)/100*5`。
- `physics2_get_property` 的当前实现只取执行角色（官方函数未使用 `sprite` 字段），速度向量模除 10；最后统一四舍五入两位小数。
- `forbid_bump_with` 维护双向排除关系：任一方排除即不求解接触；边界可以整体或单边过滤。
- 普通 `bump` 优先接受物理接触为 true，否则仍回退像素重叠/几何边缘。因此禁止物理解算不代表视觉 `bump` 永远为 false。

## Rust 方案与代价

使用 `rapier2d-f64 0.22.0`（锁文件固定），纯 Rust、成熟刚体/复合碰撞体求解器，无 C/C++ FFI、无需在 JIT 生成器中实现求解器。选择已有稳定 API 的 0.22，不宣称它是最新版本或与 Box2D 数值等价。

- `Engine.physics: Option<Box<Physics>>` 初始为 None，只在执行物理命令或 reporter 时分配 world。其他作品不建 broad/narrow phase，不遍历角色做物理同步，每帧仅一次 None 判断；碰撞 reporter 另有一次可选状态查询。未做系统性能基准，不能声称绝对零开销。
- 各 scene 分别 world；当前 scene 按传入 dt 累积固定 60 Hz 子步，dt=0 合帧不额外推进。start/restart 丢弃全部物理状态；隐藏/删除角色禁用，删除克隆清理刚体，造型/尺寸/解码 mask 变化重建形状。
- JIT 对物理命令侧退出到原解释器；数值 reporter 走已有表达式 fallback，不复制第二套语义。普通数字热路径不变。
- f64 与 JS Number 精度一致，但 Rapier 算法不同。接触摩擦用 `sqrt(frictionA*frictionB)`，弹性取 max，匹配 Box2D 常规混合性质，仍不保证逐 tick 位级一致。
- 没有加载纹理 mask 时退化为造型矩形；有 mask 时用不透明水平游程复合矩形，保持凹口与断开区域。不是官方凸分组算法；小物体、复杂轮廓、枢轴、缩放/翻转的精确接触点**未验证**。
- Rapier 可编译 wasm，但本仓库整体含原生 Cranelift JIT/服务器依赖；本次**未验证 wasm 构建**，没有声称整个项目因此可用 wasm。依赖会增加原生二进制体积和构建时间；未量化。
- 不实现 LiquidFun 粒子软体。`soft` 和柔软度 setter 明确报错，`hard` 正常。也没有添加分裂、画笔填充、深层 JSON 或其他积木。

## 官方夹具与回归

`tools/physics-fixtures.mjs` 自写工作区和内嵌 SVG；运行 `node tools/physics-kitten4.mjs --generate` 仅更新 `tests/fixtures/kitten4/physics-*.bcm`。官方工具检查反序列化后的类型、字段、连接，再点击运行按钮，保存检查点、SHA-256、浏览器和构建 URL。第三方作品没有参与夹具生成。

回归命令：`cargo test --test kitten4_physics -- --nocapture`、`node --test tests/physics-fixtures.test.mjs`。
比较行为性质、精确属性及不受帧率影响的持续力终值。60/30 Hz viewer 的 wait 采样允许 8px 位移差与 `.1` 速度差；静止零速的角度无物理意义，不比较。反弹用等待速度方向转为向上，避免比较不同周期的反弹相位。

### 官方观测与本地回归

原始记录：`tests/fixtures/kitten4/physics-official.json`，采样时间 `2026-11-09T15:56:36.843Z`，Edge `157.0.4341.42`。各 case 包含工作区校验、夹具 SHA-256、官方脚本 URL、应用版本、分时变量、角色位置、官方错误状态。13 个刚体 case 均无页面异常、工作区改写或官方运行错误；软体 case 失败，整份记录的 `ok=false`，不是全绿报告。

| 夹具 / 类别 | 官方积木观测 | Rust（60 Hz） | 对比标准 |
| --- | --- | --- | --- |
| speed / 速度 | `99 → 12`；`-2,90° → 2,-90°` | 相同 | 速度、方向 ±.02；有位移 |
| default / 默认 | 质量 `.33`，摩擦 `.1`，弹性 `0`，下落 | 质量 `.4`，其余相同 | 质量差异显式保留，不伪装相同轮廓 |
| gravity / 重力 | 下落，清重力+清速度后位置不变 | 相同性质 | 不比较 ticker 与墙钟造成的不同下落距离 |
| flags / 刚体开关 | sensor 仍前进；静态位置不变、速度仍 `2`；再启用前进；全禁用不动 | 相同 | 相对位移及静态/禁用速度 |
| properties / 材质与 reporter | mass `2`，friction `1`，restitution `0`，flexibility 默认 `50` | 相同 | 属性 ±.02；此项没有测试柔软度 setter |
| force / 一次受力 | mass `2`，force `12`，终速度 `.1` | `.1` | ±.02，且产生位移 |
| timed / 持续受力 | 1秒、force `1`、mass `2` → `.5`；随后匀速 | 相同 | 终速度 ±.02，后续脚本完成 |
| fractional / 非整数时长 | `.5` 不施力、不阻塞，速度 `0` | 相同 | passed=1，速度0 |
| boundary / 边界与过滤 | 静止 `y=-349.85`，碰底 true；过滤后 `y=-562.52` | `-350.016`，true；过滤后 `-376.925` | 静止位置 ±1px、穿越性质；不比较过滤后距离 |
| collision / 角色碰撞 | 静止 `y=-59.91`，接触 true；过滤后穿透 | `-60.068`，true；穿透 | 静止位置 ±1px、接触与穿透性质 |
| bounce / 弹性 | 反弹方向 `90°`、速度 `3.73` | `90°`、`3.77` | 向上反弹；不用不同周期位置蒙混相位 |
| friction / 摩擦 | 初速2后降到 `1.19` | 降到 `1.67` | 仅验证减速；官方已滑离400px平台，不能据此推断相同摩擦曲线 |
| rotation / 允许旋转 | 偏心碰撞后角度 `130.47°` | `-34.05°` | 仅验证非零旋转；时间、轮廓和求解器均不同，不宣称角度匹配 |
| soft / 软体+柔软度 | 点击运行按钮等待超时，无有效检查点 | 明确报不支持 | **未完成 / 未验证**，不是成功空操作 |

`tests/kitten4_physics.rs` 校验13个刚体记录哈希，并对官方和本地使用同一组行为断言；可比较属性再做直接数值对照。每个夹具验证原生→规范格式→原生完全往返，并比较 JIT/解释器结果。另有4个内部回归检查惰性分配/重启清理、sensor/静态/隐藏恢复、mask与尺寸重建/删除克隆、双向过滤所有权/重新启用接触。这些内部回归不代表相应生命周期已在官方逐项验证。

软体全套探针在运行按钮定位处超时；后续单独复查又遇 Edge 进程启动失败（`0xc000012d`，资源不足），未用新失败覆盖已有刚体证据。原因不能归结为“官方不支持软体”。工具保留失败记录；未对官方物理模块打补丁。

### 语料 coverage 前后

同一53作品，改前 release 和改后 release 分别运行 `node dist/kitten4-corpus/cov.mjs`，保存至忽略目录 `dist/physics/coverage-before.json` / `coverage-after.json`。

| 作品 | 改前 | 改后 | 备注 |
| --- | --- | --- | --- |
| 142525200 | ran | run（错误） | 明确暴露未实现 LiquidFun 软体；不再靠空操作伪通过 |
| 143928845 | ran | ran | 刚体已实际执行；不等于整作品视觉验证 |
| 144171544 | ran | ran | 同上 |
| 145621806 | ran | ran | 同上 |
| 149268571 | ran | ran | 同上 |
| 152275825 | ran | ran | 同上 |
| 172151013 | compile | compile | 仍被 `get_clone_index_property` 阻塞 |
| 232144239 | compile | compile | 仍被 `show_hide_cloud_list` 阻塞 |
| 284554184 | compile | compile | 仍被 `self_set_rotation_type` 阻塞 |
| 314937840 | compile | compile | 同上 |
| 329639937 | ran | ran | 刚体已实际执行；不等于整作品视觉验证 |
| 333231321 | ran | ran | 同上 |

全语料改前 `ran=22,compile=29,load=2`，改后 `ran=21,run=1,compile=29,load=2`。12个物理作品从8个 ran变为7个 ran+1个显式软体运行错误+4个其他编译阻塞。其余41作品的 coverage 行没有变化。`physics2_*` 全部从 `stubbed` 消失，但 **opaque 数量不变**：规范格式仍保留原始原生积木以便无损往返；opaque 不是“未实现”计数。coverage 只跑其默认入口及有限帧，既不能证明未触发软体的作品无软体，也不能证明视觉/交互兼容。

## 未完成与风险

软体未实现；多 scene 暂停/持续力锁释放、隐藏期间持续力、物理克隆继承、拖拽鼠标关节、高速穿隧、复杂旋转/枢轴轮廓、边界尺寸随编辑变化等官方一致性**未验证**。当前采用固定 tick 物理时间而非复制官方无头 ticker 墙钟速度，是有意的运行时选择。

官方实测只覆盖上述夹具中的参数组合；语料中的其他数值、`all_bounds/not_bound/left_right_bottom_bounds` 各枚举组合、双向互相排除的复杂脚本、负/零持续时长及所有非有限数值并未逐一在官方跑过。边界其他枚举和限幅等实现还依据只读源码，不应把“代码路径支持”混同于“每个参数已官方实测”。

没有参考或移植 HateNeko，本次 HateNeko 引用清单为空。
