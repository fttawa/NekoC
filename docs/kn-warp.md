# KN 0.27.4 warp 切片取证

官方 <https://kn.codemao.cn/editor>，KN 0.27.4，Edge。所有作品为原创、无外部素材，位于 `tests/fixtures/kn-warp/`；全部必须有同 hash 的 `editor-compat ok=true`。没有读取或移植第三方作品/运行时实现。官方 bundle 仅留忽略目录 `dist/kn-warp/`，跟踪 JSON 只存 URL/hash/位置/观察，不存官方源码。

## 已确认语义

以下针对默认 **OptiRunner / user_debug_mode=false**，不是 DebugRunner 的一般保证。

- **单位是已到达的循环 body-tail 检查**，不是积木数、表达式数、过程调用数或浏览器帧数。repeat、until、range 在 body 后检查；最终一次 body 也检查。条件已成立、零次循环和 break 跳出不经 tail。80 条直线变量操作没有 iteration 检查。
- 先比较**旧计数 `> 30000`**，再递增（返回 true 时也递增）。因此关闭墙钟诊断中，第 **30002** 个完成边界首次 yield；30001 次循环直接结束，30002 次循环虽然 body 全完成，后继语句仍延到下一 step。
- 每次 **interpreter.step()** 入口重置计数和计时起点；不是整个 manager.update 共用。一个 update 中两个 interpreter 可各做 30002 个边界。一个 step 内嵌套/相邻 warp 共用预算，内外循环 tail 都计数；进入/退出 warp 不重置预算。
- 墙钟严格判断 `起点 + 4ms < 当前时间`。调用链为 RuntimeManager.wall_clock_now → ClockImpl.wall_clock_now → `_wall_clock_now`，浏览器优先 **performance.now() 浮点毫秒**，不可用时才 `(new Date).getTime()`，没有整数化。宿主计时精度/隐私量化仍可能影响边界。Rust 高精度 elapsed >4ms 不应人为取整到整数毫秒。
- yield 返回 scheduler 后本 update 不再重跑该 interpreter，继续其它 interpreter，随后任务更新、frame++。renderer 调用记录在长 warp 的中间状态出现，说明 warp 切片不会禁止后续渲染；**边界函数本身不刷新/渲染**。这只证明 renderer 调用，非像素或显示器呈现保证。
- 普通过程调用的 callee frame warp = 调用点词法 warp OR caller frame warp；内部过程切换不是额外 scheduler yield，预算不重置。被调用过程退出后 caller 的 warp 状态仍保持原值；过程内局部 warp 不污染非 warp caller。显式 wait 会正常阻塞，恢复时是新 step/新预算。
- **reporter 过程也能跨 update 挂起并恢复**。`reporter-local-warp` 首个确定性 step：count=30002、inside=0、done=0；下一 step 才赋 reporter 返回值 inside=30002、done=1。默认真实墙钟同样多 step 完成。同步求值而不可恢复的本地 reporter 即使最终变量匹配，仍有明确调度兼容缺口。

官方 compiler 的 warp 用词法深度，procedure program cache 按脚本 id；传播还依赖运行时 frame flag，**官方并非为每个 warped call 编译独立过程副本**。本地实现可用 warped 编译副本等价建模，但不可把这一实现选择写成官方结构。

## 证据层次与复现

```powershell
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
node tools/semantics-kn-warp.mjs --generate
$files=Get-ChildItem tests/fixtures/kn-warp/*.bcmkn | ForEach-Object { $_.FullName }
node tools/editor-compat.mjs @files --channel msedge --out dist/kn-warp/editor-compat.json
node tools/semantics-kn-warp.mjs --out dist/kn-warp/report-final.json --nekoc target/debug/kn-trace.exe
node tools/semantics-kn-warp.mjs --case reporter-local-warp --mode baseline --out dist/kn-warp/baseline.json
node tools/semantics-kn-warp.mjs --archive dist/kn-warp/report-final.json
node --test tests/kn-warp.test.mjs
```

`default` 不更改 scheduler、块实现、时钟、配置；只暴露 webpack loader，并用透传 wrapper 记录 step/tail/update/render。**这些 observer 有开销，墙钟切点不能作性能数据**，更不能保证另一次运行每帧进度相同。`baseline` 连 wrapper 也不安装，只读最终变量（无法提供逐 step 轨迹）。

`deterministic` 是**明确受控诊断**：Start 前设置 `config.deterministic`，只让 runner 关闭墙钟限制，保留官方原函数/计数。它不是“默认在线编辑器”的墙钟运行结果，也不是完整引擎 deterministic 配置的验证。`inspection.boundaryDiagnostics` 另外用隔离的上下文直接调用官方边界方法，验证旧计数及 4/4.001ms；它是单函数受控诊断，不混同项目实测。

## 归档接口

`docs/kn-warp-official.json` schema：`nekoc-kn-warp-official-v1`。

