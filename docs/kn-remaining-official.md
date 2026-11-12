# KN 0.27.4：本轮 45 个缺失名称的官方无硬件实测

## 给实现方的结论：reporter 也必须 await

**不能把已兑现的硬件 Promise reporter 当成当前 VM 步的同步 NaN；不能只让命令 yield。**
官方 KN 0.27.4 的原生作品播放已逐项验证 37 个 Promise 域（30 command、7 reporter）：

- 独立启动线程的域调用全发生在 **frame 0**；所有兑现回调均在 **update 外、frame 1**。
- 各线程的 `after=1` 均在 **frame 1**，而不是 frame 0。7 个 reporter 的赋值也在 frame 1。
- 同步对照 `microbit_set_bpm` 的后续赋值在 **frame 0**。
- 嵌套 `microbit_temperature + microbit_light_level`：第一个 reporter 在 frame 0 调用，
  第二个在 frame 1 调用，父赋值及后续语句在 **frame 2**。因此“同步求完整表达式，然后语句末尾
  yield 一次”也不等价；每个异步子表达式都需要保留恢复点。
- 6 个真实事件根已放入同一个原生作品；无设备、无合成通知的 1600ms 观察中，事件体全部不执行。
- 显式 `recordEnable=false` 的 `get_voice_volume` 原生 reporter 同样 frame 0 调用，
  frame 1 赋 NaN 并执行后续。默认状态不能以此代替，见下文。

这些 frame 是官方 `get_elapsed_frames()` 计数，不是墙钟毫秒/屏幕刷新承诺；机器节流可能改变
真实间隔。测试不固定不同启动线程的绝对创建顺序，只固定每条线程的 await 边界。

### 最小调度模型依据

源码锚点及 SHA-256 位于 [kn-remaining-official-evidence.json](kn-remaining-official-evidence.json)
的 `sourceLocations`，源码全文只在 `dist/kn-remaining-official/`：

1. `compile_domain_functions` 对所有域调用生成前置语句、临时返回槽、
   `create_after_potential_blocker_yield_point`；reporter 也走这条路径。
2. `OptiRunner.step_call_domain_function` 用 `Promise.resolve(result) === result` 判断 Promise，
   **不检查是否已兑现**。发现 Promise 就 `get_thread_lock(entity, interpreter)`；then 回调写入
   暂存槽并调用 lock.stop。rejection 走 `report_error_and_stop`，不是恢复为 undefined。
3. `add_task(blocking=true)` 立即置当前解释器 blocked；after-blocker 保存 PC 并返回。
4. `RuntimeManager.step_code` 继续其他未阻塞解释器；`update` 是同步函数，内部无 await/
   microtask drain。当前 update 的 frames++ 后 JS 才执行 Promise 回调。
5. lock.stop 先排队任务销毁；下一 update 的 dispose 阶段移除 blocker，然后继续线程。

对本轮空 Map、立即兑现的域，保守最小模型是：**求值当前子表达式 → 暂存最终 typed value →
挂起当前线程至下一 update → 其他线程继续 → 下一 update 恢复该子表达式后的执行**。
多次异步子表达式必须多次挂起；不能重复执行前面有副作用的子表达式。这里未认证任意 Promise、
warp、循环、过程返回、跨帧 stop/restart 的完整模型。

## 逐项 45 名称

名称冻结自本任务开始时 `docs/kn-block-coverage.md` 的 45 个“缺失”行；覆盖表后续更新不减少探针目标。
`P(U)` = Promise<undefined>；`P(NaN)` = Promise<number NaN>；不是同步返回。
输入列是官方 `args0` value 插槽顺序，不能据此省略求值；本轮原生值输入使用数字 1。
所有标“0→1”的项均有独立原生调用、typed 返回/后续赋值观测。

