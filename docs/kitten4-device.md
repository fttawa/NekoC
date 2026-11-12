# Kitten 4 设备输入取证与回归

## 结论和官方身份范围

本文调查十项设备相关积木，以**指定离线 `.orig` 发布物**的原生调度器、动作队列和域函数为参考，不把它泛称为“当前编辑器”或所有 K4 的行为。

只读参考目录为 `E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app`。实际 oracle 加载的主包为：

* 路径：`src/player/build/player_v2.2d180c468559fbd29528.js.orig`
* SHA-256：`0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160`

身份限定遵循 [指定在线播放页与离线内核取证](compatibility/k4-online-vs-offline.md)：指定在线主包 SHA-256 为 `1de76dd2f8462c6ed28ac31924f597960ba9a5fcd8a68f355de4df970fcf41cd`，移除离线唯一 DI 暴露插入后整个主包与其逐字节相同；runtime 另有加载路径及检查入口差异。这证明的是**这两个指定发布物的核心实现一致**，不是所有在线 K4、当前编辑器、未加载 lazy chunks 或真实设备环境相同。设备用例本身在离线 oracle 上取证，未逐例在线复测。

主包 build 标识不是语义版本。其 `@crc/stage=0.5.6`、`@crc/default-function=0.5.11`；`@crc/heart` 实际版本未验证。不能用 Electron 壳版本、作品版本或文件名代替 hash。优化过的同名非 `.orig` 文件不属于此基线，oracle 拒绝回退。

仓库不保存官方源码。`dist/k4device/source.json` 仅保存路径、hash、关键词位置；`dist/k4device/*-official.json` 保存原生执行的观察结果。

## 输入和输出契约

`nekoc-input-v1` 的事件直接使用 `type` 判别字段；`frame` 与 `time_ms` 在事件外层，不嵌套或二次 flatten：

| type | 数据 |
| --- | --- |
| `device_motion` | `x,y,z` |
| `device_orientation` | `beta,gamma,portrait` |
| `device_event` | `action,device?,value?`；后两项省略时使用 serde 默认值 |
| `mobile_button` | `device,event,button` |

```json
{"schema":"nekoc-input-v1","events":[
  {"frame":2,"time_ms":20,"type":"device_motion","x":1,"y":2,"z":3},
  {"frame":3,"time_ms":40,"type":"device_event","action":"on_shake"},
  {"frame":4,"time_ms":60,"type":"mobile_button","device":"mobile_1","event":"click","button":"A"}
]}
```

引擎 `k4_device_motion` **仅存原始 xyz**，不把 `time_ms` 存进 motion sample，也不据此分类 shake/tilt。外层时间仅作为输入回放元数据；浏览器传感器事件携带的时间不等于引擎 sample 新增了时间字段。

官方取证适配器对前两类分发原生 DOM `DeviceMotionEvent` / `DeviceOrientationEvent`；显式设备动作走原生 `RuntimeManager.send_action`，不直接调用 trigger、不替换积木实现。Mobile slide/slope 的参数为 `{device,type}`。注册表的 `filter_arg_names.sub_type="mobile"` 是**积木字段名**，不是必须注入的 action.sub_type 常量。Mobile button 的原生 action state 是含 `device/mobile_btn_event_type/mobile_type` 的 JSON 字符串。

引擎震动请求由 `Frame.k4_media_output` 和 trace snapshot 导出，形如 `{"kind":"vibrate","pattern_ms":[123]}`。官方 `navigator.vibrate` spy 只观察调用参数，不证明硬件震动成功。比较时仅把官方标量转成单项数组；不更改数值、时序、顺序或负数。

## 十项源码锚点

以下位置均为上述 `.orig` 的第1行、从零开始的 UTF-16 code unit 偏移，**不是 UTF-8 字节偏移**。完整位置表可由 `k4-device-source.mjs` 重新生成。

| 积木 | 实现／注册偏移 |
| --- | --- |
| `on_mobile_click_btn` | 634663、666318 |
| `on_mobile_shake` | 653189 |
| `on_mobile_slide` | 652481 |
| `on_mobile_slope` | 652835 |
| `on_shake` | 582052、667139 |
| `on_tilt` | 582087、667280 |
| `set_gravity_by_orientation` | 628042 |
| `shock_duration` | 582322 |
| `shock_for_n_times` | 582121 |
| `self_shake` | 588138 |

