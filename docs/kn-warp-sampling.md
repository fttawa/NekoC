# KN 墙钟检查摊销（knwarp2）

本优化只影响默认墙钟模式；不是官方调度的逐尾等价实现。确定性模式仍在第
30002 个 warp 循环尾首次因计数让出，计数单位、严格比较与 reset 位置不变。

## 设计与偏差契约

- 每个 interpreter step 重置采样历史，第一尾必读钟；解释器与 JIT 继续通过
  `Engine::warp_iteration_yields` 使用同一个 `kn_warp::Slice`。
- 间隔从 1 开始，每次至多翻倍，硬上限为 32 尾。根据本 step 已观察到的最慢
  批次平均每尾耗时选择间隔，目标批次耗时 25μs；剩余预算的一半进一步限制间隔。
  距 deadline ≤50μs 时恢复逐尾检查。超过 4ms 时仍用严格 `>`，不提前让出。
- 硬保证（同一执行轨迹、同一尾时间序列，不比较两次独立运行）：若逐尾基线在
  第 `j` 尾首次观察到过期，采样版最迟第 `j+31` 尾观察到；
  若这些尾之间的完整墙钟间隔（含抢占）至多 `T`，附加延迟至多 `31*T`。
  计数上限仍可更早让出。要推导附加延迟 ≤0.1ms，须另有 `T≤100μs/31` 的条件。
  采样决定在 loop-tail 作出，不修改循环完成/继续/后继指令的执行约定。
- 测试使用可注入的合成时钟枚举32个相位和快转慢/突发过期；不使用 sleep。
  `kn_sampled_wall_slice_is_shared_when_native_and_interpreted_tails_alternate`
  让 JIT 与解释器双向交替，覆盖 repeat/range/forever 尾、最终/继续分支，
  并断言没有退到通用委托。已有 gateway 测试继续验证后继退款和恢复不重放。
- 25μs 是基于历史样本的目标，**不是任意程序/OS 下的无条件墙钟上界**。
  变慢的循环体、阻塞和线程抢占可以突破目标；即使逐尾检查也不能中断单个循环体。
  在没有循环体 WCET 或外部定时中断的情况下，不可能同时跳过读钟和保证无条件
  ≤0.1ms。测试应验证精确尾数界与给定每尾上界下的时间界，而不是用 sleep
  或本机计时冒充证明。
- 采样状态仅在当前 step 内累计。第一尾如果包含 JIT 编译等冷启动成本，
  最慢均值可能让该 step 保守地保持逐尾读钟；不会为追求速度忽略这个样本。
  最慢均值 ≥25μs 后锁定逐尾检查，本 step 不再计算采样间隔；避免在不能采样
  的慢路径上反而每尾增加多次整数除法。计算批次均值使用饱和的 u64 纳秒数。

## 证据范围

只读官方归档：
`E:/nekoc-wt/hncompat2/dist/hncompat2-official/crc_libs.8196dbd1.js`，
SHA-256 `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7`。
下列偏移为 UTF-8 解码后的 0-based JS 字符偏移（这些位置也等于字节偏移）。

| 模块 / 偏移 | 锚点与行为 |
|---|---|
| 85990 / 864527 | `max_warp_iterations_per_interpreter_step:3e4`，相邻默认 time limit 为 4ms |
| 83084 / 957710 | `t.prototype.step_iteration_yield=function`：非 warp 直接让出；旧计数 `>limit`，否则非 deterministic 才读 `run_mgr.wall_clock_now()`，严格 `start+4<now`，最后递增计数 |
| 83084 / 965624 | `t.prototype.step=function(){this.n_warp_iterations=0`；非 deterministic 设置 `warp_tick_start`，一次 step 的内部过程切换不重置 |
| 40299 / 975054 | `t.prototype._wall_clock_now=function`：优先 `performance.now()`，否则 Date 毫秒 |
| 56612 / 924463 | `create_iteration_yield_point` 输出 tail 检查 |
| 56612 / 935049 | `compile_warp` 只改编译深度，不重置预算 |
| 56612 / 935882、936410、937165、937905 | forever/until/repeat/range：body 后检查，最后一次 body 也检查；零次循环不检查 |
| 83084 / 958557 | `step_reset_program_counter` 只重置 PC，不重置时钟/计数 |
| 8541 / 1004131、995958 | `step_code` / `update`：让出后本 update 不再跑同一 interpreter，继续其他 interpreter 与 task update |

已实际只读核验上述文件 hash 和源码：**官方默认每尾读钟，没有 N 尾采样**；
deterministic、非 warp 或旧计数已超限时短路不读。step 入口还会读一次起点。
这限定 OptiRunner，不推断 DebugRunner。详见既有 `kn-warp.md`。

实测数据及验收结果见 `performance.md` 的 knwarp2 节。
本实现不移植 HateNeko 逻辑。固定时钟循环尾无需读钟，初始化/reset 仍读取起点，
历史计数分支保持不变；
墙钟模式的额外尾数是本优化显式接受的兼容性偏差，不宣称官方逐位一致。
