# K4 第六轮：属性、活克隆、造型 ID 与显隐主路径

## 结论与升级建议

本轮新增 **8 份原创作品、192 个官方 update、192 对完整画布**。复用主会话构建的
`target/debug/k4-trace.exe`，默认模式/解释器各比对全部 192 帧，**384 帧状态全部通过**。
未移植官方源码，未读取或修改语料，未执行 Cargo，也没有修改覆盖目录或运行时代码。

“主路径可升级”使用本轮独立级别 `main-path-verified`，**不是所有输入/宿主完全兼容**。
本页不自行改变 catalog；建议主会话结合统一 Rust 门禁按下表处理。

| 类型 | 主路径结论 | 建议与不升级部分 |
| --- | --- | --- |
| `get` | 可升级 | 有效活实体的坐标/角度/造型/大小/透明度、UUID 局部读取，和 `get_3` 全帧相同；结合第一/五轮的未知属性、全局列表和惰性槽证据。宿主非有限状态等单列未验证 |
| `get_2` | 可升级 | 与 `get` 同样的动态三阶段序列逐帧相同；不是仅靠别名源码推断 |
| `get_3` | 可升级 | 角色/场景、self/明确原型目标、动态造型及隐藏状态均有实测。效果渲染/宿主污染不是本 reporter 主路径的完整兼容声明 |
| `get_clone_index_property` | **活克隆主路径可升级** | 索引 0/1/2、原型与两克隆不同局部值/造型/位置已核对；严格索引错误沿用第一轮证据。删除竞争仍不得标成一致；若 catalog 只能给整项无范围状态，保留 partial |
| `set_costume_by_id` | **已加载资源主路径可升级** | 原型/两活克隆独立切造型、场景背景来回切、变量 ID 每次求值与 getter 结果及像素均一致；结合第四轮 25 例的错误与转型事实。异步加载失败、物理体重建等单列未验证 |
| `set_entity_show_hide` | **瞬时/渐变主路径已核验；整项仍 partial** | 真 UUID 角色/组、hide/show、渐隐后换造型再渐显全帧一致；但第五轮已确认调用克隆删除时一帧生命周期差异，不能被本轮零超差画布洗掉 |

对 getter/造型的升级建议以已有主会话二进制实测为依据；新增 Rust 的双重 Start 回归
已由主会话执行通过。没有为了数量增加像素遮罩或忽略失败帧。

## 来源与独立性