实现事实：

* `on_mobile_click_btn` 的 action type 有状态，默认空字符串，每帧自动清空。积木通过 JSON 状态条件匹配，带结束后重启元数据；设备及 `click/keydown/keyup` 精确匹配，按钮大小写不敏感。
* `on_mobile_slide/on_mobile_slope` 是动态 responder，精确比较 `parameters.device/type` 与积木字段。`on_mobile_shake` 动态 responder 只比较 device。
* `on_shake` 是 action responder；`on_tilt` 是带方向 value filter 的 action responder。其域函数返回 true，未发现 raw sensor 转换实现。
* `shock_duration` 传递 `1000*duration`；`shock_for_n_times` 在整数循环索引 `< times` 时追加一对 `100,100`，故正小数次数向上覆盖循环。两者调用浏览器后立即继续，不等待结束。
* `self_shake` 忽略非数字、NaN、非正数。正时间建立 `1000*time` ms 的 blocking task，位移依次 x+5、y+5、x−5、y−5。初始进度阈值为 `.05/time`，每次增加 `.04/time`，比较为严格 `progress > threshold`；结束按当前相位恢复净位移。没有把该数值类型检查误称为 finite 检查。
* `set_gravity_by_orientation` 对有限数值先清零所有世界重力，再移除旧监听；value 限制在 ±10000。Portrait 使用 `(gamma,-beta)`，landscape 使用 `(-beta,-gamma)`，乘 `value*.05*10`。仅当 `beta || gamma` 为真才更新；`(0,0)` **保留旧重力**。Portrait 标志在模块加载时缓存，非每事件重算。此积木直接注册重力监听；UI 的首次点击监听另负责 reporter 状态与权限流程。

RuntimeManager 的动作入队实现位于 `action_queue.push` 偏移 1175538 附近；其 action/dynamic responder 的 active-instance 门控解释了重复和 busy 抑制。这不是 raw sensor debounce。

## 官方合成输入证据

所有输入均为原创夹具，固定60 Hz诊断 update；启动更新计第1帧，不通过 sleep 模拟帧。已有官方证据的全部 errors/pageErrors 为空。

| case | 已观察结果 |
| --- | --- |
| `raw` | 两个 motion 样本 `(0,0,9.8)`、`(1000,-1000,0)` 及 orientation `(80,80)` 均未触发六类传感器／控制器帽子 |
| `actions` | 连续帧 shake 触发两次；设备／方向匹配；小写 a 匹配 A；click/down/up 区分；UP 不匹配 slide up；未知设备不匹配 |
| `duplicate` | 同帧两个 shake 只启动一次；两个相同 mobile shake 也只启动一次 |
| `mixed` | 动态 responder 只按 id 决定是否评估，trigger 却收到**整帧队列**。Slide/slope 可跨类型匹配，shake 可匹配同帧另一 mobile action 的 device；同帧两个 button state 只保留最后一个 |
| `busy` | listener 等待 `.05秒` 时不重入；连续9帧输入产生两个完成实例，第二次在第12帧完成 |
| `gravity` | value=2，横屏 `(10,20)→(-10,-20)`；`(0,0)` 无调用；`(-10,0)→(10,0)`；`(0,-20)→(0,20)` |
| `gravity-portrait` | value=2，竖屏 `(10,20)→(20,-10)`；`(0,0)` 无调用；`(-10,0)→(0,10)`；`(0,-20)→(-20,0)` |
| `vibration` | `.123秒→123`、`2.5次→[100,100]×3`、`−1次→[]`、`−.5秒→−500`；四次请求及后继 phase=2 全在第1帧 |
| `self-shake` | `.14秒`、Clock origin=0：第5帧 x+5、第7帧 y+5、第9帧 x−5、第10帧恢复、第11帧后继执行 |
| `self-shake-offset` | origin=1024：浮点严格比较使首次 x+5 在第4帧；其余采样和第11帧后继不变 |

### NekoC 对照，不隐藏负例

