# KN 第七轮：剩余入口的无设备降级

本轮以 `cf310a9`（当时最新 `oc/integrate`）为基线，处理覆盖清单原有的
45 个缺失入口。覆盖表的“缺失 0”只表示这 300 个名字都有编译/执行或元数据路径，
**不等于完整积木语义支持、真实硬件支持或官方全量一致**。

## 精确范围

- 7 个 microbit 异步传感器：无连接结果为 Number NaN，不是字符串、0 或 false。
- 30 个硬件 Promise 命令：先按官方面板顺序求值每个 value socket，再处理无设备
  提前返回。字段不会当表达式求值，不建立模拟电机、灯光、LED、音量或节拍状态。
- 6 个设备事件帽：保留专用休眠事件类型，正常编译/验证事件体；启动、键盘输入、
  重启都不派发设备事件。没有硬件后端，也没有伪造设备事件 API。
- `get_sprite_property`：仅作为兼容输入别名复用现有角色属性编译器；官方代码 API
  会转换到其他原生积木，**官方没有注册同名积木**。
- `get_voice_volume`：原生 VM 支持宿主输入，默认权限 pending 阻塞线程；权限拒绝兑现 0，
  显式停用录音兑现 NaN。浏览器本地采样和失败边界见 [本地实现](kn-local.md) 与
  [官方取证](kn-remaining-official.md)。实际无设备 NotFoundError 本轮未验证，失败返回 0
  仅有官方 catch/初始音量源码依据，不冒充实测。

硬件精确类型、value socket、字段、默认与非法输入的官方结果还可查
[microbit 证据](kn-hardware-remaining.md) 和 [其他硬件证据](kn-other-hardware.md)。
本轮新增的在线实测和版本/hash 在 [kn-remaining-official.md](kn-remaining-official.md)。
没有参考或移植 HateNeko 运行时逻辑。

## 实现及异步边界

`src/engine/kn_hardware.rs` 是精确 allowlist，未知硬件名字仍拒绝。
编译器按 `KnCurrent` provenance 接入，不污染 K4 分派。事件体不是被静默删除，
其中未知积木仍导致编译失败。

无设备命令不等待字段中指定的硬件时长，不能把“持续亮灯 10 秒”等当作本地计时器。
`src/engine/kn_await.rs` 对含精确异步叶子的表达式生成 task-local 暂存和逐个让出边界。
前面的子表达式和副作用不会在恢复时重跑；两个嵌套传感器分两次 update 恢复，
typed/numeric 路径均保留 numeric NaN。每个命令也至少跨一次 update。
只对含这些叶子的表达式启用 lowering，不改变现有同步/K4 表达式编译。
**完整 JS Promise/微任务队列、复杂过程返回/递归与调度组合仍未验证**，
尤其现有 reporter 自制过程解释器会同步运行过程体；本轮不是通用异步过程改造。
其他父 reporter 的全部输入求值顺序未逐类型验证；已覆盖算术、对象访问、逻辑、列表/文本路径的有限组合。
表达式深度上限 256，超限明确拒绝，不静默丢弃输入。

不复刻官方未连接 toast、去重 UI 状态、设备权限提示文案。连接设备后的数值校验、
设备通讯、自然事件生产者、USB/蓝牙差异均未实现。

## 回归

- `tests/kn_remaining_hardware.rs`：43 项精确名称，每项执行；传感器 typed/numeric/
  深表达式；30 命令所有 socket 求值次数与顺序、缺失/未知输入、输入运行错误；
  6 个事件的 DO/next 体编译验证、长时间无触发和重启。
- `tests/kn_hardware_remaining.rs`：原来 43 项拒绝回归改为逐项降级执行验证，仍保留
  已有同步硬件路径及输入错误边界。
- `tests/kn-catalog-status.test.mjs`：300 个名字、缺失 0、45 项保守状态、官方面板分类
  与执行状态分离、忽略注释/字段/遍历提示，不凭名字增加兼容率。

JIT 开/关都测不代表所有新增分支进入 native JIT；不支持的副作用路径应安全侧退出。
最终门禁结果、复现中的失败与未验证范围见未提交的根目录 `OC-REPORT.md`。
