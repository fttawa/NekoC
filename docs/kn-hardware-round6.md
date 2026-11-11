# KN 第六轮：硬件同步无连接分支与非面板项复核

## 本轮结果

以 `8ba08e5` 的 300 项清单为基线，原 55 个缺失项由 53 个硬件类型、代码 API
`get_sprite_property`、默认麦克风音量 `get_voice_volume` 组成。本轮新增 **10 项部分语义**，
缺失降至 **45 项**；不认证任何项为完整语义支持。

| 新增类型 | 空硬件 Map 的真实同步结果 | 必须求值的 value 插槽 |
| --- | --- | --- |
| `microbit_get_volume` | undefined | 无 |
| `microbit_set_bpm` | undefined，命令直接继续 | bpm |
| `microbit_change_bpm` | undefined，命令直接继续 | offset |
| `catbit_button_is_pressed` | Boolean false | 无（key 是字段） |
| `wand_button_is_pressed` | Boolean false | 无（key 是字段） |
| `wand_coordinate` | Number NaN | 无（key 是字段） |
| `wand_rotation` | Number NaN | 无（key 是字段） |
| `get_robot_master_motor_power` | Number NaN | 无（motor 是字段） |
| `get_robot_master_infrared_sensor_distance` | Number NaN | 无（num 是字段） |
| `get_robot2_master_motor_power` | Number NaN | 无 |

## 官方证据

- 官方 KN **0.27.4**，真实空 hardware Map、未连接任何设备；独立探针只暴露 webpack loader，
  不替换域函数、连接 guard 或 hardware Map。
- microbit 的 236 次局部调用、51 个原字节锚点/hash、全部剩余 31 项的逐项分类：
  [kn-hardware-remaining.md](kn-hardware-remaining.md)、
  [JSON](kn-hardware-remaining-evidence.json)。
- 其他 22 项硬件的 167 次调用、76 个锚点/hash及非面板项转换/构造：
  [kn-other-hardware.md](kn-other-hardware.md)、[JSON](kn-other-hardware-evidence.json)。
- 主要硬件包 `entry_hardware.481194e4.chunk.js` SHA-256：
  `7259df6bc25c81905028a569ca5e99fba5091ca4fbddd29c2ec92ac15c75842d`。
  详细 URL、UTF-8 零基字节位置和切片散列在上述 JSON，函数体仅在忽略的 `dist/`。
- 本轮没有使用或移植 HateNeko 实现。

## 实现边界

`src/engine/kn_hardware.rs` 仍是精确 allowlist，不使用前缀 fallback。8 个新 reporter
全部只有字段，没有 value socket；编译为带类型常量，`undefined` 复用已有 `Cell::Undefined`，
不按面板声明的 Number 类型强制转换。KN 模式同时接通 typed value 与 numeric expression 路径。

2 个 BPM 命令复用 `Op::Execute`，求值单个官方 value socket 恰好一次，保留错误与后续语句
边界；不会创建状态、改变音量、播放声音或假装更新设备 BPM。菜单字段非法/空值在官方空 Map
分支同样早退，不引入连接后才有的校验。

**未实现**官方未连接 warning toast/去重状态，以及任何真实设备后端。catbit/wand 域函数在
guard 前读取 key，但原生 block fields 是 JSON 普通值而不是 JS getter；直接域函数 null
参数对象或抛错 getter 的异常证据不能当成原生 JSON 输入能力。本实现不提供通用 JS 参数对象。

## 为什么仍有 43 个硬件缺失项

逐项名单与输入/字段均在上述证据文档：7 个 microbit reporter、30 个 command 即使没有设备
也返回 Promise；另 6 个事件帽只取得 action/dynamic responder 与部分生产者源码证据。
未验证原生作品的 await 相位、线程交错及真实派发，所以保持编译拒绝，不把 Promise 的兑现值
折叠成同步常量/no-op，也不把事件帽当成 false reporter 或静默跳过 body。

microbit 空 Map 下自然设备通知没有 core 生产者，但手工 action/通知注入可能绕过连接检查，
因此只标“此 profile 没有自然设备事件来源”，**不认证全局不可达、已下线或非官方**。

## 41 个已注册但面板未列出类型

该集合在本轮开始时均已有执行/元数据路径，不是 41 个新缺失。官方代码视图在无错误转换中
产生 36 项，逐项样本在其他硬件 JSON；其余 `_return_statement`、`calculate`、`get_timer`、
`reset_timer`、`start_on_click` 本次未由作者代码生成，但仍注册且构造成功，实际代码生成入口
**未验证**，不能标成不可达。

`get_sprite_property` 同名积木没有 definition、构造失败、无 domain index；有效 x/color API
分别降为 `coordinate_of_sprite`/`effect_of_sprite`。size 错误输出残留同名 XML 不构成注册证据。
因此保留该 API 清单缺失，不虚构 VM 入口。默认 `get_voice_volume` 不属本轮两类，继续缺失。

## 回归与限制

- `tests/kn_hardware_remaining.rs`：8 个新 reporter、2 个同步命令逐项运行；检查原始菜单观测、
  invalid/空字段、严格类型比较、70 层表达式、numeric 输入、600 次 warp/JIT 开关路径、BPM
  输入副作用/求值次数、缺失/未知输入、运行错误，以及其余 43 个类型逐项拒绝。
- `tests/kn-hardware-remaining.test.mjs`、`tests/kn-other-hardware.test.mjs`：逐项官方调用分类、
  Promise/异常相位、事件规格、源码位置与原始包散列；没有本地包时 hash 检查明确 skip。
- `tests/kn-catalog-status.test.mjs`：10 项仅部分语义、43 项保留缺失、41 项有路径且有既有
  Rust 测试引用；引用本身不等于完整运行认证。
- 两种 JIT 配置不声称所有表达式都生成 native 代码。官方证据仅局部调用/源码与构造/转换，
  不是完整原生工程行为差分；所有设备通信、连接后分支与跨版本兼容性仍**未验证**。

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --test kn_hardware --test kn_hardware_remaining
node --test tests/kn-hardware-remaining.test.mjs tests/kn-other-hardware.test.mjs
node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md
```
