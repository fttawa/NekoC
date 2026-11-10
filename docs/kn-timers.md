# KN 原生定时器执行边界

本实现选择与已测 **官方 KN 0.27.4 原生编译路径**一致，而不是按照 JavaScript 常识补出原生编辑器当前没有的闭包执行能力。官方来源、hash、插槽、完整作品及真实函数直接调用的区别见 [kn-async-services.md](kn-async-services.md)。

## VM 行为

- `setTimeout` / `setInterval` 是语句，求值 `delay` 一次，单位毫秒；不会阻塞当前脚本。
- 原生 callback statement 在官方进入域函数前被丢弃。本实现同样不编译/执行它，且不会将文本当代码 eval。**通用 JS 函数值/闭包回调未实现**。
- 空回调由 `src/engine/kn_async.rs` 的独立队列管理，只有后续 scheduler tick 才能到期；interval 每 tick 至多到期一次，避免零延迟忙循环。
- `clearTimeout(timeoutId)` 和 `clearInterval(intervalId)` 操作同一数字句柄空间。无效或不存在的句柄不做事。ID 只在本 VM 有效，不保证与浏览器实际数值相同。
- 普通 `wait`、广播、循环的调度代码没有因此改变，原有 [调度实测](kn-semantics.md) 继续由全量回归校验。
- 当前空回调注册上限为 4096，超过上限明确报错，不静默丢弃或无界分配。停止全部与重新开始清空队列。

## 回归与未验证

`tests/kn_async.rs` 覆盖 callback 不执行、delay reporter 只求值一次、脚本继续、跨 clear 取消、stop/restart 清理、畸形输入拒绝、超过热度阈值的 warp/JIT 回退、资源上限。队列单元测试覆盖毫秒换算、非有限/溢出延迟、到期顺序、延迟派发、interval 不追赶和句柄不复用。

以下是本地安全/确定性策略，**未验证为完整官方等价行为**：4096 上限、清理时序、ID 分配、浏览器最小延迟/后台节流、墙钟与 VM 仿真时间差异、scene 切换后 timer 生命周期。固定仿真 tick 不等同 JS macrotask；不能把上述测试视为逐毫秒/逐帧一致性认证。

由于官方当前原生回调缺口，本任务的“通用异步回调执行”仍属未完成。将来若官方补齐 statement→function 编译，或 NekoC 增加显式 JS 函数值模式，需要额外定义闭包捕获、重入、异常、取消以及 clone/actor 生命周期，而不能直接把 callback 当同步 `DO` 执行。