- 官方包只读：`E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。
- oracle 实际服务 `src/player/build/player_v2.2d180c468559fbd29528.js.orig`；
  SHA-256 `0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`。
- 每个被服务的资源摘要都保存在状态证据 `assets` 和像素证据各作品 `assets`。
  固定包含既有 DI 暴露点，未独立认证与线上发布物相同，结论不扩展到所有版本。
- 构造只使用仓库原创 `semantics-screen.bcm` 骨架、第四轮原创 UUID 资源表、内嵌 SVG
  和本轮新写脚本。未把第三方作品或官方函数改写成夹具。
- `set_costume_by_id` 和 `set_entity_show_hide` 使用自有普通 statement/socket metadata，
  原因是已归档编辑器 schema 对它们报参数错误。这些 `.bcm` 经原生播放器编译执行；
  **不声称当前在线编辑器能创建该 legacy 积木**。没有生成 `.bcmkn` 或依赖在线检查。

只读定位沿用已归档的一/四/五轮；无需复制任何官方实现：

| 位置 | 本轮用实测补强的规则 |
| --- | --- |
| `Tn6a` factory UTF-16 offset `38280`、`42386` | get_3 及 get/get_2 的统一读值行为 |
| `Tn6a` factory offset `35434` | 克隆索引 0 为原型，活克隆按索引独立取值 |
| `Tn6a` factory offset `33666`、`22419` | legacy style ID 分派与 actor/scene setter |
| 整包 UTF-16 offset `599871`、`602703` | 显隐渐变 helper 与组调用 |

上表混用的 factory/整包坐标已明确区分，均从 0 起算；本页只归档观察事实。

## 本轮原创矩阵与采样事实

生成器：`tools/compat/k4-partial-properties-6-fixtures.mjs`。
作品：`tests/fixtures/kitten4/partial-properties-6-*.bcm`。
状态证据：`docs/kitten4-partial-properties-6-evidence.json`。
全部用例每件 24 帧、60Hz、seed=1、**外网放行 0、runtime errors=[]、pageErrors=[]**。

### 四种 getter 动态状态（4 件）

`get-state`、`get_2-state`、`get_3-state`、`get_clone_index_property-state` 使用相同输入：

1. 设置位置 `(-37.125,28.875)`、角度 `137.25`、增大 `125`（最终大小 `225`）、
   透明度 `35`、局部 UUID 值 `"local-live"`；变量 ID 选择 Second。
2. 隐藏，重新取同一组属性。
3. 切回 First 并显示，再取一遍。

采样属性为 `0/1/2/3/4/5/8/9/16/17` 和局部 UUID。四件作品 **24 帧所有观察完全相同**。
phase 在前 6 帧是 `1,1,2,2,3,3`；x/y 返回 `-37.12,28.88`；造型号/名
`2/Second → 2/Second → 1/First`；透明度 `35 → 100 → 35`。
显隐不会把原 alpha=0.65 重置成 1；隐藏时 getter 的透明度仍报告 100。

### 原型和两只活克隆（1 件）

`clone-index-local-costume`：原型局部值先为 23，再为 47，分别 mirror；克隆把自身局部值
加当前索引，得到 24 与 49，独立移动到 `(60,-20)`、`(120,-20)` 并切 Second。
原型保持 `(0,0)`、First、局部值 47。

- 克隆内 `get/get_2/get_3(__self,local)` 分别读到 24/49。
- 同一调用者显式指定原型 UUID 时，分别读到当时原型的 23/47；不是默认读取自己。
- 原型最后用 clone reporter 的索引 0/1/2 读到各自位置、造型号/名与局部值。
- 角色存在数、克隆出现帧、原型/克隆位置和造型全部与 VM 对齐；不是只比较最后一帧。
- 本轮克隆不删除，规范化 `#1/#2` 只是无删除情况下 runtime 克隆列表的顺序编号，
  不声称支持删除后的索引重用。

### 场景、组瞬时、组渐变（3 件）

- `scene-costume-id` 在原生场景脚本上选择 Background two，再选 Background one。
  三个 getter 都报告 `2/Background two → 1/Background one`；像素包含背景实际变化。
- `group-instant` 同时隐藏/显示两个相距 180 的角色，getter 透明度记录
  `[100,100,0,0]`，组中两角色 visible/alpha 每帧相同。
- `group-fade-cycle`：0.1s 渐隐，完成后角色 A 换 Second，再 0.1s 渐显。
  第7帧隐藏且 alpha 重置为1；第8帧调用方继续并开始渐显（visible=true, alpha=0）；
  第14帧 alpha=1；第15帧后续脚本继续。phase 从第8帧为1、第15帧为2。

时钟插桩只在 Start 前通过 DI 固定原生 Clock 的墙钟原点为 **1024ms**，
没有替换 task update/渐变算法。它使边界帧不随 `performance.now()` 原点抖动；
不声称任意真实墙钟原点都恰好在同一帧完成。rAF/确定性 update 控制沿用仓库 oracle。

## 状态与像素回归

JS：`tests/k4-partial-properties-6.test.mjs`。
显式设置 `K4_PROPERTIES_EXE` 时使用现成二进制，**不会自动构建**：

- 夹具确定性、SHA-256、192 帧完整性、错误/网络隔离、关键官方结果。
- 默认/解释器模式各 192 帧，比较 result/phase/choice、原型局部、全部角色数/位置/visible/造型。
  官方诊断把局部值重复放在 variables，NekoC 正确保存在 entity_variables，测试按同一
  owner 槽比较，不能把诊断布局差异当语义差异。
- 192 帧像素事实的 fixture/resource hash 与全帧覆盖。

