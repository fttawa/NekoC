# KN microbit 剩余硬件：无连接取证，非实现声明

## 优先给实现方的结论

在全新 Edge 中加载官方 KN **0.27.4** 的 microbit lazy extension，保持真实硬件 Map 为空，
调用实际域函数。**剩余 catalog 中真正同步的只有以下 3 项**：

| 类型 | 实测返回 | value 输入面板顺序 | 字段 | 无连接域读取 |
| --- | --- | --- | --- | --- |
| `microbit_set_bpm` | 同步 undefined | `bpm` | 无 | 无 |
| `microbit_change_bpm` | 同步 undefined | `offset` | `change` | 无 |
| `microbit_get_volume` | 同步 undefined | 无 | 无 | 无 |

前两项可作为无连接 command 候选，必须保留子表达式求值；最后一项的面板 output 虽是
Number，实际 **undefined，不是 NaN/0/空串**，实现方须先确认自身值系统能忠实表示。
本轮不接线任何 Rust，不修改覆盖表，以上不是已经支持的声明。

7 个传感器返回 **Promise<number NaN>**；其余 18 个 catalog 命令返回
**Promise<undefined>**；3 个事件只有 action specs。缺少完整原生作品调度证据，
这 **28 项仍明确 unsupported**，不能因为最终值固定就折叠成同步 noop/常量。

## 逐项分类（53 个硬件缺失项中的全部 31 个 microbit 类型）

表中 `P(NaN)` / `P(undefined)` 表示真实 Promise；`—` 表示无 value 输入。
输入列来自官方面板 `args0`，是接线时应保留的插槽顺序，**不是本轮证明了原生子表达式执行顺序**。
每一行在 JSON 中有独立案例及源码锚点，并有独立 JS 测试。

| 类型（均以 `microbit_` 开头） | 无连接返回/分类 | value 输入顺序 | 字段 |
| --- | --- | --- | --- |
| `accelerometer` | P(NaN)，unsupported | — | key |
| `button_when` | 事件，unsupported | — | key |
| `change_bpm` | 同步 undefined，候选 | offset | change |
| `compass_heading` | P(NaN)，unsupported | — | — |
| `get_volume` | 同步 undefined，候选 | — | — |
| `led_clear` | P(undefined)，unsupported | — | — |
| `led_plot` | P(undefined)，unsupported | x, y | — |
| `led_plot_graph` | P(undefined)，unsupported | value, high | — |
| `led_show_custom` | P(undefined)，unsupported | — | value |
| `led_show_icon` | P(undefined)，unsupported | — | icon |
| `led_show_number` | P(undefined)，unsupported | num | — |
| `led_show_text` | P(undefined)，unsupported | text | — |
| `led_toggle` | P(undefined)，unsupported | x, y | — |
| `led_unplot` | P(undefined)，unsupported | x, y | — |
| `light_level` | P(NaN)，unsupported | — | — |
| `logo_when` | 事件，unsupported | — | value |
| `magnetometer` | P(NaN)，unsupported | — | key |
| `pause_by_beats` | P(undefined)，unsupported | beats | — |
| `pin_analog_write` | P(undefined)，unsupported | value | key |
| `pin_digital_write` | P(undefined)，unsupported | value | key |
| `pin_set_touch_mode` | P(undefined)，unsupported | — | key, mode |
| `pin_when` | 事件，unsupported | — | key, value |
| `play_melody` | P(undefined)，unsupported | — | melody, time |
| `play_tone_by_beats` | P(undefined)，unsupported | note, beats | — |
| `rotation` | P(NaN)，unsupported | — | rotation |
| `servo_set_angle_270` | P(undefined)，unsupported | angle | key |
| `set_bpm` | 同步 undefined，候选 | bpm | — |
| `set_volume` | P(undefined)，unsupported | volume | — |
| `sound_level` | P(NaN)，unsupported | — | — |
| `stop` | P(undefined)，unsupported | — | — |
| `temperature` | P(NaN)，unsupported | — | — |

当前官方面板还出现 catalog 未收录的 `microbit_servo_set_pulse`：输入 `pulse`，字段
`key`，P(undefined)，同样 unsupported。本轮额外核实域专有的
`microbit_pin_is_pressed`（同步 false，先读 key/value）与
`microbit_servo_set_angle_360`（P(undefined)）；二者不在当前面板/本地 catalog，
不能混入面板 allowlist。此前已有 7 个同步 reporter 的证据仍见 [kn-hardware.md](kn-hardware.md)，未改动。