| # | 名称 | 无连接实测 | value 输入 | 字段 | 原生 await / 事件 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `catbit_button_when` | 事件规格存在 | — | type,key | 事件体 0 次 |
| 2 | `catbit_usb_button_when` | 事件规格存在 | — | type,key | 事件体 0 次 |
| 3 | `change_robot2_master_motor_power` | P(U) | n | method | 0→1 |
| 4 | `change_robot_master_motor_power` | P(U) | n | motor,method | 0→1 |
| 5 | `get_sprite_property` | 代码转换 API，非同名域/积木 | — | sprite,attribute 为 API 参数 | 见转换表，不伪造执行入口 |
| 6 | `get_voice_volume` | 未答弹窗 P(pending ≥3000ms)；弹窗拒绝/浏览器 NotAllowedError P(0)；record-disabled P(NaN) | — | — | disabled 0→1；拒绝分支局部实测 |
| 7 | `microbit_accelerometer` | P(NaN) | — | key | 0→1 |
| 8 | `microbit_button_when` | 事件规格存在 | — | key | 事件体 0 次 |
| 9 | `microbit_compass_heading` | P(NaN) | — | — | 0→1 |
| 10 | `microbit_led_clear` | P(U) | — | — | 0→1 |
| 11 | `microbit_led_plot` | P(U) | x,y | — | 0→1 |
| 12 | `microbit_led_plot_graph` | P(U) | value,high | — | 0→1 |
| 13 | `microbit_led_show_custom` | P(U) | — | value | 0→1 |
| 14 | `microbit_led_show_icon` | P(U) | — | icon | 0→1 |
| 15 | `microbit_led_show_number` | P(U) | num | — | 0→1 |
| 16 | `microbit_led_show_text` | P(U) | text | — | 0→1 |
| 17 | `microbit_led_toggle` | P(U) | x,y | — | 0→1 |
| 18 | `microbit_led_unplot` | P(U) | x,y | — | 0→1 |
| 19 | `microbit_light_level` | P(NaN) | — | — | 0→1 |
| 20 | `microbit_logo_when` | 事件规格存在 | — | value | 事件体 0 次 |
| 21 | `microbit_magnetometer` | P(NaN) | — | key | 0→1 |
| 22 | `microbit_pause_by_beats` | P(U) | beats | — | 0→1 |
| 23 | `microbit_pin_analog_write` | P(U) | value | key | 0→1 |
| 24 | `microbit_pin_digital_write` | P(U) | value | key | 0→1 |
| 25 | `microbit_pin_set_touch_mode` | P(U) | — | key,mode | 0→1 |
| 26 | `microbit_pin_when` | 事件规格存在 | — | key,value | 事件体 0 次 |
| 27 | `microbit_play_melody` | P(U) | — | melody,time | 0→1 |
| 28 | `microbit_play_tone_by_beats` | P(U) | note,beats | — | 0→1 |
| 29 | `microbit_rotation` | P(NaN) | — | rotation | 0→1 |
| 30 | `microbit_servo_set_angle_270` | P(U) | angle | key | 0→1 |
| 31 | `microbit_set_volume` | P(U) | volume | — | 0→1 |
| 32 | `microbit_sound_level` | P(NaN) | — | — | 0→1 |
| 33 | `microbit_stop` | P(U) | — | — | 0→1 |
| 34 | `microbit_temperature` | P(NaN) | — | — | 0→1 |
| 35 | `set_robot2_master_motor_power_rotation` | P(U) | power | direction | 0→1 |
| 36 | `set_robot2_master_motor_power_rotation_duration` | P(U) | power,times | direction | 0→1 |
| 37 | `set_robot_master_light_color` | P(U) | — | light,color | 0→1 |
| 38 | `set_robot_master_light_color_duration` | P(U) | times | light,color | 0→1 |
| 39 | `set_robot_master_motor_power_rotation` | P(U) | power | motor,direction | 0→1 |
| 40 | `set_robot_master_motor_power_rotation_duration` | P(U) | power,times | motor,direction | 0→1 |
| 41 | `stop_robot2_master_motor` | P(U) | — | — | 0→1 |
| 42 | `stop_robot_master_light` | P(U) | — | light | 0→1 |
| 43 | `stop_robot_master_motor` | P(U) | — | motor | 0→1 |
| 44 | `wand_direction_when` | 事件规格存在 | — | key | 事件体 0 次 |
| 45 | `wand_reset_position` | P(U) | — | — | 0→1 |

