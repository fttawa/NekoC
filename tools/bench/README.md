# 可复现性能基准

在仓库根目录 PowerShell 运行（第三方输入始终只读，所有产物限定 `dist/`）：

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='1'
$env:K4_PLAYER_DIR='E:\nekoc-wt\_ref\k4player\Kitten4播放器\resources\app'
$env:NEKOC_NODE_MODULES='D:/AppData/Local/Temp/opencode/nekoc-kitenn/node_modules'
cargo build --release --bin perf-bench
node tools/bench/prepare.mjs dist/bench/prepared
node tools/bench/run.mjs --runtime both --fixtures dist/bench/prepared --corpus E:/nekoc/dist/kitten4-corpus --frames 60 --warmup 10 --repeats 3 --out dist/bench/current
```

默认 180 测量帧、30 预热帧、3 次独立进程/浏览器，seed=1，60 Hz 固定调度 delta。
正式对比时保持参数一致，串行执行，避免同时 Cargo 构建、浏览器基准。
`--binary dist/bench/before.exe` 可指定留存的优化前 release 二进制；
`--input <原始作品路径>` 只测一个作品，`--timeout` 限制原生子进程时间。
`--fixtures dist/bench/prepared` 使用同一批官方发布 AST（递归必须走此路径）；不传时直接生成工作区探针，
当前 NekoC 的工作区过程导入会显式失败，不能把该失败当成递归性能结果。
`--allow-assets` 复用 oracle 的声明素材 HTTPS 白名单，无凭据获取；默认严格断网。
`node tools/bench/compare.mjs before.json after.json dist/bench/comparison.json` 核对输入 hash、每次运行最终状态后输出比值。
正式优化前后推荐用交错顺序的配对测试，避免测试时间/温度漂移：
`node tools/bench/paired.mjs dist/bench/bin/before.exe target/release/perf-bench.exe dist/bench/prepared dist/bench/paired`
（7 次独立进程，预热 10 帧、测量 120 帧；记录二进制 SHA-256）。
最终状态相同仍不是逐帧语义等价的证明，回归以 `tests/jit_differential.rs` 等测试为准。
官方加载由 oracle 的 `timeoutMs` 限制，整个 worker 子进程另有 `--timeout` 硬超时（默认 120 秒）。
若操作系统强制终止 worker，浏览器的正常关闭 finally 无法保证执行，应检查是否残留孤立进程。
出现不支持、预算超限、官方报错时保留失败原因，退出码非零，不计为性能通过。

输出：`results.json`（环境、输入 SHA-256、每帧原始数据、最终状态）、
`summary.md`、`corpus-scores.json`（静态候选分数）、自制 `.bcm` 及失败诊断。
自制作品在每帧反复执行固定批次，避免预热后只测空闲；广播接收者有官方调度产生的流水线延迟。
语料按计算/克隆/画笔积木静态计数依次取未入选的第一名（固定选三个）；这**不证明**这些积木实际执行。
不要把第三方作品或播放器复制进仓库跟踪路径。

## 计量边界

- NekoC：导入=读文件、JSON、K4 转换、Program 编译、Engine 创建；不含进程启动。
  帧=整个 `Engine::advance`（脚本、JIT、帧输出构建，不含编码、渲染、最终快照）。
  内存=Windows `PeakWorkingSetSize` / Linux `/proc/self/status` VmHWM，整个进程高水位。
- 官方：复用 `tools/compat/k4-oracle.mjs` 的隔离 `.orig` 内核，受控 rAF 不等待实际屏幕刷新。
  导入=页面 navigation time origin 到作品素材 ready（含页面内核启动、可能的 workspace 编译和二次载入，
  **不是**纯 JSON 解析且不含浏览器启动）；帧=包围 `RuntimeManager.update` 的 `performance.now()`，
  不做逐帧完整快照，不含协议通信/rAF 外层绘图。update 内同步画笔/事件成本仍包含。
  内存同时记录 CDP 发现的各 renderer 进程 Windows PeakWorkingSet64 / Linux VmHWM（包括内核启动和同步绘制），
  与 `performance.memory.usedJSHeapSize` 帧末采样最大值。后者**不是浏览器 RSS 峰值**。
  renderer 不包含 browser/GPU 进程；不同进程高水位不能直接相加当作同时峰值，也不作内存效率加速比。
  原生 GC/JIT 均不强制干预；原始数组保留预热成本。
- 不保证相同 seed 跨内核随机序列一致；依赖 Date/网络/输入的第三方作品仅是无人输入情景。
  速度比较必须先核对工作量和状态，不支持/加载失败绝不能写成 0 ms。
- HateNeko 是 KN/Love2D 后端，不能把 K4 输入默认为同语义。未装 Love2D/Lua、无 K4 适配时标为未验证，
  不下载或改写只读参考目录，不以简单 Lua 循环冒充运行时基准。

完整实测、限制及优化前后见 [docs/performance.md](../../docs/performance.md)。
