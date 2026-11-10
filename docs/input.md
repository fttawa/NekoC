# 输入事件一致性与重放

## 范围与证据

K4 的行为基准是外部只读播放器 `resources/app/src/player/build/player_v2.2d180c468559fbd29528.js.orig`，不是 HateNeko，也不是对所有线上 K4 版本的声明。文件 SHA-256 记录在 `input-evidence.json` 的 `assets`；该包保留包装器 DI 暴露点，其上游发布身份没有独立认证。

KN 当前官方发行包的来源、hash、模块定位及静态规则见 [input-kn.md](input-kn.md)。KN 与 K4 的背景/屏幕及 swipe 规则不能混用。没有移植 HateNeko 逻辑。

KN 原创运行夹具 `tests/fixtures/input-kn.bcmkn` 已经官方编辑器检查与实测，归档见 `input-kn-evidence.json`。仅发一次 A-down、一次 A-up，持续 down 帽重复执行，释放后 up 一次；角色短按 click、超过 1 秒不 click。通过 `node tools/compat/kn-input-probe.mjs` 可复验；该联网工具会保留资源/控制台错误，不能把其键盘断言通过当成全部网络或全部输入通过。

### K4 官方源码定位

以下是上述 `.orig` 原始文本的 0-based 字符偏移，可用字符串检索复核；不将第三方源码复制到仓库。源码只说明路径，实际执行仍以记录的 DOM 回放为证据；例如 Hammer 在初始化时缓存 `Date.now`，回放必须在页面启动前安装时间代理，不能在事件发生时才临时替换 Date 后把未识别手势误判成 hat 不响应。

| 定位 | 已核对规则 |
|---|---|
| `get_action_specs` / `sprite_on_tap`，约 651170 | 实体鼠标帽是 Dynamic responder，click 从逐帧目标表查询，其他状态从实体状态读取；`mouse_up` 自动回空串 |
| `on_keydown`，652076 | State responder，`up` 自动回空串，down 保持；同步解释器仍运行时不重入 |
| `init_key_event_listeners` / `key_code_process` / `send_keyboard_action`，659560 起 | body 键盘监听，96–105 减 48；方向、字母、数字、空格、回车白名单；具体键和 `any` 分开发送 |
| `on_swipe_scene`，约 655473；`send_swipe_action`，660754 | 原生 Hammer 方向转 up/down/left/right，发送 action；不能把 filter 的 `none` 误读为“永远不响应” |
| `a1xw` 的 App / Scene / Actor `emit_mouse_event`、`drag_start/drag_end` | down 到正常 up 严格小于 1000 ms 产生 click；outside 不产生该目标 click；拖拽不排除 click |
| `a1xw/Mt.contains`，809592；Actor `is_touching`，832029 | 矩形粗判后逆变换到纹理 alpha，alpha > 0；旋转、缩放、pivot 参与；视觉 ghost 不取消原纹理命中 |
| `a1xw/Lt.drag_move`，817524 | 当前位置加 pointer delta，保留抓取偏移及脚本移动；指针超出舞台时不更新最后有效点，边界等号允许 |
| Hammer 2.0.7 `event:"swipe"`，1800411 | CSS distance > 10；overall velocity 最大轴绝对值 > .3 px/ms；maxPointers = 1；结束事件；offset direction 有效 |

## 已实施与自制实测

原创建具由 `tools/compat/k4-input-fixtures.mjs` 生成，内嵌原创 80×40 SVG（左半不透明、右半透明）。没有使用/复制语料作品或外部内核内容。

| 夹具 | 官方实测与 VM 回归 |
|---|---|
| `input.bcm`，38 帧 | A 按住 3 帧具体键与 any 均执行 3 次；小键盘 0 触发 48；同 update down/up 仅最终 up；多键的 any 是独立状态，释放 A 后 B 仍按住并不意味着 any/down |
| 同上，帧 10–16 | 按下角色持续执行，up/click 各一帧；透明右半只触发背景，角色点击不同时触发背景帽 |
| 同上，帧 18–20 | 合成单触点 touchstart/move/end：角色从 (0,0) 拖到 (10,5)，并有一次 click |
| 同上，帧 22–27 | 快速向右滑动，官方 `stage:swipe direction=4` 且 right 帽执行一次；慢拖不 swipe，长于 1 秒不 click |
| `input-transform.bcm`，8 帧 | 角色旋转 π/2、缩放 200%，(0,-40) 命中不透明侧，(0,40) 穿透到背景 |
| `input-ghost.bcm`，4 帧 | ghost=100 仍能命中不透明纹理并执行角色 down/up/click |

官方逐帧变量和角色快照归档在 `input[-transform/-ghost]-evidence.json`，绑定 BCM 和脚本的 SHA-256。`tests/input.rs` 对解释器与默认 JIT 配置逐帧比较（不是“本夹具已经进入 native 热区”的声明）；`tests/input-tools.test.mjs` 校验源字节和可选官方复验；`tests/stage-input.test.mjs` 覆盖浏览器边界、持续拖拽、CSS 缩放、速度、方向、多指不接管及失焦清理。