Rust：`tests/kitten4_partial_properties_6.rs`，默认/禁用 JIT，各两次 Start，逐帧
比较相同状态，并额外从 SpriteDelta 累积 native opacity（容差 `1e-9`）。
**子会话未执行 Rust；主会话已统一执行，1 passed、0 failed。**

像素 runner：`tools/compat/k4-partial-properties-6-visual.mjs`，逐帧应用真正的
`k4-trace --render` 增量，读取浏览器解码的造型尺寸/遮罩，再与原生播放器画布比较。
证据：`docs/kitten4-partial-properties-6-pixels.json`；384 个 PNG 位于 ignored
`dist/partial-properties-6/visual/`（两侧各192张）。

- **192/192 对 changedPixels=0**，RGB 通道容差 8/255；1280×720，每对 921600 有效像素。
- 不缩放、无视频、无 overlay、无像素遮罩，透明部分合成白底。
- **不是逐字节全等**：最大 MAE `0.002194733796296296`，最大 RMSE `0.06625305723204472`。
  有旋转/缩放/透明度的四件作品存在容差内栅格差异；渐变也有小幅舍入差异，均完整保留。
- `clone-index-local-costume`、`scene-costume-id`、`group-instant` 的所有帧 MAE/RMSE 均为0。
- alpha/惰性变量等不可见语义依赖状态证据，不以相同画布替代读值核验。

## 已知失败与未验证边界

1. **已知非一致仍保留**：第五轮 `delete-caller-clone` 第8帧官方仍显示克隆，NekoC 已删除，
   1600 像素超差；`delete-clone` 同帧也有实体存在差异。涉及公共 clone disposal，
   本轮不改 `engine.rs`、不掩盖、不把“活克隆通过”扩展为“删除竞争通过”。
2. 首次构造尝试把 `set_entity_show_hide` 的 sprite 写为 `__self`，该离线包报
   `HEART.CLIENT/set_entity_show_hide`。因此交付正常夹具明确传实际 UUID/组 ID。
   这是夹具校正，不计入192成功帧；该次诊断未独立归档成错误回归，不宣称其全错误契约已验证。
3. **非有限状态、宿主/平台**：非有限坐标/缩放对 PIXI 的污染、iOS ASCII 提示、
   ELASTIC 体重建、设备差异、复杂滤镜及资源加载失败均未由本轮验证。
4. **变量**：第五轮仍保留的显式 null 初始值加载边界、未知 UUID 与跨场景/云/local 冲突、
   对象键 getter 副作用，不由字符串/数字局部值覆盖。
5. **造型 ID**：复杂嵌套数组、显式 null、自定义对象属性键、克隆专有/未加载资源、
   跨 scene 资源加载时序未验证；动态正常路径不能扩大为加载器完全兼容。
6. **显隐**：场景隐藏、嵌套组中的克隆展开、悬空 UUID、畸形 mode、同帧 restart/stop-all、
   非60Hz与预算中断、复杂手势/拖拽/多点触摸仍未验证；第五轮已有的有限取消/输入证据继续有效。

## 复验（先检查压力任务）

构建/跑测前检查 `jit-corpus`、`perf-bench`，存在则等待；本会话采样和跑测前均检查，
未与这两个运行中进程并跑。初次检查曾看到另一会话构建 jit-corpus，因此未执行 Cargo。

```powershell
Get-Process jit-corpus,perf-bench -ErrorAction SilentlyContinue
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:K4_PROPERTIES_EXE='E:/nekoc-wt/k4partial6/target/debug/k4-trace.exe'
node tools/compat/k4-partial-properties-6-fixtures.mjs --record
node tools/compat/k4-partial-properties-6-visual.mjs
node --test tests/k4-partial-properties-6.test.mjs
# 仅主会话统一执行：
cargo test --test kitten4_partial_properties_6
```

本会话 JS 专项：**3 passed、0 failed、0 skipped**（显式提供二进制）。
连同 property-5、costume-4、visibility-5 的 JS 历史回归合跑：
**10 passed、0 failed、0 skipped**。
没有提交，没有修改其他目录。