- `cases["名称/default" | "名称/deterministic"]`：fixture/hash、官方 main/runtime hash、method/config、pageErrors、最终 `variables`。
- `steps[]`：`id` interpreter id、`frame` 为 update 的 frames++ **之前**、完整 `before`/`after` 变量、`calls`（含非 warp）、`warpedCalls`、`countAfter`、`result` 官方 StepResult、`stackDepth`、`procedureFrames`。同一 update 的不同 interpreter 会有相同 frame；wait 阻塞可能使相邻 step frame 不连续。
- `updates[]` 聚合完成一次 update 后变量；`renders[]` renderer 调用快照。**跟踪归档为精简数据**：原始 observer 最多记录前 120 个 updates、前 500 次 render；archive 再将 updates 保留至首个 done=1 样本及其后一条，将 renders 连续相同 variables 的记录仅保留首条。`steps` 原样完整保留，不截断；`boundaries`、失败及本地差异也不删改。
- 每个 case 的 `archiveSampling` 明确记录原始/保留样本数及规则。`inspection` 仅保留 config、boundaryDiagnostics（baseline 另保留 instrumentation），不保留大型 own/prototype 检查结果。共享证据仍保留在每个 case 原位置，避免破坏 schema。完整原始报告在 `dist/kn-warp/report-final.json`（或调用者指定路径）；顶层 `rawReport` 记录该路径和 SHA-256。
- `inspection.boundaryDiagnostics`：明确隔离直接调用；`sourceEvidence.locations`：零基字符/UTF-8 字节偏移、片段长度/hash，**无源码正文**。
- 可选 `nekoc` / `finalVariablesEqual` 是本地最终状态对照，**不参与篡改官方状态、不表示调度等价**。`ok` 只表示官方所有 case 成功；本地差异独立保留。
- `editorCompat` 绑定每个 fixture 的当前 bytes；archive 拒绝不完整或 stale hash。
- 顶层 `baseline` 保存 reporter 的无 wrapper 默认运行；与主 `cases` 分开，不提供逐 step 轨迹。

## 未验证 / 限制

- 官方 native compiler 没有 continue 语句分派；break 跳过 tail 已实测，但 TypeScript continue 的本地 lowering 是否走 tail 本探针**未验证**。
- DebugRunner 源码不同：循环入口计数及墙钟分支不可套用上述 compiled-tail 结果，本轮未跑 debug 模式。
- forever 空循环、return/break 所有嵌套组合、同步/异步 tell、异步 reporter、错误路径、UI 调试、递归过程调用上限、完整逐帧像素一致性尚未覆盖。
- 官方证据本身不证明所有本地 interpreter/JIT/reporters 的兼容性；本地门禁结果见 worktree 根目录未提交的 `OC-REPORT.md`，不按本地差异修改官方观察。

## NekoC 实施范围

- `src/engine/kn_warp.rs` 独立保存 KN 每次 task resume 的计数和墙钟起点；与 K4 的旧策略分离。`Engine::use_virtual_clock()` 对应忽略4ms墙钟、保留迭代上限的可复现规则，不估算“每个积木耗时”。
- knwarp2 后默认墙钟通过独立 `kn_warp_sampling.rs` 自适应摊销读钟，最多间隔32尾；这与上文官方逐尾行为存在显式偏差，硬界及条件时间界见 [采样契约](kn-warp-sampling.md)。确定性模式不采样，仍按原计数逐尾判断。
- Repeat/RangeNext 及 while/until/forever 的尾部进入同一策略；JIT 的 `h_boundary` 共用该判断，执行后的边界只收费一次，立即退出 native region，后继不偷跑。
- `tests/kn_warp.rs` 将归档的 **12 个无显式 wait、无 reporter 的确定性项目**逐 update 全变量对照解释器/JIT，另验证真实时间过期的内部 gateway、热 native 状态/栈和续跑。原生 continue 只验证本地 lowering，不包装为官方实测。
- `procedure-wait` 保留为官方证据：官方 wait(0) 后隔一整个 update 才恢复，当前 Engine KN 的 wait(0) 在下一次 update 即恢复。这是原有等待边界缺口，本次没有改通用等待调度，故不纳入逐 update 一致的12项。
- `reporter-local-warp` 的官方挂起已证实，而本地 `call_reporter` 仍同步求值。**这不是完整实现任务的声明**：要补齐必须保存表达式求值 continuation，避免恢复时重做随机数、列表操作和其它副作用。此次不以返回最终值匹配掩盖已知不一致。
- legacy `runtime::Runtime` 的 CLI/桌面 Studio 路径未改；本轮解释器/JIT指默认 Web `Engine` 的两种执行模式。完整 fangjie 终态、调试器模式、像素刷新一致性仍未验证。

## 仓库作品短跑复核

本轮对**未修改的原作**再次执行 `tools/compat/kn-project-progress-probe.mjs`，约9秒累计请求等待后：fangjie world 长度28815、仍在初始化；tiny-lm 已生成5个token，文本“走到山上，”。两者运行成功、无 page error。只改初始化上界524287→7的独立 fangjie 副本达到 world=8、chunk_x/chunk_z各64、gui_dirty=0、角色逻辑(0,-65)，4070块编辑器检查通过。它不替代原作完整终态验证。

另外用现有 `tools/bench/hateneko.mjs --input ... --binary target/debug/perf-bench.exe --frames 12 --warmup 0 --repeats 1` 分别复跑 fangjie/tiny-lm；双边均成功且只读参考树 `unchanged=true`，但固定12次update的观测状态均不同。fangjie world 长度 NekoC=252335、HateNeko=360000；tiny-lm generated_ids 长度1对0。**这些是调试构建的兼容诊断，不是性能基准或加速比证据**；墙钟切片和工作量不同，不把 NOT-EQUAL 改写为通过，也不拿 HateNeko 替代官方规范。完整结果保留 `dist/kn-warp/hateneko-{fangjie,tiny-lm}/results.json`。