`tools/compat/k4-device-compare.mjs` 只读上述官方归档，直接执行现有 `target/debug/k4-trace.exe`，**不构建 Rust、不启动官方页面、不覆盖官方证据**。它检查所有帧、全部变量及 actor 字段，ID 集合和类型也必须相同；数值绝对容差固定 `1e-6`，不归一化角度、不按名字匹配、不放宽物理容差。

本次运行的二进制 SHA-256 为 `eb985e027ca7ab8bca79e03df7aa0b4ae3fbf0d8eaa5712e826e21546afdae6b`：

* 9 项全帧一致：raw、actions、duplicate、mixed、gravity、gravity-portrait、vibration、self-shake、self-shake-offset。
* `busy` 第12帧仍有差异：`shakeDone/mobileDone` 官方均为2、NekoC均为1；其余帧无差异。不能用最终帧之外的推测掩盖该等待时序差异。
* 两个 gravity case 的变量、重力换算及归档中的 actor 轨迹均逐帧一致；这只证明本夹具的输入与状态对照，不把它外推为 Rapier 与官方物理求解器的普遍等价。
* trace 不导出 NekoC 内部重力调用，因此“内部 gravityCalls 一致”仍未验证；官方调用值与 actor 轨迹分开保留，不能用调用映射正确代替物理轨迹一致。

比较器出现任意差异、物理负例或运行错误均返回非零；二进制缺 flag 记 `unverified`，不会触发 Cargo 或伪造通过。结果随二进制更新应重新运行，以上是指定 hash 的记录。

## 离线回归档案与复现

`docs/kitten4-device-evidence.json` 是由已有 dist 官方证据派生的精简档案，只含来源 hash、原创夹具 hash、输入 script、Clock origin、官方逐帧 variables/actors/震动输出和重力调用；不含官方源码或编译 AST。标量震动仅归一化为单项数组。它不保存 NekoC 的预期轨迹，不把物理负例改写成通过基准。

```powershell
# 默认仅比较现有二进制，并从已有官方归档生成离线回归 JSON。
node tools/compat/k4-device-compare.mjs
# 仅生成回归档案，不运行二进制。
node tools/compat/k4-device-compare.mjs --archive-only
# 可指定其他现有二进制，不执行构建。
node tools/compat/k4-device-compare.mjs --exe target/debug/k4-trace.exe
node --test tests/k4-device.test.mjs
```

两个 self-shake case 分别传 `--shake-clock-origin-ms 0` 和 `1024`。每项输入写入 `dist/k4device/<case>-compare-input.json`，NekoC trace 写入 `<case>-nekoc.json`，汇总写入 `comparison.json`，不会覆盖 `*-official.json` 或 `evidence.json`。

仅在确有必要重新取官方证据时才运行：

```powershell
$env:K4_PLAYER_DIR='E:/nekoc-wt/_ref/k4player/Kitten4播放器/resources/app'
node tools/compat/k4-device-source.mjs
node tools/compat/k4-device-evidence.mjs
```

默认测试不需官方安装或浏览器；`K4_DEVICE_INTEGRATION=1` 检查只读源码锚点，`K4_DEVICE_REPLAY=1` 会重新运行官方证据并覆盖 dist，故不在日常比较中开启。

## 未验证边界

检查的 JavaScript 中不存在 `devicemotion`、`DeviceMotion`、`accelerationIncludingGravity`，因此不能声称已获取 raw motion→shake/tilt 的阈值、加速度范数、去抖时间或采样时序。显式 action 输入是可信边界，不是缺失算法的替身。真实硬件、权限弹窗、手机控制器传输及其分类逻辑未验证。

当前证据是匿名、禁外网写入／WebSocket、受控 Clock/rAF 的结果；60 Hz 是诊断输入条件，不是浏览器真实刷新率保证。JSON 序列化对负零和非有限数的限制、未来 CDN 更新、未加载模块等边界仍遵循在线／离线身份文档。不得把本次有限样本外推为完整设备或物理兼容。

当前 NekoC 对照结果：raw、actions、duplicate、mixed、两个 gravity case、
vibration、两个 self-shake origin 逐帧一致；busy 夹具在第 12 帧的
`shakeDone/mobileDone` 比官方少 1（官方为 2，NekoC 为 1）。物理求解器的
跨内核普遍等价仍未宣称；busy 差异保留为 `partial`，没有放宽比较容差，也没有
用“设备输入已接入”掩盖等待调度差异。