## 参数访问、错误及副作用

302 条局部案例包括默认参数、非法字符串、空对象、null、访问 Proxy、抛错 getter、静态菜单选项；
动态图标菜单未穷举，原生仅一套字段/数字输入。硬件直接调用没有产生 runtime action 或域错误，
Map 每次调用后均为空。不代表没有 UI 私有状态副作用：原 guard 仍可弹一次未连接 toast 并更新去重状态。

仅下列五项在连接检查前读取字段：

| 名称 | 正常域 getter 顺序 | null / 抛错 getter |
| --- | --- | --- |
| `microbit_accelerometer` | key | Promise rejection |
| `microbit_magnetometer` | key | Promise rejection |
| `microbit_rotation` | rotation | Promise rejection |
| `microbit_led_show_custom` | value | Promise rejection |
| `microbit_pin_set_touch_mode` | key,mode | Promise rejection |

其余 32 个硬件 Promise 域空 Map 时不读 args；null 和抛错 getter 也正常兑现。
这只是**域内部**属性读取；父执行管线仍求值 value 子积木，不能据此抹去子表达式副作用。
未把 getter rejection 原生化；scheduler rejection 停止整作品的结论来自源码，不是本轮原生异常作品。

## `get_voice_volume`：不能用“无设备=0/NaN”替代

本轮匿名、无权限授予的 desktop Edge（mobile=false、pcClient=false、specialPlayer=false）：

1. 默认 `recordEnable=true`：实际 registry 调用返回 Promise，3000ms 观察仍 pending。
   `startListening` 源码先 await 官方 permission modal，再申请 getUserMedia；因此不能把这个 pending
   称为已经测到浏览器权限拒绝或实际无设备错误。
2. 显式 `recordEnable=false`：官方分支等待 stopListening，最终 **numeric NaN**；有一次麦克风占用
   toast 的去重逻辑。此开关是明确选择的应用状态，不是假装真实设备/权限结果。原生赋值也验证过。
3. 随后点击官方“暂不授权”：原先 pending 的实际 Promise **兑现 numeric 0**，permission=false、
   volume=0、isRunning=false。拒绝官方弹窗不是 Promise rejection。
4. 同意官方弹窗，但通过 CDP `Browser.setPermission(microphone, denied)` 选择真实浏览器拒绝策略：
   前向观察到原始 `navigator.mediaDevices.getUserMedia({audio:true})` **真正拒绝 NotAllowedError /
   Permission denied**。未替换其结果，也未提供假设备。官方内部 catch 后域 Promise **兑现 numeric 0**，
   permission=false、volume=0、isRunning=true，错误管理器 addError **1 次**。这才是本轮明确测到的
   浏览器失败分支，不能把原始 getUserMedia rejection 误写成域 Promise rejection。
5. 普通 web 分支等待 startListening，再读 getVolume(true,false)，权限明确 false 时 addError，
   最后过归一化。源码中 web 音量初始为 0，catch 将 permission=false；本轮已测 NotAllowedError，
   **实际 NotFoundError/no-device 仍未验证**。禁止把宿主“无样本/设备不存在”统一映射 NaN 并声称官方兼容。
6. special-player 分支读宿主 volume，缺对象/假值按 0；未在该平台实测。

已实际调用官方归一化函数 `40989.K9`：普通 desktop web 为
`round(clamp(raw / 70 * 100, 0, 100))`，前置检查仅允许 number 且非 NaN；
`raw=14/35/49/70 → 20/50/70/100`；`NaN / '35' / null / undefined → 0`；
`+Infinity → 100`，`-Infinity → 0`。源码其他分支：移动 iOS `(raw-40)/55*100`，
移动非 iOS `raw/85*100`，PC 客户端 `raw/30*100`，均 clamp+round；这些平台公式仅源码定位，未换平台执行。
`record-disabled` 的 NaN 在归一化之前直接返回，所以**不被变成 0**。

