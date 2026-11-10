# JIT 分项计时与 region 入口复用

## 定位开销

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo build --release --features jit-timing --bin jit-corpus
$env:NEKOC_JIT_TIMING='1'
target/release/jit-corpus.exe E:/nekoc/dist/kitten4-corpus --only 335327306,305999424,324380532 --timing-only --out dist/jit4/profile.json
Remove-Item Env:NEKOC_JIT_TIMING
```

`--only` 匹配外部作品的完整文件名主干，逗号分隔；缺少指定作品会报错，不复制或改写输入。不传时仍遍历整个语料。分项计时需要 `jit-timing` feature，普通构建将采集代码编译掉，避免每个 helper 增加动态分支；即使打开环境变量也不会启用。`NEKOC_JIT_TIMING=1` 必须在构造 Engine 前设置；不依赖覆盖率 Map，故可与 `--timing-only` 配合。结果在每个作品的 `report.profile.timing`：

- `compile`：热编译，包括 region 发现、IR 和后端编译；失败尝试也计时。
- `region/run`：一次 region 尝试，包括入口、机器码和退出；`region/entry` / `region/native` / `region/exit` 是其子项。
- `guard/actor`：需要 Rust helper 的实体类型检查，另计成功/失败次数。优化前 profiler 还记录 `guard/parameter` / `helper/parameter`；当前参数检查和读取已内联，计入 native residual。
- `reporter/node`、`helper/*`：解释求值、列表、变量、过程调用/返回和调度边界等 helper。
- `reentrant/*`：含 reporter 的尾部 helper；`helper/reentrant-tail` 是重叠计数，不能与其父 helper 次数相加。
- `sites` / `op_sites` / `expression_sites`：按 PC 或 helper 的槽位/编码参数定位热源；`note` 解释各类 site 的单位，不能都当作 bytecode PC。
- `counters`：实际消耗指令、零进展、fuel、yield、入口 boxed 拒绝等。多个条件可能同时成立，不是互斥退出原因。

计时单位 ns。`inclusive_ns` 含已计时子调用，`exclusive_ns` 减去这些子调用；**不能累加 inclusive 时间当总时间**。内联 tag guard、纯数学 helper 和生成代码指令保留在 native residual，并未独立测量。时钟、Map 和 RefCell 也会扰动父项，分项结果仅用于定位，不用于宣称 release 提速。性能对比必须关闭计时和覆盖率统计、前后交替至少五轮并按作品取中位数。

完成归因后，重新 `cargo build --release --bin jit-corpus`（不带 `jit-timing`）并保存独立二进制再测量；不要把开启 feature 的可执行文件即使未设置环境变量的结果冒称为无插桩构建。

## 入口复用的安全边界

同一 region 可以为不同控制流 leader 共用一份机器码，避免每次某个返回/分支入口变热后重新编译整个重叠控制流。入口必须是负责扣 fuel 的 chunk 起点；不能直接跳进一个 chunk 中部。每次从 Rust 进入仍重新获取 slots/locals/boxed 指针并执行整个 region 原有写入保护，typed fallback、输出限制、错误 PC、fuel 退款和调度 yield 均不改变。

多入口只复用已有 region 内的 leader，不探索额外后继、不覆盖已有编译结果。含 reporter 的尾部 helper 仍立即退出，不能因为共享入口而在重入后继续读旧指针。region 数是机器码编译数，不是可用入口数；覆盖率不是提速指标。

region 的静态上限为48条bytecode，限制短采样里复杂控制流的首次编译成本。若入口本身就是重入尾部指令，从该入口不可能获得后续内联运算收益：实际执行32次native样本后，后续该PC选择原解释器。前驱region仍可执行有用运算后调用该尾部helper。解释器回退如实记为`unprofitable-terminal-entry`，不记native/helper次数；不因开启profile改变策略，也不伪造native覆盖率。

过程数值参数通过当前调用帧的长度/tag guard 后直接读取 f64，省去 guard/read 两次 helper 往返。启动前检查 `repr(u8) Cell::Number` 的 tag/payload 偏移；每次 region 入口和 Call/Return 都刷新参数地址/长度，不读取 Rust Vec 的内部布局，不跨重入保留旧参数地址。非 Number 和缺参仍走原 evaluator。

这里只优化本地解释器与 native tier 的实现，不新增官方语义结论；已有官方证据和未验证边界见 [jit-coverage.md](jit-coverage.md)。

## jit4 固定 d9cb962 基线实测与限制

Windows x86_64 release、60帧、seed1、每帧2,000,000指令、虚拟时钟、不启用计时或覆盖统计；四版本每个五轮，正反顺序交替，按作品取`advance()`耗时总和中位数再求合计，包含热编译。起点HEAD是`cef8840`，本节固定整合HEAD是`d9cb962`，jit2是`23d1553`。之后源码又快进整合到`e946e08`，本节数字不是新整合点结果。旧二进制与新工具的快照精度不同，快照在计时外但可能影响缓存；共享主机上的其他任务不可控制。

| 批次 | jit2 合计μs | 起点HEAD | 整合HEAD | 优化后 | 相对jit2 | 相对整合HEAD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 与串行门禁并发的四版本五轮 | 2,625,237 | 2,666,874 | 2,834,962 | 2,647,552 | +0.85% | -6.61% |
| 本任务无并发构建/测试的四版本五轮 | 2,800,517 | 2,701,870 | 2,813,344 | 2,686,233 | -4.08% | -4.52% |

第二批同期解释器合计3,019,498 / 2,796,399 / 2,945,036 / 3,012,037μs。**不能据单批-4.08%宣称稳定达成低于jit2的目标**：批间噪声较大，且仍有作品退化。第二批`335327306`从整合HEAD269,049降到121,811μs（-54.73%）；`143928845`却从jit2 3,299 / 整合HEAD3,795升到4,760μs，`324380532`从jit2 139,689升到155,876μs（相对整合HEAD仍快2.40%）。短作品高百分比和整合引入的解释器变化均须保留，不能仅列有利作品。

本轮是**局部性能改善，目标部分完成，没有证明稳定提速**。region覆盖率从94.73%降到85.71%，主要因为约999,749次无收益单条终端入口转为真实解释执行；不是覆盖率回退被隐藏。本节d9cb962构建的三seed与小预算全语料本地差分均0；仍是52作品完成采样、1原有错误，不是53作品完整成功。reporter本体仍解释执行，长运行性能和ARM64真机未验证。

## 最终整合点的验证边界

源码最终基于`e946e08`。收尾依次单独运行fmt、严格all-targets clippy、all-targets Rust测试、JS工具测试、规定三seed语料门禁，均通过：Rust合计723 passed / 0 failed / 1 ignored（差分32 passed），JS 307 pass / 0 fail / 34 skipped，seed 1/6/42均52 ran / 1 run。Rust测试采用`RUST_TEST_THREADS=1`；此前并行columns差异的根因尚未证实，未放宽断言或预算。

新整合后的后台作业曾长时间没有输出；收尾不再追加长测量。其成功通知随后迟到，只核验现存数据：feature严格clippy通过，JIT测试43 passed / 0 failed / 1 ignored；release seed 1/6/42及997预算各53 works / 52 complete / 1原有error / 0 differences / 0 loadErrors。本地差分不等于官方轨迹/像素一致。

旧作业的e946e08四版本五轮数据完整落盘，收尾仅汇总：jit2 / cef8840 / e946e08未优化 / after的JIT逐作品中位数合计为2,708,667 / 2,752,291 / 2,867,017 / 2,767,229μs；同期解释器为2,923,852 / 2,892,609 / 3,045,776 / 3,095,392μs。after相对jit2 **慢2.16%**，相对e946e08未优化快3.48%，相对起点慢0.54%。`335327306`相对e946e08快53.98%，但相对jit2仍慢8.20%；`143928845`相对jit2慢39.72%、相对e946e08慢13.23%；`305999424`也分别慢2.03%和2.51%。完整53作品和20份原始样本保留在本worktree忽略目录`dist/jit4/latest-*`，没有删掉不利结果。**最终仍不能宣称稳定提速或消除单作品退化。**