VM 将按键/实体状态合并到 scheduler tick 入口，held hat 单实例重触发，mouseup/key-up/click 为一帧脉冲。KN 持续键帽和角色按下已有独立官方运行证据，见 `input-kn-evidence.json`；`--screen` 在 KN 仍按全局舞台状态响应，不采用 K4 的背景目标规则。

Web 输入层修正了键码、点击时限、取消/捕获清理、K4 拖拽 delta 与边界、CSS swipe。KN swipe 使用官方第二层有符号比较：up `dy<-50 && dy<dx`，left `dx<-50 && dx<dy`，right `dx>50 && dx>dy`，down `dy>50 && dy>dx`，按此顺序独立触发；不同于 K4 单主轴方向。两者原纹理 alpha 命中不依赖角色整体透明度。

## 逐帧输入脚本

```json
{
  "schema": "nekoc-input-v1",
  "events": [
    {"frame": 2, "time_ms": 20, "type": "keydown", "key_code": 65},
    {"frame": 4, "time_ms": 60, "type": "keyup", "key_code": 65},
    {"frame": 6, "time_ms": 100, "type": "pointerdown", "x": -20, "y": 0},
    {"frame": 7, "time_ms": 120, "type": "pointerup", "x": -20, "y": 0}
  ]
}
```

- `frame` 从 1 起，事件在该次 update **之前**注入；同帧按数组顺序。frame 必须有序且不超出 `--frames`。
- `time_ms` 是事件时间，有限、非负、单调不减；仅用于手势/点击，不代替 VM 调度时间。
- 键码为 0–255 整数；不在官方白名单的键输入不触发积木。
- pointer 支持 `pointerdown/move/up/cancel`，`pointer_type` 为 `mouse`（默认）或 `touch`。坐标是舞台中心原点、x 右 y 上。当前脚本只支持单主指针。
- 离线 oracle 固定画布 1 CSS px/舞台单位；VM replay 同样按此比例判断 swipe。真实 web 播放器以实际 CSS 像素判断，不能将缩放后相同舞台位移直接当成同样手势。
- oracle 走原始 DOM → PIXI/Hammer → 官方 action，不直接调用 responder、不注入猜测命中 ID。触摸同时派发 TouchEvent 给 PIXI 和 PointerEvent 给 Hammer（该离线包过滤 touch pointer，防止重复）。
- 在页面初始化时安装 `Date` 代理，避免 Hammer/lodash 缓存原生 `Date.now`；**仅输入派发期间**使用事件时间，其余时候委托原生 Date。不与诊断 `--virtual-time` 混用。这属于回放插桩，不是官方天然固定时间行为。
- oracle 输出 `inputScript` 与 `inputObservations`（原生 swipe/drag_move），便于区分没有识别手势与识别后帽不运行。

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/k4-input-fixtures.mjs --record
node tools/compat/k4-oracle.mjs run --input tests/fixtures/kitten4/input.bcm --frames 38 --input-script tests/fixtures/kitten4/input-script.json --out dist/input-official.json
cargo run --bin k4-trace -- tests/fixtures/kitten4/input.bcm --frames 38 --input-script tests/fixtures/kitten4/input-script.json --costumes dist/input-costumes.json
$env:K4_INPUT_INTEGRATION='1'
node --test tests/input-tools.test.mjs
cargo test --test input
# KN 原创夹具：有 Edge 时显式选 channel
node tools/editor-compat.mjs tests/fixtures/input-kn.bcmkn --channel msedge
node tools/compat/kn-input-probe.mjs
```

`k4-trace --costumes` 现在也可不带 `--render`；格式同 [visual 工具](../tools/compat/README.md#固定帧画布像素对比) 的测量结果，含尺寸、centerPoint、mask_bytes。**命中透明像素时必须提供真实素材 mask**；缺省仍有矩形退化，不能把未解码素材的 CLI 轨迹当作像素一致证明。Rust 回归为原创 SVG 构造精确 mask；正式作品由浏览器测量。

## 未验证与风险

- K4 只覆盖上述离线包和自制最小夹具；不是全部语料交互穷举。
- KN 当前发行版细节与 K4 不同；静态源码核对不等价于运行差分，见 KN 专项记录。
- 真实手机、触控笔、独立多指持续按下、IME、浏览器 OS 自动重复、弹窗/输入框焦点、完整 DOM 冒泡顺序未验证。播放器为可用性在 blur/cancel 清理状态，不声称每个浏览器均等于官方。
- VM mask 现有最大 128×128，官方纹理也有自身降采样（KN 为 0.7）；小孔、边缘 round、非常大素材可能有差异，尚未修正为逐纹理相同采样器。旋转缩放实测选内部点，不能外推亚像素边缘。
- 特效变形不参与原纹理 hit，重叠角色/克隆完整 responder 排序与场景切换中途输入未做官方逐项实测。
- `k4-diff`/`k4-visual` 尚未增加输入脚本批处理参数；本次入口为 `k4-oracle` 与 `k4-trace`。