## `get_sprite_property`：API 转换，不是注册积木

官方声明为 Number 函数，参数 sprite/attribute；同名 block definition 与域索引均不存在。
真正执行的是代码转换后的类型。官方 `_j` 的本轮调用结果：

| API attribute | 生成积木/字段 | 转换 |
| --- | --- | --- |
| x,y | `coordinate_of_sprite` / coordinate=x,y | 无错误 |
| scale,width,height,direction | `appearance_of_sprite` / appearance=同名 | 无错误 |
| style_index | `style_of_sprite` | 无错误 |
| color,opacity,brightness,pixelate,ripple,distortion,grayscale | `effect_of_sprite` / effect=0…6 | 无错误 |
| distance | `distance_to` | 无错误 |
| size,style,visible,alpha,camp,not-a-property | 保留失败中间节点，报告插件“不支持属性” | **有错误，不可运行成功声明** |

不能因为出错 XML 中保留了 `get_sprite_property` 字符串就认定官方注册了同名积木。
本轮验证代码转换，未给该不存在的域制造返回值；转换后各属性的全部原生运行值不在本轮认证范围。

## 事件语义和未验证范围

6 个 action spec 的 `responder.async=false` 不是“事件天然不会触发”的证明：

- microbit button：sub_type=key、value=none；pin：sub_type=key、value=value；logo：sub_type=none、value=value。
- catbit / catbitUsb：dynamic responder，sub_type=key、value=type，默认空串、one_frame 状态迁移。
- wand：action responder，sub_type=none、value=key。

原生作品没有安装 hardware core、Map 空，也未调用 init/connect。只用实际官方域注册函数/事件工厂和
实际 block config 注册扩展，保留原 guard；不是默认已安装编辑器、不是已创建但断连的 core profile。
未发合成 action。观测到的事件静默只覆盖这个 profile 和窗口，不声称手工 send_action、伪造通知、
直接 core.emitEvent、真实设备连接时也全局不可达。

## 复现和证据

```powershell
# 已有 Playwright 时可不安装；或设置 NEKOC_NODE_MODULES 指向它的 node_modules。
npm install --prefix dist/kn-remaining-official/deps playwright --no-audit --no-fund
$env:NEKOC_NODE_MODULES = (Resolve-Path dist/kn-remaining-official/deps/node_modules)
node tools/compat/kn-remaining-probe.mjs --record
node --test tests/kn-remaining-official.test.mjs
```

- 跟踪的原创探针：[kn-remaining-probe.mjs](../tools/compat/kn-remaining-probe.mjs)。
- 跟踪证据：[kn-remaining-official-evidence.json](kn-remaining-official-evidence.json)：逐项 `blocks`、
  302 案例、原生域/赋值/帧观测、21 属性转换、音量归一化及源码 hash/位置；不含源码全文。
- 忽略的本地取证：`dist/kn-remaining-official/report.json`、各官方 bundle、`scheduler.bcmkn`。
- 原生夹具的扩展感知编辑器检查在同一探针 `nativeSetup.editorCompat`：292/292 blocks、
  validateBcm=true、字段/输入/next 逐项检查无问题、无 pageerror，之后才播放。
- 通用 `node tools/editor-compat.mjs dist/kn-remaining-official/scheduler.bcmkn` **不能加载 lazy 硬件扩展**，
  本轮试跑报 workspace 导入错误；不伪称该命令通过，也未修改通用工具。独立探针用官方扩展注册后实施相同
  类型/字段/连线检查补足这项限制。
- 官方主 bundle SHA-256：`58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165`；
  scheduler bundle：`462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。

本取证工具不修改 engine、coverage 工具或覆盖表；运行时实现与最终 Cargo 门禁另见
[kn-remaining.md](kn-remaining.md) 及未提交的根目录 `OC-REPORT.md`。
未复制任何第三方内核/作品；未使用 HateNeko 作为官方证据。