## 抛错与调度边界

- 默认、非法字符串、空对象、所有静态下拉选项都调用实际域函数；另用 Proxy 观察
  参数 getter，用 null 和抛错 getter 区分同步 throw 与 Promise rejection。
- `pin_set_touch_mode` 在连接检查前读取 `key,mode`；`led_show_custom` 读取字段
  `value`；`accelerometer/magnetometer` 读取字段 `key`；`rotation` 读取字段
  `rotation`。null/抛错 getter **返回 rejected Promise，不同步 throw**。
- 其余剩余面板域函数在无连接时没有读取参数；null/抛错 getter 也不改变返回。
  非法数字因此不触发其连接后分支的数值校验/错误记录，但调用方仍必须求值 value 子积木。
- 仅域专有的 `pin_is_pressed` 的 null/抛错 getter 是 **同步 throw**，正常读
  `key,value` 后同步 false。这不构成支持该非面板类型的授权。
- 实测 Promise 的回调顺序为 `call → returned → fulfilled/rejected → queued microtask`，
  后一个 microtask 是在注册 `.then` 后才排队。此结果仅说明局部 JS 边界，不能外推
  编译器、作品 scheduler、线程交错或 native/JIT 的 await 调度等价。

## 命令副作用与事件可达性

236 次调用期间，前向观察（不阻断）真实 runtime `send_action`、错误管理器 `addError`：
**0 action、0 域错误，硬件 Map 始终为空**。连接 guard 与域函数未替换，没有调用任何
设备连接操作。源码定位表明 guard 失败后未进入设备方法/数值校验分支。

但不能称“全局无副作用”：原 guard 可按 runtimeId 去重弹出“硬件未连接” warning toast，
并更新私有去重状态。本轮未删除、替换或屏蔽该逻辑。上述 0 只针对 action/域错误/硬件 Map，
不是所有 UI、日志和私有状态的通用断言。

module 47252 的实际 `get_action_specs()` 返回：

- `microbit_button_when`：sub_type 过滤字段 key，value 为 none；
- `microbit_pin_when`：sub_type 过滤 key，value 过滤 value；
- `microbit_logo_when`：sub_type 为 none，value 过滤 value；
- responder 均标 async=false；这是 action responder 元数据，**不证明作品事件调度已实现**。

module 70324 的生产者链条：onConnect 安装按钮/UART通知，`handleNotification` 处理
按钮和引脚通知，`handleUARTMessage` 处理 logo/P0/P1/P2；`emitEvent` 最终 send_action。
`start` 用 isConnected 限制引脚通知启动。空 Map 下没有 core 实例/通知生产者，
这些自然设备事件没有可达来源；action spec 本身不发事件。
**`emitEvent` 自身没有连接 guard**，手工 send_action、伪造通知、直接调用 core 方法
可能绕过设备来源，均在本 profile 外。没有用“观察了一段静默”冒充绝对不可触发证明，
也没有执行原生事件作品来证明 scheduler。

## 证据、复现与限制

- [kn-hardware-remaining-evidence.json](kn-hardware-remaining-evidence.json)：31 项 catalog 分类、
  额外面板/域项、236 条带类型案例、51 个 UTF-8 原始字节锚点与 SHA-256。
- 锚点覆盖完整 module 20592/47252/70324/87282、38 个域注册段（包含 async 包装内部，
  避免只哈希多个函数共有的 apply 包装器）、连接 guard 与通知生产者。
- 官方原始 bundle 和函数全文只在忽略的 `dist/kn-hardware-remaining/`；跟踪 JSON 只有
  名称、面板参数、观测、hash/位置和原创结论，不复制官方内核实现。未使用 HateNeko。
- 仅局部实际调用及源码定位；连接设备、完整作品调度、子表达式执行、其他硬件不在证据范围。

```powershell
npm install --prefix dist/kn-hardware-remaining/deps playwright --no-audit --no-fund
node tools/compat/kn-hardware-remaining-probe.mjs --record
node --test tests/kn-hardware-remaining.test.mjs
```

可用 `NEKOC_NODE_MODULES` 指向现有 Playwright node_modules；无需修改 package.json。
无本地官方 bundle 时最后一项源码 hash 回归明确 skip，其余元数据/逐项语义回归仍执行。
