# KN 第四轮：microbit 无连接 profile

## 官方证据与范围

官方 KN **0.27.4**，全新匿名 Edge、硬件 Map 为空，没有尝试连接设备。
`tools/compat/kn-hardware-probe.mjs` 加载实际 lazy 扩展 module 83939、面板定义
module 66111、真实域函数工厂 module 20592。未替换硬件 Map、连接 helper 或域函数。
原始包及完整报告只在忽略目录 `dist/kn-hardware/`；元数据、源码锚点/hash和37条
带类型观测保存在 [kn-hardware-evidence.json](kn-hardware-evidence.json)。本轮未参考 HateNeko。

| 积木 | 官方真实无连接返回 | 必需 value 插槽 |
| --- | --- | --- |
| `microbit_button_is_pressed` | Boolean false | 无，key 是字段 |
| `microbit_logo_is_pressed` | Boolean false | 无 |
| `microbit_is_gesture` | Boolean false | 无，gesture 是字段 |
| `microbit_led_is_plot` | Boolean false | x、y |
| `microbit_pin_digital_read` | Number NaN | 无，key 是字段 |
| `microbit_pin_analog_read` | Number NaN | 无，key 是字段 |
| 已有 `microbit_math_map` | Number NaN | value、fromStart、fromEnd、toStart、toEnd |

37次局部调用均同步、非Promise、无page error，覆盖默认/非法/空参数、按钮与引脚全部
静态下拉值。gesture为自定义字段，没有静态下拉列表，本轮只测默认/非法/空值。
LED和map域函数在读取参数前即返回，**不等于允许省略子积木求值**。

主要行为锚点在 `entry_hardware.481194e4.chunk.js` 原始UTF-8字节
196159（LED）、196747（button）、197825/198674（digital/analog）、
199253（logo）、204688（gesture）、205162（map）；完整包SHA-256
`7259df6bc25c81905028a569ca5e99fba5091ca4fbddd29c2ec92ac15c75842d`。

## 实现与回归

- `src/engine/kn_hardware.rs` 是精确allowlist，不使用前缀批量fallback。无输入项输出
  带类型常量；LED使用专用节点先依次求值x/y各一次，再返回Boolean false。
- `src/engine.rs` 仅添加KN模式分派、子树遍历；`src/engine/value.rs` 与 `jit.rs`
  添加LED节点及保守解释回退。已有map五输入路径不变。
- `tests/kn_hardware.rs` 核验allowlist、证据一致性、boolean/NaN类型、字段选项、80轮
  两种JIT配置、LED子输入顺序/次数和缺失/未知输入错误。
  另有70层深表达式与数字输入的类型回归，避免只覆盖顶层console_log。
- `tests/kn-hardware.test.mjs` 核验37条观测及7个函数锚点的原始包散列。
- 本轮新增 **6项** catalog路径；map为已有项，不重复计算。

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/compat/kn-hardware-probe.mjs --record
cargo test --test kn_hardware
node --test tests/kn-hardware.test.mjs
```

## 未实现、未验证

只覆盖空硬件Map，**不是设备模拟器**，真实连接后的传感器/LED/引脚语义未实现。
温度/光照/声音/加速度/磁场/旋转/罗盘等官方为异步函数，本轮不抹掉其调度。
`microbit_get_volume` 的无连接结果是undefined而非numeric NaN，未接线。
`microbit_pin_is_pressed`虽有域函数，却不在本次当前面板，未接线。
命令、事件、catbit及robot仍拒绝编译。证据仅为实际扩展面板定义和域函数局部调用，
完整原生作品调度与真实硬件**未验证**；两种JIT配置不代表每个分支都进入native机器码。
